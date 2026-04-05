/**
 * Revenue Journal Entry Pipeline
 * 
 * This module handles:
 *   1. Querying existing revenue JEs in production QBO
 *   2. Deleting them
 *   3. Re-posting correct revenue JEs from POS dailySales data
 *   4. Tracking all posted JEs in the revenueJournalEntries table
 * 
 * Production QBO Realms:
 *   PK + MK → 9130346671806126 (shared company, department-filtered)
 *   ONT     → 123146517406139
 *   CT      → 123146517409489
 * 
 * Revenue JE Template (per day per location):
 *   DEBIT  Undeposited Funds  = totalSales (gross receipts incl. taxes)
 *   CREDIT Sales Revenue      = net revenue (totalSales - GST - QST)
 *   CREDIT GST Payable        = GST collected
 *   CREDIT QST Payable        = QST collected
 */
import * as prodQbo from "./qboProduction";
import { getDb } from "./db";
import { dailySales, locations, revenueJournalEntries } from "../drizzle/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";

// ─── Location → QBO Realm Mapping ───

interface LocationQboConfig {
  locationId: number;
  code: string;
  name: string;
  realmId: string;
  departmentFilter?: string; // PK or MK for the shared company
}

const LOCATION_QBO_MAP: LocationQboConfig[] = [
  { locationId: 1, code: "PK", name: "President Kennedy", realmId: "9130346671806126", departmentFilter: "PK" },
  { locationId: 2, code: "MK", name: "Mackay", realmId: "9130346671806126", departmentFilter: "MK" },
  { locationId: 3, code: "ONT", name: "Ontario", realmId: "123146517406139" },
  { locationId: 4, code: "CT", name: "Cathcart Tunnel", realmId: "123146517409489" },
];

// ─── Account ID Cache (per realm) ───
// Production account IDs differ from sandbox — we query them dynamically

interface RealmAccountIds {
  undepositedFunds: { id: string; name: string };
  salesRevenue: { id: string; name: string };
  gstPayable: { id: string; name: string };
  qstPayable: { id: string; name: string };
}

const accountIdCache = new Map<string, RealmAccountIds>();

/**
 * Discover the correct QBO account IDs for revenue JEs in a given realm.
 * Searches by common account name patterns.
 */
async function getRealmAccountIds(realmId: string): Promise<RealmAccountIds> {
  if (accountIdCache.has(realmId)) return accountIdCache.get(realmId)!;

  const accounts = await prodQbo.getProductionAccounts(realmId);

  function findAccount(patterns: string[], fallbackId?: string): { id: string; name: string } {
    for (const pattern of patterns) {
      const found = accounts.find((a: { Name: string; Id: string }) =>
        a.Name.toLowerCase() === pattern.toLowerCase()
      );
      if (found) return { id: found.Id, name: found.Name };
    }
    // Try partial match
    for (const pattern of patterns) {
      const found = accounts.find((a: { Name: string; Id: string }) =>
        a.Name.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) return { id: found.Id, name: found.Name };
    }
    if (fallbackId) return { id: fallbackId, name: patterns[0] };
    throw new Error(`Could not find account matching any of: ${patterns.join(", ")} in realm ${realmId}`);
  }

  const result: RealmAccountIds = {
    undepositedFunds: findAccount(["Undeposited Funds"]),
    salesRevenue: findAccount(["Sales", "Sales Revenue", "Revenue", "Sales of Product Income"]),
    gstPayable: findAccount(["GST Payable", "GST/HST Payable", "GST", "TPS à payer", "TPS Payable"]),
    qstPayable: findAccount(["QST Payable", "QST", "TVQ à payer", "TVQ Payable"]),
  };

  accountIdCache.set(realmId, result);
  return result;
}

// ─── Step 1: Query Existing Revenue JEs ───

export interface ExistingRevenueJE {
  realmId: string;
  jeId: string;
  syncToken: string;
  docNumber: string;
  txnDate: string;
  totalAmt: number;
}

/**
 * Query all existing revenue JEs in production QBO for a date range.
 * Searches for JEs with DocNumber starting with "REV-".
 */
