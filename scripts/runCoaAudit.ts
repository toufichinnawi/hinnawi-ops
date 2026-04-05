/**
 * Chart of Accounts Audit CLI
 * 
 * Usage:
 *   npx tsx scripts/runCoaAudit.ts --audit          # Generate audit report
 *   npx tsx scripts/runCoaAudit.ts --standardize     # Dry-run standardization
 *   npx tsx scripts/runCoaAudit.ts --standardize --live  # Apply standardization
 */
import { auditAllCompanies, formatAuditReport, standardizeAccountNames } from "../server/coaCleanup";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const isAudit = args.includes("--audit");
  const isStandardize = args.includes("--standardize");
  const isLive = args.includes("--live");

  if (!isAudit && !isStandardize) {
    console.log("Usage:");
    console.log("  npx tsx scripts/runCoaAudit.ts --audit          # Generate audit report");
    console.log("  npx tsx scripts/runCoaAudit.ts --standardize     # Dry-run standardization");
    console.log("  npx tsx scripts/runCoaAudit.ts --standardize --live  # Apply name changes");
    process.exit(1);
  }

  if (isAudit) {
    console.log("🔍 Running Chart of Accounts audit across all production companies...\n");
    const report = await auditAllCompanies();
    const markdown = formatAuditReport(report);

    const outputPath = `/tmp/coa_audit_${new Date().toISOString().slice(0, 10)}.md`;
    fs.writeFileSync(outputPath, markdown);
    console.log(markdown);
    console.log(`\n📄 Report saved to: ${outputPath}`);
  }

  if (isStandardize) {
    const dryRun = !isLive;
    console.log(`\n📋 ${dryRun ? "DRY RUN" : "LIVE"} — Standardizing account names...\n`);

    if (!dryRun) {
      console.log("⚠️  LIVE MODE — Changes will be applied to production QBO in 5 seconds...");
      await new Promise(r => setTimeout(r, 5000));
    }

    const results = await standardizeAccountNames(dryRun);

    if (results.length === 0) {
      console.log("✅ All account names already follow the standard convention.");
    } else {
      console.log(`Found ${results.length} accounts to rename:\n`);
      console.log("| Realm | Old Name | New Name | Status |");
      console.log("|-------|----------|----------|--------|");
      for (const r of results) {
        const status = dryRun ? "pending" : (r.success ? "✅ done" : `❌ ${r.error}`);
        console.log(`| ${r.realmId.slice(-6)} | ${r.oldName} | ${r.newName} | ${status} |`);
      }
    }

    const outputPath = `/tmp/coa_standardize_${dryRun ? "dry" : "live"}_${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Results saved to: ${outputPath}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
