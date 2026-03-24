import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Create mock DB with chainable query builder
function createMockDb(overrides: Record<string, any> = {}) {
  const mockRows: Record<string, any[]> = {
    appSettings: overrides.appSettings || [],
    syncLogs: overrides.syncLogs || [],
    invoices: overrides.invoices || [],
    suppliers: overrides.suppliers || [],
    qboTokens: overrides.qboTokens || [],
  };

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: any) => {
        const tableName = table?.name || table?.[Symbol.for("drizzle:Name")] || "unknown";
        const rows = mockRows[tableName] || [];
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
            limit: vi.fn().mockResolvedValue(rows),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
          limit: vi.fn().mockResolvedValue(rows),
        };
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  };

  return mockDb;
}

describe("Auto-Retry Scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getSetting", () => {
    it("should return null when setting does not exist", async () => {
      const mockDb = createMockDb({ appSettings: [] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { getSetting } = await import("./autoRetry");
      const result = await getSetting("nonexistent_key");
      expect(result).toBeNull();
    });

    it("should return the value when setting exists", async () => {
      const mockDb = createMockDb({ appSettings: [{ key: "test_key", value: "test_value" }] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { getSetting } = await import("./autoRetry");
      const result = await getSetting("test_key");
      expect(result).toBe("test_value");
    });

    it("should return null when database is not available", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const { getSetting } = await import("./autoRetry");
      const result = await getSetting("any_key");
      expect(result).toBeNull();
    });
  });

  describe("setSetting", () => {
    it("should insert a new setting when it does not exist", async () => {
      const mockDb = createMockDb({ appSettings: [] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { setSetting } = await import("./autoRetry");
      await setSetting("new_key", "new_value");

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should update an existing setting", async () => {
      const mockDb = createMockDb({ appSettings: [{ key: "existing_key", value: "old_value" }] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { setSetting } = await import("./autoRetry");
      await setSetting("existing_key", "new_value");

      expect(mockDb.update).toHaveBeenCalled();
    });

    it("should handle null database gracefully", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const { setSetting } = await import("./autoRetry");
      // Should not throw
      await setSetting("key", "value");
    });
  });

  describe("logSync", () => {
    it("should insert a sync log entry", async () => {
      const mockDb = createMockDb();
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { logSync } = await import("./autoRetry");
      await logSync({
        syncType: "auto_retry",
        invoiceId: 1,
        status: "success",
        qboBillId: "BILL-123",
        triggeredBy: "scheduler",
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should handle missing optional fields", async () => {
      const mockDb = createMockDb();
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { logSync } = await import("./autoRetry");
      await logSync({
        syncType: "manual_single",
        status: "failed",
        errorMessage: "Connection timeout",
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("getRecentSyncLogs", () => {
    it("should return recent sync logs", async () => {
      const mockLogs = [
        { id: 1, syncType: "auto_retry", status: "success", createdAt: new Date() },
        { id: 2, syncType: "manual_single", status: "failed", createdAt: new Date() },
      ];
      const mockDb = createMockDb({ syncLogs: mockLogs });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { getRecentSyncLogs } = await import("./autoRetry");
      const logs = await getRecentSyncLogs(10);
      expect(logs).toHaveLength(2);
    });

    it("should return empty array when no logs exist", async () => {
      const mockDb = createMockDb({ syncLogs: [] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { getRecentSyncLogs } = await import("./autoRetry");
      const logs = await getRecentSyncLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe("Scheduler Control", () => {
    it("should report not running initially", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const { getSchedulerStatus } = await import("./autoRetry");
      const status = getSchedulerStatus();
      expect(status.running).toBe(false);
      expect(status.lastRun).toBeNull();
      expect(status.lastResult).toBeNull();
    });

    it("should start and stop the scheduler", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const { startAutoRetryScheduler, stopAutoRetryScheduler, getSchedulerStatus } = await import("./autoRetry");

      startAutoRetryScheduler();
      expect(getSchedulerStatus().running).toBe(true);

      stopAutoRetryScheduler();
      expect(getSchedulerStatus().running).toBe(false);
    });

    it("should not start duplicate schedulers", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const consoleSpy = vi.spyOn(console, "log");
      const { startAutoRetryScheduler, stopAutoRetryScheduler } = await import("./autoRetry");

      startAutoRetryScheduler();
      startAutoRetryScheduler(); // Second call should log "already running"

      expect(consoleSpy).toHaveBeenCalledWith("[AutoRetry] Scheduler already running");

      stopAutoRetryScheduler();
      consoleSpy.mockRestore();
    });
  });

  describe("runAutoRetry", () => {
    it("should return zeros when database is not available", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const { runAutoRetry } = await import("./autoRetry");
      const result = await runAutoRetry();
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    });

    it("should return zeros when auto-retry is disabled", async () => {
      const mockDb = createMockDb({ appSettings: [{ key: "qbo_auto_retry_enabled", value: "false" }] });
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { runAutoRetry } = await import("./autoRetry");
      const result = await runAutoRetry();
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    });

    it("should return zeros when no failed invoices exist", async () => {
      // Create a more complete mock that handles the full query chain
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              orderBy: vi.fn().mockResolvedValue([]),
              limit: vi.fn().mockResolvedValue([{ key: "qbo_auto_retry_enabled", value: "true" }]),
            })),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1,
                realmId: "123",
                accessToken: "token",
                refreshToken: "refresh",
                accessTokenExpiresAt: new Date(Date.now() + 3600000),
                refreshTokenExpiresAt: new Date(Date.now() + 86400000 * 100),
                companyName: "Test",
                connectedBy: "test",
                updatedAt: new Date(),
                isActive: true,
              }]),
            }),
            limit: vi.fn().mockResolvedValue([]),
          })),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      // Mock QBO to return connected
      vi.doMock("./qbo", () => ({
        getQboConnectionStatus: vi.fn().mockResolvedValue({ connected: true }),
        createBill: vi.fn().mockResolvedValue({ Bill: { Id: "1" } }),
      }));

      const { runAutoRetry } = await import("./autoRetry");
      const result = await runAutoRetry();
      expect(result.attempted).toBe(0);
    });
  });

  describe("Module exports", () => {
    it("should export all required functions", async () => {
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(null),
      }));

      const autoRetry = await import("./autoRetry");
      expect(typeof autoRetry.getSetting).toBe("function");
      expect(typeof autoRetry.setSetting).toBe("function");
      expect(typeof autoRetry.logSync).toBe("function");
      expect(typeof autoRetry.getRecentSyncLogs).toBe("function");
      expect(typeof autoRetry.startAutoRetryScheduler).toBe("function");
      expect(typeof autoRetry.stopAutoRetryScheduler).toBe("function");
      expect(typeof autoRetry.getSchedulerStatus).toBe("function");
      expect(typeof autoRetry.runAutoRetry).toBe("function");
    });
  });

  describe("Sync type validation", () => {
    it("should accept all valid sync types", async () => {
      const mockDb = createMockDb();
      vi.doMock("./db", () => ({
        getDb: vi.fn().mockResolvedValue(mockDb),
      }));

      const { logSync } = await import("./autoRetry");

      const syncTypes = ["auto_retry", "manual_bulk", "manual_single", "scheduled"] as const;
      for (const syncType of syncTypes) {
        await logSync({ syncType, status: "success" });
      }

      expect(mockDb.insert).toHaveBeenCalledTimes(syncTypes.length);
    });
  });
});
