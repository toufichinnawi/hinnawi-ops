/**
 * Financial Report Builder
 * Takes raw QBO data + account mappings (or auto-classification) + shared expense allocations
 * and produces clean, structured financial statements.
 * 
 * Enhanced: auto-classifies QBO accounts when no manual mappings exist.
 */
import * as financialDb from "./financialDb";
import * as qboReports from "./qboReports";
import type { ReportRow } from "./qboReports";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface StatementLine {
  category: string;
  subcategory: string | null;
  label: string;
  lineType: "header" | "detail" | "subtotal" | "total" | "spacer";
  currentAmount: number;
  priorAmount: number | null;
  priorYearAmount: number | null;
  varianceDollar: number | null;
  variancePct: number | null;
  varianceYoyDollar: number | null;
  varianceYoyPct: number | null;
  sharedExpenseAmount: number;
  totalWithShared: number;
  accounts: Array<{ accountId?: string; accountName: string; amount: number; priorAmount?: number }>;
}

export interface FinancialStatement {
  entityId: number;
  entityName: string;
  statementType: "profit_loss" | "balance_sheet";
  periodLabel: string;
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
  currency: string;
  lines: StatementLine[];
  generatedAt: string;
  reportMode: "qbo_only" | "qbo_plus_shared";
  mappingMode: "manual" | "auto";
}

// ═══════════════════════════════════════════════════════════════════════════════
// FISCAL YEAR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function getFiscalYearDates(date: Date, fiscalStartMonth = 9) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  const start = `${fiscalYear}-${String(fiscalStartMonth).padStart(2, "0")}-01`;
  const endYear = fiscalYear + 1;
  const endMonth = fiscalStartMonth - 1 || 12;
  const endDay = new Date(endYear, endMonth, 0).getDate();
  const end = `${fiscalStartMonth === 1 ? fiscalYear : endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { start, end, fiscalYear };
}

export function getPriorPeriodDates(startDate: string, endDate: string): { start: string; end: string } {
  const s = new Date(startDate);
  const e = new Date(endDate);
  const durationMs = e.getTime() - s.getTime();
  const priorEnd = new Date(s.getTime() - 86400000);
  const priorStart = new Date(priorEnd.getTime() - durationMs);
  return {
    start: priorStart.toISOString().split("T")[0],
    end: priorEnd.toISOString().split("T")[0],
  };
}

export function getPriorYearDates(startDate: string, endDate: string): { start: string; end: string } {
  const s = new Date(startDate);
  const e = new Date(endDate);
  return {
    start: `${s.getFullYear() - 1}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`,
    end: `${e.getFullYear() - 1}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAPPING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface MappedLine {
  category: string;
  subcategory: string | null;
  label: string;
  amount: number;
  accounts: Array<{ accountId?: string; accountName: string; amount: number }>;
}

/**
 * Apply manual mappings to QBO report rows.
 */
function applyManualMappings(
  rows: ReportRow[],
  mappings: Awaited<ReturnType<typeof financialDb.getMappingsForEntity>>,
): Map<string, MappedLine> {
  const lineMap = new Map<string, MappedLine>();

  for (const row of rows) {
    const mapping = mappings.find(m => m.qboAccountId === row.accountId);
    if (mapping && mapping.isHidden) continue;

    const category = mapping?.category || "Uncategorized";
    const subcategory = mapping?.subcategory || null;
    const label = mapping?.customLabel || mapping?.category || row.accountName;
    const key = `${category}::${subcategory || ""}`;

    if (!lineMap.has(key)) {
      lineMap.set(key, { category, subcategory, label, amount: 0, accounts: [] });
    }
    const line = lineMap.get(key)!;
    line.amount += row.amount;
    line.accounts.push({ accountId: row.accountId, accountName: row.accountName, amount: row.amount });
  }

  return lineMap;
}

/**
 * Apply auto-classification to QBO report rows (when no manual mappings exist).
 * Uses QBO section hierarchy to classify accounts into our statement categories.
 */
function applyAutoClassification(
  rows: ReportRow[],
  statementType: "profit_loss" | "balance_sheet",
): Map<string, MappedLine> {
  const classified = qboReports.autoClassifyRows(rows, statementType);
  const lineMap = new Map<string, MappedLine>();

  for (const row of classified) {
    const category = row.autoCategory;
    const subcategory = row.autoSubcategory;
    const key = `${category}::${subcategory || ""}`;

    if (!lineMap.has(key)) {
      lineMap.set(key, {
        category,
        subcategory,
        label: subcategory || category,
        amount: 0,
        accounts: [],
      });
    }
    const line = lineMap.get(key)!;
    line.amount += row.amount;
    line.accounts.push({ accountId: row.accountId, accountName: row.accountName, amount: row.amount });
  }

  return lineMap;
}

