import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-admin",
    email: "admin@hinnawi.com",
    name: "Test Admin",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };

  return { ctx };
}

describe("Microsoft Graph API - Azure Credentials", () => {
  it("should obtain an access token using client credentials flow", async () => {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    expect(tenantId).toBeTruthy();
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.access_token).toBeTruthy();
    expect(data.token_type).toBe("Bearer");
    expect(data.expires_in).toBeGreaterThan(0);
  });

  it("should be able to list messages from accounting@bagelandcafe.com", async () => {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const mailRes = await fetch(
      "https://graph.microsoft.com/v1.0/users/accounting@bagelandcafe.com/messages?$top=5&$select=subject,from,receivedDateTime,hasAttachments",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    expect(mailRes.ok).toBe(true);
    const mailData = await mailRes.json();
    expect(mailData.value).toBeDefined();
    expect(Array.isArray(mailData.value)).toBe(true);
  });
});

describe("Email tRPC procedures", () => {
  it("email.list returns emails array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.list();
    expect(result).toHaveProperty("emails");
    expect(result).toHaveProperty("totalCount");
    expect(result).toHaveProperty("error");
    expect(Array.isArray(result.emails)).toBe(true);
  });

  it("email.list with attachments filter", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.list({ hasAttachments: true });
    expect(Array.isArray(result.emails)).toBe(true);
    for (const email of result.emails) {
      expect(email.hasAttachments).toBe(true);
    }
  });

  it("email.list with pagination", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.list({ top: 5, skip: 0 });
    expect(result.emails.length).toBeLessThanOrEqual(5);
  });

  it("email.folders returns mail folders", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.folders();
    expect(result).toHaveProperty("folders");
    expect(Array.isArray(result.folders)).toBe(true);
    if (result.folders.length > 0) {
      expect(result.folders[0]).toHaveProperty("displayName");
      expect(result.folders[0]).toHaveProperty("id");
    }
  });

  it("email.stats returns processing statistics", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("pending");
    expect(result).toHaveProperty("error");
    expect(typeof result.total).toBe("number");
  });

  it("email.processedEmails returns processed list and stats", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.email.processedEmails();
    expect(result).toHaveProperty("emails");
    expect(result).toHaveProperty("stats");
    expect(Array.isArray(result.emails)).toBe(true);
  });

  it("email.get fetches a specific email when given valid id", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const list = await caller.email.list({ top: 1 });
    if (list.emails.length > 0) {
      const email = await caller.email.get({ messageId: list.emails[0].id });
      expect(email).toHaveProperty("id");
      expect(email).toHaveProperty("subject");
      expect(email).toHaveProperty("body");
    }
  });

  it("email.attachments returns attachments for an email with attachments", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const list = await caller.email.list({ hasAttachments: true, top: 1 });
    if (list.emails.length > 0) {
      const attachments = await caller.email.attachments({ messageId: list.emails[0].id });
      expect(Array.isArray(attachments)).toBe(true);
      if (attachments.length > 0) {
        expect(attachments[0]).toHaveProperty("id");
        expect(attachments[0]).toHaveProperty("name");
        expect(attachments[0]).toHaveProperty("contentType");
        expect(attachments[0]).toHaveProperty("size");
      }
    }
  });
});
