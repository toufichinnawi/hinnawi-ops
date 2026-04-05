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

// ─── QBO Department Lookup ───

const departmentIdCache = new Map<string, string>(); // "realmId:name" -> departmentId

async function resolveDepartmentId(realmId: string, departmentName: string): Promise<string | null> {
  const cacheKey = `${realmId}:${departmentName}`;
  if (departmentIdCache.has(cacheKey)) return departmentIdCache.get(cacheKey)!;

  try {
    const accessToken = await getValidToken(realmId);
    const query = encodeURIComponent(`SELECT Id, Name FROM Department WHERE Name = '${departmentName}'`);
    const url = `${QBO_BASE_URL}/v3/company/${realmId}/query?query=${query}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[QBO] Failed to query department "${departmentName}": ${res.status}`);
      return null;
    }
    const data = await res.json();
    const departments = data?.QueryResponse?.Department;
    if (departments && departments.length > 0) {
      const id = departments[0].Id;
      departmentIdCache.set(cacheKey, id);
      console.log(`[QBO] Resolved department "${departmentName}" -> ID ${id}`);
      return id;
    }
    console.warn(`[QBO] Department "${departmentName}" not found in realm ${realmId}`);
    return null;
  } catch (err) {
    console.warn(`[QBO] Error resolving department "${departmentName}":`, err);
    return null;
  }
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
  // ─── Top-level sections ───
  "ASSETS": { category: "Assets", subcategory: null },
  "Assets": { category: "Assets", subcategory: null },
  "Total Assets": { category: "Assets", subcategory: null },
  "LIABILITIES AND EQUITY": { category: "Liabilities", subcategory: null },
  "Liabilities and Equity": { category: "Liabilities", subcategory: null },
  "LIABILITIES": { category: "Liabilities", subcategory: null },
  "Liabilities": { category: "Liabilities", subcategory: null },
  "EQUITY": { category: "Equity", subcategory: "Equity" },
  "Equity": { category: "Equity", subcategory: "Equity" },

  // ─── Asset sub-sections ───
  "Current Assets": { category: "Assets", subcategory: null },
  "Bank": { category: "Assets", subcategory: "Cash" },
  "Bank Accounts": { category: "Assets", subcategory: "Cash" },
  "Cash and cash equivalents": { category: "Assets", subcategory: "Cash" },
  "Cash and Cash Equivalents": { category: "Assets", subcategory: "Cash" },
  "Chequing": { category: "Assets", subcategory: "Cash" },
  "Checking": { category: "Assets", subcategory: "Cash" },
  "Savings": { category: "Assets", subcategory: "Cash" },
  "Accounts Receivable": { category: "Assets", subcategory: "Accounts Receivable" },
  "Accounts receivable (A/R)": { category: "Assets", subcategory: "Accounts Receivable" },
  "Accounts Receivable (A/R)": { category: "Assets", subcategory: "Accounts Receivable" },
  "Other Current Assets": { category: "Assets", subcategory: "Prepaids" },
  "Other current assets": { category: "Assets", subcategory: "Prepaids" },
  "Inventory": { category: "Assets", subcategory: "Inventory" },
  "Inventory Asset": { category: "Assets", subcategory: "Inventory" },
  "Fixed Assets": { category: "Assets", subcategory: "Fixed Assets" },
  "Fixed assets": { category: "Assets", subcategory: "Fixed Assets" },
  "Property, plant and equipment": { category: "Assets", subcategory: "Fixed Assets" },
  "Property, Plant and Equipment": { category: "Assets", subcategory: "Fixed Assets" },
  "Other Assets": { category: "Assets", subcategory: null },
  "Other assets": { category: "Assets", subcategory: null },
  "Non-current Assets": { category: "Assets", subcategory: "Fixed Assets" },

  // ─── Liability sub-sections ───
  "Current Liabilities": { category: "Liabilities", subcategory: null },
  "Current liabilities": { category: "Liabilities", subcategory: null },
  "Accounts Payable": { category: "Liabilities", subcategory: "Accounts Payable" },
  "Accounts payable (A/P)": { category: "Liabilities", subcategory: "Accounts Payable" },
  "Accounts Payable (A/P)": { category: "Liabilities", subcategory: "Accounts Payable" },
  "Credit Cards": { category: "Liabilities", subcategory: "Credit Cards" },
  "Credit Card": { category: "Liabilities", subcategory: "Credit Cards" },
  "Credit cards": { category: "Liabilities", subcategory: "Credit Cards" },
  "Other Current Liabilities": { category: "Liabilities", subcategory: null },
  "Other current liabilities": { category: "Liabilities", subcategory: null },
  "Long-Term Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Long-term Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Long Term Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Non-Current Liabilities": { category: "Liabilities", subcategory: "Debt" },
  "Non-current Liabilities": { category: "Liabilities", subcategory: "Debt" },

  // ─── Equity sub-sections ───
  "Stockholders' Equity": { category: "Equity", subcategory: "Equity" },
  "Owner's Equity": { category: "Equity", subcategory: "Equity" },
  "Shareholders' Equity": { category: "Equity", subcategory: "Equity" },
  "Share Capital": { category: "Equity", subcategory: "Equity" },
  "Retained Earnings": { category: "Equity", subcategory: "Retained Earnings" },
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
    } else if (
      name.includes("cost of goods") || name.includes("cogs") || name.includes("cost of sales") ||
      name.includes("purchase") || name.includes("food cost") || name.includes("bakery") ||
      name.includes("ingredient") || name.includes("packaging") || name.includes("raw material") ||
      name.includes("beverage") || name.includes("disposable") || name.includes("laundry") ||
      name.includes("linen") || name.includes("kitchen equipment") || name.includes("coffee") ||
      name.includes("programme alimentation") || name.includes("purchase return") ||
      name.includes("early payment") || name.includes("small kitchen")
    ) {
      baseCategory = "COGS";
    } else if (
      name.includes("expense") || name.includes("payroll") || name.includes("rent") ||
      name.includes("utilit") || name.includes("merchant") || name.includes("cleaning") ||
      name.includes("insurance") || name.includes("wage") || name.includes("salary") ||
      name.includes("freight") || name.includes("delivery") || name.includes("repair") ||
      name.includes("maintenance") || name.includes("office") || name.includes("supplies") ||
      name.includes("professional") || name.includes("marketing") || name.includes("advertising") ||
      name.includes("depreciation") || name.includes("amortization") || name.includes("interest") ||
      name.includes("bank charge") || name.includes("miscellaneous") || name.includes("sundry") ||
      name.includes("general") || name.includes("telephone") || name.includes("travel") ||
      name.includes("training") || name.includes("license") || name.includes("permit") ||
      name.includes("dues") || name.includes("subscription") || name.includes("royalt") ||
      name.includes("management fee") || name.includes("commission") || name.includes("tips") ||
      name.includes("electricity") || name.includes("heating") || name.includes("computer") ||
      name.includes("security") || name.includes("car expense") || name.includes("renovation") ||
      name.includes("csst") || name.includes("qpp") || name.includes("qpip") ||
      name.includes("stat holiday") || name.includes("vacation") || name.includes("ei expense") ||
      name.includes("service charge") || name.includes("accounting") || name.includes("legal") ||
      name.includes("advertisement")
    ) {
      baseCategory = "Operating Expenses";
    }
  }
  
  if (!baseCategory) {
    return { category: "Uncategorized", subcategory: null };
  }
  
  // For Operating Expenses, auto-detect subcategory from account name
  if (baseCategory === "Operating Expenses") {
    const name = accountName.toLowerCase();

    // ─── Payroll (must be before general keyword matches) ───
    if (name.includes("payroll") || name.includes("salary") || name.includes("salaries") ||
        name.includes("wage") || name.includes("benefit") || name.includes("employee") ||
        name.includes("tips") || name.includes("usalaries") || name.includes("ei expense") ||
        name.includes("cpp") || name.includes("qpp") || name.includes("qpip") ||
        name.includes("csst") || name.includes("cnesst") || name.includes("vacation expense") ||
        name.includes("vacation accrual") || name.includes("stat holiday") ||
        name.includes("service charges payroll") || name.includes("service charge") ||
        name.includes("payroll gov") || name.includes("gov deduction") ||
        name.includes("workers comp") || name.includes("eht") || name.includes("health tax")) {
      return { category: "Operating Expenses", subcategory: "Payroll" };
    }

    // ─── Rent / Occupancy ───
    if (name.includes("rent") || name.includes("occupancy") || name.includes("lease")) {
      return { category: "Operating Expenses", subcategory: "Rent / Occupancy" };
    }

    // ─── Utilities (electricity, heating, telephone, internet) ───
    if (name.includes("utilit") || name.includes("hydro") || name.includes("electric") ||
        name.includes("heating") || name.includes("gas ") || name.includes("water") ||
        name.includes("internet") || name.includes("phone") || name.includes("telecom") ||
        name.includes("telephone")) {
      return { category: "Operating Expenses", subcategory: "Utilities" };
    }

    // ─── Repairs & Maintenance (including renovation) ───
    if (name.includes("repair") || name.includes("maintenance") || name.includes("renovation")) {
      return { category: "Operating Expenses", subcategory: "Repairs & Maintenance" };
    }

    // ─── Professional Fees (accounting, legal, consulting) ───
    if (name.includes("professional") || name.includes("legal") || name.includes("accounting") ||
        name.includes("consulting") || name.includes("bookkeeping") || name.includes("legal fee")) {
      return { category: "Operating Expenses", subcategory: "Professional Fees" };
    }

    // ─── Marketing (advertising, commission, promotion) ───
    if (name.includes("marketing") || name.includes("advertising") || name.includes("advertisement") ||
        name.includes("promotion") || name.includes("commission")) {
      return { category: "Operating Expenses", subcategory: "Marketing" };
    }

    // ─── Royalties ───
    if (name.includes("royalt")) {
      return { category: "Operating Expenses", subcategory: "Royalties" };
    }

    // ─── Management Fees ───
    if (name.includes("management fee") || name.includes("management fees")) {
      return { category: "Operating Expenses", subcategory: "Management Fees" };
    }

    // ─── Delivery / Vehicle ───
    if (name.includes("delivery") || name.includes("vehicle") || name.includes("fuel") ||
        name.includes("auto ") || name.includes("transport") || name.includes("shipping") ||
        name.includes("car expense") || name.includes("car ")) {
      return { category: "Operating Expenses", subcategory: "Delivery / Vehicle" };
    }

    // ─── Office / Admin (office supplies, computer, security, cleaning, insurance, misc) ───
    if (name.includes("office") || name.includes("admin") || name.includes("supplies") ||
        name.includes("postage") || name.includes("cleaning") || name.includes("janitorial") ||
        name.includes("computer") || name.includes("security") || name.includes("insurance") ||
        name.includes("miscellaneous")) {
      return { category: "Operating Expenses", subcategory: "Office / Admin" };
    }

    // ─── Merchant Fees / Bank Charges ───
    if (name.includes("merchant") || name.includes("processing") || name.includes("stripe") ||
        name.includes("square") || name.includes("bank charge") || name.includes("transaction fee")) {
      return { category: "Operating Expenses", subcategory: "Merchant Fees" };
    }

    // ─── Interest & Bank Charges ───
    if (name.includes("interest")) {
      return { category: "Operating Expenses", subcategory: "Interest" };
    }

    // ─── Depreciation / Amortization ───
    if (name.includes("depreciation") || name.includes("amortization")) {
      return { category: "Operating Expenses", subcategory: "Depreciation" };
    }

    // Default: general operating expense (will be caught by "Other Operating Expenses" line)
    return { category: "Operating Expenses", subcategory: null };
  }
  
  // For COGS, just return the base category
  if (baseCategory === "COGS") {
    return { category: "COGS", subcategory: null };
  }
  
  // For Revenue, check if the account is actually COGS based on name
  if (baseCategory === "Revenue") {
    const name = accountName.toLowerCase();
    // Some accounts under Income section are actually contra-revenue or COGS
    if (name.includes("cost of") || name.includes("purchase")) {
      return { category: "COGS", subcategory: null };
    }
  }
  
  return sectionMapping || { category: baseCategory, subcategory: null };
}

