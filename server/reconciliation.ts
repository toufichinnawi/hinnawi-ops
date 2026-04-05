/**
 * Bank & Credit Card Reconciliation Engine
 * 
 * Auto-matches bank/credit card transactions to internal records:
 *   - Deposits ↔ dailySales (by date + amount proximity)
 *   - Debits ↔ invoices/supplier payments (by amount + vendor name)
 *   - Payroll debits ↔ payrollRecords (by date + amount)
 *   - Tax payments (GST/QST keywords)
 *   - Inter-company transfers
 * 
 * Also handles:
 *   - Credit card transaction classification (expense category + location)
 *   - Push classified expenses to QBO as Bills or Expenses
 *   - Reconciliation summary and reporting
 */
import { getDb } from "./db";
import {
  bankTransactions, bankAccounts, dailySales, invoices, payrollRecords,
  locations, suppliers
} from "../drizzle/schema";
import { eq, and, between, sql, desc, asc, isNull, inArray } from "drizzle-orm";
import { prodQboRequest, findAccountByName, resolveClassId } from "./qboProduction";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MatchResult {
  bankTxnId: number;
  matchedType: "sales_deposit" | "payroll" | "supplier_payment" | "tax_payment" | "intercompany" | "loan" | "other";
  matchedRecordId?: number;
  confidence: number; // 0-100
  matchReason: string;
  suggestedCategory?: string;
  suggestedLocationId?: number;
}

