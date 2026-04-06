/**
 * QBO Production API Client
 * 
 * Provides per-realm API access to production QuickBooks companies.
 * Uses the same token management as qboReports.ts (production credentials).
 * 
 * Used for:
 *   - Querying journal entries by date range
 *   - Deleting/voiding journal entries
 *   - Creating journal entries in production
 *   - Querying Chart of Accounts per realm
 */
import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Production QBO Configuration ───
const QBO_PROD_CLIENT_ID = "AB1l3yvNjbzID6Qjg6sWWxYh6bJLUjVDKqbcisw8KNkYMyAmlB";
const QBO_PROD_CLIENT_SECRET = "eur57dkXRw3ZDZMrhsDK5wFIiMlgx73WMfbQQxEa";
const QBO_BASE_URL = "https://quickbooks.api.intuit.com";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// ─── Token Management (per-realm) ───

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
  if (!tokenRow) throw new Error(`No active QBO tokens for realm ${realmId}. Please connect this QuickBooks company first.`);

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

// ─── Generic API Request (per-realm) ───

export async function prodQboRequest(realmId: string, method: string, endpoint: string, body?: unknown) {
  const accessToken = await getValidToken(realmId);
  const url = `${QBO_BASE_URL}/v3/company/${realmId}/${endpoint}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO API error ${res.status} (realm ${realmId}): ${errText}`);
  }

  return await res.json();
}

// ─── Query Operations ───

export async function queryJournalEntries(realmId: string, query: string) {
  const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
  return result?.QueryResponse?.JournalEntry || [];
}

/**
 * Query all journal entries in a date range for a given realm.
 * QBO query API returns max 1000 results; we paginate if needed.
 */
export async function getJournalEntriesByDateRange(
  realmId: string,
  startDate: string,
  endDate: string,
  docNumberPrefix?: string,
): Promise<Array<{ Id: string; SyncToken: string; DocNumber: string; TxnDate: string; TotalAmt: number; Line: unknown[] }>> {
  const allEntries: Array<{ Id: string; SyncToken: string; DocNumber: string; TxnDate: string; TotalAmt: number; Line: unknown[] }> = [];
  let startPosition = 1;
  const maxResults = 1000;

  while (true) {
    let query = `SELECT * FROM JournalEntry WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}'`;
    if (docNumberPrefix) {
      query += ` AND DocNumber LIKE '${docNumberPrefix}%'`;
    }
    query += ` STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;

    const entries = await queryJournalEntries(realmId, query);
    if (!entries || entries.length === 0) break;

    allEntries.push(...entries);
    if (entries.length < maxResults) break;
    startPosition += maxResults;
  }

  return allEntries;
}

// ─── Delete Operation ───

/**
 * Delete a journal entry from QBO.
 * Requires the JE Id and SyncToken.
 * Uses POST /journalentry?operation=delete
 */
export async function deleteJournalEntry(realmId: string, jeId: string, syncToken: string) {
  return await prodQboRequest(realmId, "POST", "journalentry?operation=delete", {
    Id: jeId,
    SyncToken: syncToken,
  });
}

// ─── Create Journal Entry (Production) ───

export async function createProductionJournalEntry(
  realmId: string,
  entry: {
    txnDate: string;
    docNumber?: string;
    privateNote?: string;
    lines: Array<{
      postingType: "Debit" | "Credit";
      amount: number;
      accountId: string;
      accountName?: string;
      description?: string;
      className?: string;
      classId?: string;
      taxCodeId?: string;
      taxCodeName?: string;
      entityId?: string;
      entityName?: string;
      locationId?: string;
      locationName?: string;
    }>;
  },
) {
  const Line = entry.lines.map((line, idx) => {
    const detail: Record<string, unknown> = {
      PostingType: line.postingType,
      AccountRef: { value: line.accountId, name: line.accountName || "" },
    };
    if (line.classId) detail.ClassRef = { value: line.classId, name: line.className || "" };
    if (line.taxCodeId) detail.TaxCodeRef = { value: line.taxCodeId, name: line.taxCodeName || "" };
    if (line.entityId) detail.Entity = { EntityRef: { value: line.entityId, name: line.entityName || "" }, Type: "Customer" };

    return {
      Id: String(idx + 1),
      DetailType: "JournalEntryLineDetail",
      Amount: line.amount,
      Description: line.description || "",
      JournalEntryLineDetail: detail,
    };
  });

  const jePayload: Record<string, unknown> = {
    Line,
    TxnDate: entry.txnDate,
  };

  if (entry.docNumber) jePayload.DocNumber = entry.docNumber;
  if (entry.privateNote) jePayload.PrivateNote = entry.privateNote;

  return await prodQboRequest(realmId, "POST", "journalentry", jePayload);
}

// ─── Chart of Accounts Query ───

export async function getProductionAccounts(realmId: string) {
  const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000")}`);
  return result?.QueryResponse?.Account || [];
}

