/**
 * Revenue JE Pipeline Runner
 * 
 * Usage:
 *   npx tsx scripts/runRevenueJePipeline.ts --dry-run          # Preview only (no changes)
 *   npx tsx scripts/runRevenueJePipeline.ts --live              # Delete + re-post for real
 *   npx tsx scripts/runRevenueJePipeline.ts --live --start 2025-09-01 --end 2026-04-05
 * 
 * Default date range: Sep 1, 2025 → today
 */
import 'dotenv/config';
import { runRevenueJePipeline } from '../server/revenueJePipeline';

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--live');
  
  const startIdx = args.indexOf('--start');
  const endIdx = args.indexOf('--end');
  
  const startDate = startIdx >= 0 && args[startIdx + 1] ? args[startIdx + 1] : '2025-09-01';
  const endDate = endIdx >= 0 && args[endIdx + 1] ? args[endIdx + 1] : new Date().toISOString().split('T')[0];

  console.log(`\n🚀 Revenue JE Pipeline`);
  console.log(`   Start: ${startDate}`);
  console.log(`   End:   ${endDate}`);
  console.log(`   Mode:  ${isDryRun ? 'DRY RUN' : '🔴 LIVE'}`);
  
  if (!isDryRun) {
    console.log(`\n   ⚠️  LIVE MODE: This will DELETE existing revenue JEs and RE-POST from POS data.`);
    console.log(`   Proceeding in 5 seconds... (Ctrl+C to cancel)\n`);
    await new Promise(r => setTimeout(r, 5000));
  }

  try {
    const result = await runRevenueJePipeline(startDate, endDate, isDryRun);
    
    // Write results to file
    const fs = await import('fs');
    const outputPath = `/tmp/revenue_je_pipeline_${isDryRun ? 'dryrun' : 'live'}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to ${outputPath}`);
    
  } catch (err: any) {
    console.error(`\n❌ Pipeline failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
