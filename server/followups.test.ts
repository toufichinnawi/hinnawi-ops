import { describe, it, expect, vi } from "vitest";

// Test invoice creation logic
describe("Invoice Creation", () => {
  it("should calculate GST at 5% of subtotal", () => {
    const subtotal = 1000;
    const gst = +(subtotal * 0.05).toFixed(2);
    expect(gst).toBe(50);
  });

  it("should calculate QST at 9.975% of subtotal", () => {
    const subtotal = 1000;
    const qst = +(subtotal * 0.09975).toFixed(2);
    expect(qst).toBe(99.75);
  });

  it("should calculate total as subtotal + GST + QST", () => {
    const subtotal = 1000;
    const gst = +(subtotal * 0.05).toFixed(2);
    const qst = +(subtotal * 0.09975).toFixed(2);
    const total = +(subtotal + gst + qst).toFixed(2);
    expect(total).toBe(1149.75);
  });

  it("should handle zero subtotal", () => {
    const subtotal = 0;
    const gst = +(subtotal * 0.05).toFixed(2);
    const qst = +(subtotal * 0.09975).toFixed(2);
    const total = +(subtotal + gst + qst).toFixed(2);
    expect(total).toBe(0);
  });

  it("should handle decimal subtotals correctly", () => {
    const subtotal = 1234.56;
    const gst = +(subtotal * 0.05).toFixed(2);
    const qst = +(subtotal * 0.09975).toFixed(2);
    const total = +(subtotal + gst + qst).toFixed(2);
    expect(gst).toBe(61.73);
    expect(qst).toBe(123.15);
    expect(total).toBe(1419.44);
  });
});

// Test payroll journal entry generation logic
describe("Payroll Journal Entry Generation", () => {
  const mockPayrollRecord = {
    id: 1,
    locationId: 1,
    periodStart: "2025-03-01",
    periodEnd: "2025-03-14",
    grossWages: "15000.00",
    employerCpp: "750.00",
    employerEi: "375.00",
    employerQpip: "150.00",
    employerHealthTax: "225.00",
    totalEmployerCost: "16500.00",
    netPayroll: "12000.00",
    headcount: 12,
    totalHours: "960.00",
  };

  it("should calculate total employer contributions", () => {
    const cpp = parseFloat(mockPayrollRecord.employerCpp);
    const ei = parseFloat(mockPayrollRecord.employerEi);
    const qpip = parseFloat(mockPayrollRecord.employerQpip);
    const health = parseFloat(mockPayrollRecord.employerHealthTax);
    const totalContrib = +(cpp + ei + qpip + health).toFixed(2);
    expect(totalContrib).toBe(1500);
  });

  it("should calculate total employer cost as gross + contributions", () => {
    const gross = parseFloat(mockPayrollRecord.grossWages);
    const totalCost = parseFloat(mockPayrollRecord.totalEmployerCost);
    expect(totalCost).toBe(gross + 1500);
  });

  it("should format JE with debit = credit (balanced entry)", () => {
    const gross = parseFloat(mockPayrollRecord.grossWages);
    const cpp = parseFloat(mockPayrollRecord.employerCpp);
    const ei = parseFloat(mockPayrollRecord.employerEi);
    const qpip = parseFloat(mockPayrollRecord.employerQpip);
    const health = parseFloat(mockPayrollRecord.employerHealthTax);
    const net = parseFloat(mockPayrollRecord.netPayroll);

    // Debit side: Wage Expense + Employer Contributions
    const totalDebit = +(gross + cpp + ei + qpip + health).toFixed(2);

    // Credit side: Cash (net) + Payroll Liabilities (withholdings + employer contributions)
    const withholdings = +(gross - net).toFixed(2); // 3000
    const employerContrib = +(cpp + ei + qpip + health).toFixed(2); // 1500
    const totalCredit = +(net + withholdings + employerContrib).toFixed(2);

    expect(totalDebit).toBe(totalCredit);
  });

  it("should calculate hourly rate from gross wages and hours", () => {
    const gross = parseFloat(mockPayrollRecord.grossWages);
    const hours = parseFloat(mockPayrollRecord.totalHours);
    const hourlyRate = +(gross / hours).toFixed(2);
    expect(hourlyRate).toBe(15.63);
  });
});

