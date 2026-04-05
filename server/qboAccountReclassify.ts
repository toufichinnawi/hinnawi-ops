/**
 * QBO Account Reclassification
 * 
 * Reclassifies P&L accounts in QuickBooks for company 9427-0659 Quebec Inc
 * (realm 9130346671806126) so that each account has the correct AccountType
 * and AccountSubType. This ensures the QBO P&L report itself is properly
 * structured, and when the app refreshes, the data is already classified.
 * 
 * QBO AccountType values for P&L:
 *   - "Income" (Revenue)
 *   - "Cost of Goods Sold" (COGS)
 *   - "Expense" (Operating Expenses)
 *   - "Other Income"
 *   - "Other Expense"
 * 
 * QBO AccountSubType values we use:
 *   Income: SalesOfProductIncome, ServiceFeeIncome, OtherPrimaryIncome
 *   COGS: SuppliesMaterials, CostOfLaborCos, EquipmentRentalCos, OtherMiscServiceCost, ShippingFreightDeliveryCos
 *   Expense: PayrollExpenses, RentOrLeaseOfBuildings, Utilities, Insurance,
 *            AdvertisingPromotional, OfficeGeneralAdministrativeExpenses,
 *            RepairMaintenance, LegalProfessionalFees, Travel, Auto,
 *            TaxesPaid, OtherMiscellaneousExpense, Depreciation, InterestPaid,
 *            OperatingExpenses
 */
import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Production QBO Configuration ───
const QBO_PROD_CLIENT_ID = "AB1l3yvNjbzID6Qjg6sWWxYh6bJLUjVDKqbcisw8KNkYMyAmlB";
const QBO_PROD_CLIENT_SECRET = "eur57dkXRw3ZDZMrhsDK5wFIiMlgx73WMfbQQxEa";
const QBO_BASE_URL = "https://quickbooks.api.intuit.com";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REALM_ID = "9130346671806126"; // 9427-0659 Quebec Inc

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

// ─── Classification Rules ───

interface ClassificationRule {
  /** Regex pattern to match against account name (case-insensitive) */
  pattern: RegExp;
  /** Target QBO AccountType */
  accountType: string;
  /** Target QBO AccountSubType */
  accountSubType: string;
  /** Human-readable description of the rule */
  description: string;
}

