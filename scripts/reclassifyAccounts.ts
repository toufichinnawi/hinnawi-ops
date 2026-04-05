/**
 * Standalone script to reclassify P&L accounts in QBO for 9427-0659 Quebec Inc.
 * Run with: npx tsx scripts/reclassifyAccounts.ts [--dry-run]
 */
import "dotenv/config";
import { reclassifyAccounts } from "../server/qboAccountReclassify";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`\n🔄 Starting QBO Account Reclassification ${dryRun ? "(DRY RUN)" : "(LIVE)"}...\n`);

  try {
    const result = await reclassifyAccounts(dryRun);

    console.log("\n═══════════════════════════════════════════");
    console.log("  RECLASSIFICATION RESULTS");
    console.log("═══════════════════════════════════════════");
    console.log(`  Total accounts in QBO:  ${result.totalAccounts}`);
    console.log(`  P&L accounts analyzed:  ${result.analyzed}`);
    console.log(`  Reclassified:           ${result.reclassified}`);
    console.log(`  Already correct:        ${result.alreadyCorrect}`);
    console.log(`  No rule match:          ${result.noRuleMatch}`);
    console.log(`  Errors:                 ${result.errors}`);
    console.log("═══════════════════════════════════════════\n");

    // Show details of reclassified accounts
    const updated = result.details.filter(d => d.status === "updated");
    if (updated.length > 0) {
      console.log("📋 Accounts reclassified:");
      for (const d of updated) {
        console.log(`  ✅ ${d.acctNum || ""} ${d.accountName}`);
        console.log(`     ${d.oldType}/${d.oldSubType} → ${d.newType}/${d.newSubType}`);
        console.log(`     Rule: ${d.rule}`);
      }
    }

    // Show accounts with no matching rule
    const noRule = result.details.filter(d => d.status === "no_rule");
    if (noRule.length > 0) {
      console.log("\n⚠️  Accounts with no matching rule (kept as-is):");
      for (const d of noRule) {
        console.log(`  - ${d.acctNum || ""} ${d.accountName} (${d.oldType}/${d.oldSubType})`);
      }
    }

    // Show errors
    const errors = result.details.filter(d => d.status === "error");
    if (errors.length > 0) {
      console.log("\n❌ Errors:");
      for (const d of errors) {
        console.log(`  - ${d.accountName}: ${d.error}`);
      }
    }

    console.log("\n✅ Done!\n");
    process.exit(0);
  } catch (err: any) {
    console.error(`\n❌ Fatal error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
