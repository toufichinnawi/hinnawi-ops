import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── Locations ───
await conn.execute(`INSERT IGNORE INTO locations (id, code, name, entityName, laborTarget, foodCostTarget) VALUES
  (1, 'PK', 'President Kennedy', '9427-0659 Quebec INC', 18.00, 30.00),
  (2, 'MK', 'Mackay', '9536-7900 Quebec Inc.', 23.00, 30.00),
  (3, 'ONT', 'Ontario', '9287-8982 Quebec Inc', 28.00, 31.00),
  (4, 'CT', 'Cathcart Tunnel', '9364-1009 Quebec INC', 24.00, 29.00),
  (5, 'FAC', 'Factory', 'Hinnawi Bros Bagel & Cafe', 20.00, 28.00)
`);

// ─── Suppliers ───
await conn.execute(`INSERT IGNORE INTO suppliers (id, name, code, category) VALUES
  (1, 'Gordon Food Service', 'GFS', 'Broadline Distributor'),
  (2, 'Farinex Distribution', 'FAR', 'Bakery & Flour'),
  (3, 'Dubé Loiselle', 'DUB', 'Dairy & Cheese'),
  (4, 'JG Rive-Sud', 'JGR', 'Produce'),
  (5, 'Nantel Distribution', 'NAN', 'Specialty Foods'),
  (6, 'Costco Wholesale', 'COS', 'Wholesale Grocery'),
  (7, 'Les Touriers', 'LES', 'Bakery Supplies'),
  (8, 'Lightspeed Commerce', 'LIG', 'POS System'),
  (9, 'Hydro-Québec', 'HYD', 'Utilities'),
  (10, 'Koomi POS', 'KOO', 'POS System'),
  (11, 'Pure Tea', 'PUR', 'Tea & Beverages')
`);

// ─── Integrations ───
await conn.execute(`INSERT IGNORE INTO integrations (id, name, type, status) VALUES
  (1, 'QuickBooks Online', 'accounting', 'live'),
  (2, 'ADP Payroll', 'payroll', 'syncing'),
  (3, 'Koomi POS', 'pos', 'live'),
  (4, 'Bank Feed', 'banking', 'disconnected')
`);

// ─── Alerts ───
await conn.execute(`INSERT IGNORE INTO alerts (id, type, severity, title, description, locationId) VALUES
  (1, 'inventory', 'urgent', 'Cream cheese below par at Mackay', 'Current stock: 4 units. Par level: 12 units. Reorder immediately.', 2),
  (2, 'receiving', 'urgent', 'Receiving variance detected for smoked salmon', 'Ordered 20 kg, received 18.2 kg. Variance: -1.8 kg ($54.00)', 1),
  (3, 'labor', 'medium', 'President-Kennedy labor is 1.6% above target today', 'Current: 19.6%, Target: 18.0%. Review lunch shift scheduling.', 1),
  (4, 'invoice', 'medium', '2 invoices missing GL approval', 'Gordon Food Service #GFS-2025-0892 and Farinex #FAR-2025-1204 need review.', NULL),
  (5, 'inventory', 'medium', 'Flour inventory count overdue at Factory', 'Last count: 5 days ago. Weekly count required per policy.', 5),
  (6, 'system', 'low', 'ADP payroll sync completed', 'Biweekly payroll for period ending Mar 7 synced successfully.', NULL)
`);

// ─── Sample Inventory Items ───
await conn.execute(`INSERT IGNORE INTO inventoryItems (id, itemCode, name, category, unit, avgCost, lastCost, parLevel, supplierId, cogsAccount) VALUES
  (1, 'FLR-001', 'All Purpose Flour 20kg', 'Bakery & Dough', 'bag', 18.5000, 19.2000, 10, 2, 'COGS - Bakery & Dough Ingredients'),
  (2, 'FLR-002', 'Bread Flour 20kg', 'Bakery & Dough', 'bag', 22.0000, 22.5000, 8, 2, 'COGS - Bakery & Dough Ingredients'),
  (3, 'CRM-001', 'Cream Cheese 2kg', 'Dairy & Cheese', 'tub', 12.5000, 13.0000, 24, 3, 'COGS - Dairy & Cheese'),
  (4, 'SMK-001', 'Smoked Salmon 1kg', 'Meat & Deli', 'kg', 30.0000, 32.0000, 15, 1, 'COGS - Meat & Deli'),
  (5, 'COF-001', 'Espresso Beans 2.5kg', 'Coffee & Beverages', 'bag', 28.0000, 29.5000, 10, 1, 'COGS - Coffee & Beverages'),
  (6, 'PRD-001', 'Avocado Case', 'Produce', 'case', 42.0000, 45.0000, 6, 4, 'COGS - Produce & Vegetables'),
  (7, 'PKG-001', 'Takeout Containers (500ct)', 'Packaging', 'case', 35.0000, 36.0000, 4, 6, 'COGS - Packaging & Supplies'),
  (8, 'DRY-001', 'Sesame Seeds 5kg', 'Bakery & Dough', 'bag', 15.0000, 15.5000, 6, 5, 'COGS - Bakery & Dough Ingredients'),
  (9, 'TEA-001', 'Earl Grey Tea (100 bags)', 'Coffee & Beverages', 'box', 22.0000, 22.5000, 8, 11, 'COGS - Coffee & Beverages'),
  (10, 'MTR-001', 'Turkey Breast 2kg', 'Meat & Deli', 'pkg', 18.0000, 19.0000, 12, 1, 'COGS - Meat & Deli')
`);

