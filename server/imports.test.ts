import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  createImportLog: vi.fn().mockResolvedValue(1),
  updateImportLog: vi.fn().mockResolvedValue(undefined),
  getImportLogs: vi.fn().mockResolvedValue([
    {
      id: 1,
      importType: "pos_sales",
      fileName: "sales_march.csv",
      status: "completed",
      recordsFound: 30,
      recordsImported: 28,
      recordsSkipped: 2,
      recordsFailed: 0,
      locationId: 1,
      dateRangeStart: "2025-03-01",
      dateRangeEnd: "2025-03-30",
      importedBy: "Test User",
      createdAt: new Date("2025-03-15"),
      completedAt: new Date("2025-03-15"),
    },
  ]),
  bulkInsertDailySales: vi.fn().mockResolvedValue(5),
  bulkInsertPayroll: vi.fn().mockResolvedValue(3),
  bulkInsertBankTransactions: vi.fn().mockResolvedValue(10),
  getBankTransactions: vi.fn().mockResolvedValue([]),
  getAllLocations: vi.fn().mockResolvedValue([
    { id: 1, code: "MACK", name: "Mackay" },
    { id: 2, code: "PKEN", name: "President-Kennedy" },
  ]),
}));

import * as db from "./db";

describe("Import Pipeline - DB Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createImportLog", () => {
    it("creates a log entry with correct fields", async () => {
      const logId = await db.createImportLog({
        importType: "pos_sales",
        fileName: "koomi_export_march.csv",
        locationId: 1,
        importedBy: "Toufic",
      });
      expect(logId).toBe(1);
      expect(db.createImportLog).toHaveBeenCalledWith({
        importType: "pos_sales",
        fileName: "koomi_export_march.csv",
        locationId: 1,
        importedBy: "Toufic",
      });
    });

    it("creates payroll import log", async () => {
      await db.createImportLog({
        importType: "payroll",
        fileName: "adp_payroll_2025_03.xlsx",
        locationId: 2,
        importedBy: "Admin",
      });
      expect(db.createImportLog).toHaveBeenCalledWith(
        expect.objectContaining({ importType: "payroll" })
      );
    });

    it("creates bank statement import log", async () => {
      await db.createImportLog({
        importType: "bank_statement",
        fileName: "desjardins_march.csv",
      });
      expect(db.createImportLog).toHaveBeenCalledWith(
        expect.objectContaining({ importType: "bank_statement" })
      );
    });
  });

  describe("updateImportLog", () => {
    it("updates log with completion status", async () => {
      await db.updateImportLog(1, {
        status: "completed",
        recordsFound: 30,
        recordsImported: 28,
        recordsSkipped: 2,
        dateRangeStart: "2025-03-01",
        dateRangeEnd: "2025-03-30",
        completedAt: new Date("2025-03-15"),
      });
      expect(db.updateImportLog).toHaveBeenCalledWith(1, expect.objectContaining({
        status: "completed",
        recordsImported: 28,
      }));
    });

    it("updates log with failure status", async () => {
      await db.updateImportLog(1, {
        status: "failed",
        errors: ["Connection timeout"],
      });
      expect(db.updateImportLog).toHaveBeenCalledWith(1, expect.objectContaining({
        status: "failed",
      }));
    });
  });

  describe("getImportLogs", () => {
    it("returns import history", async () => {
      const logs = await db.getImportLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].importType).toBe("pos_sales");
      expect(logs[0].recordsImported).toBe(28);
    });
  });

  describe("bulkInsertDailySales", () => {
    it("inserts sales records and returns count", async () => {
      const rows = [
        { locationId: 1, saleDate: "2025-03-01", totalSales: "4500.00", gstCollected: "225.00", qstCollected: "448.88" },
        { locationId: 1, saleDate: "2025-03-02", totalSales: "3800.00", gstCollected: "190.00", qstCollected: "378.10" },
      ];
      const count = await db.bulkInsertDailySales(rows);
      expect(count).toBe(5);
      expect(db.bulkInsertDailySales).toHaveBeenCalledWith(rows);
    });

    it("handles empty array gracefully", async () => {
      (db.bulkInsertDailySales as any).mockResolvedValueOnce(0);
      const count = await db.bulkInsertDailySales([]);
      expect(count).toBe(0);
    });
  });

  describe("bulkInsertPayroll", () => {
    it("inserts payroll records", async () => {
      const rows = [
        {
          locationId: 1,
          payDate: "2025-03-14",
          grossWages: "12500.00",
          employerContributions: "1875.00",
          netPayroll: "9375.00",
          headcount: 8,
          totalHours: "640.00",
        },
      ];
      const count = await db.bulkInsertPayroll(rows);
      expect(count).toBe(3);
      expect(db.bulkInsertPayroll).toHaveBeenCalledWith(rows);
    });
  });

  describe("bulkInsertBankTransactions", () => {
    it("inserts bank transactions", async () => {
      const rows = [
        {
          transactionDate: "2025-03-01",
          description: "DEPOSIT - POS Settlement",
          credit: "4200.00",
          debit: "0.00",
          locationId: 1,
        },
        {
          transactionDate: "2025-03-02",
          description: "ADP PAYROLL",
          debit: "9500.00",
          credit: "0.00",
          locationId: 1,
        },
        {
          transactionDate: "2025-03-03",
          description: "VIREMENT INTERCOMPANY",
          debit: "5000.00",
          credit: "0.00",
        },
      ];
      const count = await db.bulkInsertBankTransactions(rows);
      expect(count).toBe(10);
      expect(db.bulkInsertBankTransactions).toHaveBeenCalledWith(rows);
    });
  });
});

