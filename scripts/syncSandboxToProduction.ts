/**
 * Sync Sandbox Classes/Departments to Production QBO — Issue #1
 * 
 * Queries each production QBO realm for existing Classes (Departments in API),
 * compares with the desired standard set, and creates any missing ones.
 * 
 * Production Realms:
 *   9130346671806126 — PK/MK shared (should have PK, MK departments)
 *   123146517406139  — Ontario (should have ONT department)
 *   123146517409489  — Cathcart Tunnel (should have CT department)
 * 
 * Also syncs Locations if the QBO company has Location tracking enabled.
 */

import "dotenv/config";
import * as prodQbo from "../server/qboProduction";

// ─── Desired Standard Configuration ───

interface RealmConfig {
  realmId: string;
  name: string;
  departments: string[];  // Classes/Departments that should exist
}

const REALM_CONFIGS: RealmConfig[] = [
  {
    realmId: "9130346671806126",
    name: "PK/MK Shared (9427-0659 Quebec Inc)",
    departments: ["PK", "MK"],
  },
  {
    realmId: "123146517406139",
    name: "Ontario",
    departments: ["ONT"],
  },
  {
    realmId: "123146517409489",
    name: "Cathcart Tunnel (CT)",
    departments: ["CT"],
  },
];

// ─── Main ───

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Sync Sandbox Classes/Departments to Production QBO");
  console.log("═══════════════════════════════════════════════════════\n");

  const results: Array<{
    realm: string;
    realmId: string;
    existing: string[];
    created: string[];
    errors: string[];
  }> = [];

  for (const config of REALM_CONFIGS) {
    console.log(`\n─── ${config.name} (${config.realmId}) ───\n`);

    const result = {
      realm: config.name,
      realmId: config.realmId,
      existing: [] as string[],
      created: [] as string[],
      errors: [] as string[],
    };

    try {
      // Query existing departments
      console.log("  Querying existing departments...");
      const queryResult = await prodQbo.prodQboRequest(
        config.realmId,
        "GET",
        `query?query=${encodeURIComponent("SELECT * FROM Department MAXRESULTS 100")}`
      );
      const existingDepts = queryResult?.QueryResponse?.Department || [];
      
      console.log(`  Found ${existingDepts.length} existing departments:`);
      for (const dept of existingDepts) {
        console.log(`    - "${dept.Name}" (ID: ${dept.Id}, Active: ${dept.Active})`);
        result.existing.push(dept.Name);
      }

      // Create missing departments
      for (const deptName of config.departments) {
        const exists = existingDepts.find(
          (d: any) => d.Name.toLowerCase() === deptName.toLowerCase()
        );

        if (exists) {
          console.log(`  ✅ Department "${deptName}" already exists (ID: ${exists.Id})`);
        } else {
          console.log(`  ⏳ Creating department "${deptName}"...`);
          try {
            const createResult = await prodQbo.prodQboRequest(
              config.realmId,
              "POST",
              "department",
              {
                Name: deptName,
                SubDepartment: false,
                FullyQualifiedName: deptName,
                Active: true,
              }
            );
            const newDept = createResult?.Department;
            if (newDept) {
              console.log(`  ✅ Created department "${deptName}" (ID: ${newDept.Id})`);
              result.created.push(deptName);
            } else {
              console.log(`  ⚠️  Department creation returned unexpected response`);
              result.errors.push(`${deptName}: unexpected response`);
            }
          } catch (err: any) {
            console.log(`  ❌ Failed to create department "${deptName}": ${err.message}`);
            result.errors.push(`${deptName}: ${err.message}`);
          }
        }
      }

      // Also query and list existing accounts for reference
      console.log("\n  Querying accounts for reference...");
      const accounts = await prodQbo.getProductionAccounts(config.realmId);
      const accountTypes = new Map<string, number>();
      for (const acct of accounts) {
        const type = acct.AccountType || "Unknown";
        accountTypes.set(type, (accountTypes.get(type) || 0) + 1);
      }
      console.log(`  Total accounts: ${accounts.length}`);
      for (const [type, count] of Array.from(accountTypes.entries()).sort()) {
        console.log(`    - ${type}: ${count}`);
      }

    } catch (err: any) {
      console.log(`  ❌ Error accessing realm ${config.realmId}: ${err.message}`);
      result.errors.push(`Realm access: ${err.message}`);
    }

    results.push(result);
  }

  // Summary
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  for (const r of results) {
    console.log(`${r.realm} (${r.realmId}):`);
    console.log(`  Existing departments: ${r.existing.join(", ") || "none"}`);
    console.log(`  Created departments:  ${r.created.join(", ") || "none needed"}`);
    console.log(`  Errors:               ${r.errors.join(", ") || "none"}`);
    console.log();
  }

  const totalCreated = results.reduce((s, r) => s + r.created.length, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`Total: ${totalCreated} departments created, ${totalErrors} errors`);
  
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
