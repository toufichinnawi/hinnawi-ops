/**
 * QBO Financial Report Fetching
 * Fetches Profit & Loss and Balance Sheet reports from QuickBooks API
 * using per-entity token management.
 * 
 * Enhanced: preserves QBO section hierarchy for auto-classification.
 */
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { qboTokens, qboEntities } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import * as financialDb from "./financialDb";

// ─── Production QBO Configuration ───
// Financial Statements ALWAYS uses production QBO (not sandbox)
const QBO_PROD_CLIENT_ID = "AB1l3yvNjbzID6Qjg6sWWxYh6bJLUjVDKqbcisw8KNkYMyAmlB";
const QBO_PROD_CLIENT_SECRET = "eur57dkXRw3ZDZMrhsDK5wFIiMlgx73WMfbQQxEa";
const QBO_BASE_URL = "https://quickbooks.api.intuit.com"; // Always production

const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// ─── Token Management ───

async function getTokensForRealm(realmId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(qboTokens)
    .where(and(eq(qboTokens.realmId, realmId), eq(qboTokens.isActive, true)))
    .orderBy(desc(qboTokens.updatedAt))
    .limit(1);
  return rows[0] || null;
}

async function refreshToken(tokenRow: typeof qboTokens.$inferSelect) {
  // Use production credentials for Financial Statements
  const basicAuth = Buffer.from(`${QBO_PROD_CLIENT_ID}:${QBO_PROD_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenRow.refreshToken }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };
}

async function getValidToken(realmId: string): Promise<string> {
  const tokenRow = await getTokensForRealm(realmId);
  if (!tokenRow) throw new Error(`No active QBO tokens for realm ${realmId}. Please connect this QuickBooks company in Integrations first.`);

  const now = new Date();
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (tokenRow.accessTokenExpiresAt < fiveMinFromNow) {
    const newTokens = await refreshToken(tokenRow);
    const db = await getDb();
    if (db) {
      const accessTokenExpiresAt = new Date(now.getTime() + newTokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + newTokens.x_refresh_token_expires_in * 1000);
      await db.update(qboTokens).set({
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      }).where(eq(qboTokens.id, tokenRow.id));
    }
    return newTokens.access_token;
  }

  return tokenRow.accessToken;
}

// ─── QBO Report API ───

async function fetchQboReport(realmId: string, reportName: string, params: Record<string, string>): Promise<any> {
  const accessToken = await getValidToken(realmId);
  const qs = new URLSearchParams(params).toString();
  const url = `${QBO_BASE_URL}/v3/company/${realmId}/reports/${reportName}?${qs}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO Report API error ${res.status}: ${errText}`);
  }

  return await res.json();
}

// ─── Report Parsing (Enhanced with section tracking) ───

export interface ReportRow {
  accountId?: string;
  accountName: string;
  amount: number;
  accountType?: string;
  classification?: string;
  /** The QBO section this row belongs to (e.g., "Income", "Cost of Goods Sold", "Expenses") */
  section?: string;
  /** Sub-section within the main section */
  subSection?: string;
}

export interface ParsedReport {
  reportName: string;
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
  currency: string;
  rows: ReportRow[];
  rawData: any;
}

/**
 * Enhanced parser that preserves QBO section hierarchy.
 * QBO reports have a nested structure:
 *   Section (Header) → Sub-section (Header) → Data rows
 * We track the current section context so each data row knows
 * which P&L or BS section it belongs to.
 */
function parseQboReportRows(columns: any[], rows: any[]): ReportRow[] {
  const result: ReportRow[] = [];

  function processRows(rowList: any[], sectionName?: string, subSectionName?: string) {
    for (const row of rowList) {
      // Section with header + nested rows
      if ((row.Header || row.type === "Section") && row.Rows?.Row) {
        const headerName = row.Header?.ColData?.[0]?.value;
        
        if (!sectionName) {
          // Top-level section (e.g., "Income", "Cost of Goods Sold", "Expenses")
          processRows(row.Rows.Row, headerName || sectionName, undefined);
        } else {
          // Nested section within a top-level section → treat as sub-section
          processRows(row.Rows.Row, sectionName, headerName || subSectionName);
        }
        continue;
      }

      // Data row
      if (row.type === "Data" && row.ColData) {
        const nameCol = row.ColData[0];
        const amountCol = row.ColData[1];
        if (nameCol && amountCol) {
          const amount = parseFloat(amountCol.value) || 0;
          // Skip zero-amount rows and summary/total rows
          if (nameCol.value && !nameCol.value.startsWith("Total ")) {
            result.push({
              accountId: nameCol.id || undefined,
              accountName: nameCol.value || "",
              amount,
              section: sectionName,
              subSection: subSectionName,
            });
          }
        }
      }

      // Recursively process any nested rows (fallback for unusual structures)
      if (row.Rows?.Row && !row.Header && row.type !== "Section") {
        processRows(row.Rows.Row, sectionName, subSectionName);
      }
    }
  }

  processRows(rows);
  return result;
}

// ─── Auto-Classification: Map QBO sections to our statement categories ───

/** Map QBO P&L section names to our standard categories */
const PL_SECTION_MAP: Record<string, { category: string; subcategory: string | null }> = {
  "Income": { category: "Revenue", subcategory: null },
  "Revenue": { category: "Revenue", subcategory: null },
  "Gross Receipts": { category: "Revenue", subcategory: null },
  "Sales": { category: "Revenue", subcategory: null },
  "Service Revenue": { category: "Revenue", subcategory: null },
  "Other Income": { category: "Other Income", subcategory: null },
  "Other Revenue": { category: "Other Income", subcategory: null },
  "Cost of Goods Sold": { category: "COGS", subcategory: null },
  "Cost of Sales": { category: "COGS", subcategory: null },
  "COGS": { category: "COGS", subcategory: null },
  "Expenses": { category: "Operating Expenses", subcategory: null },
  "Expense": { category: "Operating Expenses", subcategory: null },
  "Operating Expenses": { category: "Operating Expenses", subcategory: null },
  "Other Expenses": { category: "Other Expenses", subcategory: null },
  "Other Expense": { category: "Other Expenses", subcategory: null },
  "Net Other Income": { category: "Other Income", subcategory: null },
};

/** Map QBO Balance Sheet section names to our standard categories */
const BS_SECTION_MAP: Record<string, { category: string; subcategory: string | null }> = {
  "ASSETS": { category: "Assets", subcategory: null },
  "Assets": { category: "Assets", subcategory: null },
  "Current Assets": { category: "Assets", subcategory: null },
  "Bank": { category: "Assets", subcategory: "Cash" },
  "Bank Accounts": { category: "Assets", subcategory: "Cash" },
  "Cash and cash equivalents": { category: "Assets", subcategory: "Cash" },
  "Accounts Receivable": { category: "Assets", subcategory: "Accounts Receivable" },
  "Accounts receivable (A/R)": { category: "Assets", subcategory: "Accounts Receivable" },
  "Other Current Assets": { category: "Assets", subcategory: "Prepaids" },
  "Fixed Assets": { category: "Assets", subcategory: "Fixed Assets" },
  "Property, plant and equipment": { category: "Assets", subcategory: "Fixed Assets" },
  "Other Assets": { category: "Assets", subcategory: null },
  "LIABILITIES AND EQUITY": { category: "Liabilities", subcategory: null },
  "Liabilities": { category: "Liabilities", subcategory: null },
  "Current Liabilities": { category: "Liabilities", subcategory: null },
  "Accounts Payable": { category: "Liabilities", subcategory: "Accounts Payable" },
  "Accounts payable (A/P)": { category: "Liabilities", subcategory: "Accounts Payable" },
  "Credit Cards": { category: "Liabilities", subcategory: "Credit Cards" },
  "Credit Card": { category: "Liabilities", subcategory: "Credit Cards" },
  "Other Current Liabilities": { category: "Liabilities", subcategory: null },
  "Long-Term Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Non-Current Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Equity": { category: "Equity", subcategory: "Equity" },
  "Stockholders' Equity": { category: "Equity", subcategory: "Equity" },
  "Owner's Equity": { category: "Equity", subcategory: "Equity" },
};

/** Classify P&L accounts using section context + account name keyword matching */
function classifyPLAccount(accountName: string, section?: string, subSection?: string): { category: string; subcategory: string | null } {
  // Try section mapping first
  const sectionMapping = section ? PL_SECTION_MAP[section] : null;
  
  // Determine the base category from section, or fallback to account name analysis
  let baseCategory = sectionMapping?.category;
  
  // If section mapping failed, try to classify from account name alone
  if (!baseCategory) {
    const name = accountName.toLowerCase();
    if (name.includes("sales") || name.includes("revenue") || name.includes("income") || name.includes("discount")) {
      baseCategory = "Revenue";
    } else if (name.includes("cost of goods") || name.includes("cogs") || name.includes("cost of sales")) {
      baseCategory = "COGS";
    } else if (name.includes("expense") || name.includes("payroll") || name.includes("rent") || name.includes("utilit") || name.includes("merchant") || name.includes("cleaning") || name.includes("insurance")) {
      baseCategory = "Operating Expenses";
    }
  }
  
  if (!baseCategory) {
    return { category: "Uncategorized", subcategory: null };
  }
  
  // For Operating Expenses, auto-detect subcategory from account name
  if (baseCategory === "Operating Expenses") {
    const name = accountName.toLowerCase();
    if (name.includes("payroll") || name.includes("salary") || name.includes("wage") || name.includes("benefit") || name.includes("employee")) {
      return { category: "Operating Expenses", subcategory: "Payroll" };
    }
    if (name.includes("rent") || name.includes("occupancy") || name.includes("lease")) {
      return { category: "Operating Expenses", subcategory: "Rent / Occupancy" };
    }
    if (name.includes("utilit") || name.includes("hydro") || name.includes("electric") || name.includes("gas") || name.includes("water") || name.includes("internet") || name.includes("phone") || name.includes("telecom")) {
      return { category: "Operating Expenses", subcategory: "Utilities" };
    }
    if (name.includes("repair") || name.includes("maintenance")) {
      return { category: "Operating Expenses", subcategory: "Repairs & Maintenance" };
    }
    if (name.includes("professional") || name.includes("legal") || name.includes("accounting") || name.includes("consulting") || name.includes("bookkeeping")) {
      return { category: "Operating Expenses", subcategory: "Professional Fees" };
    }
    if (name.includes("marketing") || name.includes("advertising") || name.includes("promotion")) {
      return { category: "Operating Expenses", subcategory: "Marketing" };
    }
    if (name.includes("delivery") || name.includes("vehicle") || name.includes("fuel") || name.includes("auto") || name.includes("transport") || name.includes("shipping")) {
      return { category: "Operating Expenses", subcategory: "Delivery / Vehicle" };
    }
    if (name.includes("office") || name.includes("admin") || name.includes("supplies") || name.includes("postage") || name.includes("cleaning") || name.includes("janitorial")) {
      return { category: "Operating Expenses", subcategory: "Office / Admin" };
    }
    if (name.includes("merchant") || name.includes("processing") || name.includes("stripe") || name.includes("square") || name.includes("bank charge") || name.includes("transaction fee")) {
      return { category: "Operating Expenses", subcategory: "Merchant Fees" };
    }
    if (name.includes("interest")) {
      return { category: "Operating Expenses", subcategory: "Interest" };
    }
    if (name.includes("depreciation") || name.includes("amortization")) {
      return { category: "Operating Expenses", subcategory: "Depreciation" };
    }
    if (name.includes("insurance")) {
      return { category: "Operating Expenses", subcategory: "Office / Admin" };
    }
    // Default: general operating expense
    return { category: "Operating Expenses", subcategory: null };
  }
  
  // For COGS, just return the base category
  if (baseCategory === "COGS") {
    return { category: "COGS", subcategory: null };
  }
  
  return sectionMapping || { category: baseCategory, subcategory: null };
}

function classifyBSAccount(accountName: string, section?: string, subSection?: string): { category: string; subcategory: string | null } {
  // Try sub-section first for more specific classification
  if (subSection) {
    const subMapping = BS_SECTION_MAP[subSection];
    if (subMapping) {
      // Even with sub-section mapping, try to refine subcategory from account name
      return refineBSSubcategory(accountName, subMapping);
    }
  }
  // Fall back to section
  if (section) {
    const sectionMapping = BS_SECTION_MAP[section];
    if (sectionMapping) {
      return refineBSSubcategory(accountName, sectionMapping);
    }
  }
  // Final fallback: classify from account name alone
  const name = accountName.toLowerCase();
  if (name.includes("cash") || name.includes("bank") || name.includes("chequing")) return { category: "Assets", subcategory: "Cash" };
  if (name.includes("receivable")) return { category: "Assets", subcategory: "Accounts Receivable" };
  if (name.includes("inventory")) return { category: "Assets", subcategory: "Inventory" };
  if (name.includes("payable")) return { category: "Liabilities", subcategory: "Accounts Payable" };
  if (name.includes("equity") || name.includes("retained")) return { category: "Equity", subcategory: "Equity" };
  return { category: "Uncategorized", subcategory: null };
}

function refineBSSubcategory(accountName: string, baseMapping: { category: string; subcategory: string | null }): { category: string; subcategory: string | null } {
  const name = accountName.toLowerCase();
  if (baseMapping.category === "Assets") {
    if (name.includes("cash") || name.includes("chequing") || name.includes("checking") || name.includes("savings") || name.includes("bank")) {
      return { category: "Assets", subcategory: "Cash" };
    }
    if (name.includes("receivable")) return { category: "Assets", subcategory: "Accounts Receivable" };
    if (name.includes("inventory")) return { category: "Assets", subcategory: "Inventory" };
    if (name.includes("prepaid")) return { category: "Assets", subcategory: "Prepaids" };
    if (name.includes("accumulated depreciation") || name.includes("accum. depreciation")) {
      return { category: "Assets", subcategory: "Accumulated Depreciation" };
    }
    if (name.includes("equipment") || name.includes("furniture") || name.includes("leasehold") || name.includes("vehicle") || name.includes("computer")) {
      return { category: "Assets", subcategory: "Fixed Assets" };
    }
  }
  if (baseMapping.category === "Liabilities") {
    if (name.includes("payable") && !name.includes("note payable")) return { category: "Liabilities", subcategory: "Accounts Payable" };
    if (name.includes("credit card")) return { category: "Liabilities", subcategory: "Credit Cards" };
    if (name.includes("sales tax") || name.includes("gst") || name.includes("qst") || name.includes("hst") || name.includes("tps") || name.includes("tvq")) {
      return { category: "Liabilities", subcategory: "Sales Taxes" };
    }
    if (name.includes("payroll") || name.includes("ei ") || name.includes("cpp") || name.includes("qpip") || name.includes("source deduction")) {
      return { category: "Liabilities", subcategory: "Payroll Liabilities" };
    }
    if (name.includes("shareholder") || name.includes("director") || name.includes("due to")) {
      return { category: "Liabilities", subcategory: "Shareholder Loans" };
    }
    if (name.includes("loan") || name.includes("mortgage") || name.includes("note payable") || name.includes("line of credit")) {
      return { category: "Liabilities", subcategory: "Debt" };
    }
  }
  if (baseMapping.category === "Equity") {
    if (name.includes("retained earnings") || name.includes("net income")) {
      return { category: "Equity", subcategory: "Retained Earnings" };
    }
    return { category: "Equity", subcategory: "Equity" };
  }
  return baseMapping;
}

/**
 * Auto-classify rows when no manual mappings exist.
 * Returns rows with classification info attached.
 */
export function autoClassifyRows(rows: ReportRow[], statementType: "profit_loss" | "balance_sheet"): Array<ReportRow & { autoCategory: string; autoSubcategory: string | null }> {
  return rows.map(row => {
    const classification = statementType === "profit_loss"
      ? classifyPLAccount(row.accountName, row.section, row.subSection)
      : classifyBSAccount(row.accountName, row.section, row.subSection);
    return {
      ...row,
      autoCategory: classification.category,
      autoSubcategory: classification.subcategory,
    };
  });
}

// ─── Public API ───

export async function fetchProfitAndLoss(entityId: number, startDate: string, endDate: string, useCache = true): Promise<ParsedReport> {
  const entity = await financialDb.getQboEntityById(entityId);
  if (!entity) throw new Error("QBO entity not found");

  // Check cache first (within 1 hour)
  // Always re-parse rows from rawData to pick up classification improvements
  if (useCache) {
    const cached = await financialDb.getCachedReport(entityId, "ProfitAndLoss", startDate, endDate);
    if (cached && cached.fetchedAt > new Date(Date.now() - 60 * 60 * 1000)) {
      const report = cached.reportData as ParsedReport;
      // Re-parse from raw data to ensure latest classification logic is used
      if (report.rawData?.Rows?.Row) {
        report.rows = parseQboReportRows(
          report.rawData?.Columns?.Column || [],
          report.rawData.Rows.Row,
        );
      }
      return report;
    }
  }

  await financialDb.updateQboEntitySync(entityId, "syncing");

  try {
    const raw = await fetchQboReport(entity.realmId, "ProfitAndLoss", {
      start_date: startDate,
      end_date: endDate,
      accounting_method: "Accrual",
    });

    const rows = parseQboReportRows(
      raw?.Columns?.Column || [],
      raw?.Rows?.Row || [],
    );

    const parsed: ParsedReport = {
      reportName: "Profit and Loss",
      startDate,
      endDate,
      currency: raw?.Header?.Currency || "CAD",
      rows,
      rawData: raw,
    };

    // Cache the result
    await financialDb.cacheReport({
      qboEntityId: entityId,
      reportType: "ProfitAndLoss",
      startDate,
      endDate,
      reportData: parsed,
    });

    await financialDb.updateQboEntitySync(entityId, "idle");
    return parsed;
  } catch (err: any) {
    await financialDb.updateQboEntitySync(entityId, "error", err.message);
    throw err;
  }
}

export async function fetchBalanceSheet(entityId: number, asOfDate: string, useCache = true): Promise<ParsedReport> {
  const entity = await financialDb.getQboEntityById(entityId);
  if (!entity) throw new Error("QBO entity not found");

  if (useCache) {
    const cached = await financialDb.getCachedReport(entityId, "BalanceSheet", undefined, undefined, asOfDate);
    if (cached && cached.fetchedAt > new Date(Date.now() - 60 * 60 * 1000)) {
      const report = cached.reportData as ParsedReport;
      // Re-parse from raw data to ensure latest classification logic is used
      if (report.rawData?.Rows?.Row) {
        report.rows = parseQboReportRows(
          report.rawData?.Columns?.Column || [],
          report.rawData.Rows.Row,
        );
      }
      return report;
    }
  }

  await financialDb.updateQboEntitySync(entityId, "syncing");

  try {
    const raw = await fetchQboReport(entity.realmId, "BalanceSheet", {
      date_macro: "",
      as_of: asOfDate,
      accounting_method: "Accrual",
    });

    const rows = parseQboReportRows(
      raw?.Columns?.Column || [],
      raw?.Rows?.Row || [],
    );

    const parsed: ParsedReport = {
      reportName: "Balance Sheet",
      asOfDate,
      currency: raw?.Header?.Currency || "CAD",
      rows,
      rawData: raw,
    };

    await financialDb.cacheReport({
      qboEntityId: entityId,
      reportType: "BalanceSheet",
      asOfDate,
      reportData: parsed,
    });

    await financialDb.updateQboEntitySync(entityId, "idle");
    return parsed;
  } catch (err: any) {
    await financialDb.updateQboEntitySync(entityId, "error", err.message);
    throw err;
  }
}

/**
 * Sync all QBO accounts for an entity into the local cache
 */
export async function syncEntityAccounts(entityId: number) {
  const entity = await financialDb.getQboEntityById(entityId);
  if (!entity) throw new Error("QBO entity not found");

  const accessToken = await getValidToken(entity.realmId);
  const url = `${QBO_BASE_URL}/v3/company/${entity.realmId}/query?query=${encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000")}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error(`QBO query failed: ${res.status}`);
  const data = await res.json();
  const accounts = data?.QueryResponse?.Account || [];

  await financialDb.syncQboAccountCache(entityId, accounts.map((a: any) => ({
    qboAccountId: a.Id,
    name: a.Name,
    fullyQualifiedName: a.FullyQualifiedName,
    accountType: a.AccountType,
    accountSubType: a.AccountSubType,
    classification: a.Classification,
    currentBalance: a.CurrentBalance,
    acctNum: a.AcctNum,
    isActive: a.Active,
  })));

  return accounts.length;
}
