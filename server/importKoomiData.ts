import { getDb } from "./db";
import { dailySales } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";

interface KoomiRecord {
  date: string;
  locationId: number;
  locationCode: string;
  locationName: string;
  taxExemptSales: number;
  taxableSales: number;
  totalSales: number;
  gstCollected: number;
  qstCollected: number;
  tipsCollected: number;
  orders: number;
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  const raw = fs.readFileSync("/tmp/koomi_daily_sales.json", "utf-8");
  const records: KoomiRecord[] = JSON.parse(raw);
  console.log(`Loaded ${records.length} records from Koomi parser`);

  // Clear existing daily sales
  console.log("Clearing existing dailySales table...");
  await db.delete(dailySales);
  console.log("Cleared.");

  // Insert in batches of 50
  const batchSize = 50;
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const values = batch.map(r => ({
      locationId: r.locationId,
      saleDate: new Date(r.date),
      taxExemptSales: String(r.taxExemptSales),
      taxableSales: String(r.taxableSales),
      totalSales: String(r.totalSales),
      gstCollected: String(r.gstCollected),
      qstCollected: String(r.qstCollected),
      tipsCollected: String(r.tipsCollected),
      totalDeposit: String(r.totalSales + r.gstCollected + r.qstCollected),
    }));
    await db.insert(dailySales).values(values);
    inserted += batch.length;
    if (inserted % 200 === 0 || inserted === records.length) {
      console.log(`  Inserted ${inserted}/${records.length}`);
    }
  }

  // Verify
  const count = await db.select({ cnt: sql<number>`COUNT(*)` }).from(dailySales);
  const dateRange = await db.select({
    minDate: sql<string>`MIN(saleDate)`,
    maxDate: sql<string>`MAX(saleDate)`,
  }).from(dailySales);
  const byLoc = await db.select({
    locationId: dailySales.locationId,
    cnt: sql<number>`COUNT(*)`,
    total: sql<number>`SUM(totalSales)`,
  }).from(dailySales).groupBy(dailySales.locationId);

  console.log(`\nVerification:`);
  console.log(`  Total rows: ${count[0]?.cnt}`);
  console.log(`  Date range: ${dateRange[0]?.minDate} to ${dateRange[0]?.maxDate}`);
  console.log(`  By location:`);
  for (const l of byLoc) {
    console.log(`    Loc ${l.locationId}: ${l.cnt} days, $${Number(l.total).toLocaleString()}`);
  }

  console.log("\nDone!");
  process.exit(0);
}
main();