// ─── Sample Recipes ───
await conn.execute(`INSERT IGNORE INTO recipes (id, name, category, \`yield\`, yieldUnit, menuPrice, totalCost, costPerUnit, foodCostPct) VALUES
  (1, 'Sesame Bagel', 'Bagels', 12.00, 'dozen', 18.00, 3.85, 0.32, 21.39),
  (2, 'Everything Bagel', 'Bagels', 12.00, 'dozen', 18.00, 4.10, 0.34, 22.78),
  (3, 'Smoked Salmon Sandwich', 'Sandwiches', 1.00, 'unit', 14.95, 4.50, 4.50, 30.10),
  (4, 'Turkey Avocado Sandwich', 'Sandwiches', 1.00, 'unit', 13.95, 3.80, 3.80, 27.24),
  (5, 'Latte (12oz)', 'Coffee', 1.00, 'cup', 5.50, 0.85, 0.85, 15.45),
  (6, 'Cappuccino (12oz)', 'Coffee', 1.00, 'cup', 5.25, 0.80, 0.80, 15.24)
`);

// ─── Sample Purchase Orders ───
await conn.execute(`INSERT IGNORE INTO purchaseOrders (id, poNumber, supplierId, locationId, status, orderDate, expectedDate, subtotal) VALUES
  (1, 'PO-2025-001', 5, 1, 'submitted', '2025-03-14', '2025-03-15', 2140.00),
  (2, 'PO-2025-002', 5, 4, 'draft', '2025-03-14', '2025-03-16', 420.00),
  (3, 'PO-2025-003', 5, 2, 'submitted', '2025-03-13', '2025-03-14', 685.00),
  (4, 'PO-2025-004', 4, 3, 'received', '2025-03-12', '2025-03-13', 318.00)
`);

// ─── Seed Daily Sales from real POS data ───
// Generate realistic daily sales for Jan-Mar 2025
const salesData = [];
const startDate = new Date('2025-01-01');
const endDate = new Date('2025-03-14');

// Average daily sales by location
const locationAvgs = {
  1: { base: 3700, variance: 800 },  // PK
  2: { base: 2100, variance: 500 },  // MK
  4: { base: 780, variance: 200 },   // CT
};

for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  const dateStr = d.toISOString().split('T')[0];
  const dow = d.getDay();
  const dayMult = dow === 0 ? 0.6 : dow === 6 ? 0.85 : dow === 1 ? 0.9 : 1.0;

  for (const [locId, cfg] of Object.entries(locationAvgs)) {
    const total = Math.round((cfg.base + (Math.random() - 0.5) * cfg.variance) * dayMult * 100) / 100;
    const taxable = Math.round(total * 0.36 * 100) / 100;
    const exempt = Math.round((total - taxable) * 100) / 100;
    const gst = Math.round(taxable * 0.05 * 100) / 100;
    const qst = Math.round(taxable * 0.09975 * 100) / 100;
    const tips = Math.round(total * 0.08 * 100) / 100;
    const fees = Math.round(total * 0.025 * 100) / 100;

    salesData.push([locId, dateStr, exempt, taxable, total, gst, qst, total - fees, tips, fees]);
  }
}

// Batch insert sales
for (let i = 0; i < salesData.length; i += 50) {
  const batch = salesData.slice(i, i + 50);
  const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
  const values = batch.flat();
  await conn.execute(
    `INSERT INTO dailySales (locationId, saleDate, taxExemptSales, taxableSales, totalSales, gstCollected, qstCollected, totalDeposit, tipsCollected, merchantFees) VALUES ${placeholders}`,
    values
  );
}

// ─── Seed Payroll Records ───
const payrollDates = [];
let pd = new Date('2025-01-10');
while (pd <= endDate) {
  payrollDates.push(pd.toISOString().split('T')[0]);
  pd = new Date(pd.getTime() + 14 * 24 * 60 * 60 * 1000);
}

const payrollAvgs = {
  1: { gross: 8500, contrib: 1200, hc: 12, hrs: 420 },
  2: { gross: 6200, contrib: 900, hc: 9, hrs: 310 },
  4: { gross: 3800, contrib: 550, hc: 6, hrs: 190 },
  5: { gross: 7200, contrib: 1050, hc: 8, hrs: 360 },
};