/**
 * Enhanced Balance Sheet account classifier.
 * Uses a three-tier approach:
 *   1. Sub-section mapping (most specific)
 *   2. Section mapping (fallback)
 *   3. Account name keyword matching (final fallback)
 * Then refines the subcategory based on account name keywords.
 */
function classifyBSAccount(accountName: string, section?: string, subSection?: string): { category: string; subcategory: string | null } {
  // Try sub-section first for more specific classification
  if (subSection) {
    const subMapping = BS_SECTION_MAP[subSection];
    if (subMapping) {
      return refineBSSubcategory(accountName, subMapping);
    }
  }
  // Fall back to section
  if (section) {
    const sectionMapping = BS_SECTION_MAP[section];
    if (sectionMapping) {
      return refineBSSubcategory(accountName, sectionMapping);
    }
    // Case-insensitive fallback: try matching section name case-insensitively
    const sectionLower = section.toLowerCase();
    for (const [key, val] of Object.entries(BS_SECTION_MAP)) {
      if (key.toLowerCase() === sectionLower) {
        return refineBSSubcategory(accountName, val);
      }
    }
  }
  // Final fallback: classify from account name alone
  return classifyBSAccountByName(accountName);
}

/**
 * Classify a BS account purely from its name when no section context is available.
 */