export async function queryExistingRevenueJEs(
  startDate: string,
  endDate: string,
): Promise<ExistingRevenueJE[]> {
  const allJEs: ExistingRevenueJE[] = [];
  const uniqueRealms = [...new Set(LOCATION_QBO_MAP.map(l => l.realmId))];

  for (const realmId of uniqueRealms) {
    try {
      // Query all JEs in date range — we'll filter by DocNumber prefix client-side
      // because QBO LIKE queries on DocNumber can be unreliable
      const entries = await prodQbo.getJournalEntriesByDateRange(realmId, startDate, endDate);

      for (const entry of entries) {
        const docNumber = entry.DocNumber || "";
        // Only include revenue JEs (DocNumber starts with REV-)
        if (docNumber.startsWith("REV-")) {
          allJEs.push({
            realmId,
            jeId: entry.Id,
            syncToken: entry.SyncToken,
            docNumber,
            txnDate: entry.TxnDate,
            totalAmt: entry.TotalAmt,
          });
        }
      }

      console.log(`  Realm ${realmId}: found ${allJEs.filter(j => j.realmId === realmId).length} revenue JEs`);
    } catch (err: any) {
      console.error(`  Realm ${realmId}: ERROR querying JEs — ${err.message}`);
    }
  }

  return allJEs;
}

// ─── Step 2: Delete Existing Revenue JEs ───

export interface DeleteResult {
  realmId: string;
  jeId: string;
  docNumber: string;
  status: "deleted" | "error";
  error?: string;
}

/**
 * Delete all provided revenue JEs from production QBO.
 */
export async function deleteRevenueJEs(
  existingJEs: ExistingRevenueJE[],
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];

  for (const je of existingJEs) {
    try {
      await prodQbo.deleteJournalEntry(je.realmId, je.jeId, je.syncToken);
      results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "deleted" });
      console.log(`  ✅ Deleted ${je.docNumber} (JE #${je.jeId}) from realm ${je.realmId}`);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "error", error: err.message });
      console.error(`  ❌ Failed to delete ${je.docNumber}: ${err.message}`);
    }
  }

  return results;
}

// ─── Step 3: Re-post Revenue JEs from POS Data ───

export interface PostResult {
  locationId: number;
  locationCode: string;
  saleDate: string;
  realmId: string;
  status: "posted" | "skipped" | "error";
  qboJeId?: string;
  docNumber?: string;
  totalSales?: number;
  netRevenue?: number;
  gst?: number;
  qst?: number;
  error?: string;
}

/**
 * Post revenue JEs from POS dailySales data for a date range.
 * Creates one JE per day per location in the correct production realm.
 */