/**
 * Find an account by name in a realm's Chart of Accounts.
 */
export async function findAccountByName(realmId: string, accountName: string) {
  const accounts = await getProductionAccounts(realmId);
  return accounts.find((a: { Name: string }) =>
    a.Name.toLowerCase().includes(accountName.toLowerCase())
  ) || null;
}

// ─── Department/Class Query ───

const classIdCache = new Map<string, string>();

export async function resolveClassId(realmId: string, className: string): Promise<string | null> {
  const cacheKey = `${realmId}:${className}`;
  if (classIdCache.has(cacheKey)) return classIdCache.get(cacheKey)!;

  const query = `SELECT * FROM Department WHERE Name = '${className}'`;
  const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
  const departments = result?.QueryResponse?.Department || [];

  if (departments.length > 0) {
    const id = departments[0].Id;
    classIdCache.set(cacheKey, id);
    return id;
  }
  return null;
}

// ─── Tax Code Query ───

const taxCodeCache = new Map<string, { id: string; name: string }>();

/**
 * Resolve a QBO Tax Code by name (e.g., "Zero-rated (Sales)", "GST/QST QC - 9.975 (Sales)")
 * Returns the TaxCode Id and Name.
 */
export async function resolveTaxCodeId(realmId: string, taxCodeName: string): Promise<{ id: string; name: string } | null> {
  const cacheKey = `${realmId}:${taxCodeName}`;
  if (taxCodeCache.has(cacheKey)) return taxCodeCache.get(cacheKey)!;

  const query = `SELECT * FROM TaxCode MAXRESULTS 100`;
  const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
  const taxCodes = result?.QueryResponse?.TaxCode || [];

  // Exact match first
  let found = taxCodes.find((tc: { Name: string }) => tc.Name === taxCodeName);
  // Partial match
  if (!found) {
    found = taxCodes.find((tc: { Name: string }) =>
      tc.Name.toLowerCase().includes(taxCodeName.toLowerCase())
    );
  }

  if (found) {
    const entry = { id: found.Id, name: found.Name };
    taxCodeCache.set(cacheKey, entry);
    return entry;
  }
  return null;
}

// ─── Customer/Name Query ───

const customerCache = new Map<string, { id: string; name: string }>();

/**
 * Resolve a QBO Customer by display name (e.g., "MEV MK.", "MEV PK.")
 * Used for the "Name" column in journal entries.
 */
export async function resolveCustomerId(realmId: string, displayName: string): Promise<{ id: string; name: string } | null> {
  const cacheKey = `${realmId}:${displayName}`;
  if (customerCache.has(cacheKey)) return customerCache.get(cacheKey)!;

  const query = `SELECT * FROM Customer WHERE DisplayName = '${displayName}'`;
  const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
  const customers = result?.QueryResponse?.Customer || [];

  if (customers.length > 0) {
    const entry = { id: customers[0].Id, name: customers[0].DisplayName };
    customerCache.set(cacheKey, entry);
    return entry;
  }

  // Try partial match
  const queryAll = `SELECT * FROM Customer WHERE DisplayName LIKE '%${displayName}%'`;
  const resultAll = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(queryAll)}`);
  const customersAll = resultAll?.QueryResponse?.Customer || [];

  if (customersAll.length > 0) {
    const entry = { id: customersAll[0].Id, name: customersAll[0].DisplayName };
    customerCache.set(cacheKey, entry);
    return entry;
  }

  return null;
}