function classifyBSAccountByName(accountName: string): { category: string; subcategory: string | null } {
  const name = accountName.toLowerCase();

  // ─── Assets ───
  if (name.includes("cash") || name.includes("bank") || name.includes("chequing") || name.includes("checking") || name.includes("savings") || name.includes("petty cash") || name.includes("caisse")) {
    return { category: "Assets", subcategory: "Cash" };
  }
  if (name.includes("receivable") || name.includes("a/r") || name.includes("accounts rec")) {
    return { category: "Assets", subcategory: "Accounts Receivable" };
  }
  if (name.includes("inventory") || name.includes("stock") || name.includes("merchandise")) {
    return { category: "Assets", subcategory: "Inventory" };
  }
  if (name.includes("prepaid") || name.includes("deposit") || name.includes("advance") || name.includes("security deposit")) {
    return { category: "Assets", subcategory: "Prepaids" };
  }
  if (name.includes("accumulated depreciation") || name.includes("accum. depreciation") || name.includes("accum depreciation") || name.includes("amortissement cumul")) {
    return { category: "Assets", subcategory: "Accumulated Depreciation" };
  }
  if (name.includes("equipment") || name.includes("furniture") || name.includes("leasehold") || name.includes("vehicle") || name.includes("computer") || name.includes("machinery") || name.includes("building") || name.includes("land") || name.includes("fixed asset") || name.includes("capital asset") || name.includes("immobilisation") || name.includes("right-of-use") || name.includes("tenant improvement")) {
    return { category: "Assets", subcategory: "Fixed Assets" };
  }

  // ─── Liabilities ───
  if (name.includes("accounts payable") || name.includes("a/p") || name.includes("trade payable")) {
    return { category: "Liabilities", subcategory: "Accounts Payable" };
  }
  if (name.includes("credit card") || name.includes("visa") || name.includes("mastercard") || name.includes("amex") || name.includes("american express")) {
    return { category: "Liabilities", subcategory: "Credit Cards" };
  }
  if (name.includes("sales tax") || name.includes("gst") || name.includes("qst") || name.includes("hst") || name.includes("tps") || name.includes("tvq") || name.includes("pst") || name.includes("vat") || name.includes("tax payable") || name.includes("tax collected") || name.includes("input tax") || name.includes("output tax")) {
    return { category: "Liabilities", subcategory: "Sales Taxes" };
  }
  if (name.includes("payroll liabilit") || name.includes("ei ") || name.includes("cpp") || name.includes("qpip") || name.includes("source deduction") || name.includes("employee deduction") || name.includes("vacation payable") || name.includes("rqap") || name.includes("rrq") || name.includes("fss") || name.includes("cnt") || name.includes("csst") || name.includes("cnesst") || name.includes("workers comp") || name.includes("health tax") || name.includes("eht")) {
    return { category: "Liabilities", subcategory: "Payroll Liabilities" };
  }
  if (name.includes("shareholder") || name.includes("director") || name.includes("due to") || name.includes("due from") || name.includes("related party") || name.includes("owner") || name.includes("actionnaire")) {
    return { category: "Liabilities", subcategory: "Shareholder Loans" };
  }
  if (name.includes("loan") || name.includes("mortgage") || name.includes("note payable") || name.includes("line of credit") || name.includes("loc ") || name.includes("long-term") || name.includes("long term") || name.includes("financing") || name.includes("ceba") || name.includes("bdc") || name.includes("debenture")) {
    return { category: "Liabilities", subcategory: "Debt" };
  }
  if (name.includes("payable") || name.includes("accrued") || name.includes("deferred revenue") || name.includes("unearned") || name.includes("gift card") || name.includes("customer deposit")) {
    return { category: "Liabilities", subcategory: null };
  }

  // ─── Equity ───
  if (name.includes("retained earnings") || name.includes("net income") || name.includes("bénéfices non répartis") || name.includes("profit") || name.includes("accumulated")) {
    return { category: "Equity", subcategory: "Retained Earnings" };
  }
  if (name.includes("equity") || name.includes("capital") || name.includes("common share") || name.includes("preferred share") || name.includes("contributed surplus") || name.includes("opening balance") || name.includes("owner") || name.includes("draw") || name.includes("distribution") || name.includes("dividend")) {
    return { category: "Equity", subcategory: "Equity" };
  }

  return { category: "Uncategorized", subcategory: null };
}

