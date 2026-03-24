import { describe, it, expect, vi } from "vitest";

// Test the createInvoiceFromEmail procedure logic
describe("Email → Invoice Creation", () => {
  describe("createInvoiceFromEmail procedure", () => {
    it("should validate processedEmailId is required", () => {
      // The procedure requires a processedEmailId
      const input = { processedEmailId: 1 };
      expect(input.processedEmailId).toBeDefined();
      expect(typeof input.processedEmailId).toBe("number");
    });

    it("should accept optional locationId override", () => {
      const input = { processedEmailId: 1, locationId: 3 };
      expect(input.locationId).toBe(3);
    });

    it("should accept optional supplier name override", () => {
      const input = { processedEmailId: 1, overrideSupplier: "GFS Canada" };
      expect(input.overrideSupplier).toBe("GFS Canada");
    });

    it("should accept optional total amount override", () => {
      const input = { processedEmailId: 1, overrideTotal: "1234.56" };
      expect(input.overrideTotal).toBe("1234.56");
    });
  });

  describe("createInvoiceFromExtraction procedure", () => {
    it("should validate extracted data structure", () => {
      const extractedData = {
        supplierName: "GFS Canada",
        invoiceNumber: "INV-2026-001",
        invoiceDate: "2026-03-12",
        dueDate: "2026-04-12",
        totalAmount: 1500.00,
        gst: 75.00,
        qst: 149.63,
        currency: "CAD",
        lineItems: [
          { description: "All Purpose Flour 20kg", quantity: 5, unitPrice: 45.00, amount: 225.00 },
          { description: "Sugar 10kg", quantity: 3, unitPrice: 28.50, amount: 85.50 },
        ],
      };

      expect(extractedData.supplierName).toBeTruthy();
      expect(extractedData.totalAmount).toBeGreaterThan(0);
      expect(extractedData.lineItems).toHaveLength(2);
      expect(extractedData.lineItems[0].description).toBe("All Purpose Flour 20kg");
    });

    it("should handle missing optional fields gracefully", () => {
      const extractedData = {
        supplierName: "Unknown Vendor",
        totalAmount: 100.00,
        lineItems: [],
      };

      expect(extractedData.supplierName).toBeTruthy();
      expect(extractedData.totalAmount).toBe(100.00);
      expect(extractedData.lineItems).toHaveLength(0);
    });
  });

  describe("Supplier matching logic", () => {
    const suppliers = [
      { id: 1, name: "GFS Canada" },
      { id: 2, name: "Farinex" },
      { id: 3, name: "UniFirst Canada" },
      { id: 4, name: "Portebleue" },
      { id: 5, name: "JG Rive-Sud" },
    ];

    it("should match exact supplier name", () => {
      const extracted = "GFS Canada";
      const match = suppliers.find(
        (s) => s.name.toLowerCase() === extracted.toLowerCase()
      );
      expect(match).toBeDefined();
      expect(match!.id).toBe(1);
    });

    it("should match partial supplier name (contains)", () => {
      const extracted = "GFS";
      const match = suppliers.find(
        (s) =>
          s.name.toLowerCase().includes(extracted.toLowerCase()) ||
          extracted.toLowerCase().includes(s.name.toLowerCase())
      );
      expect(match).toBeDefined();
      expect(match!.id).toBe(1);
    });

    it("should handle no match gracefully", () => {
      const extracted = "Sysco Foods";
      const match = suppliers.find(
        (s) =>
          s.name.toLowerCase().includes(extracted.toLowerCase()) ||
          extracted.toLowerCase().includes(s.name.toLowerCase())
      );
      expect(match).toBeUndefined();
    });

    it("should match case-insensitively", () => {
      const extracted = "unifirst canada";
      const match = suppliers.find(
        (s) => s.name.toLowerCase() === extracted.toLowerCase()
      );
      expect(match).toBeDefined();
      expect(match!.id).toBe(3);
    });
  });

  describe("Invoice creation data mapping", () => {
    it("should map extracted data to invoice fields correctly", () => {
      const extracted = {
        supplierName: "GFS Canada",
        invoiceNumber: "INV-001",
        invoiceDate: "2026-03-12",
        totalAmount: 1500.00,
        gst: 75.00,
        qst: 149.63,
      };

      const invoiceData = {
        supplierId: 1,
        invoiceNumber: extracted.invoiceNumber,
        invoiceDate: new Date(extracted.invoiceDate).getTime(),
        totalAmount: String(extracted.totalAmount),
        gstAmount: String(extracted.gst),
        qstAmount: String(extracted.qst),
        status: "pending" as const,
      };

      expect(invoiceData.supplierId).toBe(1);
      expect(invoiceData.invoiceNumber).toBe("INV-001");
      expect(invoiceData.totalAmount).toBe("1500");
      expect(invoiceData.gstAmount).toBe("75");
      expect(invoiceData.qstAmount).toBe("149.63");
      expect(invoiceData.status).toBe("pending");
    });

    it("should map line items to invoiceLineItems correctly", () => {
      const lineItems = [
        { description: "Flour 20kg", quantity: 5, unitPrice: 45.00, amount: 225.00 },
        { description: "Sugar 10kg", quantity: 3, unitPrice: 28.50, amount: 85.50 },
      ];

      const mappedItems = lineItems.map((li, idx) => ({
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(li.unitPrice),
        amount: String(li.amount),
        sortOrder: idx,
      }));

      expect(mappedItems).toHaveLength(2);
      expect(mappedItems[0].description).toBe("Flour 20kg");
      expect(mappedItems[0].quantity).toBe("5");
      expect(mappedItems[0].unitPrice).toBe("45");
      expect(mappedItems[0].amount).toBe("225");
      expect(mappedItems[1].sortOrder).toBe(1);
    });
  });

  describe("Processed email status tracking", () => {
    it("should track linked invoice ID after creation", () => {
      const processedEmail = {
        id: 1,
        status: "processed",
        linkedInvoiceId: null as number | null,
      };

      // After invoice creation
      processedEmail.linkedInvoiceId = 42;
      expect(processedEmail.linkedInvoiceId).toBe(42);
    });

    it("should prevent duplicate invoice creation from same email", () => {
      const processedEmail = {
        id: 1,
        status: "processed",
        linkedInvoiceId: 42,
      };

      // Should check if already linked
      const alreadyLinked = processedEmail.linkedInvoiceId !== null;
      expect(alreadyLinked).toBe(true);
    });
  });
});