for (const payDate of payrollDates) {
  for (const [locId, cfg] of Object.entries(payrollAvgs)) {
    const gross = Math.round((cfg.gross + (Math.random() - 0.5) * 1000) * 100) / 100;
    const contrib = Math.round((cfg.contrib + (Math.random() - 0.5) * 200) * 100) / 100;
    const net = Math.round((gross - gross * 0.25) * 100) / 100;
    await conn.execute(
      `INSERT INTO payrollRecords (locationId, payDate, periodStart, periodEnd, grossWages, employerContributions, netPayroll, headcount, totalHours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [locId, payDate, payDate, payDate, gross, contrib, net, cfg.hc, cfg.hrs + Math.round((Math.random() - 0.5) * 40)]
    );
  }
}

// ─── Seed Invoices from real supplier data ───
const invoiceSeed = [
  { num: 'GFS-2025-0892', sid: 1, lid: 5, dt: '2025-03-10', sub: 1245.80, gst: 62.29, qst: 124.27, st: 'pending' },
  { num: 'GFS-2025-0893', sid: 1, lid: 1, dt: '2025-03-11', sub: 890.50, gst: 44.53, qst: 88.83, st: 'approved' },
  { num: 'FAR-2025-1204', sid: 2, lid: 5, dt: '2025-03-08', sub: 1560.00, gst: 78.00, qst: 155.61, st: 'pending' },
  { num: 'FAR-2025-1205', sid: 2, lid: 5, dt: '2025-03-12', sub: 980.00, gst: 49.00, qst: 97.76, st: 'approved' },
  { num: 'DUB-2025-0456', sid: 3, lid: 5, dt: '2025-03-07', sub: 675.40, gst: 33.77, qst: 67.37, st: 'paid' },
  { num: 'DUB-2025-0457', sid: 3, lid: 2, dt: '2025-03-10', sub: 420.00, gst: 21.00, qst: 41.90, st: 'approved' },
  { num: 'JGR-2025-0089', sid: 4, lid: 5, dt: '2025-03-09', sub: 580.00, gst: 29.00, qst: 57.86, st: 'paid' },
  { num: 'NAN-2025-0034', sid: 5, lid: 5, dt: '2025-03-06', sub: 445.00, gst: 22.25, qst: 44.39, st: 'paid' },
  { num: 'COS-2025-0012', sid: 6, lid: 5, dt: '2025-03-05', sub: 312.00, gst: 0.00, qst: 0.00, st: 'paid' },
  { num: 'GFS-2025-0894', sid: 1, lid: 2, dt: '2025-03-13', sub: 1120.00, gst: 56.00, qst: 111.72, st: 'pending' },
  { num: 'FAR-2025-1206', sid: 2, lid: 5, dt: '2025-03-13', sub: 2100.00, gst: 105.00, qst: 209.48, st: 'pending' },
  { num: 'DUB-2025-0458', sid: 3, lid: 1, dt: '2025-03-12', sub: 550.00, gst: 27.50, qst: 54.86, st: 'pending' },
  { num: 'GFS-2025-0880', sid: 1, lid: 5, dt: '2025-02-28', sub: 1350.00, gst: 67.50, qst: 134.66, st: 'paid' },
  { num: 'GFS-2025-0881', sid: 1, lid: 1, dt: '2025-02-27', sub: 920.00, gst: 46.00, qst: 91.77, st: 'paid' },
  { num: 'FAR-2025-1190', sid: 2, lid: 5, dt: '2025-02-25', sub: 1800.00, gst: 90.00, qst: 179.55, st: 'paid' },
  { num: 'JGR-2025-0085', sid: 4, lid: 5, dt: '2025-02-26', sub: 490.00, gst: 24.50, qst: 48.88, st: 'paid' },
  { num: 'HYD-2025-0003', sid: 9, lid: 5, dt: '2025-02-15', sub: 520.00, gst: 26.00, qst: 51.87, st: 'paid' },
];

for (const inv of invoiceSeed) {
  const total = Math.round((inv.sub + inv.gst + inv.qst) * 100) / 100;
  await conn.execute(
    `INSERT INTO invoices (invoiceNumber, supplierId, locationId, invoiceDate, subtotal, gst, qst, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [inv.num, inv.sid, inv.lid, inv.dt, inv.sub, inv.gst, inv.qst, total, inv.st]
  );
}

console.log('✅ Database seeded successfully!');
console.log('  - 5 locations');
console.log('  - 11 suppliers');
console.log('  - 4 integrations');
console.log('  - 6 alerts');
console.log('  - 10 inventory items');
console.log('  - 6 recipes');
console.log('  - 4 purchase orders');
console.log(`  - ${salesData.length} daily sales records`);
console.log(`  - ${payrollDates.length * 4} payroll records`);
console.log(`  - ${invoiceSeed.length} invoices`);

await conn.end();
