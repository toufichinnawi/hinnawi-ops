import { describe, it, expect } from 'vitest';
import {
  dailySalesToCsv,
  payrollToCsv,
  productSalesToCsv,
  combinedSummaryToCsv,
  type DailySalesRow,
  type PayrollRow,
  type ProductSalesRow,
  type CombinedRow,
} from './csvExport';

const locMap = new Map<number, string>([
  [1, 'PK'],
  [2, 'MK'],
  [4, 'CT'],
]);

describe('CSV Export Utilities', () => {
  describe('dailySalesToCsv', () => {
    it('should produce a header row and data rows', () => {
      const rows: DailySalesRow[] = [
        {
          saleDate: '2025-01-15',
          locationId: 1,
          totalSales: '1500.00',
          taxableSales: '1200.00',
          taxExemptSales: '300.00',
          gstCollected: '60.00',
          qstCollected: '119.70',
          totalDeposit: '1679.70',
          tipsCollected: '50.00',
          merchantFees: '25.00',
          labourCost: '375.00',
          orderCount: 85,
        },
      ];
      const csv = dailySalesToCsv(rows, locMap);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Date');
      expect(lines[0]).toContain('Store Code');
      expect(lines[0]).toContain('Total Sales');
      expect(lines[0]).toContain('Labour Cost');
      expect(lines[1]).toContain('2025-01-15');
      expect(lines[1]).toContain('PK');
      expect(lines[1]).toContain('1500.00');
      expect(lines[1]).toContain('375.00');
      expect(lines[1]).toContain('85');
    });

    it('should handle empty rows', () => {
      const csv = dailySalesToCsv([], locMap);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(1); // header only
    });

    it('should use locationId when code not in map', () => {
      const rows: DailySalesRow[] = [
        {
          saleDate: '2025-01-15',
          locationId: 99,
          totalSales: '100.00',
          taxableSales: '100.00',
          taxExemptSales: '0.00',
          gstCollected: '5.00',
          qstCollected: '9.98',
          totalDeposit: '114.98',
          tipsCollected: '0.00',
          merchantFees: '0.00',
          labourCost: '0.00',
          orderCount: 5,
        },
      ];
      const csv = dailySalesToCsv(rows, locMap);
      expect(csv).toContain('99');
    });

    it('should handle Date objects in saleDate', () => {
      const rows: DailySalesRow[] = [
        {
          saleDate: new Date('2025-03-10T00:00:00Z'),
          locationId: 2,
          totalSales: '500.00',
          taxableSales: '500.00',
          taxExemptSales: '0.00',
          gstCollected: '25.00',
          qstCollected: '49.88',
          totalDeposit: '574.88',
          tipsCollected: '10.00',
          merchantFees: '5.00',
          labourCost: '125.00',
          orderCount: 30,
        },
      ];
      const csv = dailySalesToCsv(rows, locMap);
      expect(csv).toContain('2025-03-10');
      expect(csv).toContain('MK');
    });
  });

  describe('payrollToCsv', () => {
    it('should produce correct header and data', () => {
      const rows: PayrollRow[] = [
        {
          payDate: '2025-01-31',
          locationId: 1,
          periodStart: '2025-01-16',
          periodEnd: '2025-01-31',
          grossWages: '12500.00',
          employerContributions: '1875.00',
          netPayroll: '10000.00',
          headcount: 8,
          totalHours: '640.00',
        },
      ];
      const csv = payrollToCsv(rows, locMap);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Pay Date');
      expect(lines[0]).toContain('Gross Wages');
      expect(lines[0]).toContain('Headcount');
      expect(lines[1]).toContain('PK');
      expect(lines[1]).toContain('12500.00');
      expect(lines[1]).toContain('8');
    });
  });

  describe('productSalesToCsv', () => {
    it('should produce correct header and data', () => {
      const rows: ProductSalesRow[] = [
        {
          periodStart: '2025-01-01',
          periodEnd: '2025-01-31',
          locationId: 2,
          section: 'items',
          itemName: 'Sesame Bagel',
          category: 'Bagels',
          groupName: 'Food',
          totalRevenue: '2500.00',
          quantitySold: 1200,
          quantityRefunded: 5,
        },
      ];
      const csv = productSalesToCsv(rows, locMap);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Item Name');
      expect(lines[0]).toContain('Category');
      expect(lines[0]).toContain('Quantity Sold');
      expect(lines[1]).toContain('MK');
      expect(lines[1]).toContain('Sesame Bagel');
      expect(lines[1]).toContain('Bagels');
      expect(lines[1]).toContain('1200');
    });

    it('should escape fields with commas', () => {
      const rows: ProductSalesRow[] = [
        {
          periodStart: '2025-01-01',
          periodEnd: '2025-01-31',
          locationId: 1,
          section: 'items',
          itemName: 'Bagel, Everything',
          category: 'Bagels',
          groupName: 'Food',
          totalRevenue: '500.00',
          quantitySold: 200,
          quantityRefunded: 0,
        },
      ];
      const csv = productSalesToCsv(rows, locMap);
      expect(csv).toContain('"Bagel, Everything"');
    });

    it('should escape fields with quotes', () => {
      const rows: ProductSalesRow[] = [
        {
          periodStart: '2025-01-01',
          periodEnd: '2025-01-31',
          locationId: 4,
          section: 'items',
          itemName: 'Bagel "Special"',
          category: 'Bagels',
          groupName: null,
          totalRevenue: '100.00',
          quantitySold: 50,
          quantityRefunded: 0,
        },
      ];
      const csv = productSalesToCsv(rows, locMap);
      expect(csv).toContain('"Bagel ""Special"""');
    });
  });

  describe('combinedSummaryToCsv', () => {
    it('should produce correct header and computed fields', () => {
      const rows: CombinedRow[] = [
        {
          date: '2025-01-15',
          storeCode: 'PK',
          revenue: 1500,
          laborCost: 375,
          laborPct: 25.0,
          orders: 85,
          avgTicket: 17.65,
          grossProfit: 1065,
          grossMarginPct: 71.0,
        },
      ];
      const csv = combinedSummaryToCsv(rows);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Revenue');
      expect(lines[0]).toContain('Labor Cost');
      expect(lines[0]).toContain('Labor %');
      expect(lines[0]).toContain('Avg Ticket');
      expect(lines[0]).toContain('Gross Margin %');
      expect(lines[1]).toContain('PK');
      expect(lines[1]).toContain('1500.00');
      expect(lines[1]).toContain('375.00');
      expect(lines[1]).toContain('25.0');
      expect(lines[1]).toContain('17.65');
      expect(lines[1]).toContain('71.0');
    });

    it('should handle multiple rows', () => {
      const rows: CombinedRow[] = [
        { date: '2025-01-15', storeCode: 'PK', revenue: 1500, laborCost: 375, laborPct: 25.0, orders: 85, avgTicket: 17.65, grossProfit: 1065, grossMarginPct: 71.0 },
        { date: '2025-01-15', storeCode: 'MK', revenue: 1200, laborCost: 360, laborPct: 30.0, orders: 60, avgTicket: 20.00, grossProfit: 852, grossMarginPct: 71.0 },
        { date: '2025-01-16', storeCode: 'PK', revenue: 1600, laborCost: 400, laborPct: 25.0, orders: 90, avgTicket: 17.78, grossProfit: 1136, grossMarginPct: 71.0 },
      ];
      const csv = combinedSummaryToCsv(rows);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(4); // header + 3 data rows
    });

    it('should handle empty rows', () => {
      const csv = combinedSummaryToCsv([]);
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(1); // header only
    });
  });

  describe('CSV field escaping', () => {
    it('should handle null and undefined values', () => {
      const rows: DailySalesRow[] = [
        {
          saleDate: '2025-01-15',
          locationId: 1,
          totalSales: null,
          taxableSales: undefined,
          taxExemptSales: '0.00',
          gstCollected: '0.00',
          qstCollected: '0.00',
          totalDeposit: '0.00',
          tipsCollected: '0.00',
          merchantFees: '0.00',
          labourCost: '0.00',
          orderCount: 0,
        },
      ];
      const csv = dailySalesToCsv(rows, locMap);
      // Should not throw and should produce a valid row
      const lines = csv.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should handle newlines in field values', () => {
      const rows: ProductSalesRow[] = [
        {
          periodStart: '2025-01-01',
          periodEnd: '2025-01-31',
          locationId: 1,
          section: 'items',
          itemName: 'Item\nWith Newline',
          category: 'Test',
          groupName: 'Test',
          totalRevenue: '100.00',
          quantitySold: 10,
          quantityRefunded: 0,
        },
      ];
      const csv = productSalesToCsv(rows, locMap);
      expect(csv).toContain('"Item\nWith Newline"');
    });
  });
});
