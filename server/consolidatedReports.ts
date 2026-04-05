/**
 * Consolidated Financial Reports
 * Merges P&L and Balance Sheet data across all entities,
 * eliminates intercompany accounts, and consolidates similar accounts.
 */
import * as financialDb from "./financialDb";
import * as financialReports from "./financialReports";
import type { FinancialStatement, StatementLine } from "./financialReports";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConsolidatedStatement {
  statementType: "profit_loss" | "balance_sheet";
  periodLabel: string;
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
  currency: string;
  lines: ConsolidatedLine[];
  entityBreakdown: EntityBreakdown[];
  eliminatedAccounts: EliminatedAccount[];
  generatedAt: string;
  entityCount: number;
}

export interface ConsolidatedLine {
  category: string;
  subcategory: string | null;
  label: string;
  lineType: "header" | "detail" | "subtotal" | "total" | "spacer";
  consolidatedAmount: number;
  eliminationAmount: number;
  netAmount: number;
  priorAmount: number | null;
  varianceDollar: number | null;
  variancePct: number | null;
  entityAmounts: Record<string, number>; // entityId -> amount
  accounts: Array<{
    accountName: string;
    amount: number;
    entityName: string;
    entityId: number;
    isEliminated: boolean;
  }>;
}

export interface EntityBreakdown {
  entityId: number;
  entityName: string;
  locationName: string;
  realmId: string;
}

