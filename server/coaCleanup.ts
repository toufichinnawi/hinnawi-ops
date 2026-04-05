/**
 * Chart of Accounts Audit & Cleanup
 * 
 * Pulls CoA from all production QBO companies, analyzes:
 *   - Unused accounts (zero balance, no transactions)
 *   - Naming inconsistencies across companies
 *   - Duplicate or redundant accounts
 *   - Non-standard naming conventions
 * 
 * Provides:
 *   - Audit report with recommendations
 *   - Standardized naming suggestions
 *   - Script to rename/deactivate accounts via QBO API
 */
import { prodQboRequest, getProductionAccounts } from "./qboProduction";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface QBOAccount {
  Id: string;
  Name: string;
  FullyQualifiedName: string;
  AccountType: string;
  AccountSubType: string;
  Classification: string;
  CurrentBalance: number;
  CurrentBalanceWithSubAccounts: number;
  Active: boolean;
  SubAccount: boolean;
  ParentRef?: { value: string; name: string };
  Description?: string;
  AcctNum?: string;
}

export interface AccountAuditResult {
  realmId: string;
  companyName: string;
  account: QBOAccount;
  issues: string[];
  suggestedName?: string;
  action: "keep" | "rename" | "deactivate" | "review";
}

export interface CoAAuditReport {
  generatedAt: string;
  companies: Array<{
    realmId: string;
    companyName: string;
    totalAccounts: number;
    activeAccounts: number;
    inactiveAccounts: number;
    zeroBalanceAccounts: number;
    issues: AccountAuditResult[];
  }>;
  crossCompanyIssues: Array<{
    issue: string;
    details: string;
    affectedRealms: string[];
  }>;
  standardizedNames: Map<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PRODUCTION_REALMS = [
  { realmId: "9130346671806126", name: "PK/MK Cafe (Shared)" },
  { realmId: "123146517406139", name: "Ontario" },
  { realmId: "123146517409489", name: "Tunnel (CT)" },
];

// Standard naming convention for restaurant/cafe chart of accounts
const STANDARD_ACCOUNT_NAMES: Record<string, string> = {
  // Revenue
  "sales": "Sales Revenue",
  "revenue": "Sales Revenue",
  "food sales": "Food Sales Revenue",
  "beverage sales": "Beverage Sales Revenue",
  "catering": "Catering Revenue",
  "other income": "Other Income",
  "interest income": "Interest Income",

  // COGS
  "cost of goods sold": "Cost of Goods Sold",
  "cogs": "Cost of Goods Sold",
  "food cost": "Food Cost",
  "beverage cost": "Beverage Cost",
  "packaging": "Packaging & Disposables",

  // Operating Expenses
  "rent": "Rent Expense",
  "rent or lease": "Rent Expense",
  "rent expense": "Rent Expense",
  "utilities": "Utilities Expense",
  "insurance": "Insurance Expense",
  "insurance expense": "Insurance Expense",
  "repairs": "Repairs & Maintenance",
  "repairs and maintenance": "Repairs & Maintenance",
  "cleaning": "Cleaning & Maintenance",
  "cleaning & maintenance": "Cleaning & Maintenance",
  "office supplies": "Office Supplies",
  "office expenses": "Office Supplies",
  "advertising": "Marketing & Advertising",
  "marketing": "Marketing & Advertising",
  "professional fees": "Professional Fees",
  "legal & professional": "Professional Fees",
  "accounting": "Professional Fees",
  "bank charges": "Bank Charges & Fees",
  "bank service charges": "Bank Charges & Fees",
  "interest expense": "Interest Expense",
  "depreciation": "Depreciation Expense",
  "amortization": "Amortization Expense",
  "travel": "Travel & Transportation",
  "travel expense": "Travel & Transportation",
  "meals & entertainment": "Meals & Entertainment",
  "telephone": "Telephone & Internet",
  "computer and internet": "Technology & Software",
  "computer and internet expenses": "Technology & Software",
  "payroll expenses": "Payroll Expenses",
  "wages": "Wages & Salaries",
  "salaries": "Wages & Salaries",
  "employee benefits": "Employee Benefits",
  "training": "Training & Development",
  "licenses": "Licenses & Permits",
  "taxes and licences": "Taxes & Licenses",
  "miscellaneous": "Miscellaneous Expense",
  "miscellaneous expense": "Miscellaneous Expense",

  // Assets
  "cash on hand": "Cash on Hand",
  "petty cash": "Petty Cash",
  "undeposited funds": "Undeposited Funds",
  "accounts receivable": "Accounts Receivable",
  "inventory": "Inventory Asset",
  "prepaid expenses": "Prepaid Expenses",
  "equipment": "Equipment",
  "furniture & fixtures": "Furniture & Fixtures",
  "leasehold improvements": "Leasehold Improvements",
  "accumulated depreciation": "Accumulated Depreciation",

  // Liabilities
  "accounts payable": "Accounts Payable",
  "credit card": "Credit Card Payable",
  "gst payable": "GST/HST Payable",
  "gst/hst payable": "GST/HST Payable",
  "qst payable": "QST Payable",
  "payroll liabilities": "Payroll Liabilities",
  "loan payable": "Loan Payable",
  "line of credit": "Line of Credit",

  // Equity
  "opening balance equity": "Opening Balance Equity",
  "retained earnings": "Retained Earnings",
  "owner's equity": "Owner's Equity",
  "owner draws": "Owner's Draws",
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pull and audit Chart of Accounts from all production QBO companies.
 */
export async function auditAllCompanies(): Promise<CoAAuditReport> {
  const report: CoAAuditReport = {
    generatedAt: new Date().toISOString(),
    companies: [],
    crossCompanyIssues: [],
    standardizedNames: new Map(),
  };

  const allAccountsByRealm = new Map<string, QBOAccount[]>();

  for (const realm of PRODUCTION_REALMS) {
    try {
      const accounts = await getProductionAccounts(realm.realmId) as QBOAccount[];
      allAccountsByRealm.set(realm.realmId, accounts);

      const activeAccounts = accounts.filter(a => a.Active);
      const inactiveAccounts = accounts.filter(a => !a.Active);
      const zeroBalanceAccounts = activeAccounts.filter(a =>
        a.CurrentBalance === 0 && a.CurrentBalanceWithSubAccounts === 0
      );

      const issues: AccountAuditResult[] = [];

      for (const account of accounts) {
        const accountIssues: string[] = [];
        let suggestedName: string | undefined;
        let action: "keep" | "rename" | "deactivate" | "review" = "keep";

        // Check 1: Zero balance active accounts (potentially unused)
        if (account.Active && account.CurrentBalance === 0 && account.CurrentBalanceWithSubAccounts === 0) {
          // Don't flag system accounts or parent accounts
          if (!account.SubAccount && !["Accounts Receivable", "Accounts Payable", "Undeposited Funds",
            "Opening Balance Equity", "Retained Earnings", "Owner's Equity"].includes(account.Name)) {
            accountIssues.push("Zero balance — may be unused");
            action = "review";
          }
        }

        // Check 2: Inactive accounts
        if (!account.Active) {
          if (account.CurrentBalance !== 0) {
            accountIssues.push(`Inactive but has balance: $${account.CurrentBalance.toFixed(2)}`);
            action = "review";
          }
        }

        // Check 3: Naming convention
        const standardName = findStandardName(account.Name);
        if (standardName && standardName !== account.Name) {
          accountIssues.push(`Non-standard name. Suggested: "${standardName}"`);
          suggestedName = standardName;
          if (action === "keep") action = "rename";
        }

        // Check 4: Missing account number
        if (!account.AcctNum && account.Active) {
          accountIssues.push("Missing account number");
        }

        // Check 5: Vague or generic names
        const vagueNames = ["miscellaneous", "other", "general", "temp", "test", "uncategorized"];
        if (vagueNames.some(v => account.Name.toLowerCase().includes(v))) {
          accountIssues.push("Vague/generic account name — consider renaming or merging");
          if (action === "keep") action = "review";
        }

        if (accountIssues.length > 0) {
          issues.push({
            realmId: realm.realmId,
            companyName: realm.name,
            account,
            issues: accountIssues,
            suggestedName,
            action,
          });
        }
      }

      report.companies.push({
        realmId: realm.realmId,
        companyName: realm.name,
        totalAccounts: accounts.length,
        activeAccounts: activeAccounts.length,
        inactiveAccounts: inactiveAccounts.length,
        zeroBalanceAccounts: zeroBalanceAccounts.length,
        issues,
      });
    } catch (err: any) {
      report.companies.push({
        realmId: realm.realmId,
        companyName: realm.name,
        totalAccounts: 0,
        activeAccounts: 0,
        inactiveAccounts: 0,
        zeroBalanceAccounts: 0,
        issues: [{
          realmId: realm.realmId,
          companyName: realm.name,
          account: { Id: "0", Name: "ERROR", FullyQualifiedName: "", AccountType: "", AccountSubType: "", Classification: "", CurrentBalance: 0, CurrentBalanceWithSubAccounts: 0, Active: false },
          issues: [`Failed to fetch accounts: ${err.message}`],
          action: "review",
        }],
      });
    }
  }

  // Cross-company analysis
  report.crossCompanyIssues = analyzeCrossCompanyConsistency(allAccountsByRealm);

  return report;
}

/**
 * Find the standard name for a given account name.
 */
function findStandardName(accountName: string): string | undefined {
  const lower = accountName.toLowerCase().trim();
  return STANDARD_ACCOUNT_NAMES[lower];
}

/**
 * Analyze naming consistency across all companies.
 */
function analyzeCrossCompanyConsistency(
  accountsByRealm: Map<string, QBOAccount[]>,
): Array<{ issue: string; details: string; affectedRealms: string[] }> {
  const issues: Array<{ issue: string; details: string; affectedRealms: string[] }> = [];

  // Group accounts by type across all realms
  const accountsByType = new Map<string, Map<string, string[]>>(); // type -> name -> realms[]

  for (const [realmId, accounts] of accountsByRealm) {
    for (const account of accounts) {
      if (!account.Active) continue;
      const type = account.AccountType;
      if (!accountsByType.has(type)) accountsByType.set(type, new Map());
      const nameMap = accountsByType.get(type)!;
      const lower = account.Name.toLowerCase().trim();
      if (!nameMap.has(lower)) nameMap.set(lower, []);
      nameMap.get(lower)!.push(realmId);
    }
  }

  // Find accounts that exist in some companies but not others
  for (const [type, nameMap] of accountsByType) {
    for (const [name, realms] of nameMap) {
      if (realms.length > 0 && realms.length < PRODUCTION_REALMS.length) {
        // Account exists in some but not all companies
        const missingRealms = PRODUCTION_REALMS
          .filter(r => !realms.includes(r.realmId))
          .map(r => r.name);

        if (missingRealms.length > 0 && !["Opening Balance Equity", "Retained Earnings"].includes(name)) {
          issues.push({
            issue: `Account "${name}" (${type}) missing in some companies`,
            details: `Present in ${realms.length}/${PRODUCTION_REALMS.length} companies. Missing from: ${missingRealms.join(", ")}`,
            affectedRealms: realms,
          });
        }
      }
    }
  }

  // Find similar but differently named accounts across companies
  const allNames = new Map<string, Array<{ realmId: string; name: string }>>();
  for (const [realmId, accounts] of accountsByRealm) {
    for (const account of accounts) {
      if (!account.Active) continue;
      const normalized = account.Name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!allNames.has(normalized)) allNames.set(normalized, []);
      allNames.get(normalized)!.push({ realmId, name: account.Name });
    }
  }

  for (const [_, entries] of allNames) {
    if (entries.length > 1) {
      const uniqueNames = [...new Set(entries.map(e => e.name))];
      if (uniqueNames.length > 1) {
        issues.push({
          issue: `Inconsistent naming: ${uniqueNames.map(n => `"${n}"`).join(" vs ")}`,
          details: `Same account appears with different names across companies`,
          affectedRealms: entries.map(e => e.realmId),
        });
      }
    }
  }

  return issues;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rename an account in QBO.
 */
export async function renameAccount(
  realmId: string,
  accountId: string,
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // First, get the current account to get SyncToken
    const query = `SELECT * FROM Account WHERE Id = '${accountId}'`;
    const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
    const accounts = result?.QueryResponse?.Account || [];
    if (accounts.length === 0) return { success: false, error: "Account not found" };

    const account = accounts[0];

    // Update the account name
    const updatePayload = {
      Id: account.Id,
      SyncToken: account.SyncToken,
      Name: newName,
      AccountType: account.AccountType,
      // Preserve all other fields
      ...(account.AccountSubType ? { AccountSubType: account.AccountSubType } : {}),
      ...(account.AcctNum ? { AcctNum: account.AcctNum } : {}),
      ...(account.Description ? { Description: account.Description } : {}),
      ...(account.ParentRef ? { ParentRef: account.ParentRef } : {}),
      ...(account.SubAccount !== undefined ? { SubAccount: account.SubAccount } : {}),
    };

    await prodQboRequest(realmId, "POST", "account", updatePayload);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Deactivate (make inactive) an account in QBO.
 * Note: QBO doesn't allow deleting accounts, only deactivating.
 */
export async function deactivateAccount(
  realmId: string,
  accountId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const query = `SELECT * FROM Account WHERE Id = '${accountId}'`;
    const result = await prodQboRequest(realmId, "GET", `query?query=${encodeURIComponent(query)}`);
    const accounts = result?.QueryResponse?.Account || [];
    if (accounts.length === 0) return { success: false, error: "Account not found" };

    const account = accounts[0];

    if (account.CurrentBalance !== 0 || account.CurrentBalanceWithSubAccounts !== 0) {
      return { success: false, error: `Cannot deactivate: account has balance $${account.CurrentBalance}` };
    }

    const updatePayload = {
      Id: account.Id,
      SyncToken: account.SyncToken,
      Name: account.Name,
      AccountType: account.AccountType,
      Active: false,
      sparse: true,
    };

    await prodQboRequest(realmId, "POST", "account?operation=update", updatePayload);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Batch rename accounts across companies for standardization.
 */
export async function standardizeAccountNames(
  dryRun = true,
): Promise<Array<{ realmId: string; accountId: string; oldName: string; newName: string; success?: boolean; error?: string }>> {
  const results: Array<{ realmId: string; accountId: string; oldName: string; newName: string; success?: boolean; error?: string }> = [];

  for (const realm of PRODUCTION_REALMS) {
    try {
      const accounts = await getProductionAccounts(realm.realmId) as QBOAccount[];

      for (const account of accounts) {
        if (!account.Active) continue;
        const standardName = findStandardName(account.Name);
        if (standardName && standardName !== account.Name) {
          if (dryRun) {
            results.push({
              realmId: realm.realmId,
              accountId: account.Id,
              oldName: account.Name,
              newName: standardName,
            });
          } else {
            const renameResult = await renameAccount(realm.realmId, account.Id, standardName);
            results.push({
              realmId: realm.realmId,
              accountId: account.Id,
              oldName: account.Name,
              newName: standardName,
              success: renameResult.success,
              error: renameResult.error,
            });
          }
        }
      }
    } catch (err: any) {
      results.push({
        realmId: realm.realmId,
        accountId: "ERROR",
        oldName: "ERROR",
        newName: err.message,
      });
    }
  }

  return results;
}

/**
 * Generate a formatted audit report as markdown.
 */
export function formatAuditReport(report: CoAAuditReport): string {
  let md = `# Chart of Accounts Audit Report\n\n`;
  md += `**Generated:** ${report.generatedAt}\n\n`;

  for (const company of report.companies) {
    md += `## ${company.companyName} (${company.realmId})\n\n`;
    md += `| Metric | Count |\n|--------|-------|\n`;
    md += `| Total Accounts | ${company.totalAccounts} |\n`;
    md += `| Active | ${company.activeAccounts} |\n`;
    md += `| Inactive | ${company.inactiveAccounts} |\n`;
    md += `| Zero Balance (Active) | ${company.zeroBalanceAccounts} |\n`;
    md += `| Issues Found | ${company.issues.length} |\n\n`;

    if (company.issues.length > 0) {
      md += `### Issues\n\n`;
      md += `| Account | Type | Action | Issues |\n|---------|------|--------|--------|\n`;
      for (const issue of company.issues) {
        md += `| ${issue.account.Name} | ${issue.account.AccountType} | ${issue.action} | ${issue.issues.join("; ")} |\n`;
      }
      md += `\n`;
    }
  }

  if (report.crossCompanyIssues.length > 0) {
    md += `## Cross-Company Consistency Issues\n\n`;
    md += `| Issue | Details |\n|-------|--------|\n`;
    for (const issue of report.crossCompanyIssues) {
      md += `| ${issue.issue} | ${issue.details} |\n`;
    }
  }

  return md;
}