export interface ReconciliationSummary {
  totalTransactions: number;
  matched: number;
  unmatched: number;
  matchedByType: Record<string, number>;
  totalDebits: number;
  totalCredits: number;
  matchedDebits: number;
  matchedCredits: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSE CATEGORIES (for credit card classification)
// ═══════════════════════════════════════════════════════════════════════════════

export const EXPENSE_CATEGORIES = [
  { value: "food_supplies", label: "Food & Supplies", qboAccountName: "Cost of Goods Sold" },
  { value: "beverages", label: "Beverages", qboAccountName: "Cost of Goods Sold" },
  { value: "packaging", label: "Packaging & Disposables", qboAccountName: "Cost of Goods Sold" },
  { value: "cleaning", label: "Cleaning Supplies", qboAccountName: "Cleaning & Maintenance" },
  { value: "equipment", label: "Equipment & Smallwares", qboAccountName: "Equipment" },
  { value: "repairs", label: "Repairs & Maintenance", qboAccountName: "Repairs and Maintenance" },
  { value: "utilities", label: "Utilities", qboAccountName: "Utilities" },
  { value: "rent", label: "Rent", qboAccountName: "Rent or Lease" },
  { value: "insurance", label: "Insurance", qboAccountName: "Insurance" },
  { value: "marketing", label: "Marketing & Advertising", qboAccountName: "Advertising" },
  { value: "office", label: "Office Supplies", qboAccountName: "Office Supplies" },
  { value: "technology", label: "Technology & Software", qboAccountName: "Computer and Internet Expenses" },
  { value: "travel", label: "Travel & Transportation", qboAccountName: "Travel" },
  { value: "professional", label: "Professional Services", qboAccountName: "Professional Fees" },
  { value: "bank_fees", label: "Bank Fees & Interest", qboAccountName: "Bank Charges" },
  { value: "payroll_related", label: "Payroll Related", qboAccountName: "Payroll Expenses" },
  { value: "taxes", label: "Taxes & Licenses", qboAccountName: "Taxes and Licences" },
  { value: "other", label: "Other Expense", qboAccountName: "Miscellaneous Expense" },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-MATCHING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// Keyword patterns for auto-classification
const PAYROLL_KEYWORDS = ["payroll", "paychex", "adp", "ceridian", "desjardins payroll", "wagepoint", "humi", "salary", "wages"];
const TAX_KEYWORDS = ["gst", "qst", "hst", "cra", "revenu quebec", "revenue canada", "tax remittance", "source deductions"];
const INTERCOMPANY_KEYWORDS = ["transfer", "hinnawi", "pk cafe", "mk cafe", "tunnel", "ontario"];
const LOAN_KEYWORDS = ["loan", "mortgage", "line of credit", "loc payment", "interest payment"];
const BANK_FEE_KEYWORDS = ["service charge", "monthly fee", "nsf", "overdraft", "wire fee", "bank charge"];

function matchesKeywords(description: string, keywords: string[]): boolean {
  const lower = description.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

/**
 * Auto-match a single bank transaction against internal records.
 */
async function autoMatchTransaction(
  txn: {
    id: number;
    transactionDate: string | Date | null;
    description: string | null;
    debit: string | null;
    credit: string | null;
    locationId: number | null;
    accountName: string | null;
    bankAccountId: number | null;
  },
  salesByDate: Map<string, Array<{ id: number; locationId: number; totalDeposit: string; totalSales: string }>>,
  invoicesByAmount: Map<string, Array<{ id: number; supplierId: number | null; total: string; supplierName?: string }>>,
  payrollByDate: Map<string, Array<{ id: number; locationId: number; netPayroll: string; grossWages: string }>>,
): Promise<MatchResult | null> {
  const desc = (txn.description || "").toLowerCase();
  const txnDate = txn.transactionDate ? new Date(txn.transactionDate).toISOString().slice(0, 10) : null;
  const debitAmt = Number(txn.debit || 0);
  const creditAmt = Number(txn.credit || 0);
  const isDebit = debitAmt > 0;
  const amount = isDebit ? debitAmt : creditAmt;

  if (!txnDate || amount === 0) return null;

  // 1. DEPOSIT → Daily Sales match (credits only)
  if (!isDebit && creditAmt > 0) {
    // Check same day and nearby days (±1 day for processing delay)
    for (const dayOffset of [0, -1, 1, -2, 2]) {
      const checkDate = new Date(txnDate);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      const checkDateStr = checkDate.toISOString().slice(0, 10);
      const daySales = salesByDate.get(checkDateStr);
      if (!daySales) continue;

      for (const sale of daySales) {
        const depositAmt = Number(sale.totalDeposit || sale.totalSales);
        const diff = Math.abs(creditAmt - depositAmt);
        const pctDiff = depositAmt > 0 ? (diff / depositAmt) * 100 : 100;

        // Exact match
        if (diff < 0.01) {
          return {
            bankTxnId: txn.id,
            matchedType: "sales_deposit",
            matchedRecordId: sale.id,
            confidence: dayOffset === 0 ? 98 : 90,
            matchReason: `Exact deposit match: ${creditAmt.toFixed(2)} = daily sales deposit for ${checkDateStr}`,
            suggestedLocationId: sale.locationId,
          };
        }

        // Close match (within 5% — accounts for merchant fees)
        if (pctDiff < 5 && dayOffset <= 1) {
          return {
            bankTxnId: txn.id,
            matchedType: "sales_deposit",
            matchedRecordId: sale.id,
            confidence: 75 - dayOffset * 10,
            matchReason: `Close deposit match: ${creditAmt.toFixed(2)} ≈ ${depositAmt.toFixed(2)} (${pctDiff.toFixed(1)}% diff) for ${checkDateStr}`,
            suggestedLocationId: sale.locationId,
          };
        }
      }
    }
  }

  // 2. PAYROLL match (debits)
  if (isDebit && matchesKeywords(desc, PAYROLL_KEYWORDS)) {
    for (const dayOffset of [0, -1, 1, -2, 2]) {
      const checkDate = new Date(txnDate);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      const checkDateStr = checkDate.toISOString().slice(0, 10);
      const dayPayroll = payrollByDate.get(checkDateStr);
      if (!dayPayroll) continue;

      for (const pr of dayPayroll) {
        const netAmt = Number(pr.netPayroll);
        const grossAmt = Number(pr.grossWages);
        if (Math.abs(debitAmt - netAmt) < 0.01 || Math.abs(debitAmt - grossAmt) < 0.01) {
          return {
            bankTxnId: txn.id,
            matchedType: "payroll",
            matchedRecordId: pr.id,
            confidence: dayOffset === 0 ? 95 : 85,
            matchReason: `Payroll match: ${debitAmt.toFixed(2)} = payroll for ${checkDateStr}`,
            suggestedLocationId: pr.locationId,
            suggestedCategory: "payroll_related",
          };
        }
      }
    }
    // Even without amount match, keyword is strong signal
    return {
      bankTxnId: txn.id,
      matchedType: "payroll",
      confidence: 60,
      matchReason: `Payroll keyword detected in: "${txn.description}"`,
      suggestedCategory: "payroll_related",
    };
  }

  // 3. SUPPLIER PAYMENT match (debits)
  if (isDebit) {
    const amtKey = debitAmt.toFixed(2);
    const matchingInvoices = invoicesByAmount.get(amtKey);
    if (matchingInvoices && matchingInvoices.length > 0) {
      // Try to match by vendor name in description
      for (const inv of matchingInvoices) {
        const supplierName = (inv.supplierName || "").toLowerCase();
        if (supplierName && desc.includes(supplierName.slice(0, 6))) {
          return {
            bankTxnId: txn.id,
            matchedType: "supplier_payment",
            matchedRecordId: inv.id,
            confidence: 90,
            matchReason: `Supplier payment: ${debitAmt.toFixed(2)} matches invoice from ${inv.supplierName}`,
            suggestedCategory: "food_supplies",
          };
        }
      }
      // Amount match without vendor name
      if (matchingInvoices.length === 1) {
        return {
          bankTxnId: txn.id,
          matchedType: "supplier_payment",
          matchedRecordId: matchingInvoices[0].id,
          confidence: 65,
          matchReason: `Amount match: ${debitAmt.toFixed(2)} matches single invoice`,
          suggestedCategory: "food_supplies",
        };
      }
    }
  }

  // 4. TAX PAYMENT
  if (isDebit && matchesKeywords(desc, TAX_KEYWORDS)) {
    return {
      bankTxnId: txn.id,
      matchedType: "tax_payment",
      confidence: 80,
      matchReason: `Tax payment keyword detected: "${txn.description}"`,
      suggestedCategory: "taxes",
    };
  }

  // 5. INTER-COMPANY TRANSFER
  if (matchesKeywords(desc, INTERCOMPANY_KEYWORDS)) {
    return {
      bankTxnId: txn.id,
      matchedType: "intercompany",
      confidence: 70,
      matchReason: `Inter-company keyword detected: "${txn.description}"`,
    };
  }

  // 6. LOAN / LINE OF CREDIT
  if (isDebit && matchesKeywords(desc, LOAN_KEYWORDS)) {
    return {
      bankTxnId: txn.id,
      matchedType: "loan",
      confidence: 70,
      matchReason: `Loan/LOC keyword detected: "${txn.description}"`,
    };
  }

  // 7. BANK FEES
  if (isDebit && matchesKeywords(desc, BANK_FEE_KEYWORDS)) {
    return {
      bankTxnId: txn.id,
      matchedType: "other",
      confidence: 75,
      matchReason: `Bank fee detected: "${txn.description}"`,
      suggestedCategory: "bank_fees",
    };
  }

  return null;
}

/**
 * Run auto-matching on all unmatched bank transactions.
 * Returns match results and a summary.
 */
export async function runAutoMatch(bankAccountId?: number, locationId?: number): Promise<{
  matches: MatchResult[];
  summary: ReconciliationSummary;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1. Get unmatched transactions
  let conditions: any[] = [eq(bankTransactions.matchedType, "unmatched")];
  if (bankAccountId) conditions.push(eq(bankTransactions.bankAccountId, bankAccountId));
  if (locationId) conditions.push(eq(bankTransactions.locationId, locationId));

  const unmatchedTxns = await db.select().from(bankTransactions)
    .where(and(...conditions))
    .orderBy(asc(bankTransactions.transactionDate));

  // 2. Build lookup maps for matching targets

  // Daily sales by date
  const allSales = await db.select().from(dailySales);
  const salesByDate = new Map<string, Array<{ id: number; locationId: number; totalDeposit: string; totalSales: string }>>();
  for (const s of allSales) {
    const dateStr = s.saleDate ? new Date(s.saleDate).toISOString().slice(0, 10) : null;
    if (!dateStr) continue;
    if (!salesByDate.has(dateStr)) salesByDate.set(dateStr, []);
    salesByDate.get(dateStr)!.push({
      id: s.id,
      locationId: s.locationId,
      totalDeposit: String(s.totalDeposit || "0"),
      totalSales: String(s.totalSales || "0"),
    });
  }

  // Invoices by total amount (for supplier payment matching)
  const allInvoices = await db.select({
    id: invoices.id,
    supplierId: invoices.supplierId,
    total: invoices.total,
    supplierName: sql<string>`(SELECT name FROM suppliers WHERE id = ${invoices.supplierId})`,
  }).from(invoices).where(eq(invoices.status, "approved"));

  const invoicesByAmount = new Map<string, Array<{ id: number; supplierId: number | null; total: string; supplierName?: string }>>();
  for (const inv of allInvoices) {
    const key = Number(inv.total || 0).toFixed(2);
    if (!invoicesByAmount.has(key)) invoicesByAmount.set(key, []);
    invoicesByAmount.get(key)!.push({
      id: inv.id,
      supplierId: inv.supplierId,
      total: String(inv.total || "0"),
      supplierName: inv.supplierName || undefined,
    });
  }

  // Payroll by date
  const allPayroll = await db.select().from(payrollRecords);
  const payrollByDate = new Map<string, Array<{ id: number; locationId: number; netPayroll: string; grossWages: string }>>();
  for (const pr of allPayroll) {
    const dateStr = pr.payDate ? new Date(pr.payDate).toISOString().slice(0, 10) : null;
    if (!dateStr) continue;
    if (!payrollByDate.has(dateStr)) payrollByDate.set(dateStr, []);
    payrollByDate.get(dateStr)!.push({
      id: pr.id,
      locationId: pr.locationId,
      netPayroll: String(pr.netPayroll || "0"),
      grossWages: String(pr.grossWages || "0"),
    });
  }

  // 3. Run matching
  const matches: MatchResult[] = [];
  for (const txn of unmatchedTxns) {
    const match = await autoMatchTransaction(
      {
        id: txn.id,
        transactionDate: txn.transactionDate,
        description: txn.description,
        debit: String(txn.debit || "0"),
        credit: String(txn.credit || "0"),
        locationId: txn.locationId,
        accountName: txn.accountName,
        bankAccountId: txn.bankAccountId,
      },
      salesByDate,
      invoicesByAmount,
      payrollByDate,
    );
    if (match) matches.push(match);
  }

  // 4. Compute summary
  const allTxns = await db.select().from(bankTransactions);
  const matchedCount = allTxns.filter(t => t.matchedType !== "unmatched").length;
  const unmatchedCount = allTxns.filter(t => t.matchedType === "unmatched").length;

  const matchedByType: Record<string, number> = {};
  for (const t of allTxns) {
    if (t.matchedType && t.matchedType !== "unmatched") {
      matchedByType[t.matchedType] = (matchedByType[t.matchedType] || 0) + 1;
    }
  }

  const summary: ReconciliationSummary = {
    totalTransactions: allTxns.length,
    matched: matchedCount + matches.length,
    unmatched: unmatchedCount - matches.length,
    matchedByType,
    totalDebits: allTxns.reduce((s, t) => s + Number(t.debit || 0), 0),
    totalCredits: allTxns.reduce((s, t) => s + Number(t.credit || 0), 0),
    matchedDebits: allTxns.filter(t => t.matchedType !== "unmatched" && Number(t.debit || 0) > 0)
      .reduce((s, t) => s + Number(t.debit || 0), 0),
    matchedCredits: allTxns.filter(t => t.matchedType !== "unmatched" && Number(t.credit || 0) > 0)
      .reduce((s, t) => s + Number(t.credit || 0), 0),
  };

  return { matches, summary };
}

/**
 * Apply match results — update bank transactions with matched type and record ID.
 * Only applies matches above the confidence threshold.
 */
export async function applyMatches(matches: MatchResult[], minConfidence = 70): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let applied = 0;
  for (const match of matches) {
    if (match.confidence < minConfidence) continue;

    await db.update(bankTransactions).set({
      matchedType: match.matchedType as any,
      matchedRecordId: match.matchedRecordId || null,
      category: match.suggestedCategory || null,
      locationId: match.suggestedLocationId || undefined,
    } as any).where(eq(bankTransactions.id, match.bankTxnId));

    applied++;
  }
  return applied;
}

/**
 * Manually classify a bank/credit card transaction.
 */
export async function classifyTransaction(
  txnId: number,
  data: {
    matchedType: string;
    category?: string;
    locationId?: number;
    notes?: string;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(bankTransactions).set({
    matchedType: data.matchedType as any,
    category: data.category || null,
    locationId: data.locationId || null,
    notes: data.notes || null,
  } as any).where(eq(bankTransactions.id, txnId));
}

/**
 * Bulk classify multiple transactions at once.
 */
export async function bulkClassifyTransactions(
  txnIds: number[],
  data: {
    matchedType: string;
    category?: string;
    locationId?: number;
  },
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(bankTransactions).set({
    matchedType: data.matchedType as any,
    category: data.category || null,
    locationId: data.locationId || null,
  } as any).where(inArray(bankTransactions.id, txnIds));

  return txnIds.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECONCILIATION QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get bank transactions with filters for the reconciliation dashboard.
 */
export async function getFilteredBankTransactions(filters: {
  bankAccountId?: number;
  locationId?: number;
  matchedType?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [];
  if (filters.bankAccountId) conditions.push(eq(bankTransactions.bankAccountId, filters.bankAccountId));
  if (filters.locationId) conditions.push(eq(bankTransactions.locationId, filters.locationId));
  if (filters.matchedType) conditions.push(eq(bankTransactions.matchedType, filters.matchedType as any));
  if (filters.startDate) conditions.push(sql`${bankTransactions.transactionDate} >= ${filters.startDate}`);
  if (filters.endDate) conditions.push(sql`${bankTransactions.transactionDate} <= ${filters.endDate}`);

  const query = db.select().from(bankTransactions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bankTransactions.transactionDate))
    .limit(filters.limit || 500);

  return query;
}

/**
 * Get reconciliation summary for a bank account.
 */
export async function getReconciliationSummary(bankAccountId?: number): Promise<ReconciliationSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: any[] = [];
  if (bankAccountId) conditions.push(eq(bankTransactions.bankAccountId, bankAccountId));

  const allTxns = await db.select().from(bankTransactions)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const matched = allTxns.filter(t => t.matchedType !== "unmatched");
  const unmatched = allTxns.filter(t => t.matchedType === "unmatched");

  const matchedByType: Record<string, number> = {};
  for (const t of matched) {
    matchedByType[t.matchedType!] = (matchedByType[t.matchedType!] || 0) + 1;
  }

  return {
    totalTransactions: allTxns.length,
    matched: matched.length,
    unmatched: unmatched.length,
    matchedByType,
    totalDebits: allTxns.reduce((s, t) => s + Number(t.debit || 0), 0),
    totalCredits: allTxns.reduce((s, t) => s + Number(t.credit || 0), 0),
    matchedDebits: matched.filter(t => Number(t.debit || 0) > 0).reduce((s, t) => s + Number(t.debit || 0), 0),
    matchedCredits: matched.filter(t => Number(t.credit || 0) > 0).reduce((s, t) => s + Number(t.credit || 0), 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QBO EXPENSE PUSH (for credit card transactions)
// ═══════════════════════════════════════════════════════════════════════════════

// Location → QBO realm mapping (same as revenueJePipeline)
const LOCATION_REALM_MAP: Record<number, { realmId: string; department?: string }> = {
  1: { realmId: "9130346671806126", department: "PK" },   // PK Cafe
  2: { realmId: "9130346671806126", department: "MK" },   // MK Cafe
  3: { realmId: "123146517406139" },                       // Ontario
  4: { realmId: "123146517409489" },                       // Tunnel (CT)
};

/**
 * Push a classified credit card transaction to QBO as an Expense.
 * Creates a Purchase (Expense) in the correct QBO company based on location.
 */
export async function pushExpenseToQBO(
  txnId: number,
  options: {
    locationId: number;
    category: string;
    vendorName?: string;
    memo?: string;
  },
): Promise<{ success: boolean; qboId?: string; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  // Get the transaction
  const txnRows = await db.select().from(bankTransactions).where(eq(bankTransactions.id, txnId));
  if (txnRows.length === 0) return { success: false, error: "Transaction not found" };
  const txn = txnRows[0];

  const amount = Number(txn.debit || 0);
  if (amount <= 0) return { success: false, error: "Only debit transactions can be pushed as expenses" };

  // Resolve QBO realm
  const realmInfo = LOCATION_REALM_MAP[options.locationId];
  if (!realmInfo) return { success: false, error: `No QBO realm configured for location ${options.locationId}` };

  // Find the expense account by category
  const categoryDef = EXPENSE_CATEGORIES.find(c => c.value === options.category);
  if (!categoryDef) return { success: false, error: `Unknown expense category: ${options.category}` };

  try {
    const account = await findAccountByName(realmInfo.realmId, categoryDef.qboAccountName);
    if (!account) return { success: false, error: `QBO account "${categoryDef.qboAccountName}" not found in realm ${realmInfo.realmId}` };

    // Find credit card account in QBO
    const ccAccount = await findAccountByName(realmInfo.realmId, "Credit Card");

    // Build the Purchase (Expense) payload
    const lineDetail: Record<string, unknown> = {
      AccountRef: { value: account.Id, name: account.Name },
    };

    // Add department/class if applicable
    if (realmInfo.department) {
      const classId = await resolveClassId(realmInfo.realmId, realmInfo.department);
      if (classId) {
        lineDetail.ClassRef = { value: classId, name: realmInfo.department };
      }
    }

    const purchasePayload: Record<string, unknown> = {
      PaymentType: "CreditCard",
      TxnDate: txn.transactionDate ? new Date(txn.transactionDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      Line: [{
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: amount,
        Description: options.memo || txn.description || "",
        AccountBasedExpenseLineDetail: lineDetail,
      }],
      AccountRef: ccAccount ? { value: ccAccount.Id, name: ccAccount.Name } : undefined,
    };

    if (options.memo) purchasePayload.PrivateNote = options.memo;

    // Find or reference vendor
    if (options.vendorName) {
      const vendorQuery = `SELECT * FROM Vendor WHERE DisplayName LIKE '%${options.vendorName.replace(/'/g, "\\'")}%' MAXRESULTS 1`;
      const vendorResult = await prodQboRequest(realmInfo.realmId, "GET", `query?query=${encodeURIComponent(vendorQuery)}`);
      const vendors = vendorResult?.QueryResponse?.Vendor || [];
      if (vendors.length > 0) {
        purchasePayload.EntityRef = { value: vendors[0].Id, name: vendors[0].DisplayName, type: "Vendor" };
      }
    }

    // Create the Purchase in QBO
    const result = await prodQboRequest(realmInfo.realmId, "POST", "purchase", purchasePayload);
    const qboId = result?.Purchase?.Id;

    // Update the bank transaction with QBO sync info
    await db.update(bankTransactions).set({
      matchedType: "supplier_payment" as any,
      category: options.category,
      locationId: options.locationId,
      matchedRecordId: qboId ? Number(qboId) : null,
      notes: `Pushed to QBO as Purchase #${qboId || "unknown"}`,
    } as any).where(eq(bankTransactions.id, txnId));

    return { success: true, qboId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Bulk push multiple classified credit card transactions to QBO.
 */
export async function bulkPushExpensesToQBO(
  txnIds: number[],
  locationId: number,
  category: string,
): Promise<{ pushed: number; failed: number; errors: string[] }> {
  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const txnId of txnIds) {
    const result = await pushExpenseToQBO(txnId, { locationId, category });
    if (result.success) {
      pushed++;
    } else {
      failed++;
      errors.push(`Txn #${txnId}: ${result.error}`);
    }
  }

  return { pushed, failed, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTER-COMPANY CREDIT CARD TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get credit card spending breakdown by location (for inter-company settlement).
 */
export async function getCreditCardByLocation(bankAccountId: number): Promise<Array<{
  locationId: number | null;
  locationName: string;
  totalSpent: number;
  txnCount: number;
  unclassified: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      bt.locationId,
      COALESCE(l.name, 'Unassigned') as locationName,
      SUM(CAST(bt.debit AS DECIMAL(12,2))) as totalSpent,
      COUNT(*) as txnCount,
      SUM(CASE WHEN bt.matchedType = 'unmatched' THEN 1 ELSE 0 END) as unclassified
    FROM bankTransactions bt
    LEFT JOIN locations l ON l.id = bt.locationId
    WHERE bt.bankAccountId = ${bankAccountId}
      AND CAST(bt.debit AS DECIMAL(12,2)) > 0
    GROUP BY bt.locationId, l.name
    ORDER BY totalSpent DESC
  `);

  return ((result as any)[0] || []).map((r: any) => ({
    locationId: r.locationId,
    locationName: r.locationName,
    totalSpent: Number(r.totalSpent || 0),
    txnCount: Number(r.txnCount || 0),
    unclassified: Number(r.unclassified || 0),
  }));
}
