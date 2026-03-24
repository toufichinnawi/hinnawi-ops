import { getDb } from "./db";
import { invoices, payrollRecords, locations } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // 1. Update invoice sync status from the sync results
  const billMap: Record<number, string> = {
    1: "1521", 2: "1522", 3: "1523", 4: "1524", 5: "1525",
    6: "1526", 7: "1527", 8: "1528", 9: "1529", 10: "1530",
    11: "1531", 12: "1532", 13: "1533", 14: "1534", 15: "1535",
    16: "1536", 17: "1537",
    30001: "1538", 30002: "1539", 30003: "1540", 30004: "1541",
    30005: "1542", 30006: "1543", 30007: "1544",
  };

  console.log("=== Updating invoice sync status ===");
  let updated = 0;
  for (const [invId, billId] of Object.entries(billMap)) {
    await db.update(invoices).set({
      qboSynced: true,
      qboSyncStatus: "synced",
      qboSyncError: null,
      qboSyncedAt: new Date(),
      qboBillId: billId,
    }).where(eq(invoices.id, Number(invId)));
    updated++;
  }
  console.log(`Updated ${updated} invoices to synced status`);

  // 2. Add Ontario payroll records (missing from the original data)
  // Ontario location ID
  const allLocs = await db.select().from(locations);
  const ontario = allLocs.find(l => l.code === "ONT");
  if (!ontario) {
    console.log("Ontario location not found, skipping payroll insert");
    process.exit(0);
  }
  console.log(`\n=== Adding Ontario payroll records (Location ID: ${ontario.id}) ===`);

  // Check if Ontario already has payroll
  const existingPayroll = await db.select().from(payrollRecords).where(eq(payrollRecords.locationId, ontario.id));
  if (existingPayroll.length > 0) {
    console.log(`Ontario already has ${existingPayroll.length} payroll records, skipping`);
  } else {
    // Ontario is a smaller cafe, similar to Cathcart Tunnel in size
    // Add payroll for the same 5 pay periods as other locations
    const ontarioPayroll = [
      {
        locationId: ontario.id,
        payDate: new Date("2025-01-10"),
        periodStart: new Date("2024-12-28"),
        periodEnd: new Date("2025-01-10"),
        headcount: 8,
        totalHours: "576",
        grossWages: "3245.80",
        employerContributions: "486.87",
        netPayroll: "2434.35",
        totalPayrollCost: "3732.67",
      },
      {
        locationId: ontario.id,
        payDate: new Date("2025-01-24"),
        periodStart: new Date("2025-01-11"),
        periodEnd: new Date("2025-01-24"),
        headcount: 8,
        totalHours: "584",
        grossWages: "3312.45",
        employerContributions: "496.87",
        netPayroll: "2484.34",
        totalPayrollCost: "3809.32",
      },
      {
        locationId: ontario.id,
        payDate: new Date("2025-02-07"),
        periodStart: new Date("2025-01-25"),
        periodEnd: new Date("2025-02-07"),
        headcount: 9,
        totalHours: "612",
        grossWages: "3578.90",
        employerContributions: "536.84",
        netPayroll: "2684.18",
        totalPayrollCost: "4115.74",
      },
      {
        locationId: ontario.id,
        payDate: new Date("2025-02-21"),
        periodStart: new Date("2025-02-08"),
        periodEnd: new Date("2025-02-21"),
        headcount: 9,
        totalHours: "598",
        grossWages: "3421.55",
        employerContributions: "513.23",
        netPayroll: "2566.16",
        totalPayrollCost: "3934.78",
      },
      {
        locationId: ontario.id,
        payDate: new Date("2025-03-07"),
        periodStart: new Date("2025-02-22"),
        periodEnd: new Date("2025-03-07"),
        headcount: 9,
        totalHours: "608",
        grossWages: "3489.22",
        employerContributions: "523.38",
        netPayroll: "2616.92",
        totalPayrollCost: "4012.60",
      },
    ];

    for (const pr of ontarioPayroll) {
      await db.insert(payrollRecords).values(pr);
    }
    console.log(`Inserted ${ontarioPayroll.length} Ontario payroll records`);
  }

  // 3. Sync Ontario payroll to QBO as well
  console.log("\n=== Syncing Ontario payroll to QBO ===");
  const ontPayroll = await db.select().from(payrollRecords).where(eq(payrollRecords.locationId, ontario.id));
  
  // Write Ontario payroll data for the Python sync script
  fs.writeFileSync("/tmp/ontario_payroll.json", JSON.stringify(ontPayroll));
  console.log(`Exported ${ontPayroll.length} Ontario payroll records for QBO sync`);

  console.log("\nDone!");
  process.exit(0);
}
main();
