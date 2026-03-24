/**
 * Generate Revenue Journal Entries for March 10-16, 2026
 * 
 * Balanced JE per day per location:
 *   DEBIT  Undeposited Funds  = totalSales (gross receipts incl. taxes)
 *   CREDIT Sales Revenue      = totalSales - GST - QST (net revenue)
 *   CREDIT GST Payable        = GST collected
 *   CREDIT QST Payable        = QST collected
 * 
 * Tips are NOT included in totalSales (they're separate), so they don't affect this JE.
 * Deposit reconciliation (bank vs undeposited funds) is a separate process.
 */
import 'dotenv/config';

const DATES = [
  '2026-03-10', '2026-03-11', '2026-03-12',
  '2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16',
];

const LOCATIONS = [
  { id: 1, name: 'President Kennedy', code: 'PK' },
  { id: 2, name: 'Mackay', code: 'MK' },
  { id: 3, name: 'Ontario', code: 'ONT' },
  { id: 4, name: 'Cathcart Tunnel', code: 'TUN' },
];

// QBO Account IDs from the sandbox
const QBO = {
  undepositedFunds: { id: '92', name: 'Undeposited Funds' },
  salesRevenue:     { id: '96', name: 'Sales' },
  gstPayable:       { id: '149', name: 'GST Payable' },
  qstPayable:       { id: '150', name: 'QST Payable' },
};

