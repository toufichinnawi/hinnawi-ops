/**
 * CSV Export Utilities
 * Generates CSV strings from database records for download.
 */

// Escape a CSV field: wrap in quotes if it contains comma, quote, or newline
function escapeField(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeField).join(',');
}

function formatDate(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).slice(0, 10);
}

// ─── Daily Sales CSV ───
export interface DailySalesRow {
  saleDate: unknown;
  locationId: number;
  totalSales: unknown;
  taxableSales: unknown;
  taxExemptSales: unknown;
  gstCollected: unknown;
  qstCollected: unknown;
  totalDeposit: unknown;
  tipsCollected: unknown;
  merchantFees: unknown;
  labourCost: unknown;
  orderCount: unknown;
}

export function dailySalesToCsv(
  rows: DailySalesRow[],
  locationMap: Map<number, string>,
): string {
  const header = [
    'Date', 'Store Code', 'Total Sales', 'Taxable Sales', 'Tax Exempt Sales',
    'GST Collected', 'QST Collected', 'Total Deposit', 'Tips Collected',
    'Merchant Fees', 'Labour Cost', 'Order Count',
  ];
  const lines = [toCsvRow(header)];
  for (const r of rows) {
    lines.push(toCsvRow([
      formatDate(r.saleDate),
      locationMap.get(r.locationId) || r.locationId,
      r.totalSales, r.taxableSales, r.taxExemptSales,
      r.gstCollected, r.qstCollected, r.totalDeposit, r.tipsCollected,
      r.merchantFees, r.labourCost, r.orderCount,
    ]));
  }
  return lines.join('\n') + '\n';
}

// ─── Payroll CSV ───
export interface PayrollRow {
  payDate: unknown;
  locationId: number;
  periodStart: unknown;
  periodEnd: unknown;
  grossWages: unknown;
  employerContributions: unknown;
  netPayroll: unknown;
  headcount: unknown;
  totalHours: unknown;
}

export function payrollToCsv(
  rows: PayrollRow[],
  locationMap: Map<number, string>,
): string {
  const header = [
    'Pay Date', 'Store Code', 'Period Start', 'Period End',
    'Gross Wages', 'Employer Contributions', 'Net Payroll',
    'Headcount', 'Total Hours',
  ];
  const lines = [toCsvRow(header)];
  for (const r of rows) {
    lines.push(toCsvRow([
      formatDate(r.payDate),
      locationMap.get(r.locationId) || r.locationId,
      formatDate(r.periodStart), formatDate(r.periodEnd),
      r.grossWages, r.employerContributions, r.netPayroll,
      r.headcount, r.totalHours,
    ]));
  }
  return lines.join('\n') + '\n';
}

// ─── Product Sales CSV ───
export interface ProductSalesRow {
  periodStart: unknown;
  periodEnd: unknown;
  locationId: number;
  section: unknown;
  itemName: unknown;
  category: unknown;
  groupName: unknown;
  totalRevenue: unknown;
  quantitySold: unknown;
  quantityRefunded: unknown;
}

export function productSalesToCsv(
  rows: ProductSalesRow[],
  locationMap: Map<number, string>,
): string {
  const header = [
    'Period Start', 'Period End', 'Store Code', 'Section',
    'Item Name', 'Category', 'Group', 'Total Revenue',
    'Quantity Sold', 'Quantity Refunded',
  ];
  const lines = [toCsvRow(header)];
  for (const r of rows) {
    lines.push(toCsvRow([
      formatDate(r.periodStart), formatDate(r.periodEnd),
      locationMap.get(r.locationId) || r.locationId,
      r.section, r.itemName, r.category, r.groupName,
      r.totalRevenue, r.quantitySold, r.quantityRefunded,
    ]));
  }
  return lines.join('\n') + '\n';
}

// ─── Combined Sales + Labor Summary CSV ───
export interface CombinedRow {
  date: string;
  storeCode: string;
  revenue: number;
  laborCost: number;
  laborPct: number;
  orders: number;
  avgTicket: number;
  grossProfit: number;
  grossMarginPct: number;
}

export function combinedSummaryToCsv(rows: CombinedRow[]): string {
  const header = [
    'Date', 'Store', 'Revenue', 'Labor Cost', 'Labor %',
    'Orders', 'Avg Ticket', 'Gross Profit', 'Gross Margin %',
  ];
  const lines = [toCsvRow(header)];
  for (const r of rows) {
    lines.push(toCsvRow([
      r.date, r.storeCode, r.revenue.toFixed(2), r.laborCost.toFixed(2),
      r.laborPct.toFixed(1), r.orders, r.avgTicket.toFixed(2),
      r.grossProfit.toFixed(2), r.grossMarginPct.toFixed(1),
    ]));
  }
  return lines.join('\n') + '\n';
}
