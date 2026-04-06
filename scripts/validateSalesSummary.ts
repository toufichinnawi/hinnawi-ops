/**
 * Sales Summary Validation
 * 
 * Shows total sales per store for the JE posting period (Sep 1, 2025 → today).
 * Run this BEFORE the pipeline to verify the data is correct.
 * 
 * Usage: npx tsx scripts/validateSalesSummary.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const db = drizzle(process.env.DATABASE_URL);
  const startDate = '2025-09-01';
  const today = new Date().toISOString().split('T')[0];

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  SALES DATA VALIDATION — JE Posting Period`);
  console.log(`  Date Range: ${startDate} → ${today}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // 1. Summary per store
  const summary = await db.execute(sql`
    SELECT 
      ds.locationId,
      l.name AS locationName,
      COUNT(*) AS totalDays,
      SUM(CASE WHEN CAST(ds.totalSales AS DECIMAL(12,2)) > 0 THEN 1 ELSE 0 END) AS activeDays,
      SUM(CASE WHEN CAST(ds.totalSales AS DECIMAL(12,2)) = 0 THEN 1 ELSE 0 END) AS closedDays,
      ROUND(SUM(CAST(ds.totalSales AS DECIMAL(12,2))), 2) AS totalSales,
      ROUND(SUM(CAST(ds.taxExemptSales AS DECIMAL(12,2))), 2) AS totalTaxExempt,
      ROUND(SUM(CAST(ds.taxableSales AS DECIMAL(12,2))), 2) AS totalTaxable,
      ROUND(SUM(CAST(ds.gstCollected AS DECIMAL(12,2))), 2) AS totalGST,
      ROUND(SUM(CAST(ds.qstCollected AS DECIMAL(12,2))), 2) AS totalQST,
      ROUND(SUM(CAST(ds.tipsCollected AS DECIMAL(12,2))), 2) AS totalTips,
      ROUND(SUM(CAST(ds.pettyCash AS DECIMAL(12,2))), 2) AS totalPettyCash,
      SUM(CASE WHEN CAST(ds.gstCollected AS DECIMAL(12,2)) > 0 THEN 1 ELSE 0 END) AS daysWithGST,
      SUM(CASE WHEN CAST(ds.taxExemptSales AS DECIMAL(12,2)) > 0 THEN 1 ELSE 0 END) AS daysWithTaxExempt
    FROM dailySales ds
    LEFT JOIN locations l ON l.id = ds.locationId
    WHERE ds.saleDate >= ${startDate} AND ds.saleDate <= ${today}
    GROUP BY ds.locationId, l.name
    ORDER BY ds.locationId
  `);

  const rows = (summary as any)[0] || summary;

  console.log(`STORE SUMMARY`);
  console.log(`─────────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`${'Store'.padEnd(22)} ${'Days'.padStart(5)} ${'Active'.padStart(6)} ${'Total Sales'.padStart(13)} ${'Tax Exempt'.padStart(12)} ${'Taxable'.padStart(12)} ${'GST'.padStart(10)} ${'QST'.padStart(10)} ${'Tips'.padStart(10)}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────────────────`);

  let grandTotalSales = 0;
  let grandTotalGST = 0;
  let grandTotalQST = 0;

  for (const row of rows as any[]) {
    const name = `${row.locationName || 'Unknown'} (${row.locationId})`;
    const totalSales = Number(row.totalSales) || 0;
    const totalTaxExempt = Number(row.totalTaxExempt) || 0;
    const totalTaxable = Number(row.totalTaxable) || 0;
    const totalGST = Number(row.totalGST) || 0;
    const totalQST = Number(row.totalQST) || 0;
    const totalTips = Number(row.totalTips) || 0;

    grandTotalSales += totalSales;
    grandTotalGST += totalGST;
    grandTotalQST += totalQST;

    console.log(
      `${name.padEnd(22)} ${String(row.totalDays).padStart(5)} ${String(row.activeDays).padStart(6)} ${('$' + totalSales.toFixed(2)).padStart(13)} ${('$' + totalTaxExempt.toFixed(2)).padStart(12)} ${('$' + totalTaxable.toFixed(2)).padStart(12)} ${('$' + totalGST.toFixed(2)).padStart(10)} ${('$' + totalQST.toFixed(2)).padStart(10)} ${('$' + totalTips.toFixed(2)).padStart(10)}`
    );

    // Warnings
    if (Number(row.daysWithGST) === 0 && Number(row.activeDays) > 0) {
      console.log(`  ⚠️  WARNING: No GST data for any active day!`);
    } else if (Number(row.daysWithGST) < Number(row.activeDays)) {
      console.log(`  ⚠️  WARNING: GST missing for ${Number(row.activeDays) - Number(row.daysWithGST)} of ${row.activeDays} active days`);
    }
    if (Number(row.daysWithTaxExempt) === 0 && Number(row.activeDays) > 0) {
      console.log(`  ⚠️  WARNING: No tax-exempt data for any active day!`);
    }
  }

  console.log(`─────────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`${'GRAND TOTAL'.padEnd(22)} ${''.padStart(5)} ${''.padStart(6)} ${('$' + grandTotalSales.toFixed(2)).padStart(13)} ${''.padStart(12)} ${''.padStart(12)} ${('$' + grandTotalGST.toFixed(2)).padStart(10)} ${('$' + grandTotalQST.toFixed(2)).padStart(10)}`);

  // 2. Data quality check — entries that would fail JE posting
  console.log(`\n\nDATA QUALITY CHECK`);
  console.log(`─────────────────────────────────────────────────────────────────────────────────────────`);

  const issues = await db.execute(sql`
    SELECT 
      ds.locationId, l.name, ds.saleDate,
      ds.totalSales, ds.taxExemptSales, ds.taxableSales, 
      ds.gstCollected, ds.qstCollected, ds.tipsCollected, ds.pettyCash
    FROM dailySales ds
    LEFT JOIN locations l ON l.id = ds.locationId
    WHERE ds.saleDate >= ${startDate} AND ds.saleDate <= ${today}
      AND CAST(ds.totalSales AS DECIMAL(12,2)) > 0
      AND (
        (CAST(ds.taxExemptSales AS DECIMAL(12,2)) = 0 AND CAST(ds.taxableSales AS DECIMAL(12,2)) = 0)
        OR (CAST(ds.gstCollected AS DECIMAL(12,2)) = 0 AND CAST(ds.taxableSales AS DECIMAL(12,2)) > 0 AND CAST(ds.taxExemptSales AS DECIMAL(12,2)) = 0)
      )
    ORDER BY ds.locationId, ds.saleDate
  `);

  const issueRows = (issues as any)[0] || issues;
  if ((issueRows as any[]).length === 0) {
    console.log(`✅ All active entries have proper tax split — no issues found.`);
  } else {
    console.log(`⚠️  ${(issueRows as any[]).length} entries with missing tax split (pipeline will use fallback logic):`);
    for (const r of issueRows as any[]) {
      console.log(`   ${r.name} (${r.locationId}) | ${r.saleDate} | total=$${r.totalSales} exempt=$${r.taxExemptSales} taxable=$${r.taxableSales} GST=$${r.gstCollected} QST=$${r.qstCollected}`);
    }
  }

  // 3. Count JEs that would be generated
  const jeCount = await db.execute(sql`
    SELECT 
      ds.locationId, l.name,
      COUNT(*) AS jeCount
    FROM dailySales ds
    LEFT JOIN locations l ON l.id = ds.locationId
    WHERE ds.saleDate >= ${startDate} AND ds.saleDate <= ${today}
      AND CAST(ds.totalSales AS DECIMAL(12,2)) > 0
    GROUP BY ds.locationId, l.name
    ORDER BY ds.locationId
  `);

  const jeCounts = (jeCount as any)[0] || jeCount;
  let totalJEs = 0;
  console.log(`\n\nJOURNAL ENTRIES TO BE POSTED`);
  console.log(`─────────────────────────────────────────────────────────────────────────────────────────`);
  for (const r of jeCounts as any[]) {
    const count = Number(r.jeCount);
    totalJEs += count;
    console.log(`   ${r.name} (${r.locationId}): ${count} JEs`);
  }
  console.log(`   TOTAL: ${totalJEs} JEs`);
  console.log(`\n═══════════════════════════════════════════════════════════════\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