export interface EliminatedAccount {
  accountName: string;
  amount: number;
  entityName: string;
  entityId: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERCOMPANY DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default intercompany account patterns.
 * These are matched case-insensitively against account names.
 */
const DEFAULT_INTERCOMPANY_PATTERNS = [
  /intercompany/i,
  /inter-company/i,
  /inter company/i,
  /due (to|from) .*(pk|mk|ont|ct|factory|hinnawi|mackay|parc kennedy|central kitchen)/i,
  /loan (to|from) .*(pk|mk|ont|ct|factory|hinnawi|mackay|parc kennedy|central kitchen)/i,
  /receivable.*(pk|mk|ont|ct|factory|hinnawi|mackay|parc kennedy|central kitchen)/i,
  /payable.*(pk|mk|ont|ct|factory|hinnawi|mackay|parc kennedy|central kitchen)/i,
  /transfer.*(pk|mk|ont|ct|factory|hinnawi|mackay|parc kennedy|central kitchen)/i,
  /9427.?0659/i,
  /9287.?8982/i,
  /9364.?1009/i,
  /hinnawi bros/i,
];

function isIntercompanyAccount(accountName: string, customPatterns?: string[]): boolean {
  // Check default patterns
  for (const pattern of DEFAULT_INTERCOMPANY_PATTERNS) {
    if (pattern.test(accountName)) return true;
  }
  // Check custom patterns
  if (customPatterns) {
    for (const p of customPatterns) {
      try {
        if (new RegExp(p, "i").test(accountName)) return true;
      } catch { /* invalid regex, skip */ }
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT CONSOLIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Consolidation rules for merging similar accounts across entities.
 * Maps variant account names to a canonical name.
 */
const ACCOUNT_CONSOLIDATION_MAP: Record<string, string> = {
  // Revenue variants
  "sales": "Sales",
  "sales - tax exempt": "Sales - Tax Exempt",
  "sales - taxable": "Sales - Taxable",
  "revenue": "Revenue",
  "sales revenue": "Sales",
  "food sales": "Food Sales",
  "beverage sales": "Beverage Sales",
  "catering sales": "Catering Sales",
  "discounts & promotions": "Discounts & Promotions",
  "discounts given": "Discounts & Promotions",
  "discounts": "Discounts & Promotions",

  // COGS variants
  "cost of goods sold": "Cost of Goods Sold",
  "cogs": "Cost of Goods Sold",
  "cogs - bakery & dough": "COGS - Bakery & Dough",
  "cogs - bakery & dough ingredients": "COGS - Bakery & Dough",
  "cogs - produce": "COGS - Produce",
  "food cost": "Food Cost",

  // Expense variants
  "merchant processing fees": "Merchant Processing Fees",
  "merchant fees": "Merchant Processing Fees",
  "credit card fees": "Merchant Processing Fees",
  "cleaning supplies": "Cleaning Supplies",
  "janitorial": "Cleaning Supplies",
  "rent": "Rent",
  "rent expense": "Rent",
  "rent / occupancy": "Rent",
  "utilities": "Utilities",
  "hydro": "Utilities",
  "electricity": "Utilities",
  "gas": "Utilities",
  "insurance": "Insurance",
  "insurance expense": "Insurance",
  "payroll expenses": "Payroll",
  "salaries and wages": "Payroll",
  "wages": "Payroll",
};

function canonicalAccountName(name: string): string {
  const lower = name.toLowerCase().trim();
  return ACCOUNT_CONSOLIDATION_MAP[lower] || name;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED REPORT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildConsolidatedProfitAndLoss(params: {
  startDate: string;
  endDate: string;
  includeComparison: boolean;
  eliminateIntercompany: boolean;
  customIntercompanyPatterns?: string[];
  excludeEntityIds?: number[];
  forceRefresh?: boolean;
}): Promise<ConsolidatedStatement> {
  const entities = await financialDb.getQboEntities();
  const activeEntities = entities.filter(e =>
    e.realmId && e.realmId !== "pending" && e.realmId !== "9341456522572832" &&
    !(params.excludeEntityIds || []).includes(e.id)
  );

  if (activeEntities.length === 0) {
    throw new Error("No active production-connected entities found");
  }

  // Fetch P&L for each entity
  const entityReports: Array<{ entity: typeof activeEntities[0]; report: FinancialStatement }> = [];
  for (const entity of activeEntities) {
    try {
      const report = await financialReports.buildProfitAndLoss({
        entityId: entity.id,
        startDate: params.startDate,
        endDate: params.endDate,
        includeComparison: params.includeComparison,
        includeYoY: false,
        includeSharedExpenses: false,
        forceRefresh: params.forceRefresh,
      });
      entityReports.push({ entity, report });
    } catch (err) {
      console.warn(`[Consolidated] Failed to fetch P&L for entity ${entity.id}:`, err);
    }
  }

  // Build consolidated lines
  return mergeStatements(
    entityReports,
    "profit_loss",
    `${params.startDate} to ${params.endDate}`,
    params.startDate,
    params.endDate,
    undefined,
    params.eliminateIntercompany,
    params.customIntercompanyPatterns,
  );
}

export async function buildConsolidatedBalanceSheet(params: {
  asOfDate: string;
  compareDate?: string;
  eliminateIntercompany: boolean;
  customIntercompanyPatterns?: string[];
  excludeEntityIds?: number[];
  forceRefresh?: boolean;
}): Promise<ConsolidatedStatement> {
  const entities = await financialDb.getQboEntities();
  const activeEntities = entities.filter(e =>
    e.realmId && e.realmId !== "pending" && e.realmId !== "9341456522572832" &&
    !(params.excludeEntityIds || []).includes(e.id)
  );

  if (activeEntities.length === 0) {
    throw new Error("No active production-connected entities found");
  }

  const entityReports: Array<{ entity: typeof activeEntities[0]; report: FinancialStatement }> = [];
  for (const entity of activeEntities) {
    try {
      const report = await financialReports.buildBalanceSheet({
        entityId: entity.id,
        asOfDate: params.asOfDate,
        compareDate: params.compareDate,
        includeSharedExpenses: false,
        forceRefresh: params.forceRefresh,
      });
      entityReports.push({ entity, report });
    } catch (err) {
      console.warn(`[Consolidated] Failed to fetch BS for entity ${entity.id}:`, err);
    }
  }

  return mergeStatements(
    entityReports,
    "balance_sheet",
    `As of ${params.asOfDate}`,
    undefined,
    undefined,
    params.asOfDate,
    params.eliminateIntercompany,
    params.customIntercompanyPatterns,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MERGE LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function mergeStatements(
  entityReports: Array<{ entity: any; report: FinancialStatement }>,
  statementType: "profit_loss" | "balance_sheet",
  periodLabel: string,
  startDate?: string,
  endDate?: string,
  asOfDate?: string,
  eliminateIntercompany = true,
  customIntercompanyPatterns?: string[],
): ConsolidatedStatement {
  // Collect all unique category::subcategory keys across all entities
  const allKeys = new Map<string, { category: string; subcategory: string | null; label: string; lineType: string }>();
  const eliminatedAccounts: EliminatedAccount[] = [];

  // Accumulate amounts per key per entity
  const keyAmounts = new Map<string, {
    consolidated: number;
    elimination: number;
    prior: number | null;
    entityAmounts: Record<string, number>;
    accounts: ConsolidatedLine["accounts"];
  }>();

  for (const { entity, report } of entityReports) {
    const entityName = entity.companyName || `Entity ${entity.id}`;

    for (const line of report.lines) {
      const key = `${line.category}::${line.subcategory || ""}`;

      // Register the key metadata (use first occurrence for label/lineType)
      if (!allKeys.has(key)) {
        allKeys.set(key, {
          category: line.category,
          subcategory: line.subcategory,
          label: line.label,
          lineType: line.lineType,
        });
      }

      if (!keyAmounts.has(key)) {
        keyAmounts.set(key, {
          consolidated: 0,
          elimination: 0,
          prior: null,
          entityAmounts: {},
          accounts: [],
        });
      }

      const entry = keyAmounts.get(key)!;

      // For subtotal/total lines, use the computed amount directly
      if (line.lineType === "subtotal" || line.lineType === "total") {
        entry.consolidated += line.currentAmount;
        entry.entityAmounts[entity.id.toString()] = (entry.entityAmounts[entity.id.toString()] || 0) + line.currentAmount;
        if (line.priorAmount !== null) {
          entry.prior = (entry.prior ?? 0) + line.priorAmount;
        }
        continue;
      }

      // For detail lines, process individual accounts
      for (const acct of line.accounts) {
        const canonical = canonicalAccountName(acct.accountName);
        const isIC = eliminateIntercompany && isIntercompanyAccount(acct.accountName, customIntercompanyPatterns);

        if (isIC) {
          entry.elimination += acct.amount;
          eliminatedAccounts.push({
            accountName: acct.accountName,
            amount: acct.amount,
            entityName,
            entityId: entity.id,
            reason: "Intercompany account",
          });
          entry.accounts.push({
            accountName: canonical,
            amount: acct.amount,
            entityName,
            entityId: entity.id,
            isEliminated: true,
          });
        } else {
          entry.consolidated += acct.amount;
          entry.entityAmounts[entity.id.toString()] = (entry.entityAmounts[entity.id.toString()] || 0) + acct.amount;
          entry.accounts.push({
            accountName: canonical,
            amount: acct.amount,
            entityName,
            entityId: entity.id,
            isEliminated: false,
          });
        }
      }

      // Handle prior amounts at the line level
      if (line.priorAmount !== null) {
        entry.prior = (entry.prior ?? 0) + line.priorAmount;
      }
    }
  }

  // Build the consolidated lines in the standard order
  const lineOrder = getStandardLineOrder(statementType);
  const lines: ConsolidatedLine[] = [];
  const processedKeys = new Set<string>();

  // Compute category totals for subtotal/total rows
  const categoryTotals = new Map<string, number>();
  for (const [key, data] of keyAmounts) {
    const meta = allKeys.get(key);
    if (meta && meta.lineType !== "subtotal" && meta.lineType !== "total") {
      const cat = meta.category;
      categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + data.consolidated);
    }
  }

  for (const orderKey of lineOrder) {
    const meta = allKeys.get(orderKey);
    if (!meta) continue;

    const data = keyAmounts.get(orderKey);
    processedKeys.add(orderKey);

    let consolidatedAmt = data?.consolidated ?? 0;
    let eliminationAmt = data?.elimination ?? 0;
    let priorAmt = data?.prior ?? null;

    // For subtotal/total rows, recompute from category totals
    if (meta.lineType === "subtotal" || meta.lineType === "total") {
      const recomputed = recomputeTotalLine(meta.category, meta.lineType, categoryTotals, statementType);
      if (recomputed !== null) {
        consolidatedAmt = recomputed;
      }
    }

    const netAmt = consolidatedAmt; // elimination already excluded from consolidated
    let varianceDollar: number | null = null;
    let variancePct: number | null = null;
    if (priorAmt !== null) {
      varianceDollar = netAmt - priorAmt;
      variancePct = priorAmt !== 0 ? ((netAmt - priorAmt) / Math.abs(priorAmt)) * 100 : null;
    }

    lines.push({
      category: meta.category,
      subcategory: meta.subcategory,
      label: meta.label,
      lineType: meta.lineType as ConsolidatedLine["lineType"],
      consolidatedAmount: consolidatedAmt,
      eliminationAmount: eliminationAmt,
      netAmount: netAmt,
      priorAmount: priorAmt,
      varianceDollar,
      variancePct,
      entityAmounts: data?.entityAmounts ?? {},
      accounts: data?.accounts ?? [],
    });
  }

  // Add any remaining keys not in standard order
  for (const [key, meta] of allKeys) {
    if (processedKeys.has(key)) continue;
    const data = keyAmounts.get(key);
    if (!data) continue;

    const netAmt = data.consolidated;
    let varianceDollar: number | null = null;
    let variancePct: number | null = null;
    if (data.prior !== null) {
      varianceDollar = netAmt - data.prior;
      variancePct = data.prior !== 0 ? ((netAmt - data.prior) / Math.abs(data.prior)) * 100 : null;
    }

    lines.push({
      category: meta.category,
      subcategory: meta.subcategory,
      label: meta.label,
      lineType: meta.lineType as ConsolidatedLine["lineType"],
      consolidatedAmount: data.consolidated,
      eliminationAmount: data.elimination,
      netAmount: netAmt,
      priorAmount: data.prior,
      varianceDollar,
      variancePct,
      entityAmounts: data.entityAmounts,
      accounts: data.accounts,
    });
  }

  const entityBreakdown: EntityBreakdown[] = entityReports.map(({ entity }) => ({
    entityId: entity.id,
    entityName: entity.companyName || `Entity ${entity.id}`,
    locationName: entity.legalName || "",
    realmId: entity.realmId,
  }));

  return {
    statementType,
    periodLabel,
    startDate,
    endDate,
    asOfDate,
    currency: entityReports[0]?.report.currency || "CAD",
    lines,
    entityBreakdown,
    eliminatedAccounts,
    generatedAt: new Date().toISOString(),
    entityCount: entityReports.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LINE ORDERING
// ═══════════════════════════════════════════════════════════════════════════════

function getStandardLineOrder(statementType: "profit_loss" | "balance_sheet"): string[] {
  if (statementType === "profit_loss") {
    return [
      "Revenue::", "Revenue::Sales", "Revenue::Discounts",
      "COGS::", "COGS::Food Cost", "COGS::Bakery & Dough", "COGS::Produce",
      "Gross Profit::",
      "Operating Expenses::Payroll", "Operating Expenses::Rent / Occupancy",
      "Operating Expenses::Utilities", "Operating Expenses::Repairs & Maintenance",
      "Operating Expenses::Professional Fees", "Operating Expenses::Marketing",
      "Operating Expenses::Delivery / Vehicle", "Operating Expenses::Office / Admin",
      "Operating Expenses::Merchant Fees", "Operating Expenses::Interest",
      "Operating Expenses::Depreciation", "Operating Expenses::Royalties",
      "Operating Expenses::Management Fees", "Operating Expenses::",
      "Other Income::", "Other Expenses::",
      "Net Income::",
    ];
  }
  return [
    "Assets::Cash", "Assets::Accounts Receivable", "Assets::Inventory",
    "Assets::Prepaids", "Assets::Fixed Assets", "Assets::Accumulated Depreciation",
    "Assets::",
    "Liabilities::Accounts Payable", "Liabilities::Credit Cards",
    "Liabilities::Sales Taxes", "Liabilities::Payroll Liabilities",
    "Liabilities::Shareholder Loans", "Liabilities::Debt", "Liabilities::",
    "Equity::Equity", "Equity::Retained Earnings", "Equity::",
    "Total::",
  ];
}

function recomputeTotalLine(
  category: string,
  lineType: string,
  categoryTotals: Map<string, number>,
  statementType: "profit_loss" | "balance_sheet",
): number | null {
  if (statementType === "profit_loss") {
    if (category === "Revenue" && lineType === "subtotal") return categoryTotals.get("Revenue") ?? 0;
    if (category === "COGS" && lineType === "subtotal") return categoryTotals.get("COGS") ?? 0;
    if (category === "Gross Profit") {
      return (categoryTotals.get("Revenue") ?? 0) - (categoryTotals.get("COGS") ?? 0);
    }
    if (category === "Operating Expenses" && lineType === "subtotal") return categoryTotals.get("Operating Expenses") ?? 0;
    if (category === "Net Income") {
      const rev = categoryTotals.get("Revenue") ?? 0;
      const cogs = categoryTotals.get("COGS") ?? 0;
      const opex = categoryTotals.get("Operating Expenses") ?? 0;
      const otherInc = categoryTotals.get("Other Income") ?? 0;
      const otherExp = categoryTotals.get("Other Expenses") ?? 0;
      return (rev - cogs - opex) + otherInc - otherExp;
    }
  } else {
    if (category === "Assets" && lineType === "subtotal") return categoryTotals.get("Assets") ?? 0;
    if (category === "Liabilities" && lineType === "subtotal") return categoryTotals.get("Liabilities") ?? 0;
    if (category === "Equity" && lineType === "subtotal") return categoryTotals.get("Equity") ?? 0;
    if (category === "Total") {
      return (categoryTotals.get("Liabilities") ?? 0) + (categoryTotals.get("Equity") ?? 0);
    }
  }
  return null;
}
