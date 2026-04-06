/**
 * Revenue JE Math Validator
 * 
 * Queries all dailySales entries and checks if the JE template math would balance.
 * Compares POS-recorded GST/QST vs what QBO would auto-calculate from the tax code.
 * 
 * Usage:
 *   npx tsx scripts/validateJeMath.ts
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

  console.log("=" .repeat(80));
  console.log("REVENUE JE MATH VALIDATOR");
  console.log("Checking all dailySales entries for JE balance issues");
  console.log("=" .repeat(80));

  // Query all dailySales in the pipeline date range
  const rows: any[] = await db.execute(sql`
    SELECT 
      ds.id,
      ds.locationId,
      CASE ds.locationId 
        WHEN 1 THEN 'PK'
        WHEN 2 THEN 'MK' 
        WHEN 3 THEN 'ONT'
        WHEN 4 THEN 'CT'
        ELSE 'UNK'
      END AS loc,
      ds.saleDate,
      CAST(ds.totalSales AS DECIMAL(12,2)) as totalSales,
      CAST(ds.taxExemptSales AS DECIMAL(12,2)) as taxExempt,
      CAST(ds.taxableSales AS DECIMAL(12,2)) as taxable,
      CAST(ds.gstCollected AS DECIMAL(10,2)) as pos_gst,
      CAST(ds.qstCollected AS DECIMAL(10,2)) as pos_qst,
      ROUND(ds.taxableSales * 0.05, 2) as qbo_gst,
      ROUND(ds.taxableSales * 0.09975, 2) as qbo_qst,
      CAST(ds.tipsCollected AS DECIMAL(10,2)) as tips,
      CAST(COALESCE(ds.pettyCash, 0) AS DECIMAL(10,2)) as pettyCash
    FROM dailySales ds
    WHERE ds.saleDate >= '2025-09-01' 
      AND ds.saleDate <= CURDATE()
    ORDER BY ds.saleDate, ds.locationId
  `);

  // Handle the result - drizzle returns [rows, fields]
  const data = Array.isArray(rows[0]) ? rows[0] : rows;
  
  console.log(`\nTotal dailySales records in range (Sep 1 2025 - today): ${data.length}`);

  let zeroSales: any[] = [];
  let noTaxSplit: any[] = [];
  let taxMismatch: any[] = [];
  let tooFewLines: any[] = [];
  let valid: any[] = [];

  for (const r of data) {
    const total = Number(r.totalSales || 0);
    const exempt = Number(r.taxExempt || 0);
    const taxable = Number(r.taxable || 0);
    const posGst = Number(r.pos_gst || 0);
    const posQst = Number(r.pos_qst || 0);
    const qboGst = Number(r.qbo_gst || 0);
    const qboQst = Number(r.qbo_qst || 0);
    const tips = Number(r.tips || 0);
    const petty = Number(r.pettyCash || 0);
    const loc = r.loc;

    // Zero sales = closed
    if (total === 0) {
      zeroSales.push(r);
      continue;
    }

    // No tax split: totalSales > 0 but both exempt and taxable are 0
    if (exempt === 0 && taxable === 0) {
      noTaxSplit.push(r);
      let lineCount = 1; // AR always
      if (petty > 0) lineCount++;
      if (tips > 0) lineCount++;
      if (lineCount < 2) tooFewLines.push(r);
      continue;
    }

    // Tax mismatch: POS GST/QST vs QBO auto-calculated
    const gstDiff = Math.round((posGst - qboGst) * 100) / 100;
    const qstDiff = Math.round((posQst - qboQst) * 100) / 100;
    const totalDiff = Math.round((gstDiff + qstDiff) * 100) / 100;

    if (totalDiff !== 0) {
      (r as any).gstDiff = gstDiff;
      (r as any).qstDiff = qstDiff;
      (r as any).totalDiff = totalDiff;
      taxMismatch.push(r);
    } else {
      // Check line count
      let lineCount = 1; // AR
      if (exempt > 0) lineCount++;
      if (taxable > 0) lineCount++;
      if (petty > 0) lineCount++;
      if (tips > 0) lineCount++;
      if (lineCount < 2) {
        tooFewLines.push(r);
      } else {
        valid.push(r);
      }
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log("RESULTS BREAKDOWN:");
  console.log(`${"─".repeat(60)}`);
  console.log(`  Valid entries (would post OK):     ${valid.length}`);
  console.log(`  Zero sales (store closed, skip):   ${zeroSales.length}`);
  console.log(`  No tax split (total>0, exempt=0    ${noTaxSplit.length}`);
  console.log(`    AND taxable=0):`);
  console.log(`  Tax mismatch (POS vs QBO calc):    ${taxMismatch.length}`);
  console.log(`  Too few lines (<2 detail lines):   ${tooFewLines.length}`);

  // ─── Tax Mismatch Details ───
  if (taxMismatch.length > 0) {
    const diffs = taxMismatch.map(r => Math.abs(r.totalDiff));
    const biggest = Math.max(...diffs);
    const totalAbsDiff = diffs.reduce((s, d) => s + d, 0);
    const totalSigned = taxMismatch.reduce((s, r) => s + r.totalDiff, 0);

    console.log(`\n${"=".repeat(80)}`);
    console.log("TAX MISMATCH DETAILS (would cause Debits ≠ Credits error)");
    console.log(`${"=".repeat(80)}`);
    console.log(`  Count:              ${taxMismatch.length}`);
    console.log(`  Biggest difference: $${biggest.toFixed(2)}`);
    console.log(`  Total difference:   $${totalSigned.toFixed(2)} (signed)`);
    console.log(`  Total |difference|: $${totalAbsDiff.toFixed(2)} (absolute)`);

    // By location
    const byLoc: Record<string, any[]> = {};
    for (const r of taxMismatch) {
      if (!byLoc[r.loc]) byLoc[r.loc] = [];
      byLoc[r.loc].push(r);
    }
    console.log(`\n  By location:`);
    for (const [loc, entries] of Object.entries(byLoc).sort()) {
      const locDiffs = entries.map(e => Math.abs(e.totalDiff));
      const locTotal = entries.reduce((s, e) => s + e.totalDiff, 0);
      console.log(`    ${loc}: ${entries.length} entries, biggest=$${Math.max(...locDiffs).toFixed(2)}, total=$${locTotal.toFixed(2)}`);
    }

    // Top 10
    taxMismatch.sort((a, b) => Math.abs(b.totalDiff) - Math.abs(a.totalDiff));
    console.log(`\n  Top 10 biggest mismatches:`);
    console.log(`  ${"Date".padEnd(12)} ${"Loc".padEnd(5)} ${"Taxable".padStart(10)} ${"POS GST".padStart(10)} ${"QBO GST".padStart(10)} ${"POS QST".padStart(10)} ${"QBO QST".padStart(10)} ${"Diff".padStart(8)}`);
    console.log(`  ${"─".repeat(12)} ${"─".repeat(5)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(8)}`);
    for (const r of taxMismatch.slice(0, 10)) {
      const d = r.saleDate instanceof Date ? r.saleDate.toISOString().split('T')[0] : String(r.saleDate);
      console.log(`  ${d.padEnd(12)} ${r.loc.padEnd(5)} ${Number(r.taxable).toFixed(2).padStart(10)} ${Number(r.pos_gst).toFixed(2).padStart(10)} ${Number(r.qbo_gst).toFixed(2).padStart(10)} ${Number(r.pos_qst).toFixed(2).padStart(10)} ${Number(r.qbo_qst).toFixed(2).padStart(10)} ${r.totalDiff.toFixed(2).padStart(8)}`);
    }
  }

  // ─── No Tax Split Details ───
  if (noTaxSplit.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log("NO TAX SPLIT DETAILS (totalSales > 0 but taxExempt=0 AND taxable=0)");
    console.log(`${"=".repeat(80)}`);
    const byLoc: Record<string, any[]> = {};
    for (const r of noTaxSplit) {
      if (!byLoc[r.loc]) byLoc[r.loc] = [];
      byLoc[r.loc].push(r);
    }
    for (const [loc, entries] of Object.entries(byLoc).sort()) {
      console.log(`\n  ${loc}: ${entries.length} entries`);
      for (const r of entries.slice(0, 5)) {
        const d = r.saleDate instanceof Date ? r.saleDate.toISOString().split('T')[0] : String(r.saleDate);
        console.log(`    ${d} — totalSales=$${Number(r.totalSales).toFixed(2)}, tips=$${Number(r.tips).toFixed(2)}, pettyCash=$${Number(r.pettyCash).toFixed(2)}`);
      }
      if (entries.length > 5) console.log(`    ... and ${entries.length - 5} more`);
    }
  }

  // ─── Zero Sales ───
  if (zeroSales.length > 0) {
    console.log(`\n${"=".repeat(80)}`);
    console.log("ZERO SALES (store closed) — will be skipped");
    console.log(`${"=".repeat(80)}`);
    const byLoc: Record<string, number> = {};
    for (const r of zeroSales) {
      byLoc[r.loc] = (byLoc[r.loc] || 0) + 1;
    }
    for (const [loc, count] of Object.entries(byLoc).sort()) {
      console.log(`  ${loc}: ${count} days`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total records:          ${data.length}`);
  console.log(`Would post OK:          ${valid.length}`);
  console.log(`Would skip (closed):    ${zeroSales.length}`);
  console.log(`PROBLEM - no tax split: ${noTaxSplit.length}`);
  console.log(`PROBLEM - tax mismatch: ${taxMismatch.length}`);
  console.log(`PROBLEM - too few lines: ${tooFewLines.length}`);
  console.log(`\nTotal problems:         ${noTaxSplit.length + taxMismatch.length + tooFewLines.length}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
