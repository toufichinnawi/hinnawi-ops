import { getDb } from "./db";
import { invoices, suppliers, payrollRecords, locations } from "../drizzle/schema";
import * as fs from "fs";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  const allInvoices = await db.select().from(invoices).orderBy(invoices.id);
  const allSuppliers = await db.select().from(suppliers);
  const allPayroll = await db.select().from(payrollRecords).orderBy(payrollRecords.payDate);
  const allLocations = await db.select().from(locations);

  fs.writeFileSync("/tmp/hinnawi_invoices.json", JSON.stringify(allInvoices, null, 2));
  fs.writeFileSync("/tmp/hinnawi_suppliers.json", JSON.stringify(allSuppliers, null, 2));
  fs.writeFileSync("/tmp/hinnawi_payroll.json", JSON.stringify(allPayroll, null, 2));
  fs.writeFileSync("/tmp/hinnawi_locations.json", JSON.stringify(allLocations, null, 2));

  console.log(`Exported: ${allInvoices.length} invoices, ${allSuppliers.length} suppliers, ${allPayroll.length} payroll, ${allLocations.length} locations`);
  process.exit(0);
}
main();
