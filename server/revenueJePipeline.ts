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
 *   PK + MK → 9130346671806126 (shared company, class-filtered)
 *   ONT     → 123146517406139
 *   CT      → 123146517409489
 * 
 * Revenue JE Template (per day per location):
 *   Line 1: DEBIT  Accounts Receivable     = AR amount          (Name: MEV XX. / Ontario SALES-12732303)
 *   Line 2: CREDIT Sales (Zero-rated)      = taxExemptSales      (Tax: Zero-rated)
 *   Line 3: CREDIT Sales (Taxable)         = taxableSales        (Tax: GST/QST QC)
 *   Line 4: CREDIT GST Payable             = ROUND(taxable*0.05, 2)
 *   Line 5: CREDIT QST Payable             = ROUND(taxable*0.09975, 2)
 *   Line 6: DEBIT  Petty Cash              = pettyCash           (cash taken out)
 *   Line 7: CREDIT Tips Payable            = tipsCollected       (Tax: Zero-rated)
 *   Line 8: DEBIT/CREDIT Rounding Adj.     = balance diff        (if any, max $1.00)
 * 
 *   GST/QST are posted as explicit credit lines (QBO JE tax codes are tags only).
 *   AR = taxExemptSales + taxableSales + GST + QST + tips - pettyCash
 *   Rounding Adjustments absorbs any sub-$1 difference from POS rounding.
 */
import * as prodQbo from "./qboProduction";
import { getDb } from "./db";
import { dailySales, locations, revenueJournalEntries } from "../drizzle/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";

/**
 * Safely convert a Date or string to YYYY-MM-DD without timezone shift.
 * MySQL `date` columns come back as JS Date objects at midnight UTC.
 * Using String() or toISOString() can shift the date by -1 day in EDT/EST.
 */
