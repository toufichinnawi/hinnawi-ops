/**
 * Diagnostic Check — Verify QBO entity configuration
 * Checks: departmentFilter, realm IDs, class resolution, and P&L duplication risk
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { qboEntities } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as prodQbo from "../server/qboProduction";

async function main() {
  const db = await getDb();
  
  console.log("═══════════════════════════════════════════════════════");
  console.log("DIAGNOSTIC CHECK — QBO Entity Configuration");
  console.log("═══════════════════════════════════════════════════════\n");
  
  // 1. Check all QBO entities
  const entities = await db.select().from(qboEntities);
  console.log(`Found ${entities.length} QBO entities:\n`);
  
  for (const e of entities) {
    console.log(`  ID: ${e.id}`);
    console.log(`    Company:          ${e.companyName}`);
    console.log(`    Legal Name:       ${e.legalName}`);
    console.log(`    Realm ID:         ${e.realmId}`);
    console.log(`    Location ID:      ${e.locationId}`);
    console.log(`    Department Filter: ${e.departmentFilter || "NOT SET"}`);
    console.log(`    Active:           ${e.isActive}`);
    console.log(`    Sync Status:      ${e.syncStatus}`);
    console.log("");
  }
  
  // 2. Check for duplication risk
  const realmCounts = new Map<string, number>();
  for (const e of entities) {
    if (e.isActive && e.realmId && e.realmId !== "pending") {
      realmCounts.set(e.realmId, (realmCounts.get(e.realmId) || 0) + 1);
    }
  }
  
  console.log("═══════════════════════════════════════════════════════");
  console.log("DUPLICATION RISK ANALYSIS");
  console.log("═══════════════════════════════════════════════════════\n");
  
  for (const [realmId, count] of realmCounts) {
    if (count > 1) {
      const sharedEntities = entities.filter(e => e.realmId === realmId && e.isActive);
      console.log(`  ⚠️  SHARED REALM ${realmId}: ${count} entities share this QBO company`);
      for (const e of sharedEntities) {
        const hasDeptFilter = !!e.departmentFilter;
        console.log(`    - ${e.companyName} (ID ${e.id}): departmentFilter = ${e.departmentFilter || "NOT SET"} ${hasDeptFilter ? "✅" : "❌ WILL CAUSE DUPLICATION"}`);
      }
      console.log("");
    } else {
      console.log(`  ✅ Realm ${realmId}: Single entity — no duplication risk`);
    }
  }
  
  // 3. Try to resolve department IDs for entities with department filters
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("DEPARTMENT/CLASS RESOLUTION");
  console.log("═══════════════════════════════════════════════════════\n");
  
  for (const e of entities) {
    if (!e.isActive || !e.realmId || e.realmId === "pending") continue;
    if (!e.departmentFilter) continue;
    
    try {
      const classId = await prodQbo.resolveClassId(e.realmId, e.departmentFilter);
      if (classId) {
        console.log(`  ✅ ${e.companyName}: Class "${e.departmentFilter}" resolved to ID ${classId}`);
      } else {
        console.log(`  ❌ ${e.companyName}: Class "${e.departmentFilter}" NOT FOUND in realm ${e.realmId}`);
      }
    } catch (err: any) {
      console.log(`  ❌ ${e.companyName}: Error resolving class — ${err.message}`);
    }
  }
  
  // 4. Check accounts in each realm
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("ACCOUNT CHECK PER REALM");
  console.log("═══════════════════════════════════════════════════════\n");
  
  const checkedRealms = new Set<string>();
  for (const e of entities) {
    if (!e.isActive || !e.realmId || e.realmId === "pending" || checkedRealms.has(e.realmId)) continue;
    checkedRealms.add(e.realmId);
    
    try {
      const accounts = await prodQbo.getProductionAccounts(e.realmId);
      const salesAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("sales") && a.AccountType === "Income");
      const arAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("receivable"));
      const tipsAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("tips") || a.Name.toLowerCase().includes("pourboire"));
      const gstAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("gst") || a.Name.toLowerCase().includes("tps"));
      const qstAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("qst") || a.Name.toLowerCase().includes("tvq"));
      const roundingAccounts = accounts.filter((a: any) => a.Name.toLowerCase().includes("rounding"));
      
      console.log(`  Realm ${e.realmId} (${e.companyName}):`);
      console.log(`    Sales accounts:    ${salesAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE"}`);
      console.log(`    AR accounts:       ${arAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE"}`);
      console.log(`    Tips accounts:     ${tipsAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE"}`);
      console.log(`    GST accounts:      ${gstAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE"}`);
      console.log(`    QST accounts:      ${qstAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE"}`);
      console.log(`    Rounding accounts: ${roundingAccounts.map((a: any) => `${a.Name} (#${a.Id})`).join(", ") || "NONE — needs to be created"}`);
      console.log("");
    } catch (err: any) {
      console.log(`  ❌ Realm ${e.realmId}: Error fetching accounts — ${err.message}`);
    }
  }
  
  // 5. Check customers in each realm
  console.log("═══════════════════════════════════════════════════════");
  console.log("CUSTOMER CHECK (for AR Name column)");
  console.log("═══════════════════════════════════════════════════════\n");
  
  const customerNames = ["MEV PK.", "MEV MK.", "Ontario SALES-12732303", "MEV CT."];
  for (const e of entities) {
    if (!e.isActive || !e.realmId || e.realmId === "pending" || e.realmId === "9341456522572832") continue;
    
    for (const name of customerNames) {
      try {
        const customer = await prodQbo.resolveCustomerId(e.realmId, name);
        if (customer) {
          console.log(`  ✅ Realm ${e.realmId}: Customer "${name}" → ID ${customer.id} (${customer.name})`);
        }
      } catch (err: any) {
        // skip
      }
    }
  }
  
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("DIAGNOSTIC COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