export async function postRevenueJEsFromPOS(
  startDate: string,
  endDate: string,
): Promise<PostResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results: PostResult[] = [];

  // Get all daily sales in the date range
  const sales = await db.select().from(dailySales)
    .where(and(
      gte(dailySales.saleDate, startDate),
      lte(dailySales.saleDate, endDate),
    ))
    .orderBy(dailySales.saleDate);

  console.log(`  Found ${sales.length} daily sales records from ${startDate} to ${endDate}`);

  for (const sale of sales) {
    const locConfig = LOCATION_QBO_MAP.find(l => l.locationId === sale.locationId);
    if (!locConfig) {
      console.log(`  ⏭️  Skipping locationId ${sale.locationId} — not mapped to QBO`);
      results.push({
        locationId: sale.locationId,
        locationCode: "UNK",
        saleDate: String(sale.saleDate),
        realmId: "",
        status: "skipped",
        error: "Location not mapped to QBO realm",
      });
      continue;
    }

    const totalSales = Math.round(Number(sale.totalSales) * 100) / 100;
    if (totalSales === 0) {
      results.push({
        locationId: sale.locationId,
        locationCode: locConfig.code,
        saleDate: String(sale.saleDate),
        realmId: locConfig.realmId,
        status: "skipped",
        error: "Zero sales",
      });
      continue;
    }

    try {
      // Get the correct account IDs for this realm
      const accts = await getRealmAccountIds(locConfig.realmId);

      const gst = Math.round(Number(sale.gstCollected || 0) * 100) / 100;
      const qst = Math.round(Number(sale.qstCollected || 0) * 100) / 100;
      const netRevenue = Math.round((totalSales - gst - qst) * 100) / 100;

      // Resolve department/class ID for PK/MK
      let classId: string | undefined;
      let className: string | undefined;
      if (locConfig.departmentFilter) {
        const resolvedId = await prodQbo.resolveClassId(locConfig.realmId, locConfig.departmentFilter);
        if (resolvedId) {
          classId = resolvedId;
          className = locConfig.departmentFilter;
        }
      }

      const lines: Array<{
        postingType: "Debit" | "Credit";
        amount: number;
        accountId: string;
        accountName: string;
        description: string;
        className?: string;
        classId?: string;
      }> = [];

      // DEBIT: Undeposited Funds = totalSales (gross)
      lines.push({
        postingType: "Debit",
        amount: totalSales,
        accountId: accts.undepositedFunds.id,
        accountName: accts.undepositedFunds.name,
        description: `Daily sales - ${locConfig.name} - ${sale.saleDate}`,
        className,
        classId,
      });

      // CREDIT: Sales Revenue = net revenue
      lines.push({
        postingType: "Credit",
        amount: netRevenue,
        accountId: accts.salesRevenue.id,
        accountName: accts.salesRevenue.name,
        description: `Daily revenue - ${locConfig.name} - ${sale.saleDate}`,
        className,
        classId,
      });

      // CREDIT: GST Payable
      if (gst > 0) {
        lines.push({
          postingType: "Credit",
          amount: gst,
          accountId: accts.gstPayable.id,
          accountName: accts.gstPayable.name,
          description: `GST collected - ${locConfig.name} - ${sale.saleDate}`,
          className,
          classId,
        });
      }

      // CREDIT: QST Payable
      if (qst > 0) {
        lines.push({
          postingType: "Credit",
          amount: qst,
          accountId: accts.qstPayable.id,
          accountName: accts.qstPayable.name,
          description: `QST collected - ${locConfig.name} - ${sale.saleDate}`,
          className,
          classId,
        });
      }

      const docNumber = `REV-${locConfig.code}-${sale.saleDate}`;
      const result = await prodQbo.createProductionJournalEntry(locConfig.realmId, {
        txnDate: String(sale.saleDate),
        docNumber,
        privateNote: `Daily revenue entry for ${locConfig.name} - ${sale.saleDate} | Source: POS (Hinnawi Ops)`,
        lines,
      });

      const jeId = result?.JournalEntry?.Id;

      // Track in database
      try {
        await db.insert(revenueJournalEntries).values({
          locationId: sale.locationId,
          saleDate: String(sale.saleDate),
          realmId: locConfig.realmId,
          qboJeId: jeId || null,
          docNumber,
          totalSales: String(totalSales),
          netRevenue: String(netRevenue),
          gst: String(gst),
          qst: String(qst),
          status: "posted",
          environment: "production",
        });
      } catch (trackErr: any) {
        // Duplicate tracking entry is OK — means it was already tracked
        console.log(`  ⚠️  Tracking entry already exists for ${docNumber}`);
      }

      results.push({
        locationId: sale.locationId,
        locationCode: locConfig.code,
        saleDate: String(sale.saleDate),
        realmId: locConfig.realmId,
        status: "posted",
        qboJeId: jeId,
        docNumber,
        totalSales,
        netRevenue,
        gst,
        qst,
      });

      console.log(`  ✅ ${docNumber} — JE #${jeId} — Gross: $${totalSales.toFixed(2)}, Net: $${netRevenue.toFixed(2)}, GST: $${gst.toFixed(2)}, QST: $${qst.toFixed(2)}`);

      // Rate limit: 200ms between API calls
      await new Promise(r => setTimeout(r, 200));

    } catch (err: any) {
      results.push({
        locationId: sale.locationId,
        locationCode: locConfig.code,
        saleDate: String(sale.saleDate),
        realmId: locConfig.realmId,
        status: "error",
        error: err.message,
      });
      console.error(`  ❌ ${locConfig.code} ${sale.saleDate}: ${err.message}`);
    }
  }

  return results;
}

// ─── Full Pipeline: Delete + Re-post ───

export interface PipelineResult {
  phase1_query: { totalFound: number; byRealm: Record<string, number> };
  phase2_delete: { deleted: number; errors: number; details: DeleteResult[] };
  phase3_post: { posted: number; skipped: number; errors: number; details: PostResult[] };
  summary: {
    totalGrossSales: number;
    totalNetRevenue: number;
    totalGst: number;
    totalQst: number;
    jeCount: number;
  };
}

/**
 * Run the full revenue JE pipeline:
 *   1. Query existing revenue JEs in production QBO
 *   2. Delete them all
 *   3. Re-post from POS dailySales data
 * 
 * @param startDate - Start of date range (YYYY-MM-DD), e.g. "2025-09-01"
 * @param endDate - End of date range (YYYY-MM-DD), e.g. "2026-04-05"
 * @param dryRun - If true, only queries and reports without deleting/posting
 */