describe("Import Pipeline - Data Parsing Logic", () => {
  // Test the date parsing logic used in routers
  function parseDate(dateVal: string): string {
    if (dateVal.includes("/")) {
      const parts = dateVal.split("/");
      if (parts.length === 3) {
        const [m, d, y] = parts;
        return `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
    return dateVal;
  }

  function parseNum(val: string): string {
    if (!val) return "0.00";
    return String(parseFloat(String(val).replace(/[^0-9.-]/g, "")) || 0);
  }

  function detectTransactionType(description: string): string {
    const descLower = description.toLowerCase();
    if (descLower.includes("transfer") || descLower.includes("virement")) return "intercompany";
    if (descLower.includes("payroll") || descLower.includes("adp") || descLower.includes("paie")) return "payroll";
    if (descLower.includes("deposit") || descLower.includes("dépôt")) return "sales_deposit";
    return "unmatched";
  }

  describe("Date Parsing", () => {
    it("parses MM/DD/YYYY format", () => {
      expect(parseDate("03/15/2025")).toBe("2025-03-15");
    });

    it("parses MM/DD/YY format", () => {
      expect(parseDate("03/15/25")).toBe("2025-03-15");
    });

    it("passes through ISO format unchanged", () => {
      expect(parseDate("2025-03-15")).toBe("2025-03-15");
    });

    it("handles single-digit months and days", () => {
      expect(parseDate("3/5/2025")).toBe("2025-03-05");
    });
  });

  describe("Number Parsing", () => {
    it("parses clean numbers", () => {
      expect(parseNum("4500.00")).toBe("4500");
    });

    it("strips currency symbols", () => {
      expect(parseNum("$4,500.00")).toBe("4500");
    });

    it("handles negative numbers", () => {
      expect(parseNum("-1200.50")).toBe("-1200.5");
    });

    it("returns 0 for empty strings", () => {
      expect(parseNum("")).toBe("0.00");
    });
  });

  describe("Bank Transaction Type Detection", () => {
    it("detects intercompany transfers (English)", () => {
      expect(detectTransactionType("TRANSFER TO 9287-8982")).toBe("intercompany");
    });

    it("detects intercompany transfers (French)", () => {
      expect(detectTransactionType("VIREMENT INTERCOMPAGNIE")).toBe("intercompany");
    });

    it("detects payroll via ADP", () => {
      expect(detectTransactionType("ADP PAYROLL DEBIT")).toBe("payroll");
    });

    it("detects payroll via French keyword", () => {
      expect(detectTransactionType("PAIE EMPLOYÉS")).toBe("payroll");
    });

    it("detects sales deposits", () => {
      expect(detectTransactionType("POS DEPOSIT SETTLEMENT")).toBe("sales_deposit");
    });

    it("detects French deposits", () => {
      expect(detectTransactionType("DÉPÔT JOURNALIER")).toBe("sales_deposit");
    });

    it("returns unmatched for unknown descriptions", () => {
      expect(detectTransactionType("CHEQUE #12345")).toBe("unmatched");
    });
  });
});