/**
 * Classification rules applied in order. First match wins.
 * These determine what AccountType and AccountSubType each account should have in QBO.
 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ═══ INCOME / REVENUE ═══
  { pattern: /^(sales|revenue|income|ventes)/i, accountType: "Income", accountSubType: "SalesOfProductIncome", description: "Sales/Revenue" },

  // ═══ COST OF GOODS SOLD ═══
  { pattern: /beverage/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Beverages → COGS" },
  { pattern: /purchase.*ck|purchase.*general|purchase.*return|early.*payment.*purchase/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Purchases → COGS" },
  { pattern: /^5200\b|^5210\b|^5211\b/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Purchase subtotals → COGS" },
  { pattern: /disposable.*material/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Disposable Materials → COGS" },
  { pattern: /freight/i, accountType: "Cost of Goods Sold", accountSubType: "ShippingFreightDeliveryCos", description: "Freight → COGS" },
  { pattern: /laundry|linen/i, accountType: "Cost of Goods Sold", accountSubType: "OtherMiscServiceCost", description: "Laundry/Linen → COGS" },
  { pattern: /supplies.*cleaning|cleaning.*paper/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Cleaning Supplies → COGS" },
  { pattern: /small.*kitchen.*equip/i, accountType: "Cost of Goods Sold", accountSubType: "EquipmentRentalCos", description: "Small Kitchen Equipment → COGS" },
  { pattern: /coffee.*bean/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Coffee Beans → COGS" },
  { pattern: /cost.*goods.*sold/i, accountType: "Cost of Goods Sold", accountSubType: "SuppliesMaterials", description: "Cost of Goods Sold" },
  { pattern: /programme.*alimentation/i, accountType: "Cost of Goods Sold", accountSubType: "OtherMiscServiceCost", description: "Programme Alimentation → COGS" },
  { pattern: /delivery/i, accountType: "Cost of Goods Sold", accountSubType: "ShippingFreightDeliveryCos", description: "Delivery → COGS" },

  // ═══ OPERATING EXPENSES — PAYROLL ═══
  { pattern: /wages|salary|salaries|usalaries/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Wages/Salaries → Payroll" },
  { pattern: /tips/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Tips → Payroll" },
  { pattern: /payroll.*gov|payroll.*deduction/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Payroll Deductions → Payroll" },
  { pattern: /\bEI\b.*expense/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "EI Expense → Payroll" },
  { pattern: /\bQPP\b/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "QPP → Payroll" },
  { pattern: /\bCSS?T\b/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "CSST → Payroll" },
  { pattern: /\bQPIP\b/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "QPIP → Payroll" },
  { pattern: /vacation.*expense|vacation.*accrual/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Vacation Expense → Payroll" },
  { pattern: /stat.*holiday/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Stat Holiday → Payroll" },
  { pattern: /service.*charge.*payroll/i, accountType: "Expense", accountSubType: "PayrollExpenses", description: "Service Charges Payroll → Payroll" },

  // ═══ OPERATING EXPENSES — RENT ═══
  { pattern: /\brent\b/i, accountType: "Expense", accountSubType: "RentOrLeaseOfBuildings", description: "Rent → Rent/Occupancy" },

  // ═══ OPERATING EXPENSES — UTILITIES ═══
  { pattern: /electricity|heating/i, accountType: "Expense", accountSubType: "Utilities", description: "Electricity/Heating → Utilities" },
  { pattern: /telephone/i, accountType: "Expense", accountSubType: "Utilities", description: "Telephone → Utilities" },

  // ═══ OPERATING EXPENSES — MARKETING ═══
  { pattern: /marketing|advertisement|commission/i, accountType: "Expense", accountSubType: "AdvertisingPromotional", description: "Marketing/Advertising → Marketing" },

  // ═══ OPERATING EXPENSES — ROYALTIES & MANAGEMENT FEES ═══
  { pattern: /royalt/i, accountType: "Expense", accountSubType: "OperatingExpenses", description: "Royalties → Operating Expenses" },
  { pattern: /management.*fee/i, accountType: "Expense", accountSubType: "OperatingExpenses", description: "Management Fees → Operating Expenses" },

  // ═══ OPERATING EXPENSES — PROFESSIONAL FEES ═══
  { pattern: /accounting.*legal|legal.*fee/i, accountType: "Expense", accountSubType: "LegalProfessionalFees", description: "Accounting/Legal → Professional Fees" },

  // ═══ OPERATING EXPENSES — REPAIRS & MAINTENANCE ═══
  { pattern: /repair|maintenance|renovation/i, accountType: "Expense", accountSubType: "RepairMaintenance", description: "Repairs/Maintenance → Repairs" },

  // ═══ OPERATING EXPENSES — OFFICE / ADMIN ═══
  { pattern: /office.*suppli/i, accountType: "Expense", accountSubType: "OfficeGeneralAdministrativeExpenses", description: "Office Supplies → Office/Admin" },
  { pattern: /computer|security.*sys/i, accountType: "Expense", accountSubType: "OfficeGeneralAdministrativeExpenses", description: "Computer/Security → Office/Admin" },
  { pattern: /miscellaneous/i, accountType: "Expense", accountSubType: "OtherMiscellaneousExpense", description: "Miscellaneous → Other Misc" },

  // ═══ OPERATING EXPENSES — VEHICLE ═══
  { pattern: /car.*expense/i, accountType: "Expense", accountSubType: "Auto", description: "Car Expenses → Vehicle" },

  // ═══ OPERATING EXPENSES — DEPRECIATION ═══
  { pattern: /amortization|depreciation/i, accountType: "Expense", accountSubType: "Depreciation", description: "Amortization/Depreciation" },

  // ═══ OPERATING EXPENSES — INTEREST ═══
  { pattern: /interest.*bank.*charge|bank.*charge/i, accountType: "Expense", accountSubType: "InterestPaid", description: "Interest & Bank Charges" },

  // ═══ OPERATING EXPENSES — INSURANCE ═══
  { pattern: /insurance/i, accountType: "Expense", accountSubType: "Insurance", description: "Insurance" },
];

/**
 * Determine the correct AccountType and AccountSubType for a given account.
 * Returns null if no reclassification is needed (account type already correct or no rule matches).
 */
