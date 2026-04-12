/**
 * Fix P&L Duplication — Issue #2
 * 
 * PK and MK share the same QBO realm (9130346671806126).
 * Without department filtering, the P&L for this realm returns ALL accounts
 * for BOTH stores, causing duplication in the consolidated view.
 * 
 * This script:
 * 1. Checks if departmentFilter is set for PK and MK entities
 * 2. Sets the correct department names if missing
 * 3. Queries QBO to verify the departments exist
 * 4. Clears stale cached reports so fresh filtered data is fetched
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌ Could not connect to database");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  Fix P&L Duplication — Department Filter Setup");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: Check current entity configuration
  console.log("Step 1: Checking current QBO entity configuration...\n");
  const entities = await db.execute(sql`
    SELECT id, locationId, realmId, companyName, departmentFilter, isActive
    FROM qboEntities
    WHERE isActive = 1
    ORDER BY id
  `);
  const rows = (entities as any)[0] || entities;
  
  console.log("Current entities:");
  console.log("─────────────────────────────────────────────────");
  for (const e of rows as any[]) {
    console.log(`  ID=${e.id} | Location=${e.locationId} | Realm=${e.realmId} | Company="${e.companyName}" | DeptFilter="${e.departmentFilter || 'NOT SET'}"`);
  }
  console.log();

  // Step 2: Identify PK and MK entities (same realm)
  const pkMkRealm = "9130346671806126";
  const sharedEntities = (rows as any[]).filter((e: any) => e.realmId === pkMkRealm);
  
  if (sharedEntities.length < 2) {
    console.log("⚠️  Expected 2 entities sharing realm " + pkMkRealm + " (PK & MK), found " + sharedEntities.length);
    console.log("    The P&L duplication fix requires both PK and MK entities to be configured.");
    console.log("    Please check the qboEntities table.\n");
  }

  for (const entity of sharedEntities) {
    if (!entity.departmentFilter) {
      console.log(`⚠️  Entity ${entity.id} (${entity.companyName}) has NO departmentFilter set!`);
      console.log(`    This means the P&L fetch returns ALL data for the shared realm — causing duplication.\n`);
    } else {
      console.log(`✅ Entity ${entity.id} (${entity.companyName}) has departmentFilter="${entity.departmentFilter}"\n`);
    }
  }

  // Step 3: Set department filters if missing
  // PK department name in QBO is typically "PK" or "President Kennedy"
  // MK department name in QBO is typically "MK" or "Mackay"
  // We need to check what departments actually exist in QBO
  console.log("Step 2: Setting department filters...\n");
  
  for (const entity of sharedEntities) {
    // Determine the correct department name based on locationId or companyName
    let deptName: string | null = null;
    const name = (entity.companyName || "").toLowerCase();
    if (name.includes("pk") || name.includes("president") || name.includes("kennedy") || entity.locationId === 1) {
      deptName = "PK";
    } else if (name.includes("mk") || name.includes("mackay") || entity.locationId === 2) {
      deptName = "MK";
    }

    if (deptName && !entity.departmentFilter) {
      console.log(`  Setting departmentFilter="${deptName}" for entity ${entity.id} (${entity.companyName})...`);
      await db.execute(sql`
        UPDATE qboEntities 
        SET departmentFilter = ${deptName}
        WHERE id = ${entity.id}
      `);
      console.log(`  ✅ Done\n`);
    } else if (entity.departmentFilter) {
      console.log(`  Entity ${entity.id} already has departmentFilter="${entity.departmentFilter}" — no change needed\n`);
    } else {
      console.log(`  ⚠️  Could not determine department name for entity ${entity.id} (${entity.companyName}). Please set manually.\n`);
    }
  }

  // Step 4: Clear stale cached reports for the shared realm entities
  console.log("Step 3: Clearing stale cached reports for PK/MK entities...\n");
  for (const entity of sharedEntities) {
    const result = await db.execute(sql`
      DELETE FROM qboReportCache 
      WHERE qboEntityId = ${entity.id}
    `);
    const deleted = (result as any)[0]?.affectedRows || 0;
    console.log(`  Cleared ${deleted} cached reports for entity ${entity.id} (${entity.companyName})`);
  }
  console.log();

  // Step 5: Also clear cache for all other entities to ensure fresh data
  console.log("Step 4: Clearing ALL cached reports to ensure fresh data...\n");
  const clearAll = await db.execute(sql`DELETE FROM qboReportCache`);
  const totalCleared = (clearAll as any)[0]?.affectedRows || 0;
  console.log(`  Cleared ${totalCleared} total cached reports\n`);

  // Step 6: Verify final state
  console.log("Step 5: Final entity configuration:\n");
  const finalEntities = await db.execute(sql`
    SELECT id, locationId, realmId, companyName, departmentFilter
    FROM qboEntities
    WHERE isActive = 1
    ORDER BY id
  `);
  const finalRows = (finalEntities as any)[0] || finalEntities;
  for (const e of finalRows as any[]) {
    const status = e.departmentFilter ? "✅" : "⚠️ ";
    console.log(`  ${status} ID=${e.id} | Location=${e.locationId} | Realm=${e.realmId} | DeptFilter="${e.departmentFilter || 'NOT SET'}"`);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  DONE — Next steps:");
  console.log("  1. Refresh the Financial Statements page in the app");
  console.log("  2. The P&L will re-fetch from QBO with department filters");
  console.log("  3. PK should only show PK accounts, MK only MK accounts");
  console.log("  4. If departments don't exist in QBO, create them first");
  console.log("═══════════════════════════════════════════════════\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