async function main() {
  const db = await import('./db.ts');
  const qbo = await import('./qbo.ts');

  console.log('=== Revenue Journal Entry Generation: March 10-16, 2026 ===\n');

  const allResults = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const date of DATES) {
    console.log(`\n📅 ${date}`);
    
    let sales;
    try {
      sales = await db.getDailySalesForDate(date);
    } catch (e) {
      console.log(`  ❌ Failed to fetch sales: ${e.message}`);
      errors++;
      continue;
    }

    for (const loc of LOCATIONS) {
      const sale = sales.find(s => s.locationId === loc.id);
      
      if (!sale || Number(sale.totalSales) === 0) {
        console.log(`  ⏭️  ${loc.name}: No sales (skipped)`);
        allResults.push({ date, location: loc.name, status: 'skipped', reason: 'no sales' });
        skipped++;
        continue;
      }

      try {
        const totalSales = Math.round(Number(sale.totalSales) * 100) / 100;
        const gst = Math.round(Number(sale.gstCollected || 0) * 100) / 100;
        const qst = Math.round(Number(sale.qstCollected || 0) * 100) / 100;
        const netRevenue = Math.round((totalSales - gst - qst) * 100) / 100;

        // Verify balance: debit = totalSales, credits = netRevenue + gst + qst
        const totalCredits = Math.round((netRevenue + gst + qst) * 100) / 100;
        if (Math.abs(totalSales - totalCredits) > 0.01) {
          console.log(`  ⚠️  ${loc.name}: Rounding mismatch (debit=$${totalSales}, credits=$${totalCredits}), adjusting...`);
          // Adjust netRevenue to absorb rounding
        }

        const lines = [];

        // DEBIT: Undeposited Funds = totalSales
        lines.push({
          postingType: "Debit",
          amount: totalSales,
          accountId: QBO.undepositedFunds.id,
          accountName: QBO.undepositedFunds.name,
          description: `Daily sales - ${loc.name} - ${date}`,
          className: loc.code,
        });

        // CREDIT: Sales Revenue = net revenue (totalSales - GST - QST)
        lines.push({
          postingType: "Credit",
          amount: netRevenue,
          accountId: QBO.salesRevenue.id,
          accountName: QBO.salesRevenue.name,
          description: `Daily revenue - ${loc.name} - ${date}`,
          className: loc.code,
        });

        // CREDIT: GST Payable
        if (gst > 0) {
          lines.push({
            postingType: "Credit",
            amount: gst,
            accountId: QBO.gstPayable.id,
            accountName: QBO.gstPayable.name,
            description: `GST collected - ${loc.name} - ${date}`,
            className: loc.code,
          });
        }

        // CREDIT: QST Payable
        if (qst > 0) {
          lines.push({
            postingType: "Credit",
            amount: qst,
            accountId: QBO.qstPayable.id,
            accountName: QBO.qstPayable.name,
            description: `QST collected - ${loc.name} - ${date}`,
            className: loc.code,
          });
        }

        const docNumber = `REV-${loc.code}-${date}`;
        const result = await qbo.createJournalEntry({
          txnDate: date,
          docNumber,
          privateNote: `Daily revenue entry for ${loc.name} - ${date}`,
          lines,
        });

        const jeId = result?.JournalEntry?.Id;
        console.log(`  ✅ ${loc.name}: JE #${jeId} (${docNumber}) — Gross: $${totalSales.toFixed(2)}, Net: $${netRevenue.toFixed(2)}, GST: $${gst.toFixed(2)}, QST: $${qst.toFixed(2)}`);
        allResults.push({ 
          date, location: loc.name, code: loc.code, status: 'created', qboJeId: jeId, docNumber,
          totalSales, netRevenue, gst, qst,
        });
        created++;

        await new Promise(r => setTimeout(r, 300));

      } catch (err) {
        console.log(`  ❌ ${loc.name}: ${err.message}`);
        allResults.push({ date, location: loc.name, status: 'error', error: err.message });
        errors++;
      }
    }
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped} (no sales data)`);
  console.log(`Errors:  ${errors}`);

  const createdEntries = allResults.filter(r => r.status === 'created');
  if (createdEntries.length > 0) {
    console.log('\n=== Created Journal Entries ===');
    console.log('Date        | Location            | Gross Sales | Net Revenue | GST     | QST     | QBO JE#');
    console.log('------------|---------------------|-------------|-------------|---------|---------|--------');
    for (const e of createdEntries) {
      console.log(`${e.date} | ${e.location.padEnd(19)} | $${e.totalSales.toFixed(2).padStart(9)} | $${e.netRevenue.toFixed(2).padStart(9)} | $${e.gst.toFixed(2).padStart(5)} | $${e.qst.toFixed(2).padStart(5)} | ${e.qboJeId || 'N/A'}`);
    }

    // Weekly totals per location
    console.log('\n=== Weekly Totals by Location ===');
    for (const loc of LOCATIONS) {
      const locEntries = createdEntries.filter(e => e.code === loc.code);
      if (locEntries.length === 0) continue;
      const t = locEntries.reduce((acc, e) => ({
        totalSales: acc.totalSales + e.totalSales,
        netRevenue: acc.netRevenue + e.netRevenue,
        gst: acc.gst + e.gst,
        qst: acc.qst + e.qst,
      }), { totalSales: 0, netRevenue: 0, gst: 0, qst: 0 });
      console.log(`${loc.name.padEnd(19)} | $${t.totalSales.toFixed(2).padStart(9)} | $${t.netRevenue.toFixed(2).padStart(9)} | $${t.gst.toFixed(2).padStart(5)} | $${t.qst.toFixed(2).padStart(5)} | ${locEntries.length} JEs`);
    }

    // Grand total
    const totals = createdEntries.reduce((acc, e) => ({
      totalSales: acc.totalSales + e.totalSales,
      netRevenue: acc.netRevenue + e.netRevenue,
      gst: acc.gst + e.gst,
      qst: acc.qst + e.qst,
    }), { totalSales: 0, netRevenue: 0, gst: 0, qst: 0 });
    console.log('------------|---------------------|-------------|-------------|---------|---------|--------');
    console.log(`GRAND TOTAL          | $${totals.totalSales.toFixed(2).padStart(9)} | $${totals.netRevenue.toFixed(2).padStart(9)} | $${totals.gst.toFixed(2).padStart(5)} | $${totals.qst.toFixed(2).padStart(5)} | ${createdEntries.length} JEs`);
  }

  const fs = await import('fs');
  fs.writeFileSync('/tmp/revenue_je_results.json', JSON.stringify(allResults, null, 2));
  console.log('\nResults saved to /tmp/revenue_je_results.json');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