function classifyAccount(account: {
  Name: string;
  AcctNum?: string;
  AccountType: string;
  AccountSubType: string;
}): { accountType: string; accountSubType: string; rule: string } | null {
  const nameWithNum = account.AcctNum
    ? `${account.AcctNum} ${account.Name}`
    : account.Name;

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(nameWithNum)) {
      // Only return a reclassification if the type actually needs to change
      if (account.AccountType !== rule.accountType || account.AccountSubType !== rule.accountSubType) {
        return {
          accountType: rule.accountType,
          accountSubType: rule.accountSubType,
          rule: rule.description,
        };
      }
      // Already correct
      return null;
    }
  }

  return null; // No matching rule
}

// ─── Main Reclassification Function ───

export interface ReclassifyAccountsResult {
  totalAccounts: number;
  analyzed: number;
  reclassified: number;
  alreadyCorrect: number;
  noRuleMatch: number;
  skipped: number;
  errors: number;
  details: Array<{
    accountId: string;
    accountName: string;
    acctNum?: string;
    oldType: string;
    oldSubType: string;
    newType: string;
    newSubType: string;
    rule: string;
    status: "updated" | "error" | "skipped" | "already_correct" | "no_rule";
    error?: string;
  }>;
}

/**
 * Reclassify all P&L accounts in QBO for 9427-0659 Quebec Inc.
 * 
 * This function:
 * 1. Fetches all accounts from QBO
 * 2. Filters to P&L-related accounts (Income, COGS, Expense, Other Income, Other Expense)
 * 3. Applies classification rules to determine the correct AccountType and AccountSubType
 * 4. Updates accounts in QBO that need reclassification
 * 
 * @param dryRun If true, only analyzes without making changes. Default: false.
 */