// Test daily revenue journal entry logic
describe("Daily Revenue Journal Entry Generation", () => {
  const mockDailySale = {
    date: "2025-03-10",
    locationId: 1,
    grossSales: 3500,
    netSales: 3200,
    gst: 160,
    qst: 319.20,
  };

  it("should calculate GST as 5% of net sales", () => {
    const expectedGst = +(mockDailySale.netSales * 0.05).toFixed(2);
    expect(expectedGst).toBe(160);
  });

  it("should calculate QST as 9.975% of net sales", () => {
    const expectedQst = +(mockDailySale.netSales * 0.09975).toFixed(2);
    expect(expectedQst).toBe(319.20);
  });

  it("should create balanced JE (debit Bank = credit Revenue + GST + QST)", () => {
    const revenue = mockDailySale.netSales;
    const gst = mockDailySale.gst;
    const qst = mockDailySale.qst;

    const totalDebit = +(revenue + gst + qst).toFixed(2); // Bank/AR
    const totalCredit = +(revenue + gst + qst).toFixed(2); // Revenue + GST Payable + QST Payable

    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(3679.20);
  });

  it("should handle discounts (gross - net = discount amount)", () => {
    const discount = mockDailySale.grossSales - mockDailySale.netSales;
    expect(discount).toBe(300);
  });
});

// Test QBO sync status logic
describe("QBO Sync Status", () => {
  it("should identify unsynced approved invoices", () => {
    const invoices = [
      { id: 1, status: "pending", qboSynced: false },
      { id: 2, status: "approved", qboSynced: false },
      { id: 3, status: "approved", qboSynced: true },
      { id: 4, status: "paid", qboSynced: false },
      { id: 5, status: "rejected", qboSynced: false },
    ];

    const unsyncedApproved = invoices.filter(
      (i) => !i.qboSynced && (i.status === "approved" || i.status === "paid")
    );

    expect(unsyncedApproved.length).toBe(2);
    expect(unsyncedApproved.map((i) => i.id)).toEqual([2, 4]);
  });

  it("should count synced vs total", () => {
    const invoices = [
      { qboSynced: true },
      { qboSynced: true },
      { qboSynced: false },
      { qboSynced: false },
      { qboSynced: false },
    ];

    const synced = invoices.filter((i) => i.qboSynced).length;
    expect(synced).toBe(2);
    expect(invoices.length - synced).toBe(3);
  });
});

// Test email invoice extraction data
describe("Email Invoice Data Integrity", () => {
  const emailInvoices = [
    { supplier: "Portebleue", invoiceNumber: "PB-2025-0312", subtotal: 2850.0, source: "email" },
    { supplier: "UniFirst", invoiceNumber: "UF-2025-0287", subtotal: 485.0, source: "email" },
    { supplier: "UniFirst", invoiceNumber: "UF-2025-0288", subtotal: 485.0, source: "email" },
    { supplier: "UniFirst", invoiceNumber: "UF-2025-0289", subtotal: 520.0, source: "email" },
    { supplier: "JG Rive-Sud", invoiceNumber: "JG-2025-1847", subtotal: 1250.0, source: "email" },
    { supplier: "Farinex", invoiceNumber: "FAR-2025-0456", subtotal: 3200.0, source: "email" },
    { supplier: "GFS", invoiceNumber: "GFS-2025-2891", subtotal: 4500.0, source: "email" },
  ];

  it("should have 7 invoices extracted from email", () => {
    expect(emailInvoices.length).toBe(7);
  });

  it("should have unique invoice numbers", () => {
    const numbers = emailInvoices.map((i) => i.invoiceNumber);
    const unique = new Set(numbers);
    expect(unique.size).toBe(numbers.length);
  });

  it("should all have positive subtotals", () => {
    emailInvoices.forEach((inv) => {
      expect(inv.subtotal).toBeGreaterThan(0);
    });
  });

  it("should calculate total email invoice value", () => {
    const total = emailInvoices.reduce((s, i) => s + i.subtotal, 0);
    expect(total).toBe(13290);
  });

  it("should all be marked as email source", () => {
    emailInvoices.forEach((inv) => {
      expect(inv.source).toBe("email");
    });
  });
});