/**
 * Refine the subcategory of a BS account based on its name,
 * given a base mapping from the section context.
 * This is the most comprehensive keyword matcher for BS accounts.
 */
function refineBSSubcategory(accountName: string, baseMapping: { category: string; subcategory: string | null }): { category: string; subcategory: string | null } {
  const name = accountName.toLowerCase();

  // ─── Assets refinement ───
  if (baseMapping.category === "Assets") {
    if (name.includes("cash") || name.includes("chequing") || name.includes("checking") || name.includes("savings") || name.includes("bank") || name.includes("petty cash") || name.includes("caisse")) {
      return { category: "Assets", subcategory: "Cash" };
    }
    if (name.includes("receivable") || name.includes("a/r")) {
      return { category: "Assets", subcategory: "Accounts Receivable" };
    }
    if (name.includes("inventory") || name.includes("stock") || name.includes("merchandise")) {
      return { category: "Assets", subcategory: "Inventory" };
    }
    if (name.includes("prepaid") || name.includes("deposit") || name.includes("advance") || name.includes("security deposit")) {
      return { category: "Assets", subcategory: "Prepaids" };
    }
    if (name.includes("accumulated depreciation") || name.includes("accum. depreciation") || name.includes("accum depreciation") || name.includes("amortissement cumul")) {
      return { category: "Assets", subcategory: "Accumulated Depreciation" };
    }
    if (name.includes("equipment") || name.includes("furniture") || name.includes("leasehold") || name.includes("vehicle") || name.includes("computer") || name.includes("machinery") || name.includes("building") || name.includes("land") || name.includes("capital asset") || name.includes("immobilisation") || name.includes("right-of-use") || name.includes("tenant improvement")) {
      return { category: "Assets", subcategory: "Fixed Assets" };
    }
    // If we have a subcategory from the section, use it; otherwise return base
    return baseMapping.subcategory ? baseMapping : { category: "Assets", subcategory: baseMapping.subcategory };
  }

  // ─── Liabilities refinement ───
  if (baseMapping.category === "Liabilities") {
    if ((name.includes("payable") || name.includes("a/p") || name.includes("trade payable")) && !name.includes("note payable") && !name.includes("tax payable") && !name.includes("payroll")) {
      return { category: "Liabilities", subcategory: "Accounts Payable" };
    }
    if (name.includes("credit card") || name.includes("visa") || name.includes("mastercard") || name.includes("amex")) {
      return { category: "Liabilities", subcategory: "Credit Cards" };
    }
    if (name.includes("sales tax") || name.includes("gst") || name.includes("qst") || name.includes("hst") || name.includes("tps") || name.includes("tvq") || name.includes("pst") || name.includes("vat") || name.includes("tax payable") || name.includes("tax collected") || name.includes("input tax") || name.includes("output tax")) {
      return { category: "Liabilities", subcategory: "Sales Taxes" };
    }
    if (name.includes("payroll") || name.includes("ei ") || name.includes("cpp") || name.includes("qpip") || name.includes("source deduction") || name.includes("employee deduction") || name.includes("vacation payable") || name.includes("rqap") || name.includes("rrq") || name.includes("fss") || name.includes("cnt") || name.includes("csst") || name.includes("cnesst") || name.includes("workers comp") || name.includes("health tax") || name.includes("eht")) {
      return { category: "Liabilities", subcategory: "Payroll Liabilities" };
    }
    if (name.includes("shareholder") || name.includes("director") || name.includes("due to") || name.includes("due from") || name.includes("related party") || name.includes("actionnaire")) {
      return { category: "Liabilities", subcategory: "Shareholder Loans" };
    }
    if (name.includes("loan") || name.includes("mortgage") || name.includes("note payable") || name.includes("line of credit") || name.includes("loc ") || name.includes("long-term") || name.includes("long term") || name.includes("financing") || name.includes("ceba") || name.includes("bdc") || name.includes("debenture")) {
      return { category: "Liabilities", subcategory: "Debt" };
    }
    // Return base mapping if we have a subcategory, otherwise null
    return baseMapping;
  }

  // ─── Equity refinement ───
  if (baseMapping.category === "Equity") {
    if (name.includes("retained earnings") || name.includes("net income") || name.includes("bénéfices non répartis") || name.includes("accumulated")) {
      return { category: "Equity", subcategory: "Retained Earnings" };
    }
    if (name.includes("opening balance equity") || name.includes("opening bal equity")) {
      return { category: "Equity", subcategory: "Equity" };
    }
    if (name.includes("draw") || name.includes("distribution") || name.includes("dividend")) {
      return { category: "Equity", subcategory: "Equity" };
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

  // Check cache first (within 5 minutes)
  // Always re-parse rows from rawData to pick up classification improvements
  if (useCache) {
    const cached = await financialDb.getCachedReport(entityId, "ProfitAndLoss", startDate, endDate);
    if (cached && cached.fetchedAt > new Date(Date.now() - 5 * 60 * 1000)) {
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
    const reportParams: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
      accounting_method: "Accrual",
    };
    // Filter by department if entity has a department filter (e.g., PK or MK)
    // QBO API requires the numeric Department.Id, not the name
    // CRITICAL: If department filter is set but cannot be resolved, return EMPTY
    // report to prevent duplication in consolidated views. Never fall back to
    // unfiltered data when a filter is expected.
    if (entity.departmentFilter) {
      const deptId = await resolveDepartmentId(entity.realmId, entity.departmentFilter);
      if (deptId) {
        reportParams.department = deptId;
      } else {
        console.warn(`[QBO] Could not resolve department "${entity.departmentFilter}" for entity ${entityId} — returning empty report to prevent duplication`);
        const emptyParsed: ParsedReport = {
          reportName: "Profit and Loss",
          startDate,
          endDate,
          currency: "CAD",
          rows: [],
          rawData: null,
        };
        await financialDb.cacheReport({
          qboEntityId: entityId,
          reportType: "ProfitAndLoss",
          startDate,
          endDate,
          reportData: emptyParsed,
        });
        await financialDb.updateQboEntitySync(entityId, "idle");
        return emptyParsed;
      }
    }
    const raw = await fetchQboReport(entity.realmId, "ProfitAndLoss", reportParams);

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

  // Check cache first (within 5 minutes)
  if (useCache) {
    const cached = await financialDb.getCachedReport(entityId, "BalanceSheet", undefined, undefined, asOfDate);
    if (cached && cached.fetchedAt > new Date(Date.now() - 5 * 60 * 1000)) {
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
    const reportParams: Record<string, string> = {
      date_macro: "",
      as_of: asOfDate,
      accounting_method: "Accrual",
    };
    // Filter by department if entity has a department filter (e.g., PK or MK)
    // QBO API requires the numeric Department.Id, not the name
    // CRITICAL: If department filter is set but cannot be resolved, return EMPTY
    // report to prevent duplication in consolidated views.
    if (entity.departmentFilter) {
      const deptId = await resolveDepartmentId(entity.realmId, entity.departmentFilter);
      if (deptId) {
        reportParams.department = deptId;
      } else {
        console.warn(`[QBO] Could not resolve department "${entity.departmentFilter}" for entity ${entityId} — returning empty report to prevent duplication`);
        const emptyParsed: ParsedReport = {
          reportName: "Balance Sheet",
          asOfDate,
          currency: "CAD",
          rows: [],
          rawData: null,
        };
        await financialDb.cacheReport({
          qboEntityId: entityId,
          reportType: "BalanceSheet",
          asOfDate,
          reportData: emptyParsed,
        });
        await financialDb.updateQboEntitySync(entityId, "idle");
        return emptyParsed;
      }
    }
    const raw = await fetchQboReport(entity.realmId, "BalanceSheet", reportParams);

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
