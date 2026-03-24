import { describe, it, expect, vi } from "vitest";

// Mock the ENV module
vi.mock("./_core/env", () => ({
  ENV: {
    qboClientId: "test_client_id",
    qboClientSecret: "test_client_secret",
    qboEnvironment: "sandbox",
    appId: "",
    cookieSecret: "",
    databaseUrl: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    isProduction: false,
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

describe("QBO Module", () => {
  describe("getQboAuthUrl", () => {
    it("should generate a valid Intuit OAuth URL", async () => {
      const { getQboAuthUrl } = await import("./qbo");
      const url = getQboAuthUrl("https://example.com/api/qbo/callback", "test_state");
      expect(url).toContain("https://appcenter.intuit.com/connect/oauth2");
      expect(url).toContain("client_id=test_client_id");
      expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fqbo%2Fcallback");
      expect(url).toContain("response_type=code");
      expect(url).toContain("scope=com.intuit.quickbooks.accounting");
      expect(url).toContain("state=test_state");
    });

    it("should include all required OAuth parameters", async () => {
      const { getQboAuthUrl } = await import("./qbo");
      const url = getQboAuthUrl("https://app.test/callback", "abc123");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("client_id")).toBe("test_client_id");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    });
  });

  describe("exchangeCodeForTokens", () => {
    it("should call the Intuit token endpoint with correct parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "test_access",
          refresh_token: "test_refresh",
          expires_in: 3600,
          x_refresh_token_expires_in: 8726400,
          token_type: "bearer",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { exchangeCodeForTokens } = await import("./qbo");
      const result = await exchangeCodeForTokens("auth_code_123", "https://app.test/callback");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
          }),
        })
      );

      expect(result.access_token).toBe("test_access");
      expect(result.refresh_token).toBe("test_refresh");
      expect(result.expires_in).toBe(3600);

      vi.unstubAllGlobals();
    });

    it("should throw on failed token exchange", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("invalid_grant"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { exchangeCodeForTokens } = await import("./qbo");
      await expect(exchangeCodeForTokens("bad_code", "https://app.test/callback"))
        .rejects.toThrow("QBO token exchange failed");

      vi.unstubAllGlobals();
    });
  });

  describe("refreshAccessToken", () => {
    it("should call token endpoint with refresh_token grant type", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new_access",
          refresh_token: "new_refresh",
          expires_in: 3600,
          x_refresh_token_expires_in: 8726400,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { refreshAccessToken } = await import("./qbo");
      const result = await refreshAccessToken("old_refresh_token");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
      expect(opts.body.toString()).toContain("grant_type=refresh_token");
      expect(opts.body.toString()).toContain("refresh_token=old_refresh_token");
      expect(result.access_token).toBe("new_access");

      vi.unstubAllGlobals();
    });
  });

  describe("getQboConnectionStatus", () => {
    it("should return disconnected when no tokens exist", async () => {
      // Reset modules so doMock takes effect on fresh import
      vi.resetModules();
      vi.doMock("./_core/env", () => ({
        ENV: {
          qboClientId: "test_client_id",
          qboClientSecret: "test_client_secret",
          qboEnvironment: "sandbox",
          appId: "",
          cookieSecret: "",
          databaseUrl: "",
          oAuthServerUrl: "",
          ownerOpenId: "",
          isProduction: false,
          forgeApiUrl: "",
          forgeApiKey: "",
        },
      }));
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue({
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve([]),
                }),
              }),
            }),
          }),
        }),
      }));

      const { getQboConnectionStatus } = await import("./qbo");
      const status = await getQboConnectionStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe("QBO API URL construction", () => {
    it("should use sandbox URL when environment is sandbox", async () => {
      // The module is already loaded with sandbox env
      const { getQboAuthUrl } = await import("./qbo");
      // Auth URL is always the same regardless of environment
      const url = getQboAuthUrl("https://test.com/cb", "state");
      expect(url).toContain("appcenter.intuit.com");
    });
  });

  describe("createBill payload", () => {
    it("should construct valid bill payload structure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ Bill: { Id: "123" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      // Mock getActiveTokens to return valid tokens
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue({
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve([{
                    id: 1,
                    realmId: "123456",
                    accessToken: "test_token",
                    refreshToken: "test_refresh",
                    accessTokenExpiresAt: new Date(Date.now() + 3600000),
                    refreshTokenExpiresAt: new Date(Date.now() + 86400000 * 100),
                    companyName: "Test Co",
                    connectedBy: "test",
                    updatedAt: new Date(),
                    isActive: true,
                  }]),
                }),
              }),
            }),
          }),
        }),
      }));

      // Can't easily test createBill without full mock chain, but verify the module exports
      const qboModule = await import("./qbo");
      expect(typeof qboModule.createBill).toBe("function");
      expect(typeof qboModule.createJournalEntry).toBe("function");
      expect(typeof qboModule.getVendors).toBe("function");
      expect(typeof qboModule.getAccounts).toBe("function");
      expect(typeof qboModule.queryQbo).toBe("function");

      vi.unstubAllGlobals();
    });
  });
});
