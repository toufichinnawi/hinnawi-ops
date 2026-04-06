/**
 * Check Ontario dailySales data to see if POS provides GST/QST values
 * 
 * Usage: npx tsx scripts/checkOntarioData.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const db = drizzle(process.env.DATABASE_URL);

  console.log("=".repeat(80));
  console.log("ONTARIO (locationId=4) dailySales Data Check");
  console.log("=".repeat(80));

  // Get all Ontario records with all tax-related fields
  const rows: any[] = await db.execute(sql`
    SELECT 
      id,
      saleDate,
      CAST(totalSales AS DECIMAL(12,2)) as totalSales,
      CAST(taxExemptSales AS DECIMAL(12,2)) as taxExempt,
      CAST(taxableSales AS DECIMAL(12,2)) as taxable,
      CAST(gstCollected AS DECIMAL(10,2)) as gst,
      CAST(qstCollected AS DECIMAL(10,2)) as qst,
      CAST(tipsCollected AS DECIMAL(10,2)) as tips,
      CAST(COALESCE(pettyCash, 0) AS DECIMAL(10,2)) as pettyCash
    FROM dailySales
    WHERE locationId = 4
    ORDER BY saleDate DESC
    LIMIT 50
  `);

  const data = Array.isArray(rows[0]) ? rows[0] : rows;
  
  console.log(`\nTotal Ontario records (last 50): ${data.length}\n`);

  // Categorize
  let zeroSales = 0;
  let hasTaxSplit = 0;
  let noTaxSplit = 0;
  let hasGst = 0;
  let hasQst = 0;
  let hasHst = 0;

  console.log(`${"Date".padEnd(12)} ${"Total".padStart(10)} ${"Exempt".padStart(10)} ${"Taxable".padStart(10)} ${"GST".padStart(8)} ${"QST".padStart(8)} ${"Tips".padStart(8)} ${"Petty".padStart(8)}`);
  console.log(`${"─".repeat(12)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)}`);

  for (const r of data) {
    const total = Number(r.totalSales || 0);
    const exempt = Number(r.taxExempt || 0);
    const taxable = Number(r.taxable || 0);
    const gst = Number(r.gst || 0);
    const qst = Number(r.qst || 0);
    const tips = Number(r.tips || 0);
    const petty = Number(r.pettyCash || 0);
    const d = r.saleDate instanceof Date ? r.saleDate.toISOString().split('T')[0] : String(r.saleDate);

    console.log(`${d.padEnd(12)} ${total.toFixed(2).padStart(10)} ${exempt.toFixed(2).padStart(10)} ${taxable.toFixed(2).padStart(10)} ${gst.toFixed(2).padStart(8)} ${qst.toFixed(2).padStart(8)} ${tips.toFixed(2).padStart(8)} ${petty.toFixed(2).padStart(8)}`);

    if (total === 0) { zeroSales++; continue; }
    if (exempt > 0 || taxable > 0) hasTaxSplit++;
    else noTaxSplit++;
    if (gst > 0) hasGst++;
    if (qst > 0) hasQst++;
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`  Total records:       ${data.length}`);
  console.log(`  Zero sales (closed): ${zeroSales}`);
  console.log(`  Has tax split:       ${hasTaxSplit} (taxExempt>0 OR taxable>0)`);
  console.log(`  No tax split:        ${noTaxSplit} (taxExempt=0 AND taxable=0 but total>0)`);
  console.log(`  Has GST > 0:         ${hasGst}`);
  console.log(`  Has QST > 0:         ${hasQst}`);
  
  // Also check: does Ontario use HST instead of GST+QST?
  console.log(`\n  NOTE: Ontario uses HST (13%), not GST+QST.`);
  console.log(`  If GST column has values, it might be HST stored as GST.`);
  console.log(`  If QST column has values, check if it's actually PST/HST.`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
