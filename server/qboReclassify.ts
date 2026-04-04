/**
 * QBO Transaction Reclassification
 * 
 * Creates MK and PK as Locations (Departments) in QuickBooks company 9427-0659 Quebec Inc (realm 9130346671806126),
 * then reclassifies all transactions by assigning the correct location based on bank accounts:
 * - CIBC 553 → PK
 * - BMO 720 → MK
 */
import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Production QBO Configuration ───
const QBO_PROD_CLIENT_ID = "AB1l3yvNjbzID6Qjg6sWWxYh6bJLUjVDKqbcisw8KNkYMyAmlB";
const QBO_PROD_CLIENT_SECRET = "eur57dkXRw3ZDZMrhsDK5wFIiMlgx73WMfbQQxEa";
const QBO_BASE_URL = "https://quickbooks.api.intuit.com";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REALM_ID = "9130346671806126"; // 9427-0659 Quebec Inc (MK + PK shared company)

// ─── Token Management (reused from qboReports) ───

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

async function getValidToken(): Promise<string> {
  const tokenRow = await getTokensForRealm(REALM_ID);
  if (!tokenRow) throw new Error(`No active QBO tokens for realm ${REALM_ID}. Please connect this QuickBooks company first.`);

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

// ─── QBO API Helpers ───

async function qboGet(endpoint: string): Promise<any> {
  const token = await getValidToken();
  const url = `${QBO_BASE_URL}/v3/company/${REALM_ID}/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO GET ${endpoint} failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function qboPost(endpoint: string, body: any): Promise<any> {
  const token = await getValidToken();
  const url = `${QBO_BASE_URL}/v3/company/${REALM_ID}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO POST ${endpoint} failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

// ─── Step 1: Create Departments (Locations) ───

async function createOrGetDepartment(name: string): Promise<{ Id: string; Name: string }> {
  // First check if it already exists
  const query = await qboGet(`query?query=${encodeURIComponent(`SELECT * FROM Department WHERE Name = '${name}'`)}`);
  const existing = query?.QueryResponse?.Department;
  if (existing && existing.length > 0) {
    console.log(`[Reclassify] Department "${name}" already exists with ID ${existing[0].Id}`);
    return existing[0];
  }

  // Create new department
  const result = await qboPost("department", {
    Name: name,
    SubDepartment: false,
    FullyQualifiedName: name,
    Active: true,
  });
  console.log(`[Reclassify] Created Department "${name}" with ID ${result.Department.Id}`);
  return result.Department;
}

// ─── Step 2: Query All Accounts to Find Bank Accounts ───

async function findBankAccounts(): Promise<{ cibcAccountId: string | null; bmoAccountId: string | null; allAccounts: any[] }> {
  const query = await qboGet(`query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 1000")}`);
  const accounts = query?.QueryResponse?.Account || [];
  
  let cibcAccountId: string | null = null;
  let bmoAccountId: string | null = null;

  for (const acct of accounts) {
    const name = (acct.Name || "").toLowerCase();
    const acctNum = acct.AcctNum || "";
    console.log(`[Reclassify] Bank account: ${acct.Name} (ID: ${acct.Id}, AcctNum: ${acctNum})`);
    
    // CIBC 553 → PK
    if (name.includes("cibc") || acctNum.includes("553")) {
      cibcAccountId = acct.Id;
      console.log(`[Reclassify] → Identified CIBC 553 (PK): Account ID ${acct.Id}`);
    }
    // BMO 720 → MK
    if (name.includes("bmo") || acctNum.includes("720")) {
      bmoAccountId = acct.Id;
      console.log(`[Reclassify] → Identified BMO 720 (MK): Account ID ${acct.Id}`);
    }
  }

  return { cibcAccountId, bmoAccountId, allAccounts: accounts };
}

// ─── Step 3: Query and Reclassify Transactions ───

type TransactionType = "Purchase" | "Deposit" | "JournalEntry" | "Bill" | "Invoice" | "SalesReceipt" | "Payment" | "Expense" | "Transfer" | "VendorCredit" | "CreditMemo" | "RefundReceipt";

const TRANSACTION_TYPES: TransactionType[] = [
  "Purchase", "Deposit", "JournalEntry", "Bill", "Invoice", 
  "SalesReceipt", "Payment", "Expense", "Transfer",
  "VendorCredit", "CreditMemo", "RefundReceipt",
];

async function queryAllTransactions(txnType: string, startPosition = 1, maxResults = 1000): Promise<any[]> {
  try {
    const query = await qboGet(
      `query?query=${encodeURIComponent(`SELECT * FROM ${txnType} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`)}`
    );
    return query?.QueryResponse?.[txnType] || [];
  } catch (err: any) {
    console.log(`[Reclassify] Warning: Could not query ${txnType}: ${err.message}`);
    return [];
  }
}

function determineDepartment(
  txn: any,
  cibcAccountId: string | null,
  bmoAccountId: string | null,
  pkDeptId: string,
  mkDeptId: string,
): string | null {
  // Check the main account (AccountRef) on the transaction
  const mainAccountId = txn.AccountRef?.value;
  if (mainAccountId === cibcAccountId) return pkDeptId;
  if (mainAccountId === bmoAccountId) return mkDeptId;

  // Check BankAccountRef (for Purchases/Expenses)
  const bankAccountId = txn.BankAccountRef?.value;
  if (bankAccountId === cibcAccountId) return pkDeptId;
  if (bankAccountId === bmoAccountId) return mkDeptId;

  // Check DepositToAccountRef (for Deposits)
  const depositAccountId = txn.DepositToAccountRef?.value;
  if (depositAccountId === cibcAccountId) return pkDeptId;
  if (depositAccountId === bmoAccountId) return mkDeptId;

  // Check line items for bank account references
  const lines = txn.Line || [];
  for (const line of lines) {
    const lineAccountId = line?.JournalEntryLineDetail?.AccountRef?.value
      || line?.AccountBasedExpenseLineDetail?.AccountRef?.value
      || line?.DepositLineDetail?.AccountRef?.value
      || line?.SalesItemLineDetail?.ItemAccountRef?.value;
    if (lineAccountId === cibcAccountId) return pkDeptId;
    if (lineAccountId === bmoAccountId) return mkDeptId;
  }

  // Check account name patterns in line items
  for (const line of lines) {
    const accountName = (
      line?.JournalEntryLineDetail?.AccountRef?.name
      || line?.AccountBasedExpenseLineDetail?.AccountRef?.name
      || ""
    ).toLowerCase();
    if (accountName.includes("cibc") || accountName.includes("553")) return pkDeptId;
    if (accountName.includes("bmo") || accountName.includes("720")) return mkDeptId;
  }

  // Also check the transaction description/memo for hints
  const memo = (txn.PrivateNote || txn.Memo || "").toLowerCase();
  if (memo.includes("pk") || memo.includes("parc") || memo.includes("kennedy")) return pkDeptId;
  if (memo.includes("mk") || memo.includes("mackay")) return mkDeptId;

  return null; // Cannot determine — skip
}

async function updateTransactionDepartment(txnType: string, txn: any, departmentId: string): Promise<boolean> {
  try {
    // For most transaction types, we set DepartmentRef at the header level
    const updatedTxn = {
      ...txn,
      DepartmentRef: {
        value: departmentId,
      },
      sparse: true,
    };

    // For Journal Entries, we need to set DepartmentRef on each line
    if (txnType === "JournalEntry") {
      updatedTxn.Line = (txn.Line || []).map((line: any) => {
        if (line.JournalEntryLineDetail) {
          return {
            ...line,
            JournalEntryLineDetail: {
              ...line.JournalEntryLineDetail,
              DepartmentRef: { value: departmentId },
            },
          };
        }
        return line;
      });
    }

    // Use sparse update
    await qboPost(`${txnType.toLowerCase()}?operation=update`, updatedTxn);
    return true;
  } catch (err: any) {
    console.log(`[Reclassify] Failed to update ${txnType} #${txn.Id}: ${err.message}`);
    return false;
  }
}

// ─── Main Reclassification Function ───

export interface ReclassifyResult {
  departmentsPK: { Id: string; Name: string };
  departmentsMK: { Id: string; Name: string };
  bankAccounts: { cibc: string | null; bmo: string | null };
  totalTransactions: number;
  classified: number;
  skipped: number;
  errors: number;
  details: Array<{ type: string; id: string; department: string; success: boolean }>;
}

export async function reclassifyTransactions(): Promise<ReclassifyResult> {
  console.log("[Reclassify] Starting transaction reclassification for realm", REALM_ID);

  // Step 1: Create or get PK and MK departments
  const pkDept = await createOrGetDepartment("PK");
  const mkDept = await createOrGetDepartment("MK");

  // Step 2: Find bank accounts
  const { cibcAccountId, bmoAccountId, allAccounts } = await findBankAccounts();
  console.log(`[Reclassify] CIBC Account ID: ${cibcAccountId}, BMO Account ID: ${bmoAccountId}`);

  if (!cibcAccountId && !bmoAccountId) {
    console.log("[Reclassify] WARNING: Could not identify bank accounts. Listing all bank accounts:");
    for (const acct of allAccounts) {
      console.log(`  - ${acct.Name} (ID: ${acct.Id}, AcctNum: ${acct.AcctNum || "N/A"})`);
    }
  }

  // Step 3: Query and reclassify all transactions
  const result: ReclassifyResult = {
    departmentsPK: pkDept,
    departmentsMK: mkDept,
    bankAccounts: { cibc: cibcAccountId, bmo: bmoAccountId },
    totalTransactions: 0,
    classified: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const txnType of TRANSACTION_TYPES) {
    console.log(`[Reclassify] Processing ${txnType}...`);
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const transactions = await queryAllTransactions(txnType, startPosition, 500);
      if (transactions.length === 0) {
        hasMore = false;
        break;
      }

      for (const txn of transactions) {
        result.totalTransactions++;

        // Skip if already has a department assigned
        if (txn.DepartmentRef?.value) {
          result.skipped++;
          continue;
        }

        const deptId = determineDepartment(txn, cibcAccountId, bmoAccountId, pkDept.Id, mkDept.Id);
        if (!deptId) {
          result.skipped++;
          continue;
        }

        const deptName = deptId === pkDept.Id ? "PK" : "MK";
        const success = await updateTransactionDepartment(txnType, txn, deptId);
        
        if (success) {
          result.classified++;
        } else {
          result.errors++;
        }

        result.details.push({
          type: txnType,
          id: txn.Id,
          department: deptName,
          success,
        });

        // Rate limiting — QBO allows ~500 requests/minute
        if (result.classified % 50 === 0) {
          console.log(`[Reclassify] Progress: ${result.classified} classified, ${result.skipped} skipped, ${result.errors} errors`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2s pause every 50 updates
        }
      }

      startPosition += transactions.length;
      if (transactions.length < 500) hasMore = false;
    }
  }

  console.log(`[Reclassify] Complete! Total: ${result.totalTransactions}, Classified: ${result.classified}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
  return result;
}