function toDateStr(d: Date | string | null | undefined): string {
  if (!d) return "";
  if (typeof d === "string") {
    // Already a string — just take the first 10 chars (YYYY-MM-DD)
    return d.slice(0, 10);
  }
  // It's a Date object — use UTC components to avoid timezone shift
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─── Location → QBO Realm Mapping ───

interface LocationQboConfig {
  locationId: number;
  code: string;
  name: string;
  realmId: string;
  departmentFilter?: string; // PK or MK for the shared company
  mevName?: string; // Name column in QBO (e.g., "MEV MK.", "MEV PK.")
  taxProvince?: "QC" | "ON"; // Province for tax calculation — QC = GST+QST, ON = HST
  /**
   * When true, the POS totalSales is TAX-INCLUSIVE (i.e., it includes GST+QST).
   * The pipeline will back-calculate the tax from totalSales.
   * This is needed for locations like Ontario cafe (in QC) where 7shifts
   * reports gross receipts including tax but doesn't break down GST/QST.
   */
  taxInclusive?: boolean;
}

const LOCATION_QBO_MAP: LocationQboConfig[] = [
  { locationId: 1, code: "PK", name: "President Kennedy", realmId: "9130346671806126", departmentFilter: "PK", mevName: "MEV PK.", taxProvince: "QC" },
  { locationId: 2, code: "MK", name: "Mackay", realmId: "9130346671806126", departmentFilter: "MK", mevName: "MEV MK.", taxProvince: "QC" },
  { locationId: 3, code: "ONT", name: "Ontario", realmId: "123146517406139", mevName: "Ontario SALES-12732303", taxProvince: "QC", taxInclusive: true },
  { locationId: 4, code: "CT", name: "Cathcart Tunnel", realmId: "123146517409489", mevName: "MEV CT.", taxProvince: "QC" },
];

// ─── Account ID Cache (per realm) ───

interface RealmAccountIds {
  accountsReceivable: { id: string; name: string };
  undepositedFunds: { id: string; name: string };
  cashOnHand: { id: string; name: string };
  discountsPromotions: { id: string; name: string };
  salesRevenue: { id: string; name: string };
  pettyCash: { id: string; name: string };
  tipsPayable: { id: string; name: string };
  gstPayable: { id: string; name: string };
  qstPayable: { id: string; name: string };
  roundingAdjustments: { id: string; name: string };
  taxCodeZeroRated: { id: string; name: string } | null;
  taxCodeGstQst: { id: string; name: string } | null;
}

const accountIdCache = new Map<string, RealmAccountIds>();

/**
 * Discover the correct QBO account IDs and tax codes for revenue JEs in a given realm.
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

  async function findAccountOrCreate(
    patterns: string[],
    createAs: { name: string; accountType: string; accountSubType?: string; description?: string },
  ): Promise<{ id: string; name: string }> {
    for (const pattern of patterns) {
      const found = accounts.find((a: { Name: string; Id: string }) =>
        a.Name.toLowerCase() === pattern.toLowerCase()
      );
      if (found) return { id: found.Id, name: found.Name };
    }
    for (const pattern of patterns) {
      const found = accounts.find((a: { Name: string; Id: string }) =>
        a.Name.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) return { id: found.Id, name: found.Name };
    }
    // Auto-create the missing account
    console.log(`  ⚠️  Account not found in realm ${realmId}. Creating "${createAs.name}"...`);
    const created = await prodQbo.createProductionAccount(realmId, createAs);
    return { id: created.Id, name: created.Name };
  }

  // Resolve tax codes
  const taxCodeZeroRated = await prodQbo.resolveTaxCodeId(realmId, "Zero-rated");
  const taxCodeGstQst = await prodQbo.resolveTaxCodeId(realmId, "GST/QST QC");

  const result: RealmAccountIds = {
    accountsReceivable: findAccount([
      "Accounts Receivable", "1200 Accounts Receivable", "Accounts Receivable (A/R)",
      "Comptes clients", "A/R",
    ]),
    undepositedFunds: await findAccountOrCreate(
      [
        "Undeposited Funds", "1050 Undeposited Funds",
        "Fonds non d\u00e9pos\u00e9s",
      ],
      {
        name: "Undeposited Funds",
        accountType: "Other Current Asset",
        accountSubType: "UndepositedFunds",
        description: "Electronic payments (credit/debit) not yet deposited",
      },
    ),
    cashOnHand: await findAccountOrCreate(
      [
        "Cash on Hand", "1060 Cash on Hand", "Petty Cash", "1051 Petty Cash",
        "Petite caisse", "Cash",
      ],
      {
        name: "Cash on Hand",
        accountType: "Bank",
        accountSubType: "CashOnHand",
        description: "Cash payments collected at POS",
      },
    ),
    discountsPromotions: await findAccountOrCreate(
      [
        "Discounts & Promotions", "Discounts", "Promotions",
        "Rabais et promotions", "Discount",
      ],
      {
        name: "Discounts & Promotions",
        accountType: "Income",
        accountSubType: "DiscountsRefundsGiven",
        description: "Discounts and promotions given at POS",
      },
    ),
    salesRevenue: findAccount([
      "Sales", "Sales Revenue", "4200 Sales", "Sales MK", "Sales PK",
      "Revenue", "Sales of Product Income", "Ventes",
    ]),
    pettyCash: findAccount([
      "Petty Cash", "1051 Petty Cash", "Petty Cash - PK", "Petty Cash - MK",
      "Petite caisse", "Cash on Hand",
    ]),
    tipsPayable: await findAccountOrCreate(
      [
        "Tips", "Tips Payable", "Tips Payable - PK", "Tips Payable - MK",
        "Pourboires", "Pourboires à payer", "Tips payable",
      ],
      {
        name: "Tips Payable",
        accountType: "Other Current Liability",
        accountSubType: "OtherCurrentLiabilities",
        description: "Tips collected from POS to be paid to staff",
      },
    ),
    gstPayable: await findAccountOrCreate(
      [
        "GST Payable", "GST/HST Payable", "GST", "TPS à payer",
        "GST/HST Suspense", "GST Collected",
      ],
      {
        name: "GST Payable",
        accountType: "Other Current Liability",
        accountSubType: "OtherCurrentLiabilities",
        description: "GST (TPS) collected on taxable sales",
      },
    ),
    qstPayable: await findAccountOrCreate(
      [
        "QST Payable", "TVQ à payer", "QST", "TVQ",
        "QST Collected", "Provincial Tax Payable",
      ],
      {
        name: "QST Payable",
        accountType: "Other Current Liability",
        accountSubType: "OtherCurrentLiabilities",
        description: "QST (TVQ) collected on taxable sales",
      },
    ),
    roundingAdjustments: await findAccountOrCreate(
      [
        "Rounding Adjustments", "Rounding", "Rounding Expense",
        "Ajustements d'arrondissement",
      ],
      {
        name: "Rounding Adjustments",
        accountType: "Expense",
        accountSubType: "OtherMiscellaneousExpense",
        description: "Rounding differences on POS revenue journal entries",
      },
    ),
    taxCodeZeroRated,
    taxCodeGstQst,
  };

  accountIdCache.set(realmId, result);
  console.log(`  Realm ${realmId} accounts resolved:`);
  console.log(`    AR:           ${result.accountsReceivable.name} (#${result.accountsReceivable.id})`);
  console.log(`    Undeposited:  ${result.undepositedFunds.name} (#${result.undepositedFunds.id})`);
  console.log(`    Cash on Hand: ${result.cashOnHand.name} (#${result.cashOnHand.id})`);
  console.log(`    Discounts:    ${result.discountsPromotions.name} (#${result.discountsPromotions.id})`);
  console.log(`    Sales:        ${result.salesRevenue.name} (#${result.salesRevenue.id})`);
  console.log(`    Petty Cash:   ${result.pettyCash.name} (#${result.pettyCash.id})`);
    console.log(`    Tips:         ${result.tipsPayable.name} (#${result.tipsPayable.id})`);
  console.log(`    GST Payable:  ${result.gstPayable.name} (#${result.gstPayable.id})`);
  console.log(`    QST Payable:  ${result.qstPayable.name} (#${result.qstPayable.id})`);
  console.log(`    Rounding:     ${result.roundingAdjustments.name} (#${result.roundingAdjustments.id})`);
  console.log(`    Tax Zero:     ${result.taxCodeZeroRated?.name || "NOT FOUND"} (#${result.taxCodeZeroRated?.id || "?"})`);
  console.log(`    Tax GST/QST:  ${result.taxCodeGstQst?.name || "NOT FOUND"} (#${result.taxCodeGstQst?.id || "?"})`);
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
 * Option C: Finds ALL journal entries that touch a Sales account (name contains "Sales")
 * within the date range, regardless of DocNumber. This catches both manual JEs
 * (e.g., "01March RevenueMK") and automated ones (e.g., "REVPK260405").
 */
export async function queryExistingRevenueJEs(
  startDate: string,
  endDate: string,
): Promise<ExistingRevenueJE[]> {
  const allJEs: ExistingRevenueJE[] = [];
  const uniqueRealms = [...new Set(LOCATION_QBO_MAP.map(l => l.realmId))];

  for (const realmId of uniqueRealms) {
    try {
      // First, resolve the Sales account name for this realm
      const accounts = await prodQbo.getProductionAccounts(realmId);
      const salesAccounts = accounts.filter((a: { Name: string; AccountType: string }) =>
        a.Name.toLowerCase().includes("sales") && a.AccountType === "Income"
      );
      const salesAccountIds = new Set(salesAccounts.map((a: { Id: string }) => a.Id));
      const salesAccountNames = salesAccounts.map((a: { Name: string }) => a.Name);
      console.log(`  Realm ${realmId}: Sales accounts found: ${salesAccountNames.join(", ")}`);

      const entries = await prodQbo.getJournalEntriesByDateRange(realmId, startDate, endDate);

      for (const entry of entries) {
        // Check if ANY line in this JE touches a Sales account
        const lines = entry.Line || [];
        const touchesSales = lines.some((line: any) => {
          const detail = line.JournalEntryLineDetail;
          if (!detail || !detail.AccountRef) return false;
          return salesAccountIds.has(detail.AccountRef.value);
        });

        if (touchesSales) {
          allJEs.push({
            realmId,
            jeId: entry.Id,
            syncToken: entry.SyncToken,
            docNumber: entry.DocNumber || "(no doc#)",
            txnDate: entry.TxnDate,
            totalAmt: entry.TotalAmt,
          });
        }
      }

      const realmCount = allJEs.filter(j => j.realmId === realmId).length;
      console.log(`  Realm ${realmId}: found ${realmCount} JEs touching Sales accounts`);
    } catch (err: any) {
      console.error(`  Realm ${realmId}: ERROR querying JEs — ${err.message}`);
    }
  }

  return allJEs;
}

// ─── Step 2: Delete (or Void) Existing Revenue JEs ───

export interface DeleteResult {
  realmId: string;
  jeId: string;
  docNumber: string;
  status: "deleted" | "voided" | "error";
  error?: string;
}

/**
 * Delete existing revenue JEs. If a JE is matched to a bank transaction
 * (QBO error 6480), automatically falls back to voiding it instead.
 * Voided JEs have all amounts zeroed out so they don't affect financials.
 */
export async function deleteRevenueJEs(
  existingJEs: ExistingRevenueJE[],
): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];

  for (const je of existingJEs) {
    try {
      // Try delete first
      await prodQbo.deleteJournalEntry(je.realmId, je.jeId, je.syncToken);
      results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "deleted" });
      console.log(`  ✅ Deleted ${je.docNumber} (JE #${je.jeId}) from realm ${je.realmId}`);
    } catch (err: any) {
      const errMsg = err.message || "";
      // Error 6480 = matched to bank transaction, can't delete → void instead
      if (errMsg.includes("6480") || errMsg.includes("matched") || errMsg.includes("reconcil")) {
        try {
          await prodQbo.voidJournalEntry(je.realmId, je.jeId, je.syncToken);
          results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "voided" });
          console.log(`  🔄 Voided ${je.docNumber} (JE #${je.jeId}) — was matched to bank txn`);
        } catch (voidErr: any) {
          results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "error", error: `Delete failed (6480), void also failed: ${voidErr.message}` });
          console.error(`  ❌ Failed to delete AND void ${je.docNumber}: ${voidErr.message}`);
        }
      } else {
        results.push({ realmId: je.realmId, jeId: je.jeId, docNumber: je.docNumber, status: "error", error: errMsg });
        console.error(`  ❌ Failed to delete ${je.docNumber}: ${errMsg}`);
      }
    }
    // Rate limit: 200ms between API calls
    await new Promise(r => setTimeout(r, 200));
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
  taxExemptSales?: number;
  taxableSales?: number;
  pettyCash?: number;
  tips?: number;
  arAmount?: number;
  gst?: number;
  qst?: number;
  error?: string;
}

