/**
 * QBO Financial Report Fetching
 * Fetches Profit & Loss and Balance Sheet reports from QuickBooks API
 * using per-entity token management.
 */
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { qboTokens, qboEntities } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import * as financialDb from "./financialDb";

const QBO_BASE_URL = ENV.qboEnvironment === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

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
  const basicAuth = Buffer.from(`${ENV.qboClientId}:${ENV.qboClientSecret}`).toString("base64");
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
  if (!tokenRow) throw new Error(`No active QBO tokens for realm ${realmId}`);

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

// ─── Report Parsing ───

export interface ReportRow {
  accountId?: string;
  accountName: string;
  amount: number;
  accountType?: string;
  classification?: string;
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

function parseQboReportRows(columns: any[], rows: any[]): ReportRow[] {
  const result: ReportRow[] = [];

  function processRow(row: any) {
    if (row.type === "Data" && row.ColData) {
      const nameCol = row.ColData[0];
      const amountCol = row.ColData[1];
      if (nameCol && amountCol) {
        result.push({
          accountId: nameCol.id || undefined,
          accountName: nameCol.value || "",
          amount: parseFloat(amountCol.value) || 0,
        });
      }
    }
    if (row.Rows?.Row) {
      for (const subRow of row.Rows.Row) {
        processRow(subRow);
      }
    }
    if (row.Summary?.ColData) {
      // Skip summary rows for now — we compute our own totals
    }
    if (row.Header?.ColData) {
      // Section headers
    }
  }

  for (const row of rows) {
    processRow(row);
  }

  return result;
}

// ─── Public API ───

export async function fetchProfitAndLoss(entityId: number, startDate: string, endDate: string, useCache = true): Promise<ParsedReport> {
  const entity = await financialDb.getQboEntityById(entityId);
  if (!entity) throw new Error("QBO entity not found");

  // Check cache first (within 1 hour)
  if (useCache) {
    const cached = await financialDb.getCachedReport(entityId, "ProfitAndLoss", startDate, endDate);
    if (cached && cached.fetchedAt > new Date(Date.now() - 60 * 60 * 1000)) {
      return cached.reportData as ParsedReport;
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
      return cached.reportData as ParsedReport;
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