export async function reclassifyAccounts(dryRun = false): Promise<ReclassifyAccountsResult> {
  console.log(`[AccountReclassify] Starting ${dryRun ? "DRY RUN" : "LIVE"} reclassification for realm ${REALM_ID}...`);

  // Step 1: Fetch all accounts
  const data = await qboGet(`query?query=${encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000")}`);
  const allAccounts: any[] = data?.QueryResponse?.Account || [];
  console.log(`[AccountReclassify] Fetched ${allAccounts.length} total accounts`);

  // Step 2: Filter to P&L accounts only (skip Balance Sheet accounts)
  const plTypes = new Set(["Income", "Cost of Goods Sold", "Expense", "Other Income", "Other Expense"]);
  const plAccounts = allAccounts.filter((a: any) => plTypes.has(a.AccountType));
  console.log(`[AccountReclassify] ${plAccounts.length} P&L accounts to analyze`);

  const result: ReclassifyAccountsResult = {
    totalAccounts: allAccounts.length,
    analyzed: plAccounts.length,
    reclassified: 0,
    alreadyCorrect: 0,
    noRuleMatch: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  // Step 3: Analyze and reclassify each account
  for (const account of plAccounts) {
    const classification = classifyAccount({
      Name: account.Name,
      AcctNum: account.AcctNum,
      AccountType: account.AccountType,
      AccountSubType: account.AccountSubType,
    });

    if (!classification) {
      // Check if a rule matched but type was already correct
      const nameWithNum = account.AcctNum ? `${account.AcctNum} ${account.Name}` : account.Name;
      const hasMatchingRule = CLASSIFICATION_RULES.some(r => r.pattern.test(nameWithNum));

      if (hasMatchingRule) {
        result.alreadyCorrect++;
        result.details.push({
          accountId: account.Id,
          accountName: account.Name,
          acctNum: account.AcctNum,
          oldType: account.AccountType,
          oldSubType: account.AccountSubType,
          newType: account.AccountType,
          newSubType: account.AccountSubType,
          rule: "Already correct",
          status: "already_correct",
        });
      } else {
        result.noRuleMatch++;
        result.details.push({
          accountId: account.Id,
          accountName: account.Name,
          acctNum: account.AcctNum,
          oldType: account.AccountType,
          oldSubType: account.AccountSubType,
          newType: account.AccountType,
          newSubType: account.AccountSubType,
          rule: "No matching rule",
          status: "no_rule",
        });
      }
      continue;
    }

    // Account needs reclassification
    if (dryRun) {
      result.reclassified++;
      result.details.push({
        accountId: account.Id,
        accountName: account.Name,
        acctNum: account.AcctNum,
        oldType: account.AccountType,
        oldSubType: account.AccountSubType,
        newType: classification.accountType,
        newSubType: classification.accountSubType,
        rule: classification.rule,
        status: "updated",
      });
      console.log(`[AccountReclassify] [DRY RUN] Would update "${account.Name}": ${account.AccountType}/${account.AccountSubType} → ${classification.accountType}/${classification.accountSubType} (${classification.rule})`);
      continue;
    }

    // LIVE: Update the account in QBO
    try {
      // QBO requires full account object for type changes (sparse update may not work for AccountType)
      const updatePayload: any = {
        Id: account.Id,
        SyncToken: account.SyncToken,
        Name: account.Name,
        AccountType: classification.accountType,
        AccountSubType: classification.accountSubType,
      };

      // Preserve existing fields
      if (account.AcctNum) updatePayload.AcctNum = account.AcctNum;
      if (account.Description) updatePayload.Description = account.Description;
      if (account.Active !== undefined) updatePayload.Active = account.Active;
      if (account.SubAccount) {
        updatePayload.SubAccount = account.SubAccount;
        if (account.ParentRef) updatePayload.ParentRef = account.ParentRef;
      }
      if (account.CurrencyRef) updatePayload.CurrencyRef = account.CurrencyRef;

      await qboPost("account", updatePayload);

      result.reclassified++;
      result.details.push({
        accountId: account.Id,
        accountName: account.Name,
        acctNum: account.AcctNum,
        oldType: account.AccountType,
        oldSubType: account.AccountSubType,
        newType: classification.accountType,
        newSubType: classification.accountSubType,
        rule: classification.rule,
        status: "updated",
      });
      console.log(`[AccountReclassify] Updated "${account.Name}": ${account.AccountType}/${account.AccountSubType} → ${classification.accountType}/${classification.accountSubType}`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err: any) {
      result.errors++;
      result.details.push({
        accountId: account.Id,
        accountName: account.Name,
        acctNum: account.AcctNum,
        oldType: account.AccountType,
        oldSubType: account.AccountSubType,
        newType: classification.accountType,
        newSubType: classification.accountSubType,
        rule: classification.rule,
        status: "error",
        error: err.message,
      });
      console.error(`[AccountReclassify] ERROR updating "${account.Name}": ${err.message}`);
    }
  }

  console.log(`[AccountReclassify] Complete! Reclassified: ${result.reclassified}, Already correct: ${result.alreadyCorrect}, No rule: ${result.noRuleMatch}, Errors: ${result.errors}`);
  return result;
}