/**
 * Post revenue JEs from POS dailySales data for a date range.
 * Creates one JE per day per location in the correct production realm.
 * 
 * JE Template:
 *   Line 1: DEBIT  Accounts Receivable  = AR amount          (Name: MEV XX.)
 *   Line 2: CREDIT Sales                = taxExemptSales      (Tax: Zero-rated)
 *   Line 3: CREDIT Sales                = taxableSales        (Tax: GST/QST QC - 9.975)
 *   Line 4: DEBIT  Petty Cash           = pettyCash           (if > 0)
 *   Line 5: CREDIT Tips Payable         = tipsCollected       (Tax: Zero-rated, if > 0)
 * 
 * IMPORTANT: AR uses QBO-matching tax calculation (ROUND(taxable * rate, 2))
 * instead of POS-recorded GST/QST to avoid rounding mismatches.
 * 
 * For entries with no tax split (e.g., Ontario/7shifts where taxExempt=0 AND
 * taxable=0 but totalSales>0), totalSales is posted as a single tax-exempt
 * credit line.
 */
export async function postRevenueJEsFromPOS(
  startDate: string,
  endDate: string,
): Promise<PostResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results: PostResult[] = [];

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
        saleDate: toDateStr(sale.saleDate),
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
        saleDate: toDateStr(sale.saleDate),
        realmId: locConfig.realmId,
        status: "skipped",
        error: "Zero sales (store closed)",
      });
      continue;
    }

    try {
      const accts = await getRealmAccountIds(locConfig.realmId);

      let taxExemptSales = Math.round(Number(sale.taxExemptSales || 0) * 100) / 100;
      let taxableSales = Math.round(Number(sale.taxableSales || 0) * 100) / 100;
      const posGst = Math.round(Number(sale.gstCollected || 0) * 100) / 100;
      const posQst = Math.round(Number(sale.qstCollected || 0) * 100) / 100;
      const pettyCash = Math.round(Number((sale as any).pettyCash || 0) * 100) / 100;
      const discounts = Math.round(Number((sale as any).discounts || 0) * 100) / 100;
      const tips = Math.round(Number(sale.tipsCollected || 0) * 100) / 100;

      // ── Scenario 0: Tax-inclusive POS (e.g., Ontario cafe via 7shifts) ──
      // When taxInclusive=true, the POS totalSales INCLUDES GST+QST.
      // We must back-calculate the net revenue from the gross total.
      // Formula: netSales = totalSales / (1 + GST_RATE + QST_RATE)
      //          GST = ROUND(netSales * 0.05, 2)
      //          QST = ROUND(netSales * 0.09975, 2)
      // This ensures revenue reports show actual net revenue, not gross receipts.
      if (locConfig.taxInclusive && posGst === 0 && posQst === 0 && totalSales > 0) {
        if (locConfig.taxProvince === "QC") {
          // QC: GST 5% + QST 9.975% = 14.975% combined
          const netSales = Math.round(totalSales / 1.14975 * 100) / 100;
          const backGst = Math.round(netSales * 5) / 100;
          const backQst = Math.round(netSales * 9.975) / 100;
          // Assign: all net sales are taxable (Ontario has no tax-exempt split from 7shifts)
          taxableSales = netSales;
          taxExemptSales = 0;
          // Override the POS GST/QST with back-calculated values
          // (We'll use these below instead of posGst/posQst)
          (sale as any)._backCalcGst = backGst;
          (sale as any)._backCalcQst = backQst;
          console.log(`  💰 ${locConfig.code} ${sale.saleDate}: Tax-inclusive POS — gross=$${totalSales.toFixed(2)}, net=$${netSales.toFixed(2)}, GST=$${backGst.toFixed(2)}, QST=$${backQst.toFixed(2)}`);
        }
      }

      // ── Repair incomplete tax splits (for non-taxInclusive locations) ──
      // Scenario 1: No split at all (taxExempt=0 AND taxable=0 but totalSales>0)
      //   → Treat entire totalSales as tax-exempt.
      // Scenario 2: Partial split — 7shifts overwrote Lightspeed data
      //   (taxExempt=0, taxable>0, GST=0, QST=0, and taxable < totalSales)
      //   → The gap (totalSales - taxable) is the missing tax-exempt portion.
      // Scenario 3: Full Lightspeed data (taxExempt>0, taxable>0, GST>0, QST>0)
      //   → Use as-is.

      if (!locConfig.taxInclusive && taxExemptSales === 0 && taxableSales === 0 && totalSales > 0) {
        // Scenario 1: no split at all → all tax-exempt
        taxExemptSales = totalSales;
        console.log(`  ℹ️  ${locConfig.code} ${sale.saleDate}: No tax split — treating $${totalSales.toFixed(2)} as tax-exempt`);
      } else if (taxExemptSales === 0 && taxableSales > 0 && posGst === 0 && posQst === 0) {
        // Scenario 2: partial split (7shifts overwrote Lightspeed)
        // taxable has a value but GST/QST are 0 → data is incomplete
        // The gap between totalSales and taxable is the missing tax-exempt portion
        const gap = Math.round((totalSales - taxableSales) * 100) / 100;
        if (gap > 0) {
          taxExemptSales = gap;
          console.log(`  ℹ️  ${locConfig.code} ${sale.saleDate}: Partial split — recovered exempt=$${gap.toFixed(2)} from gap (total=$${totalSales.toFixed(2)} - taxable=$${taxableSales.toFixed(2)})`);
        } else if (gap === 0) {
          // totalSales == taxable, everything is taxable, no exempt
          console.log(`  ℹ️  ${locConfig.code} ${sale.saleDate}: All taxable ($${taxableSales.toFixed(2)}), no exempt`);
        } else {
          // gap < 0 means taxable > totalSales — data inconsistency, treat all as tax-exempt to be safe
          console.warn(`  ⚠️  ${locConfig.code} ${sale.saleDate}: Data inconsistency — taxable ($${taxableSales.toFixed(2)}) > totalSales ($${totalSales.toFixed(2)}). Treating all as tax-exempt.`);
          taxExemptSales = totalSales;
          taxableSales = 0;
        }
      }
      // Scenario 3: full data — no changes needed

      // ── Calculate GST/QST ──
      // For taxInclusive locations: use the back-calculated values from Scenario 0
      // For other locations: use ROUND(taxable * rate, 2) to match QBO's auto-calculation
      let gst: number;
      let qst: number;
      if ((sale as any)._backCalcGst !== undefined) {
        gst = (sale as any)._backCalcGst;
        qst = (sale as any)._backCalcQst;
      } else {
        gst = Math.round(taxableSales * 5) / 100;       // ROUND(taxable * 0.05, 2)
        qst = Math.round(taxableSales * 9.975) / 100;   // ROUND(taxable * 0.09975, 2)
      }

      // ── Debit/Credit structure (matching QBO template) ──
      // DEBITS:
      //   Undeposited Funds = totalSales - pettyCash - discounts (electronic payments)
      //   Cash on Hand      = pettyCash (cash payments)
      //   Discounts & Promo = discounts (discounts given, reduces revenue)
      // CREDITS:
      //   Sales - Tax Exempt = taxExemptSales
      //   Sales - Taxable    = taxableSales
      //   GST Payable        = gst
      //   QST Payable        = qst
      //   Tips Payable       = tips
      //   Rounding Adj       = balance difference
      const undepositedFundsAmount = Math.round((taxExemptSales + taxableSales + gst + qst + tips - pettyCash - discounts) * 100) / 100;
      const arAmount = undepositedFundsAmount; // For backward compat in DB tracking

      // ── Pre-flight validation: ensure at least 2 lines ──
      let lineCount = 0;
      if (undepositedFundsAmount > 0) lineCount++;
      if (pettyCash > 0) lineCount++;
      if (discounts > 0) lineCount++;
      if (taxExemptSales > 0) lineCount++;
      if (taxableSales > 0) lineCount++;
      if (gst > 0) lineCount++;
      if (qst > 0) lineCount++;
      if (tips > 0) lineCount++;

      if (lineCount < 2) {
        results.push({
          locationId: sale.locationId,
          locationCode: locConfig.code,
          saleDate: toDateStr(sale.saleDate),
          realmId: locConfig.realmId,
          status: "skipped",
          error: `Only ${lineCount} line(s) — need at least 2 for QBO`,
        });
        console.log(`  ⏭️  ${locConfig.code} ${sale.saleDate}: Skipped — only ${lineCount} JE line(s)`);
        continue;
      }

      // ── Pre-flight validation: debits must equal credits ──
      // If there's a small rounding difference, absorb it into Rounding Adjustments
      const totalDebits = undepositedFundsAmount + pettyCash + discounts;
      const totalCredits = taxExemptSales + taxableSales + gst + qst + tips;
      const balance = Math.round((totalDebits - totalCredits) * 100) / 100;
      let roundingAmount = 0;
      if (balance !== 0) {
        if (Math.abs(balance) > 1.00) {
          // More than $1 difference is a data issue, not rounding
          results.push({
            locationId: sale.locationId,
            locationCode: locConfig.code,
            saleDate: toDateStr(sale.saleDate),
            realmId: locConfig.realmId,
            status: "error",
            error: `Pre-flight: Debits ($${totalDebits.toFixed(2)}) ≠ Credits ($${totalCredits.toFixed(2)}), diff=$${balance.toFixed(2)} exceeds $1.00 threshold`,
          });
          console.error(`  ❌ ${locConfig.code} ${sale.saleDate}: Balance diff $${balance.toFixed(2)} exceeds $1.00 — likely data issue, not rounding`);
          continue;
        }
        // Small rounding difference — will be absorbed by Rounding Adjustments line
        roundingAmount = balance; // positive = debits > credits, negative = credits > debits
        console.log(`  ℹ️  ${locConfig.code} ${sale.saleDate}: Rounding adjustment of $${balance.toFixed(2)} will be applied`);
      }

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

      // Resolve MEV customer for the Name column
      let entityId: string | undefined;
      let entityName: string | undefined;
      if (locConfig.mevName) {
        const customer = await prodQbo.resolveCustomerId(locConfig.realmId, locConfig.mevName);
        if (customer) {
          entityId = customer.id;
          entityName = customer.name;
        }
      }

      // DocNumber max 21 chars in QBO. Format: REVPK250405
      const dateStr = toDateStr(sale.saleDate);
      const shortDate = dateStr.replace(/-/g, "").slice(2); // 250405 from 2025-04-05
      const docNumber = `REV${locConfig.code}${shortDate}`;
      const description = `${shortDate.slice(2)}${locConfig.code} Revenue`;

      const lines: Array<{
        postingType: "Debit" | "Credit";
        amount: number;
        accountId: string;
        accountName: string;
        description: string;
        className?: string;
        classId?: string;
        taxCodeId?: string;
        taxCodeName?: string;
        entityId?: string;
        entityName?: string;
      }> = [];

      // Line 1: DEBIT Undeposited Funds = electronic payments (with MEV Name)
      if (undepositedFundsAmount > 0) {
        lines.push({
          postingType: "Debit",
          amount: undepositedFundsAmount,
          accountId: accts.undepositedFunds.id,
          accountName: accts.undepositedFunds.name,
          description: `Daily Sales - ${locConfig.name} - ${dateStr}`,
          className,
          classId,
          entityId,
          entityName,
        });
      }

      // Line 2: DEBIT Cash on Hand = cash payments
      if (pettyCash > 0) {
        lines.push({
          postingType: "Debit",
          amount: pettyCash,
          accountId: accts.cashOnHand.id,
          accountName: accts.cashOnHand.name,
          description: `Daily Sales - ${locConfig.name} - ${dateStr}`,
          className,
          classId,
        });
      }

      // Line 3: DEBIT Discounts & Promotions = discounts given
      if (discounts > 0) {
        lines.push({
          postingType: "Debit",
          amount: discounts,
          accountId: accts.discountsPromotions.id,
          accountName: accts.discountsPromotions.name,
          description: `Daily Sales - ${locConfig.name} - ${dateStr}`,
          className,
          classId,
        });
      }

      // Line 4: CREDIT Sales = taxExemptSales (Tax: Zero-rated)
      if (taxExemptSales > 0) {
        lines.push({
          postingType: "Credit",
          amount: taxExemptSales,
          accountId: accts.salesRevenue.id,
          accountName: accts.salesRevenue.name,
          description: `${description}`,
          className,
          classId,
          taxCodeId: accts.taxCodeZeroRated?.id,
          taxCodeName: accts.taxCodeZeroRated?.name,
        });
      }

      // Line 3: CREDIT Sales = taxableSales (no auto-tax — we post GST/QST as explicit lines)
      if (taxableSales > 0) {
        lines.push({
          postingType: "Credit",
          amount: taxableSales,
          accountId: accts.salesRevenue.id,
          accountName: accts.salesRevenue.name,
          description: `${description}`,
          className,
          classId,
          taxCodeId: accts.taxCodeGstQst?.id,
          taxCodeName: accts.taxCodeGstQst?.name,
        });
      }

      // Line 4: CREDIT GST Payable (explicit — QBO JE tax codes are tags only, they don't auto-add amounts)
      if (gst > 0) {
        lines.push({
          postingType: "Credit",
          amount: gst,
          accountId: accts.gstPayable.id,
          accountName: accts.gstPayable.name,
          description: `${description} GST`,
          className,
          classId,
        });
      }

      // Line 5: CREDIT QST Payable (explicit)
      if (qst > 0) {
        lines.push({
          postingType: "Credit",
          amount: qst,
          accountId: accts.qstPayable.id,
          accountName: accts.qstPayable.name,
          description: `${description} QST`,
          className,
          classId,
        });
      }

      // Line 8: CREDIT Tips Payable (if > 0)
      if (tips > 0) {
        lines.push({
          postingType: "Credit",
          amount: tips,
          accountId: accts.tipsPayable.id,
          accountName: accts.tipsPayable.name,
          description: `${description}`,
          className,
          classId,
          taxCodeId: accts.taxCodeZeroRated?.id,
          taxCodeName: accts.taxCodeZeroRated?.name,
        });
      }

      // Line 8: Rounding Adjustments (if balance ≠ 0)
      // If debits > credits (positive balance): add a CREDIT to Rounding Adjustments
      // If credits > debits (negative balance): add a DEBIT to Rounding Adjustments
      if (roundingAmount !== 0) {
        lines.push({
          postingType: roundingAmount > 0 ? "Credit" : "Debit",
          amount: Math.abs(roundingAmount),
          accountId: accts.roundingAdjustments.id,
          accountName: accts.roundingAdjustments.name,
          description: `${description} Rounding`,
          className,
          classId,
        });
      }

      const result = await prodQbo.createProductionJournalEntry(locConfig.realmId, {
        txnDate: toDateStr(sale.saleDate),
        docNumber,
        privateNote: `Daily revenue entry for ${locConfig.name} - ${sale.saleDate} | Source: POS (Hinnawi Ops)`,
        lines,
      });

      const jeId = result?.JournalEntry?.Id;

      // Track in database with full line details
      try {
        await db.insert(revenueJournalEntries).values({
          locationId: sale.locationId,
          saleDate: toDateStr(sale.saleDate),
          realmId: locConfig.realmId,
          qboJeId: jeId || null,
          docNumber,
          totalSales: String(totalSales),
          netRevenue: String(taxExemptSales + taxableSales),
          gst: String(gst),
          qst: String(qst),
          taxExemptSales: String(taxExemptSales),
          taxableSales: String(taxableSales),
          tips: String(tips),
          pettyCash: String(pettyCash),
          arAmount: String(arAmount),
          roundingAdj: String(roundingAmount),
          jeLineDetails: JSON.stringify(lines),
          status: "posted",
          environment: "production",
        });
      } catch (trackErr: any) {
        console.log(`  ⚠️  Tracking entry already exists for ${docNumber}`);
      }

      results.push({
        locationId: sale.locationId,
        locationCode: locConfig.code,
        saleDate: toDateStr(sale.saleDate),
        realmId: locConfig.realmId,
        status: "posted",
        qboJeId: jeId,
        docNumber,
        totalSales,
        taxExemptSales,
        taxableSales,
        pettyCash,
        tips,
        arAmount,
        gst,
        qst,
      });

      console.log(`  ✅ ${docNumber} — JE #${jeId} — AR: $${arAmount.toFixed(2)}, Exempt: $${taxExemptSales.toFixed(2)}, Taxable: $${taxableSales.toFixed(2)}, Tips: $${tips.toFixed(2)}, PettyCash: $${pettyCash.toFixed(2)}`);

      // Rate limit: 200ms between API calls
      await new Promise(r => setTimeout(r, 200));

    } catch (err: any) {
      // Record failed entry in database so it can be reviewed and reposted
      try {
        await db.insert(revenueJournalEntries).values({
          locationId: sale.locationId,
          saleDate: toDateStr(sale.saleDate),
          realmId: locConfig.realmId,
          docNumber,
          totalSales: String(totalSales),
          netRevenue: String(taxExemptSales + taxableSales),
          gst: String(gst),
          qst: String(qst),
          taxExemptSales: String(taxExemptSales),
          taxableSales: String(taxableSales),
          tips: String(tips),
          pettyCash: String(pettyCash),
          arAmount: String(arAmount),
          roundingAdj: String(roundingAmount),
          jeLineDetails: JSON.stringify(lines),
          status: "failed",
          errorMessage: err.message,
          environment: "production",
        });
      } catch (trackErr: any) {
        // Ignore tracking errors
      }

      results.push({
        locationId: sale.locationId,
        locationCode: locConfig.code,
        saleDate: toDateStr(sale.saleDate),
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
  phase2_delete: { deleted: number; voided: number; errors: number; details: DeleteResult[] };
  phase3_post: { posted: number; skipped: number; errors: number; details: PostResult[] };
  summary: {
    totalGrossSales: number;
    totalTaxExempt: number;
    totalTaxable: number;
    totalGst: number;
    totalQst: number;
    totalTips: number;
    totalPettyCash: number;
    totalAR: number;
    jeCount: number;
  };
}

/**
 * Run the full revenue JE pipeline:
 *   1. Query existing revenue JEs in production QBO
 *   2. Delete them all
 *   3. Re-post from POS dailySales data
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
    console.log(`\n🗑️  Phase 2: Deleting/voiding ${existingJEs.length} existing revenue JEs...`);
    console.log(`  (JEs matched to bank transactions will be voided instead of deleted)`);
    deleteResults = await deleteRevenueJEs(existingJEs);
  } else if (dryRun) {
    console.log(`\n🗑️  Phase 2: SKIPPED (dry run) — would delete/void ${existingJEs.length} JEs`);
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
    totalTaxExempt: posted.reduce((sum, r) => sum + (r.taxExemptSales || 0), 0),
    totalTaxable: posted.reduce((sum, r) => sum + (r.taxableSales || 0), 0),
    totalGst: posted.reduce((sum, r) => sum + (r.gst || 0), 0),
    totalQst: posted.reduce((sum, r) => sum + (r.qst || 0), 0),
    totalTips: posted.reduce((sum, r) => sum + (r.tips || 0), 0),
    totalPettyCash: posted.reduce((sum, r) => sum + (r.pettyCash || 0), 0),
    totalAR: posted.reduce((sum, r) => sum + (r.arAmount || 0), 0),
    jeCount: posted.length,
  };

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Existing JEs found:  ${existingJEs.length}`);
  console.log(`Deleted:             ${deleteResults.filter(r => r.status === "deleted").length}`);
  console.log(`Voided (matched):    ${deleteResults.filter(r => r.status === "voided").length}`);
  console.log(`Delete errors:       ${deleteResults.filter(r => r.status === "error").length}`);
  console.log(`Posted:              ${posted.length}`);
  console.log(`Skipped:             ${postResults.filter(r => r.status === "skipped").length}`);
  console.log(`Post errors:         ${postResults.filter(r => r.status === "error").length}`);
  if (posted.length > 0) {
    console.log(`Total Gross Sales:   $${summary.totalGrossSales.toFixed(2)}`);
    console.log(`  Tax Exempt:        $${summary.totalTaxExempt.toFixed(2)}`);
    console.log(`  Taxable:           $${summary.totalTaxable.toFixed(2)}`);
    console.log(`Total GST (auto):    $${summary.totalGst.toFixed(2)}`);
    console.log(`Total QST (auto):    $${summary.totalQst.toFixed(2)}`);
    console.log(`Total Tips:          $${summary.totalTips.toFixed(2)}`);
    console.log(`Total Petty Cash:    $${summary.totalPettyCash.toFixed(2)}`);
    console.log(`Total AR:            $${summary.totalAR.toFixed(2)}`);
  }

  return {
    phase1_query: { totalFound: existingJEs.length, byRealm },
    phase2_delete: {
      deleted: deleteResults.filter(r => r.status === "deleted").length,
      voided: deleteResults.filter(r => r.status === "voided").length,
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