/**
 * Smart mapping: uses manual mappings if available, falls back to auto-classification.
 */
async function smartMap(
  rows: ReportRow[],
  entityId: number,
  statementType: "profit_loss" | "balance_sheet",
): Promise<{ mapped: Map<string, MappedLine>; mode: "manual" | "auto" }> {
  const mappings = await financialDb.getMappingsForEntity(entityId);
  if (mappings.length > 0) {
    return { mapped: applyManualMappings(rows, mappings), mode: "manual" };
  }
  return { mapped: applyAutoClassification(rows, statementType), mode: "auto" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build structured statement lines from mapped data + line definitions.
 * Computes totals for subtotal/total rows and adds unmapped categories.
 */
function buildLines(
  currentMapped: Map<string, MappedLine>,
  priorMapped: Map<string, MappedLine> | null,
  priorYearMapped: Map<string, MappedLine> | null,
  lineDefinitions: Awaited<ReturnType<typeof financialDb.getFsLineDefinitions>>,
  sharedByCategory: Map<string, number>,
): StatementLine[] {
  const lines: StatementLine[] = [];
  const usedKeys = new Set<string>();

  // Running totals for computed rows (Gross Profit, Net Income, Total Assets, etc.)
  let revenueTotal = 0;
  let cogsTotal = 0;
  let opexTotal = 0;
  let otherIncomeTotal = 0;
  let otherExpenseTotal = 0;

  let revenueTotal_prior = 0;
  let cogsTotal_prior = 0;
  let opexTotal_prior = 0;
  let otherIncomeTotal_prior = 0;
  let otherExpenseTotal_prior = 0;

  let revenueTotal_yoy = 0;
  let cogsTotal_yoy = 0;
  let opexTotal_yoy = 0;
  let otherIncomeTotal_yoy = 0;
  let otherExpenseTotal_yoy = 0;

  for (const def of lineDefinitions) {
    const key = `${def.category}::${def.subcategory || ""}`;
    const currentData = currentMapped.get(key);
    const priorData = priorMapped?.get(key);
    const priorYearData = priorYearMapped?.get(key);

    let currentAmt = currentData?.amount || 0;
    let priorAmt = priorData?.amount ?? null;
    let priorYearAmt = priorYearData?.amount ?? null;

    // For subtotal/total rows, compute from accumulated data
    if (def.lineType === "subtotal" || def.lineType === "total") {
      if (def.category === "Revenue") {
        // Sum all Revenue detail rows
        currentAmt = sumCategory(currentMapped, "Revenue");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Revenue") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Revenue") : null;
        revenueTotal = currentAmt;
        revenueTotal_prior = priorAmt ?? 0;
        revenueTotal_yoy = priorYearAmt ?? 0;
      } else if (def.category === "COGS") {
        currentAmt = sumCategory(currentMapped, "COGS");
        priorAmt = priorMapped ? sumCategory(priorMapped, "COGS") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "COGS") : null;
        cogsTotal = currentAmt;
        cogsTotal_prior = priorAmt ?? 0;
        cogsTotal_yoy = priorYearAmt ?? 0;
      } else if (def.category === "Gross Profit") {
        currentAmt = revenueTotal - cogsTotal;
        priorAmt = priorMapped ? revenueTotal_prior - cogsTotal_prior : null;
        priorYearAmt = priorYearMapped ? revenueTotal_yoy - cogsTotal_yoy : null;
      } else if (def.category === "Operating Expenses") {
        currentAmt = sumCategory(currentMapped, "Operating Expenses");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Operating Expenses") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Operating Expenses") : null;
        opexTotal = currentAmt;
        opexTotal_prior = priorAmt ?? 0;
        opexTotal_yoy = priorYearAmt ?? 0;
      } else if (def.category === "Net Income") {
        otherIncomeTotal = sumCategory(currentMapped, "Other Income");
        otherExpenseTotal = sumCategory(currentMapped, "Other Expenses");
        otherIncomeTotal_prior = priorMapped ? sumCategory(priorMapped, "Other Income") : 0;
        otherExpenseTotal_prior = priorMapped ? sumCategory(priorMapped, "Other Expenses") : 0;
        otherIncomeTotal_yoy = priorYearMapped ? sumCategory(priorYearMapped, "Other Income") : 0;
        otherExpenseTotal_yoy = priorYearMapped ? sumCategory(priorYearMapped, "Other Expenses") : 0;

        currentAmt = (revenueTotal - cogsTotal - opexTotal) + otherIncomeTotal - otherExpenseTotal;
        priorAmt = priorMapped ? (revenueTotal_prior - cogsTotal_prior - opexTotal_prior) + otherIncomeTotal_prior - otherExpenseTotal_prior : null;
        priorYearAmt = priorYearMapped ? (revenueTotal_yoy - cogsTotal_yoy - opexTotal_yoy) + otherIncomeTotal_yoy - otherExpenseTotal_yoy : null;
      } else if (def.category === "Assets") {
        currentAmt = sumCategory(currentMapped, "Assets");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Assets") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Assets") : null;
      } else if (def.category === "Liabilities") {
        currentAmt = sumCategory(currentMapped, "Liabilities");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Liabilities") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Liabilities") : null;
      } else if (def.category === "Equity") {
        currentAmt = sumCategory(currentMapped, "Equity");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Equity") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Equity") : null;
      } else if (def.category === "Total") {
        currentAmt = sumCategory(currentMapped, "Liabilities") + sumCategory(currentMapped, "Equity");
        priorAmt = priorMapped ? sumCategory(priorMapped, "Liabilities") + sumCategory(priorMapped, "Equity") : null;
        priorYearAmt = priorYearMapped ? sumCategory(priorYearMapped, "Liabilities") + sumCategory(priorYearMapped, "Equity") : null;
      }
    } else {
      usedKeys.add(key);
    }

    const sharedAmt = sharedByCategory.get(key) || 0;

    let varianceDollar: number | null = null;
    let variancePct: number | null = null;
    let varianceYoyDollar: number | null = null;
    let varianceYoyPct: number | null = null;

    if (priorAmt !== null) {
      varianceDollar = currentAmt - priorAmt;
      variancePct = priorAmt !== 0 ? ((currentAmt - priorAmt) / Math.abs(priorAmt)) * 100 : null;
    }
    if (priorYearAmt !== null) {
      varianceYoyDollar = currentAmt - priorYearAmt;
      varianceYoyPct = priorYearAmt !== 0 ? ((currentAmt - priorYearAmt) / Math.abs(priorYearAmt)) * 100 : null;
    }

    // Build account detail with prior amounts
    const accounts = (currentData?.accounts || []).map(a => {
      const priorAcct = priorData?.accounts?.find(pa => pa.accountId === a.accountId || pa.accountName === a.accountName);
      return { ...a, priorAmount: priorAcct?.amount };
    });

    lines.push({
      category: def.category,
      subcategory: def.subcategory,
      label: currentData?.label || def.displayLabel,
      lineType: def.lineType as StatementLine["lineType"],
      currentAmount: currentAmt,
      priorAmount: priorAmt,
      priorYearAmount: priorYearAmt,
      varianceDollar,
      variancePct,
      varianceYoyDollar,
      varianceYoyPct,
      sharedExpenseAmount: sharedAmt,
      totalWithShared: currentAmt + sharedAmt,
      accounts,
    });
  }

  // Add unmapped categories that aren't in line definitions
  Array.from(currentMapped.entries()).forEach(([key, data]) => {
    if (usedKeys.has(key)) return;
    // Check if this key matches any definition
    const matchesDef = lineDefinitions.some(d => `${d.category}::${d.subcategory || ""}` === key);
    if (matchesDef) return;

    const priorData = priorMapped?.get(key);
    const priorYearData = priorYearMapped?.get(key);
    const priorAmt = priorData?.amount ?? null;
    const priorYearAmt = priorYearData?.amount ?? null;

    let varianceDollar: number | null = null;
    let variancePct: number | null = null;
    if (priorAmt !== null) {
      varianceDollar = data.amount - priorAmt;
      variancePct = priorAmt !== 0 ? ((data.amount - priorAmt) / Math.abs(priorAmt)) * 100 : null;
    }

    lines.push({
      category: data.category,
      subcategory: data.subcategory,
      label: data.label,
      lineType: "detail",
      currentAmount: data.amount,
      priorAmount: priorAmt,
      priorYearAmount: priorYearAmt,
      varianceDollar,
      variancePct,
      varianceYoyDollar: null,
      varianceYoyPct: null,
      sharedExpenseAmount: sharedByCategory.get(key) || 0,
      totalWithShared: data.amount + (sharedByCategory.get(key) || 0),
      accounts: data.accounts,
    });
  });

  return lines;
}