export async function runRevenueJePipeline(
  startDate: string,
  endDate: string,
  dryRun = false,
): Promise<PipelineResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Revenue JE Pipeline: ${startDate} → ${endDate}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE (will delete and re-post)"}`);
  console.log(`${"=".repeat(60)}\n`);

  // Phase 1: Query existing
  console.log("📋 Phase 1: Querying existing revenue JEs in production QBO...");
  const existingJEs = await queryExistingRevenueJEs(startDate, endDate);
  const byRealm: Record<string, number> = {};
  for (const je of existingJEs) {
    byRealm[je.realmId] = (byRealm[je.realmId] || 0) + 1;
  }
  console.log(`  Total found: ${existingJEs.length}`);
  for (const [realm, count] of Object.entries(byRealm)) {
    console.log(`    Realm ${realm}: ${count} JEs`);
  }

  // Phase 2: Delete existing
  let deleteResults: DeleteResult[] = [];
  if (!dryRun && existingJEs.length > 0) {
    console.log(`\n🗑️  Phase 2: Deleting ${existingJEs.length} existing revenue JEs...`);
    deleteResults = await deleteRevenueJEs(existingJEs);
  } else if (dryRun) {
    console.log(`\n🗑️  Phase 2: SKIPPED (dry run) — would delete ${existingJEs.length} JEs`);
  } else {
    console.log(`\n🗑️  Phase 2: No existing JEs to delete`);
  }

  // Phase 3: Re-post from POS data
  let postResults: PostResult[] = [];
  if (!dryRun) {
    console.log(`\n📝 Phase 3: Posting revenue JEs from POS data...`);
    postResults = await postRevenueJEsFromPOS(startDate, endDate);
  } else {
    console.log(`\n📝 Phase 3: SKIPPED (dry run) — would post JEs for all daily sales in range`);
    // Still count what would be posted
    const db = await getDb();
    if (db) {
      const sales = await db.select().from(dailySales)
        .where(and(gte(dailySales.saleDate, startDate), lte(dailySales.saleDate, endDate)));
      const mapped = sales.filter(s => LOCATION_QBO_MAP.some(l => l.locationId === s.locationId));
      const nonZero = mapped.filter(s => Number(s.totalSales) > 0);
      console.log(`  Would post ${nonZero.length} JEs (${mapped.length - nonZero.length} zero-sales skipped)`);
    }
  }

  // Summary
  const posted = postResults.filter(r => r.status === "posted");
  const summary = {
    totalGrossSales: posted.reduce((sum, r) => sum + (r.totalSales || 0), 0),
    totalNetRevenue: posted.reduce((sum, r) => sum + (r.netRevenue || 0), 0),
    totalGst: posted.reduce((sum, r) => sum + (r.gst || 0), 0),
    totalQst: posted.reduce((sum, r) => sum + (r.qst || 0), 0),
    jeCount: posted.length,
  };

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Existing JEs found:  ${existingJEs.length}`);
  console.log(`Deleted:             ${deleteResults.filter(r => r.status === "deleted").length}`);
  console.log(`Delete errors:       ${deleteResults.filter(r => r.status === "error").length}`);
  console.log(`Posted:              ${posted.length}`);
  console.log(`Skipped:             ${postResults.filter(r => r.status === "skipped").length}`);
  console.log(`Post errors:         ${postResults.filter(r => r.status === "error").length}`);
  if (posted.length > 0) {
    console.log(`Total Gross Sales:   $${summary.totalGrossSales.toFixed(2)}`);
    console.log(`Total Net Revenue:   $${summary.totalNetRevenue.toFixed(2)}`);
    console.log(`Total GST:           $${summary.totalGst.toFixed(2)}`);
    console.log(`Total QST:           $${summary.totalQst.toFixed(2)}`);
  }

  return {
    phase1_query: { totalFound: existingJEs.length, byRealm },
    phase2_delete: {
      deleted: deleteResults.filter(r => r.status === "deleted").length,
      errors: deleteResults.filter(r => r.status === "error").length,
      details: deleteResults,
    },
    phase3_post: {
      posted: posted.length,
      skipped: postResults.filter(r => r.status === "skipped").length,
      errors: postResults.filter(r => r.status === "error").length,
      details: postResults,
    },
    summary,
  };
}
