/**
 * Sync All Script - Pushes all invoices as Bills and creates payroll JEs in QBO
 * Run via: npx tsx server/syncAll.ts
 */
import { getDb } from "./db";
import { invoices, suppliers, payrollRecords, locations, dailySales } from "../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import * as qbo from "./qbo";

async function syncAllInvoices() {
  const db = await getDb();
  if (!db) { console.error("No DB"); return; }

  // Verify QBO connection
  const status = await qbo.getQboConnectionStatus();
  if (!status.connected) {
    console.error("QBO not connected!");
    return;
  }
  console.log(`Connected to QBO: ${status.companyName} (Realm: ${status.realmId})`);

  // Get all invoices
  const allInvoices = await db.select().from(invoices).orderBy(invoices.id);
  const allSuppliers = await db.select().from(suppliers);
  const supplierMap = new Map(allSuppliers.map(s => [s.id, s]));

  console.log(`\n=== SYNCING ${allInvoices.length} INVOICES AS BILLS ===\n`);

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const inv of allInvoices) {
    // Skip already synced
    if (inv.qboSyncStatus === "synced" && inv.qboBillId) {
      console.log(`  SKIP #${inv.id} ${inv.invoiceNumber} - already synced (Bill ${inv.qboBillId})`);
      skipped++;
      continue;
    }

    const supplier = supplierMap.get(inv.supplierId!);
    const vendorName = supplier?.name || "Unknown Vendor";

    try {
      // Build line items: subtotal + GST + QST as separate lines
      const lineItems: Array<{ description: string; amount: number }> = [];

      // Main expense line
      lineItems.push({
        description: `Invoice ${inv.invoiceNumber || inv.id} - ${vendorName}`,
        amount: Number(inv.subtotal),
      });

      // GST line if present
      if (inv.gst && Number(inv.gst) > 0) {
        lineItems.push({
          description: `GST - Invoice ${inv.invoiceNumber || inv.id}`,
          amount: Number(inv.gst),
        });
      }

      // QST line if present
      if (inv.qst && Number(inv.qst) > 0) {
        lineItems.push({
          description: `QST - Invoice ${inv.invoiceNumber || inv.id}`,
          amount: Number(inv.qst),
        });
      }

      const result = await qbo.createBill({
        vendorName,
        txnDate: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().split("T")[0] : undefined,
        docNumber: inv.invoiceNumber || `INV-${inv.id}`,
        lineItems,
      });

      const billId = result?.Bill?.Id;

      // Update DB
      await db.update(invoices).set({
        qboSynced: true,
        qboSyncStatus: "synced",
        qboSyncError: null,
        qboSyncedAt: new Date(),
        qboBillId: billId ? String(billId) : null,
      }).where(eq(invoices.id, inv.id));

      console.log(`  OK   #${inv.id} ${inv.invoiceNumber} | ${vendorName} | $${inv.total} → Bill #${billId}`);
      synced++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`  FAIL #${inv.id} ${inv.invoiceNumber} | ${vendorName} | $${inv.total} → ${err.message}`);

      await db.update(invoices).set({
        qboSynced: false,
        qboSyncStatus: "failed",
        qboSyncError: err.message,
      }).where(eq(invoices.id, inv.id));

      failed++;
    }
  }

  console.log(`\nInvoice sync complete: ${synced} synced, ${failed} failed, ${skipped} skipped`);
  return { synced, failed, skipped };
}

async function createPayrollJournalEntries() {
  const db = await getDb();
  if (!db) { console.error("No DB"); return; }

  const allPayroll = await db.select().from(payrollRecords).orderBy(payrollRecords.payDate);
  const allLocations = await db.select().from(locations);
  const locationMap = new Map(allLocations.map(l => [l.id, l]));

  console.log(`\n=== CREATING ${allPayroll.length} PAYROLL JOURNAL ENTRIES ===\n`);

  let created = 0;
  let failed = 0;

  for (const pr of allPayroll) {
    const loc = locationMap.get(pr.locationId!);
    const locName = loc?.name || `Location ${pr.locationId}`;
    const payDate = pr.payDate ? new Date(pr.payDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
    const periodStart = pr.periodStart ? new Date(pr.periodStart).toISOString().split("T")[0] : "";
    const periodEnd = pr.periodEnd ? new Date(pr.periodEnd).toISOString().split("T")[0] : "";

    try {
      // Payroll JE structure:
      // Debit: Wages Expense (gross wages)
      // Debit: Employer Contributions Expense
      // Credit: Cash/Bank (net payroll)
      // Credit: Payroll Liabilities (withholdings = gross - net)
      // Credit: Employer Payroll Taxes Payable (employer contributions)

      const grossWages = Number(pr.grossWages);
      const employerContrib = Number(pr.employerContributions);
      const netPayroll = Number(pr.netPayroll);
      const withholdings = grossWages - netPayroll;

      // Use generic account IDs (QBO sandbox has default accounts)
      // We'll use account names and let QBO match them
      const result = await qbo.createJournalEntry({
        txnDate: payDate,
        docNumber: `PAY-${loc?.code || "XX"}-${payDate}`,
        privateNote: `Payroll for ${locName} | Period: ${periodStart} to ${periodEnd} | Headcount: ${pr.headcount} | Hours: ${pr.totalHours}`,
        lines: [
          {
            postingType: "Debit",
            amount: grossWages,
            accountId: "44", // Payroll Expenses (common sandbox account)
            accountName: "Payroll Expenses",
            description: `Gross Wages - ${locName}`,
          },
          {
            postingType: "Debit",
            amount: employerContrib,
            accountId: "44", // Payroll Expenses
            accountName: "Payroll Expenses",
            description: `Employer Contributions - ${locName} (CPP, EI, QPIP, HSF)`,
          },
          {
            postingType: "Credit",
            amount: netPayroll,
            accountId: "35", // Checking (common sandbox account)
            accountName: "Checking",
            description: `Net Payroll Paid - ${locName}`,
          },
          {
            postingType: "Credit",
            amount: withholdings,
            accountId: "89", // Payroll Liabilities
            accountName: "Payroll Liabilities",
            description: `Employee Withholdings - ${locName} (Tax, CPP, EI, QPIP)`,
          },
          {
            postingType: "Credit",
            amount: employerContrib,
            accountId: "89", // Payroll Liabilities
            accountName: "Payroll Liabilities",
            description: `Employer Payroll Taxes Payable - ${locName}`,
          },
        ],
      });

      const jeId = result?.JournalEntry?.Id;
      console.log(`  OK   Payroll ${locName} ${payDate} | Gross: $${grossWages.toFixed(2)} → JE #${jeId}`);
      created++;

      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`  FAIL Payroll ${locName} ${payDate} | $${pr.grossWages} → ${err.message}`);
      failed++;
    }
  }

  console.log(`\nPayroll JE creation complete: ${created} created, ${failed} failed`);
  return { created, failed };
}

async function main() {
  console.log("========================================");
  console.log("  HINNAWI OPS - QBO FULL SYNC");
  console.log("========================================\n");

  // Step 1: Sync all invoices
  const invoiceResult = await syncAllInvoices();

  // Step 2: Create payroll journal entries
  const payrollResult = await createPayrollJournalEntries();

  console.log("\n========================================");
  console.log("  SYNC SUMMARY");
  console.log("========================================");
  console.log(`Invoices: ${invoiceResult?.synced} synced, ${invoiceResult?.failed} failed, ${invoiceResult?.skipped} skipped`);
  console.log(`Payroll JEs: ${payrollResult?.created} created, ${payrollResult?.failed} failed`);
  console.log("========================================\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
