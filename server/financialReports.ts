/**
 * Financial Report Builder
 * Takes raw QBO data + account mappings + shared expense allocations
 * and produces clean, structured financial statements.
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
  accounts: Array<{ accountId?: string; accountName: string; amount: number }>;
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// FISCAL YEAR HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function getFiscalYearDates(date: Date, fiscalStartMonth = 9) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-indexed
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
  const priorEnd = new Date(s.getTime() - 86400000); // day before start
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
// REPORT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function applyMappings(
  rows: ReportRow[],
  mappings: Awaited<ReturnType<typeof financialDb.getMappingsForEntity>>,
): Map<string, { category: string; subcategory: string | null; label: string; amount: number; accounts: ReportRow[] }> {
  const lineMap = new Map<string, { category: string; subcategory: string | null; label: string; amount: number; accounts: ReportRow[] }>();

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
    line.accounts.push(row);
  }

  return lineMap;
}

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
  const mappings = await financialDb.getMappingsForEntity(params.entityId);
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

  // Apply mappings
  const currentMapped = applyMappings(current.rows, mappings);
  const priorMapped = priorReport ? applyMappings(priorReport.rows, mappings) : null;
  const priorYearMapped = priorYearReport ? applyMappings(priorYearReport.rows, mappings) : null;

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

  // Build statement lines from definitions
  const lines: StatementLine[] = [];

  for (const def of lineDefinitions) {
    const key = `${def.category}::${def.subcategory || ""}`;
    const currentData = currentMapped.get(key);
    const priorData = priorMapped?.get(key);
    const priorYearData = priorYearMapped?.get(key);

    const currentAmt = currentData?.amount || 0;
    const priorAmt = priorData?.amount || null;
    const priorYearAmt = priorYearData?.amount || null;
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
      accounts: currentData?.accounts || [],
    });
  }

  // Add unmapped rows
  Array.from(currentMapped.entries()).forEach(([key, data]) => {
    const exists = lines.some(l => `${l.category}::${l.subcategory || ""}` === key);
    if (!exists) {
      lines.push({
        category: data.category,
        subcategory: data.subcategory,
        label: data.label,
        lineType: "detail",
        currentAmount: data.amount,
        priorAmount: null,
        priorYearAmount: null,
        varianceDollar: null,
        variancePct: null,
        varianceYoyDollar: null,
        varianceYoyPct: null,
        sharedExpenseAmount: sharedByCategory.get(key) || 0,
        totalWithShared: data.amount + (sharedByCategory.get(key) || 0),
        accounts: data.accounts,
      });
    }
  });

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
  const mappings = await financialDb.getMappingsForEntity(params.entityId);
  const lineDefinitions = await financialDb.getFsLineDefinitions("balance_sheet");

  let priorReport: qboReports.ParsedReport | null = null;
  if (params.compareDate) {
    try {
      priorReport = await qboReports.fetchBalanceSheet(params.entityId, params.compareDate);
    } catch { /* comparison unavailable */ }
  }

  const currentMapped = applyMappings(current.rows, mappings);
  const priorMapped = priorReport ? applyMappings(priorReport.rows, mappings) : null;

  const lines: StatementLine[] = [];

  for (const def of lineDefinitions) {
    const key = `${def.category}::${def.subcategory || ""}`;
    const currentData = currentMapped.get(key);
    const priorData = priorMapped?.get(key);

    const currentAmt = currentData?.amount || 0;
    const priorAmt = priorData?.amount || null;

    let varianceDollar: number | null = null;
    let variancePct: number | null = null;

    if (priorAmt !== null) {
      varianceDollar = currentAmt - priorAmt;
      variancePct = priorAmt !== 0 ? ((currentAmt - priorAmt) / Math.abs(priorAmt)) * 100 : null;
    }

    lines.push({
      category: def.category,
      subcategory: def.subcategory,
      label: currentData?.label || def.displayLabel,
      lineType: def.lineType as StatementLine["lineType"],
      currentAmount: currentAmt,
      priorAmount: priorAmt,
      priorYearAmount: null,
      varianceDollar,
      variancePct,
      varianceYoyDollar: null,
      varianceYoyPct: null,
      sharedExpenseAmount: 0,
      totalWithShared: currentAmt,
      accounts: currentData?.accounts || [],
    });
  }

  // Add unmapped rows
  Array.from(currentMapped.entries()).forEach(([key, data]) => {
    const exists = lines.some(l => `${l.category}::${l.subcategory || ""}` === key);
    if (!exists) {
      lines.push({
        category: data.category,
        subcategory: data.subcategory,
        label: data.label,
        lineType: "detail",
        currentAmount: data.amount,
        priorAmount: null,
        priorYearAmount: null,
        varianceDollar: null,
        variancePct: null,
        varianceYoyDollar: null,
        varianceYoyPct: null,
        sharedExpenseAmount: 0,
        totalWithShared: data.amount,
        accounts: data.accounts,
      });
    }
  });

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
  };
}
