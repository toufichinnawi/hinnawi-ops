import { getDb } from "./db";
import {
  qboEntities, qboAccountCache, accountMappingVersions, accountMappings,
  accountMappingAudit, fsLineDefinitions, sharedExpenses, sharedExpenseAllocations,
  qboReportCache, dailySales, locations,
} from "../drizzle/schema";
import { eq, and, desc, asc, sql, gte, lte, inArray, isNull } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
// QBO ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getQboEntities() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(qboEntities).where(eq(qboEntities.isActive, true)).orderBy(asc(qboEntities.id));
}

export async function getQboEntityById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(qboEntities).where(eq(qboEntities.id, id)).limit(1);
  return rows[0] || null;
}

export async function upsertQboEntity(data: {
  locationId: number;
  realmId: string;
  companyName?: string;
  legalName?: string;
  fiscalYearStartMonth?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Match on locationId only so we can update realmId from sandbox/pending to production
  const existing = await db.select().from(qboEntities)
    .where(eq(qboEntities.locationId, data.locationId))
    .limit(1);
  if (existing.length > 0) {
    await db.update(qboEntities).set({
      realmId: data.realmId,
      companyName: data.companyName,
      legalName: data.legalName,
      fiscalYearStartMonth: data.fiscalYearStartMonth,
    }).where(eq(qboEntities.id, existing[0].id));
    return existing[0].id;
  }
  const result = await db.insert(qboEntities).values(data);
  return Number(result[0].insertId);
}

// Department/class filtering is handled via query parameters, not stored in entity table

export async function updateQboEntitySync(id: number, status: "idle" | "syncing" | "error", error?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(qboEntities).set({
    syncStatus: status,
    syncError: error || null,
    lastSyncAt: status === "idle" ? new Date() : undefined,
  }).where(eq(qboEntities.id, id));
}

// ═══════════════════════════════════════════════════════════════════════════════
// QBO ACCOUNT CACHE
// ═══════════════════════════════════════════════════════════════════════════════

export async function syncQboAccountCache(entityId: number, accounts: Array<{
  qboAccountId: string;
  name: string;
  fullyQualifiedName?: string;
  accountType?: string;
  accountSubType?: string;
  classification?: string;
  currentBalance?: number;
  acctNum?: string;
  isActive?: boolean;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(qboAccountCache).where(eq(qboAccountCache.qboEntityId, entityId));
  if (accounts.length > 0) {
    await db.insert(qboAccountCache).values(
      accounts.map(a => ({
        qboEntityId: entityId,
        qboAccountId: a.qboAccountId,
        name: a.name,
        fullyQualifiedName: a.fullyQualifiedName || null,
        accountType: a.accountType || null,
        accountSubType: a.accountSubType || null,
        classification: a.classification || null,
        currentBalance: a.currentBalance?.toString() || null,
        acctNum: a.acctNum || null,
        isActive: a.isActive ?? true,
      }))
    );
  }
}

export async function getQboAccountCacheForEntity(entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(qboAccountCache)
    .where(eq(qboAccountCache.qboEntityId, entityId))
    .orderBy(asc(qboAccountCache.accountType), asc(qboAccountCache.name));
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT MAPPING VERSIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getActiveMappingVersion(entityId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(accountMappingVersions)
    .where(and(eq(accountMappingVersions.qboEntityId, entityId), eq(accountMappingVersions.isActive, true)))
    .orderBy(desc(accountMappingVersions.versionNumber))
    .limit(1);
  return rows[0] || null;
}

export async function createMappingVersion(data: {
  qboEntityId: number;
  label?: string;
  effectiveFrom: string;
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(accountMappingVersions)
    .where(eq(accountMappingVersions.qboEntityId, data.qboEntityId))
    .orderBy(desc(accountMappingVersions.versionNumber))
    .limit(1);
  const nextVersion = existing.length > 0 ? existing[0].versionNumber + 1 : 1;
  await db.update(accountMappingVersions).set({ isActive: false })
    .where(eq(accountMappingVersions.qboEntityId, data.qboEntityId));
  const result = await db.insert(accountMappingVersions).values({
    qboEntityId: data.qboEntityId,
    versionNumber: nextVersion,
    label: data.label || `Version ${nextVersion}`,
    effectiveFrom: new Date(data.effectiveFrom),
    isActive: true,
    createdBy: data.createdBy,
  });
  return Number(result[0].insertId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMappingsForVersion(versionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountMappings)
    .where(eq(accountMappings.versionId, versionId))
    .orderBy(asc(accountMappings.statementType), asc(accountMappings.sortOrder));
}

export async function getMappingsForEntity(entityId: number) {
  const db = await getDb();
  if (!db) return [];
  const version = await getActiveMappingVersion(entityId);
  if (!version) return [];
  return getMappingsForVersion(version.id);
}

export async function upsertMapping(data: {
  versionId: number;
  qboEntityId: number;
  qboAccountId: string;
  qboAccountName?: string;
  statementType: "profit_loss" | "balance_sheet";
  category: string;
  subcategory?: string;
  customLabel?: string;
  sortOrder?: number;
  isHidden?: boolean;
  flags?: Record<string, unknown>;
  changedBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(accountMappings)
    .where(and(
      eq(accountMappings.versionId, data.versionId),
      eq(accountMappings.qboAccountId, data.qboAccountId),
    ))
    .limit(1);

  if (existing.length > 0) {
    const old = existing[0];
    await db.update(accountMappings).set({
      statementType: data.statementType,
      category: data.category,
      subcategory: data.subcategory || null,
      customLabel: data.customLabel || null,
      sortOrder: data.sortOrder ?? old.sortOrder,
      isHidden: data.isHidden ?? old.isHidden,
      flags: data.flags || old.flags,
    }).where(eq(accountMappings.id, old.id));
    await db.insert(accountMappingAudit).values({
      mappingId: old.id,
      versionId: data.versionId,
      action: "update",
      fieldChanged: "category",
      oldValue: old.category,
      newValue: data.category,
      changedBy: data.changedBy,
    });
    return old.id;
  } else {
    const result = await db.insert(accountMappings).values({
      versionId: data.versionId,
      qboEntityId: data.qboEntityId,
      qboAccountId: data.qboAccountId,
      qboAccountName: data.qboAccountName || null,
      statementType: data.statementType,
      category: data.category,
      subcategory: data.subcategory || null,
      customLabel: data.customLabel || null,
      sortOrder: data.sortOrder ?? 0,
      isHidden: data.isHidden ?? false,
      flags: data.flags || null,
    });
    const newId = Number(result[0].insertId);
    await db.insert(accountMappingAudit).values({
      mappingId: newId,
      versionId: data.versionId,
      action: "create",
      newValue: JSON.stringify({ category: data.category, subcategory: data.subcategory }),
      changedBy: data.changedBy,
    });
    return newId;
  }
}

export async function deleteMapping(id: number, changedBy?: string) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(accountMappings).where(eq(accountMappings.id, id)).limit(1);
  if (existing.length > 0) {
    await db.insert(accountMappingAudit).values({
      mappingId: id,
      versionId: existing[0].versionId,
      action: "delete",
      oldValue: JSON.stringify(existing[0]),
      changedBy,
    });
    await db.delete(accountMappings).where(eq(accountMappings.id, id));
  }
}

export async function updateMappingSortOrder(updates: Array<{ id: number; sortOrder: number }>, changedBy?: string) {
  const db = await getDb();
  if (!db) return;
  for (const u of updates) {
    await db.update(accountMappings).set({ sortOrder: u.sortOrder }).where(eq(accountMappings.id, u.id));
  }
  if (updates.length > 0) {
    await db.insert(accountMappingAudit).values({
      action: "reorder",
      newValue: JSON.stringify(updates),
      changedBy,
    });
  }
}

export async function getMappingAuditTrail(entityId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountMappingAudit)
    .where(eq(accountMappingAudit.versionId, entityId))
    .orderBy(desc(accountMappingAudit.createdAt))
    .limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FS LINE DEFINITIONS (default statement structure)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getFsLineDefinitions(statementType: "profit_loss" | "balance_sheet") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fsLineDefinitions)
    .where(eq(fsLineDefinitions.statementType, statementType))
    .orderBy(asc(fsLineDefinitions.sortOrder));
}

/**
 * Ensure the BS catch-all "Other" lines exist.
 * This is needed for existing deployments that were seeded before these lines were added.
 * Safe to call multiple times — it only inserts if the specific lines are missing.
 */
export async function ensureBSCatchAllLines() {
  const db = await getDb();
  if (!db) return;
  const bsLines = await db.select().from(fsLineDefinitions)
    .where(eq(fsLineDefinitions.statementType, "balance_sheet"))
    .orderBy(asc(fsLineDefinitions.sortOrder));
  if (bsLines.length === 0) return; // Not yet seeded, seedDefaultLineDefinitions will handle it

  // Check if "Other Assets" catch-all detail line exists
  const hasOtherAssets = bsLines.some(l => l.category === "Assets" && !l.subcategory && l.lineType === "detail");
  if (!hasOtherAssets) {
    await db.insert(fsLineDefinitions).values({
      statementType: "balance_sheet",
      category: "Assets",
      subcategory: null,
      displayLabel: "Other Assets",
      lineType: "detail",
      sortOrder: 160,
    });
  }

  // Check if "Other Liabilities" catch-all detail line exists
  const hasOtherLiabilities = bsLines.some(l => l.category === "Liabilities" && !l.subcategory && l.lineType === "detail");
  if (!hasOtherLiabilities) {
    await db.insert(fsLineDefinitions).values({
      statementType: "balance_sheet",
      category: "Liabilities",
      subcategory: null,
      displayLabel: "Other Liabilities",
      lineType: "detail",
      sortOrder: 260,
    });
  }
}

/**
 * Ensure the new P&L subcategory lines (Royalties, Management Fees, Other Operating Expenses) exist.
 * This is needed for existing deployments that were seeded before these lines were added.
 */
export async function ensurePLNewSubcategories() {
  const db = await getDb();
  if (!db) return;
  const plLines = await db.select().from(fsLineDefinitions)
    .where(eq(fsLineDefinitions.statementType, "profit_loss"))
    .orderBy(asc(fsLineDefinitions.sortOrder));
  if (plLines.length === 0) return; // Not yet seeded

  const hasRoyalties = plLines.some(l => l.category === "Operating Expenses" && l.subcategory === "Royalties");
  if (!hasRoyalties) {
    await db.insert(fsLineDefinitions).values({
      statementType: "profit_loss",
      category: "Operating Expenses",
      subcategory: "Royalties",
      displayLabel: "Royalties",
      lineType: "detail",
      sortOrder: 510,
    });
  }

  const hasMgmtFees = plLines.some(l => l.category === "Operating Expenses" && l.subcategory === "Management Fees");
  if (!hasMgmtFees) {
    await db.insert(fsLineDefinitions).values({
      statementType: "profit_loss",
      category: "Operating Expenses",
      subcategory: "Management Fees",
      displayLabel: "Management Fees",
      lineType: "detail",
      sortOrder: 520,
    });
  }

  // Add "Other Operating Expenses" catch-all detail line
  const hasOtherOpex = plLines.some(l => l.category === "Operating Expenses" && !l.subcategory && l.lineType === "detail");
  if (!hasOtherOpex) {
    await db.insert(fsLineDefinitions).values({
      statementType: "profit_loss",
      category: "Operating Expenses",
      subcategory: null,
      displayLabel: "Other Operating Expenses",
      lineType: "detail",
      sortOrder: 530,
    });
  }
}

export async function seedDefaultLineDefinitions() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(fsLineDefinitions).limit(1);
  if (existing.length > 0) {
    // Even if already seeded, ensure the new lines exist
    await ensureBSCatchAllLines();
    await ensurePLNewSubcategories();
    return;
  }

  const plLines = [
    { category: "Revenue", subcategory: null, displayLabel: "Sales", lineType: "detail" as const, sortOrder: 100 },
    { category: "Revenue", subcategory: null, displayLabel: "Total Revenue", lineType: "subtotal" as const, sortOrder: 199 },
    { category: "COGS", subcategory: null, displayLabel: "Cost of Goods Sold", lineType: "detail" as const, sortOrder: 200 },
    { category: "COGS", subcategory: null, displayLabel: "Total COGS", lineType: "subtotal" as const, sortOrder: 299 },
    { category: "Gross Profit", subcategory: null, displayLabel: "Gross Profit", lineType: "total" as const, sortOrder: 300 },
    { category: "Operating Expenses", subcategory: "Payroll", displayLabel: "Payroll", lineType: "detail" as const, sortOrder: 400 },
    { category: "Operating Expenses", subcategory: "Rent / Occupancy", displayLabel: "Rent / Occupancy", lineType: "detail" as const, sortOrder: 410 },
    { category: "Operating Expenses", subcategory: "Utilities", displayLabel: "Utilities", lineType: "detail" as const, sortOrder: 420 },
    { category: "Operating Expenses", subcategory: "Repairs & Maintenance", displayLabel: "Repairs & Maintenance", lineType: "detail" as const, sortOrder: 430 },
    { category: "Operating Expenses", subcategory: "Professional Fees", displayLabel: "Professional Fees", lineType: "detail" as const, sortOrder: 440 },
    { category: "Operating Expenses", subcategory: "Marketing", displayLabel: "Marketing", lineType: "detail" as const, sortOrder: 450 },
    { category: "Operating Expenses", subcategory: "Delivery / Vehicle", displayLabel: "Delivery / Vehicle", lineType: "detail" as const, sortOrder: 460 },
    { category: "Operating Expenses", subcategory: "Office / Admin", displayLabel: "Office / Admin", lineType: "detail" as const, sortOrder: 470 },
    { category: "Operating Expenses", subcategory: "Merchant Fees", displayLabel: "Merchant Fees", lineType: "detail" as const, sortOrder: 480 },
    { category: "Operating Expenses", subcategory: "Interest", displayLabel: "Interest", lineType: "detail" as const, sortOrder: 490 },
    { category: "Operating Expenses", subcategory: "Depreciation", displayLabel: "Depreciation", lineType: "detail" as const, sortOrder: 500 },
    { category: "Operating Expenses", subcategory: "Royalties", displayLabel: "Royalties", lineType: "detail" as const, sortOrder: 510 },
    { category: "Operating Expenses", subcategory: "Management Fees", displayLabel: "Management Fees", lineType: "detail" as const, sortOrder: 520 },
    { category: "Operating Expenses", subcategory: null, displayLabel: "Other Operating Expenses", lineType: "detail" as const, sortOrder: 530 },
    { category: "Operating Expenses", subcategory: null, displayLabel: "Total Operating Expenses", lineType: "subtotal" as const, sortOrder: 599 },
    { category: "Other Income", subcategory: null, displayLabel: "Other Income", lineType: "detail" as const, sortOrder: 600 },
    { category: "Other Expenses", subcategory: null, displayLabel: "Other Expenses", lineType: "detail" as const, sortOrder: 700 },
    { category: "Net Income", subcategory: null, displayLabel: "Net Income", lineType: "total" as const, sortOrder: 999 },
  ];

  const bsLines = [
    { category: "Assets", subcategory: "Cash", displayLabel: "Cash", lineType: "detail" as const, sortOrder: 100 },
    { category: "Assets", subcategory: "Accounts Receivable", displayLabel: "Accounts Receivable", lineType: "detail" as const, sortOrder: 110 },
    { category: "Assets", subcategory: "Inventory", displayLabel: "Inventory", lineType: "detail" as const, sortOrder: 120 },
    { category: "Assets", subcategory: "Prepaids", displayLabel: "Prepaids", lineType: "detail" as const, sortOrder: 130 },
    { category: "Assets", subcategory: "Fixed Assets", displayLabel: "Fixed Assets", lineType: "detail" as const, sortOrder: 140 },
    { category: "Assets", subcategory: "Accumulated Depreciation", displayLabel: "Accumulated Depreciation", lineType: "detail" as const, sortOrder: 150 },
    { category: "Assets", subcategory: null, displayLabel: "Other Assets", lineType: "detail" as const, sortOrder: 160 },
    { category: "Assets", subcategory: null, displayLabel: "Total Assets", lineType: "subtotal" as const, sortOrder: 199 },
    { category: "Liabilities", subcategory: "Accounts Payable", displayLabel: "Accounts Payable", lineType: "detail" as const, sortOrder: 200 },
    { category: "Liabilities", subcategory: "Credit Cards", displayLabel: "Credit Cards", lineType: "detail" as const, sortOrder: 210 },
    { category: "Liabilities", subcategory: "Sales Taxes", displayLabel: "Sales Taxes", lineType: "detail" as const, sortOrder: 220 },
    { category: "Liabilities", subcategory: "Payroll Liabilities", displayLabel: "Payroll Liabilities", lineType: "detail" as const, sortOrder: 230 },
    { category: "Liabilities", subcategory: "Shareholder Loans", displayLabel: "Shareholder Loans", lineType: "detail" as const, sortOrder: 240 },
    { category: "Liabilities", subcategory: "Debt", displayLabel: "Debt", lineType: "detail" as const, sortOrder: 250 },
    { category: "Liabilities", subcategory: null, displayLabel: "Other Liabilities", lineType: "detail" as const, sortOrder: 260 },
    { category: "Liabilities", subcategory: null, displayLabel: "Total Liabilities", lineType: "subtotal" as const, sortOrder: 299 },
    { category: "Equity", subcategory: "Equity", displayLabel: "Equity", lineType: "detail" as const, sortOrder: 300 },
    { category: "Equity", subcategory: "Retained Earnings", displayLabel: "Retained Earnings", lineType: "detail" as const, sortOrder: 310 },
    { category: "Equity", subcategory: null, displayLabel: "Total Equity", lineType: "subtotal" as const, sortOrder: 399 },
    { category: "Total", subcategory: null, displayLabel: "Total Liabilities & Equity", lineType: "total" as const, sortOrder: 999 },
  ];

  for (const line of plLines) {
    await db.insert(fsLineDefinitions).values({
      statementType: "profit_loss",
      ...line,
    });
  }
  for (const line of bsLines) {
    await db.insert(fsLineDefinitions).values({
      statementType: "balance_sheet",
      ...line,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED EXPENSES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getSharedExpenses(filters?: {
  startDate?: string;
  endDate?: string;
  status?: string;
  category?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (filters?.startDate) conditions.push(gte(sharedExpenses.expenseDate, new Date(filters.startDate)));
  if (filters?.endDate) conditions.push(lte(sharedExpenses.expenseDate, new Date(filters.endDate)));
  if (filters?.status) conditions.push(eq(sharedExpenses.approvalStatus, filters.status as any));
  if (filters?.category) conditions.push(eq(sharedExpenses.expenseCategory, filters.category));
  if (conditions.length > 0) {
    return db.select().from(sharedExpenses).where(and(...conditions)).orderBy(desc(sharedExpenses.expenseDate));
  }
  return db.select().from(sharedExpenses).orderBy(desc(sharedExpenses.expenseDate));
}

export async function getSharedExpenseById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sharedExpenses).where(eq(sharedExpenses.id, id)).limit(1);
  return rows[0] || null;
}

export async function createSharedExpense(data: {
  expenseDate: string;
  vendor?: string;
  description?: string;
  amount: string;
  reportingPeriodStart?: string;
  reportingPeriodEnd?: string;
  expenseCategory?: string;
  statementCategory?: string;
  statementSubcategory?: string;
  customLabel?: string;
  allocationBasis?: "revenue" | "fixed_pct" | "equal" | "manual" | "payroll" | "sqft";
  entitiesIncluded?: number[];
  sourceType?: "manual" | "credit_card" | "journal_entry" | "import";
  approvalStatus?: "draft" | "approved" | "posted";
  notes?: string;
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sharedExpenses).values({
    expenseDate: new Date(data.expenseDate),
    vendor: data.vendor || null,
    description: data.description || null,
    amount: data.amount,
    reportingPeriodStart: data.reportingPeriodStart ? new Date(data.reportingPeriodStart) : null,
    reportingPeriodEnd: data.reportingPeriodEnd ? new Date(data.reportingPeriodEnd) : null,
    expenseCategory: data.expenseCategory || null,
    statementCategory: data.statementCategory || null,
    statementSubcategory: data.statementSubcategory || null,
    customLabel: data.customLabel || null,
    allocationBasis: data.allocationBasis || "revenue",
    entitiesIncluded: data.entitiesIncluded || null,
    sourceType: data.sourceType || "manual",
    approvalStatus: data.approvalStatus || "draft",
    notes: data.notes || null,
    createdBy: data.createdBy || null,
  });
  return Number(result[0].insertId);
}

export async function updateSharedExpense(id: number, data: Partial<{
  expenseDate: string;
  vendor: string;
  description: string;
  amount: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  expenseCategory: string;
  statementCategory: string;
  statementSubcategory: string;
  customLabel: string;
  allocationBasis: "revenue" | "fixed_pct" | "equal" | "manual" | "payroll" | "sqft";
  entitiesIncluded: number[];
  sourceType: "manual" | "credit_card" | "journal_entry" | "import";
  approvalStatus: "draft" | "approved" | "posted";
  notes: string;
  fileUrl: string;
  fileKey: string;
}>) {
  const db = await getDb();
  if (!db) return;
  // Convert date strings to Date objects for date columns
  const setData: any = { ...data };
  if (setData.expenseDate) setData.expenseDate = new Date(setData.expenseDate);
  if (setData.reportingPeriodStart) setData.reportingPeriodStart = new Date(setData.reportingPeriodStart);
  if (setData.reportingPeriodEnd) setData.reportingPeriodEnd = new Date(setData.reportingPeriodEnd);
  await db.update(sharedExpenses).set(setData).where(eq(sharedExpenses.id, id));
}

export async function deleteSharedExpense(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(sharedExpenseAllocations).where(eq(sharedExpenseAllocations.sharedExpenseId, id));
  await db.delete(sharedExpenses).where(eq(sharedExpenses.id, id));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED EXPENSE ALLOCATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function computeRevenueAllocation(
  sharedExpenseId: number,
  periodStart: string,
  periodEnd: string,
  entityLocationIds: number[],
  computedBy?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const expense = await getSharedExpenseById(sharedExpenseId);
  if (!expense) throw new Error("Shared expense not found");

  // Get revenue for each location in the period
  const salesData = await db.select({
    locationId: dailySales.locationId,
    totalRevenue: sql<string>`SUM(${dailySales.totalSales})`,
  }).from(dailySales)
    .where(and(
      gte(dailySales.saleDate, new Date(periodStart)),
      lte(dailySales.saleDate, new Date(periodEnd)),
      inArray(dailySales.locationId, entityLocationIds),
    ))
    .groupBy(dailySales.locationId);

  const totalRevenue = salesData.reduce((sum, s) => sum + Number(s.totalRevenue || 0), 0);

  // Delete existing allocations for this expense
  await db.delete(sharedExpenseAllocations).where(eq(sharedExpenseAllocations.sharedExpenseId, sharedExpenseId));

  // Compute and insert allocations
  const allocations = [];
  for (const locId of entityLocationIds) {
    const locRevenue = Number(salesData.find(s => s.locationId === locId)?.totalRevenue || 0);
    const pct = totalRevenue > 0 ? (locRevenue / totalRevenue) * 100 : 0;
    const amount = totalRevenue > 0 ? (locRevenue / totalRevenue) * Number(expense.amount) : 0;

    allocations.push({
      sharedExpenseId,
      locationId: locId,
      allocationBasis: "revenue" as const,
      basisValue: locRevenue.toFixed(2),
      allocationPct: pct.toFixed(4),
      allocatedAmount: amount.toFixed(2),
      revenueUsed: locRevenue.toFixed(2),
      totalRevenue: totalRevenue.toFixed(2),
      computedBy: computedBy || null,
    });
  }

  if (allocations.length > 0) {
    await db.insert(sharedExpenseAllocations).values(allocations);
  }

  return allocations;
}

export async function getAllocationsForExpense(sharedExpenseId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sharedExpenseAllocations)
    .where(eq(sharedExpenseAllocations.sharedExpenseId, sharedExpenseId))
    .orderBy(asc(sharedExpenseAllocations.locationId));
}

export async function getAllocationsForLocation(locationId: number, periodStart: string, periodEnd: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    allocation: sharedExpenseAllocations,
    expense: sharedExpenses,
  }).from(sharedExpenseAllocations)
    .innerJoin(sharedExpenses, eq(sharedExpenseAllocations.sharedExpenseId, sharedExpenses.id))
    .where(and(
      eq(sharedExpenseAllocations.locationId, locationId),
      gte(sharedExpenses.expenseDate, new Date(periodStart)),
      lte(sharedExpenses.expenseDate, new Date(periodEnd)),
    ))
    .orderBy(desc(sharedExpenses.expenseDate));
}

// ═══════════════════════════════════════════════════════════════════════════════
// QBO REPORT CACHE
// ═══════════════════════════════════════════════════════════════════════════════

export async function getCachedReport(entityId: number, reportType: "ProfitAndLoss" | "BalanceSheet", startDate?: string, endDate?: string, asOfDate?: string) {
  const db = await getDb();
  if (!db) return null;
  const conditions: any[] = [
    eq(qboReportCache.qboEntityId, entityId),
    eq(qboReportCache.reportType, reportType),
  ];
  if (startDate) conditions.push(eq(qboReportCache.startDate, new Date(startDate)));
  if (endDate) conditions.push(eq(qboReportCache.endDate, new Date(endDate)));
  if (asOfDate) conditions.push(eq(qboReportCache.asOfDate, new Date(asOfDate)));

  const rows = await db.select().from(qboReportCache)
    .where(and(...conditions))
    .orderBy(desc(qboReportCache.fetchedAt))
    .limit(1);
  return rows[0] || null;
}

export async function cacheReport(data: {
  qboEntityId: number;
  reportType: "ProfitAndLoss" | "BalanceSheet";
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
  reportData: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(qboReportCache).values({
    qboEntityId: data.qboEntityId,
    reportType: data.reportType,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    asOfDate: data.asOfDate ? new Date(data.asOfDate) : null,
    reportData: data.reportData,
  });
}