/** Sum all detail-level amounts for a given category across all subcategories */
function sumCategory(mapped: Map<string, MappedLine>, category: string): number {
  let total = 0;
  Array.from(mapped.entries()).forEach(([key, data]) => {
    if (key.startsWith(category + "::")) {
      total += data.amount;
    }
  });
  return total;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildProfitAndLoss(params: {
  entityId: number;
  startDate: string;
  endDate: string;
  includeComparison: boolean;
  includeYoY: boolean;
  includeSharedExpenses: boolean;
  locationId?: number;
}): Promise<FinancialStatement> {
  const entity = await financialDb.getQboEntityById(params.entityId);
  if (!entity) throw new Error("Entity not found");

  // Fetch current period
  const current = await qboReports.fetchProfitAndLoss(params.entityId, params.startDate, params.endDate);
  const lineDefinitions = await financialDb.getFsLineDefinitions("profit_loss");

  // Fetch comparison periods
  let priorReport: qboReports.ParsedReport | null = null;
  let priorYearReport: qboReports.ParsedReport | null = null;

  if (params.includeComparison) {
    const prior = getPriorPeriodDates(params.startDate, params.endDate);
    try {
      priorReport = await qboReports.fetchProfitAndLoss(params.entityId, prior.start, prior.end);
    } catch { /* comparison data unavailable */ }
  }

  if (params.includeYoY) {
    const priorYear = getPriorYearDates(params.startDate, params.endDate);
    try {
      priorYearReport = await qboReports.fetchProfitAndLoss(params.entityId, priorYear.start, priorYear.end);
    } catch { /* YoY data unavailable */ }
  }

  // Smart mapping: auto-classify if no manual mappings
  const { mapped: currentMapped, mode } = await smartMap(current.rows, params.entityId, "profit_loss");
  const priorMapped = priorReport ? (await smartMap(priorReport.rows, params.entityId, "profit_loss")).mapped : null;
  const priorYearMapped = priorYearReport ? (await smartMap(priorYearReport.rows, params.entityId, "profit_loss")).mapped : null;

  // Get shared expense allocations if requested
  let sharedByCategory = new Map<string, number>();
  if (params.includeSharedExpenses && params.locationId) {
    const allocations = await financialDb.getAllocationsForLocation(
      params.locationId, params.startDate, params.endDate
    );
    for (const { allocation, expense } of allocations) {
      const cat = expense.statementCategory || expense.expenseCategory || "Other Expenses";
      const sub = expense.statementSubcategory || "";
      const key = `${cat}::${sub}`;
      sharedByCategory.set(key, (sharedByCategory.get(key) || 0) + Number(allocation.allocatedAmount));
    }
  }

  // Build statement lines
  const lines = buildLines(currentMapped, priorMapped, priorYearMapped, lineDefinitions, sharedByCategory);

  return {
    entityId: params.entityId,
    entityName: entity.companyName || "Unknown",
    statementType: "profit_loss",
    periodLabel: `${params.startDate} to ${params.endDate}`,
    startDate: params.startDate,
    endDate: params.endDate,
    currency: current.currency,
    lines,
    generatedAt: new Date().toISOString(),
    reportMode: params.includeSharedExpenses ? "qbo_plus_shared" : "qbo_only",
    mappingMode: mode,
  };
}

export async function buildBalanceSheet(params: {
  entityId: number;
  asOfDate: string;
  compareDate?: string;
  includeSharedExpenses: boolean;
}): Promise<FinancialStatement> {
  const entity = await financialDb.getQboEntityById(params.entityId);
  if (!entity) throw new Error("Entity not found");

  const current = await qboReports.fetchBalanceSheet(params.entityId, params.asOfDate);
  const lineDefinitions = await financialDb.getFsLineDefinitions("balance_sheet");

  let priorReport: qboReports.ParsedReport | null = null;
  if (params.compareDate) {
    try {
      priorReport = await qboReports.fetchBalanceSheet(params.entityId, params.compareDate);
    } catch { /* comparison unavailable */ }
  }

  const { mapped: currentMapped, mode } = await smartMap(current.rows, params.entityId, "balance_sheet");
  const priorMapped = priorReport ? (await smartMap(priorReport.rows, params.entityId, "balance_sheet")).mapped : null;

  const lines = buildLines(currentMapped, priorMapped, null, lineDefinitions, new Map());

  return {
    entityId: params.entityId,
    entityName: entity.companyName || "Unknown",
    statementType: "balance_sheet" as const,
    periodLabel: `As of ${params.asOfDate}`,
    asOfDate: params.asOfDate,
    currency: current.currency,
    lines,
    generatedAt: new Date().toISOString(),
    reportMode: params.includeSharedExpenses ? "qbo_plus_shared" : "qbo_only",
    mappingMode: mode,
  };
}
