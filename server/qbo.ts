import { ENV } from "./_core/env";
import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ─── QBO Configuration ───
const QBO_BASE_URL = ENV.qboEnvironment === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// ─── OAuth Helpers ───

export function getQboAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.qboClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    state,
  });
  return `${QBO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const basicAuth = Buffer.from(`${ENV.qboClientId}:${ENV.qboClientSecret}`).toString("base64");

  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QBO token exchange failed: ${res.status} ${err}`);
  }

  return await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    token_type: string;
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const basicAuth = Buffer.from(`${ENV.qboClientId}:${ENV.qboClientSecret}`).toString("base64");

  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QBO token refresh failed: ${res.status} ${err}`);
  }

  return await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    token_type: string;
  };
}

// ─── Token Storage ───

export async function saveTokens(
  realmId: string,
  tokens: { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number },
  companyName?: string,
  connectedBy?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
  const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

  // Deactivate any existing tokens for this realm
  await db.update(qboTokens).set({ isActive: false }).where(eq(qboTokens.realmId, realmId));

  // Insert new tokens
  await db.insert(qboTokens).values({
    realmId,
    companyName: companyName || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    scope: "com.intuit.quickbooks.accounting",
    isActive: true,
    connectedBy: connectedBy || null,
  });
}

export async function getActiveTokens() {
  const db = await getDb();
  if (!db) return null;

  // Only return sandbox tokens (exclude production tokens used by Financial Statements)
  const rows = await db.select().from(qboTokens)
    .where(eq(qboTokens.isActive, true))
    .orderBy(desc(qboTokens.updatedAt));

  // Filter out production tokens (connectedBy = 'prod-oauth-callback')
  const sandboxRows = rows.filter(r => r.connectedBy !== 'prod-oauth-callback');
  if (sandboxRows.length === 0) return rows[0] || null; // fallback to any token
  return sandboxRows[0];
}

async function getValidAccessToken(): Promise<{ accessToken: string; realmId: string } | null> {
  const tokenRow = await getActiveTokens();
  if (!tokenRow) return null;

  const now = new Date();
  // If access token expires in less than 5 minutes, refresh it
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (tokenRow.accessTokenExpiresAt < fiveMinFromNow) {
    try {
      const newTokens = await refreshAccessToken(tokenRow.refreshToken);
      await saveTokens(tokenRow.realmId, newTokens, tokenRow.companyName || undefined, tokenRow.connectedBy || undefined);
      return { accessToken: newTokens.access_token, realmId: tokenRow.realmId };
    } catch (err) {
      console.error("[QBO] Token refresh failed:", err);
      return null;
    }
  }

  return { accessToken: tokenRow.accessToken, realmId: tokenRow.realmId };
}

// ─── QBO API Client ───

export async function qboRequest(method: string, endpoint: string, body?: unknown) {
  const auth = await getValidAccessToken();
  if (!auth) throw new Error("No active QBO connection. Please connect to QuickBooks first.");

  const url = `${QBO_BASE_URL}/v3/company/${auth.realmId}/${endpoint}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${auth.accessToken}`,
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
    throw new Error(`QBO API error ${res.status}: ${errText}`);
  }

  return await res.json();
}

// ─── QBO Business Operations ───

export async function getCompanyInfo() {
  const auth = await getValidAccessToken();
  if (!auth) throw new Error("No active QBO connection");
  return await qboRequest("GET", `companyinfo/${auth.realmId}`);
}

export async function queryQbo(query: string) {
  return await qboRequest("GET", `query?query=${encodeURIComponent(query)}`);
}

export async function getVendors() {
  return await queryQbo("SELECT * FROM Vendor MAXRESULTS 1000");
}

export async function getAccounts() {
  return await queryQbo("SELECT * FROM Account MAXRESULTS 1000");
}

export async function createBill(bill: {
  vendorName: string;
  vendorId?: string;
  txnDate: string;
  dueDate?: string;
  lineItems: Array<{
    description: string;
    amount: number;
    accountId?: string;
    accountName?: string;
  }>;
  docNumber?: string;
}) {
  // Build the Bill object per QBO API spec
  const Line = bill.lineItems.map((item, idx) => ({
    Id: String(idx + 1),
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: item.amount,
    Description: item.description,
    AccountBasedExpenseLineDetail: {
      ...(item.accountId ? { AccountRef: { value: item.accountId, name: item.accountName || "" } } : {}),
    },
  }));

  const billPayload: Record<string, unknown> = {
    Line,
    VendorRef: bill.vendorId
      ? { value: bill.vendorId, name: bill.vendorName }
      : { name: bill.vendorName },
    TxnDate: bill.txnDate,
  };

  if (bill.dueDate) billPayload.DueDate = bill.dueDate;
  if (bill.docNumber) billPayload.DocNumber = bill.docNumber;

  return await qboRequest("POST", "bill", billPayload);
}

export async function createJournalEntry(entry: {
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
  }>;
}) {
  const Line = entry.lines.map((line, idx) => ({
    Id: String(idx + 1),
    DetailType: "JournalEntryLineDetail",
    Amount: line.amount,
    Description: line.description || "",
    JournalEntryLineDetail: {
      PostingType: line.postingType,
      AccountRef: { value: line.accountId, name: line.accountName || "" },
      ...(line.classId ? { ClassRef: { value: line.classId, name: line.className || "" } } : {}),
    },
  }));

  const jePayload: Record<string, unknown> = {
    Line,
    TxnDate: entry.txnDate,
  };

  if (entry.docNumber) jePayload.DocNumber = entry.docNumber;
  if (entry.privateNote) jePayload.PrivateNote = entry.privateNote;

  return await qboRequest("POST", "journalentry", jePayload);
}

// ─── QBO Chart of Accounts Operations ───

export type QboAccountType = "Bank" | "Other Current Asset" | "Fixed Asset" | "Other Asset" |
  "Accounts Receivable" | "Equity" | "Expense" | "Other Expense" | "Cost of Goods Sold" |
  "Accounts Payable" | "Credit Card" | "Long Term Liability" | "Other Current Liability" |
  "Income" | "Other Income";

export type QboAccountSubType = "Checking" | "Savings" | "CreditCard" | "MoneyMarket" |
  "RentsHeldInTrust" | "TrustAccounts" | "CashOnHand" | "OtherEarMarkedBankAccounts" |
  "OperatingExpenses" | "CostOfLaborCos" | "EquipmentRentalCos" | "OtherMiscServiceCost" |
  "SuppliesMaterials" | "SalesOfProductIncome" | "ServiceFeeIncome" | "OtherPrimaryIncome" |
  "PayrollExpenses" | "RentOrLeaseOfBuildings" | "Utilities" | "Insurance" |
  "AdvertisingPromotional" | "OfficeGeneralAdministrativeExpenses" | "TaxesPaid" |
  "AccountsPayable" | "AccountsReceivable" | "OtherCurrentLiabilities" | "RetainedEarnings" |
  "OpeningBalanceEquity" | string;

export interface QboAccount {
  Id: string;
  Name: string;
  AccountType: QboAccountType;
  AccountSubType: QboAccountSubType;
  FullyQualifiedName: string;
  Active: boolean;
  CurrentBalance: number;
  CurrencyRef?: { value: string; name: string };
  Classification: string;
  Description?: string;
  AcctNum?: string;
}

export async function getAccountsByType(accountType?: string): Promise<QboAccount[]> {
  let query = "SELECT * FROM Account";
  if (accountType) {
    query += ` WHERE AccountType = '${accountType}'`;
  }
  query += " MAXRESULTS 1000";
  const result = await queryQbo(query);
  return result?.QueryResponse?.Account || [];
}

export async function getBankAccounts(): Promise<QboAccount[]> {
  return getAccountsByType("Bank");
}

export async function getExpenseAccounts(): Promise<QboAccount[]> {
  return getAccountsByType("Expense");
}

export async function getAccountById(accountId: string): Promise<QboAccount | null> {
  const result = await qboRequest("GET", `account/${accountId}`);
  return result?.Account || null;
}

export async function createAccount(account: {
  name: string;
  accountType: QboAccountType;
  accountSubType?: QboAccountSubType;
  acctNum?: string;
  description?: string;
  currencyCode?: string;
}): Promise<QboAccount> {
  const payload: Record<string, unknown> = {
    Name: account.name,
    AccountType: account.accountType,
  };

  if (account.accountSubType) payload.AccountSubType = account.accountSubType;
  if (account.acctNum) payload.AcctNum = account.acctNum;
  if (account.description) payload.Description = account.description;
  if (account.currencyCode) {
    payload.CurrencyRef = { value: account.currencyCode };
  }

  const result = await qboRequest("POST", "account", payload);
  return result?.Account;
}

export async function updateAccount(accountId: string, syncToken: string, updates: {
  name?: string;
  description?: string;
  acctNum?: string;
  active?: boolean;
}): Promise<QboAccount> {
  // Must include Id and SyncToken for updates
  const payload: Record<string, unknown> = {
    Id: accountId,
    SyncToken: syncToken,
    sparse: true,
  };

  if (updates.name !== undefined) payload.Name = updates.name;
  if (updates.description !== undefined) payload.Description = updates.description;
  if (updates.acctNum !== undefined) payload.AcctNum = updates.acctNum;
  if (updates.active !== undefined) payload.Active = updates.active;

  const result = await qboRequest("POST", "account", payload);
  return result?.Account;
}

/**
 * Map local accountType to QBO AccountType and AccountSubType
 */
export function mapLocalToQboAccountType(localType: string): { accountType: QboAccountType; accountSubType: QboAccountSubType } {
  switch (localType) {
    case "checking":
      return { accountType: "Bank", accountSubType: "Checking" };
    case "savings":
      return { accountType: "Bank", accountSubType: "Savings" };
    case "credit_card":
      return { accountType: "Credit Card", accountSubType: "CreditCard" };
    default:
      return { accountType: "Bank", accountSubType: "Checking" };
  }
}

/**
 * Auto-create a bank account in QBO from local bank account data.
 * Returns the created QBO Account.
 */
export async function createBankAccountInQbo(bankAccount: {
  name: string;
  bankName?: string | null;
  accountNumber?: string | null;
  accountType: string;
  currency: string;
}): Promise<QboAccount> {
  const { accountType, accountSubType } = mapLocalToQboAccountType(bankAccount.accountType);

  return await createAccount({
    name: bankAccount.name,
    accountType,
    accountSubType,
    acctNum: bankAccount.accountNumber || undefined,
    description: bankAccount.bankName ? `${bankAccount.bankName} - ${bankAccount.name}` : bankAccount.name,
    currencyCode: bankAccount.currency || "CAD",
  });
}

export async function getQboConnectionStatus() {
  const tokenRow = await getActiveTokens();
  if (!tokenRow) {
    return { connected: false, realmId: null, companyName: null, expiresAt: null };
  }

  const now = new Date();
  const isExpired = tokenRow.refreshTokenExpiresAt < now;

  if (isExpired) {
    return { connected: false, realmId: tokenRow.realmId, companyName: tokenRow.companyName, expiresAt: null, error: "Refresh token expired — please reconnect" };
  }

  return {
    connected: true,
    realmId: tokenRow.realmId,
    companyName: tokenRow.companyName,
    accessTokenExpiresAt: tokenRow.accessTokenExpiresAt.getTime(),
    refreshTokenExpiresAt: tokenRow.refreshTokenExpiresAt.getTime(),
    connectedBy: tokenRow.connectedBy,
    updatedAt: tokenRow.updatedAt.getTime(),
  };
}
