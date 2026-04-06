import { eq, sql, desc, and, gte, lte, asc, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users, locations, suppliers, invoices, invoiceLineItems,
  dailySales, payrollRecords, inventoryItems, recipes, recipeIngredients,
  purchaseOrders, poLineItems, alerts, integrations, importLogs, bankTransactions,
  appSettings, syncLogs, menuItems, bankAccounts, productSales, quotations, processedEmails,
  locationPins, inventoryLevels, stockMovements, wasteReports, wasteReportItems,
  leftoverReports, leftoverReportItems, vendorCatalogItems, orderRecommendations
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { findMenuItemMatch, getProductCategory } from './productNameMap';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Locations ───
export async function getAllLocations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(locations).orderBy(asc(locations.id));
}

// ─── Dashboard KPIs ───
export async function getDailySalesForDate(dateStr: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailySales).where(sql`saleDate = ${dateStr}`);
}

export async function getSalesRange(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailySales)
    .where(sql`saleDate >= ${startDate} AND saleDate <= ${endDate}`)
    .orderBy(sql`saleDate ASC`);
}

export async function getPayrollRange(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payrollRecords)
    .where(sql`payDate >= ${startDate} AND payDate <= ${endDate}`)
    .orderBy(sql`payDate ASC`);
}

// ─── Invoices ───
export async function getInvoices(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(invoices).where(eq(invoices.status, status as any)).orderBy(desc(invoices.invoiceDate));
  }
  return db.select().from(invoices).orderBy(desc(invoices.invoiceDate));
}

export async function getInvoiceCount() {
  const db = await getDb();
  if (!db) return { pending: 0, total: 0, pendingAmount: 0 };
  const result = await db.select({
    pending: sql<number>`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)`,
    total: sql<number>`COUNT(*)`,
    pendingAmount: sql<number>`SUM(CASE WHEN status = 'pending' THEN total ELSE 0 END)`,
  }).from(invoices);
  return result[0] || { pending: 0, total: 0, pendingAmount: 0 };
}

export async function updateInvoiceStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(invoices).set({ status: status as any }).where(eq(invoices.id, id));
}

export async function updateInvoiceQboSync(id: number, data: {
  qboSynced?: boolean;
  qboSyncStatus?: "not_synced" | "pending" | "synced" | "failed";
  qboSyncError?: string | null;
  qboSyncedAt?: Date | null;
  qboBillId?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(invoices).set(data as any).where(eq(invoices.id, id));
}

// ─── Create Invoice ───
export async function createInvoice(data: {
  invoiceNumber?: string;
  supplierId?: number;
  locationId?: number;
  invoiceDate?: string;
  dueDate?: string;
  subtotal?: string;
  gst?: string;
  qst?: string;
  total?: string;
  status?: string;
  glAccount?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(invoices).values(data as any);
  return (result as any)[0]?.insertId;
}

// ─── Invoice Detail & File Management ───
export async function getInvoiceById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return rows[0] || null;
}

export async function getInvoiceLineItems(invoiceId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
}

export async function updateInvoiceFile(id: number, data: {
  fileUrl?: string | null;
  fileKey?: string | null;
  deliveryNoteUrl?: string | null;
  deliveryNoteKey?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(invoices).set(data as any).where(eq(invoices.id, id));
}

export async function updateInvoiceLocation(id: number, locationId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(invoices).set({ locationId }).where(eq(invoices.id, id));
}

export async function updateInvoiceAutoApproved(id: number, autoApproved: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(invoices).set({ autoApproved } as any).where(eq(invoices.id, id));
}

// ─── Suppliers ───
export async function getAllSuppliers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(suppliers).orderBy(asc(suppliers.name));
}

// ─── Inventory ───
export async function getAllInventoryItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryItems).orderBy(asc(inventoryItems.name));
}

// ─── Recipes ───
export async function getAllRecipes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(recipes).orderBy(asc(recipes.name));
}

// ─── Purchase Orders ───
export async function getAllPurchaseOrders() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
}

// ─── Alerts ───
export async function getActiveAlerts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(alerts).where(eq(alerts.isRead, false)).orderBy(desc(alerts.createdAt));
}

export async function markAlertRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, id));
}

// ─── Integrations ───
export async function getAllIntegrations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(integrations).orderBy(asc(integrations.id));
}

// ─── Payroll ───
export async function getLatestPayroll() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payrollRecords).orderBy(desc(payrollRecords.payDate)).limit(20);
}

// ─── Import Logs ───
export async function createImportLog(data: {
  importType: "pos_sales" | "payroll" | "bank_statement" | "invoices" | "product_sales";
  fileName: string;
  fileUrl?: string;
  locationId?: number;
  importedBy?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(importLogs).values({
    importType: data.importType,
    fileName: data.fileName,
    fileUrl: data.fileUrl || null,
    status: "pending",
    locationId: data.locationId || null,
    importedBy: data.importedBy || null,
  });
  return (result as any)[0]?.insertId;
}

export async function updateImportLog(id: number, data: {
  status?: string;
  recordsFound?: number;
  recordsImported?: number;
  recordsSkipped?: number;
  recordsFailed?: number;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  errors?: any;
  completedAt?: Date;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(importLogs).set(data as any).where(eq(importLogs.id, id));
}

export async function getImportLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(importLogs).orderBy(desc(importLogs.createdAt)).limit(limit);
}

// ─── Bulk Insert Sales ───
export async function bulkInsertDailySales(rows: Array<{
  locationId: number;
  saleDate: string;
  taxExemptSales?: string;
  taxableSales?: string;
  totalSales: string;
  gstCollected?: string;
  qstCollected?: string;
  totalDeposit?: string;
  tipsCollected?: string;
  merchantFees?: string;
}>) {
  const db = await getDb();
  if (!db) return 0;
  if (rows.length === 0) return 0;
  // Delete existing records for same location+date combos to prevent duplicates
  for (const row of rows) {
    await db.delete(dailySales).where(
      sql`locationId = ${row.locationId} AND saleDate = ${row.saleDate}`
    );
  }
  await db.insert(dailySales).values(rows as any);
  return rows.length;
}

// ─── Bulk Insert Payroll ───
export async function bulkInsertPayroll(rows: Array<{
  locationId: number;
  payDate: string;
  periodStart?: string;
  periodEnd?: string;
  grossWages: string;
  employerContributions?: string;
  netPayroll?: string;
  headcount?: number;
  totalHours?: string;
}>) {
  const db = await getDb();
  if (!db) return 0;
  if (rows.length === 0) return 0;
  // Delete existing records for same location+payDate to prevent duplicates
  for (const row of rows) {
    await db.delete(payrollRecords).where(
      sql`locationId = ${row.locationId} AND payDate = ${row.payDate}`
    );
  }
  await db.insert(payrollRecords).values(rows as any);
  return rows.length;
}

// ─── Bulk Insert Bank Transactions ───
export async function bulkInsertBankTransactions(rows: Array<{
  bankAccountId?: number;
  accountName?: string;
  transactionDate: string;
  description?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  category?: string;
  matchedType?: string;
  locationId?: number;
  importLogId?: number;
}>) {
  const db = await getDb();
  if (!db) return 0;
  if (rows.length === 0) return 0;
  await db.insert(bankTransactions).values(rows as any);
  return rows.length;
}

export async function getBankTransactions(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bankTransactions).orderBy(desc(bankTransactions.transactionDate)).limit(limit);
}

// ─── Data Coverage ───
export async function getDataCoverage() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT 'POS Sales' as dataType, locationId, MIN(saleDate) as earliest, MAX(saleDate) as latest, COUNT(*) as records
    FROM dailySales GROUP BY locationId
    UNION ALL
    SELECT 'Payroll', locationId, MIN(payDate), MAX(payDate), COUNT(*)
    FROM payrollRecords GROUP BY locationId
    UNION ALL
    SELECT 'Invoices', locationId, MIN(invoiceDate), MAX(invoiceDate), COUNT(*)
    FROM invoices GROUP BY locationId
    UNION ALL
    SELECT 'Product Sales', locationId, MIN(periodStart), MAX(periodEnd), COUNT(*)
    FROM productSales GROUP BY locationId
    UNION ALL
    SELECT 'Bank Statements', bt.accountName as locationId, MIN(bt.transactionDate), MAX(bt.transactionDate), COUNT(*)
    FROM bankTransactions bt GROUP BY bt.accountName
    ORDER BY dataType, locationId
  `);
  return (result as any)[0] || [];
}

export async function getBankTransactionCoverage() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT 
      ba.id as bankAccountId,
      ba.name as bankAccountName,
      ba.bankName,
      ba.accountNumber,
      ba.locationId,
      COUNT(bt.id) as txnCount,
      MIN(bt.transactionDate) as earliest,
      MAX(bt.transactionDate) as latest
    FROM bankAccounts ba
    LEFT JOIN bankTransactions bt ON bt.accountName = ba.name AND bt.locationId = ba.locationId
    GROUP BY ba.id, ba.name, ba.bankName, ba.accountNumber, ba.locationId
    ORDER BY ba.locationId
  `);
  return (result as any)[0] || [];
}

// ─── Monthly Summary ───
export async function getMonthlySalesSummary(year: number, locationIds?: number[]) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [sql`YEAR(saleDate) = ${year}`];
  if (locationIds && locationIds.length > 0) {
    conditions.push(sql`locationId IN (${sql.join(locationIds.map(id => sql`${id}`), sql`, `)})`);
  }
  const result = await db.select({
    month: sql<number>`MONTH(saleDate)`,
    locationId: dailySales.locationId,
    totalSales: sql<number>`SUM(totalSales)`,
    totalGst: sql<number>`SUM(gstCollected)`,
    totalQst: sql<number>`SUM(qstCollected)`,
    totalLabourCost: sql<number>`SUM(labourCost)`,
    totalOrders: sql<number>`SUM(orderCount)`,
  }).from(dailySales)
    .where(sql.join(conditions, sql` AND `))
    .groupBy(sql`MONTH(saleDate)`, dailySales.locationId)
    .orderBy(sql`MONTH(saleDate)`);
  return result;
}

// ─── Aggregated Monthly Summary (across all locations) ───
export async function getMonthlyAggregatedSummary(year: number, locationIds?: number[]) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [sql`YEAR(saleDate) = ${year}`];
  if (locationIds && locationIds.length > 0) {
    conditions.push(sql`locationId IN (${sql.join(locationIds.map(id => sql`${id}`), sql`, `)})`);
  }
  const result = await db.select({
    month: sql<number>`MONTH(saleDate)`,
    totalSales: sql<number>`COALESCE(SUM(totalSales), 0)`,
    totalGst: sql<number>`COALESCE(SUM(gstCollected), 0)`,
    totalQst: sql<number>`COALESCE(SUM(qstCollected), 0)`,
    totalLabourCost: sql<number>`COALESCE(SUM(labourCost), 0)`,
    totalOrders: sql<number>`COALESCE(SUM(orderCount), 0)`,
    daysCount: sql<number>`COUNT(DISTINCT saleDate)`,
    locationsCount: sql<number>`COUNT(DISTINCT locationId)`,
  }).from(dailySales)
    .where(sql.join(conditions, sql` AND `))
    .groupBy(sql`MONTH(saleDate)`)
    .orderBy(sql`MONTH(saleDate)`);
  return result;
}

// ─── Locations with Sales Data ───
export async function getLocationIdsWithSalesData() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    locationId: sql<number>`DISTINCT locationId`,
  }).from(dailySales);
  return result.map(r => r.locationId);
}

// ─── Latest Sale Date ───
export async function getLatestSaleDate() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    maxDate: sql<string>`MAX(saleDate)`,
    minDate: sql<string>`MIN(saleDate)`,
    totalDays: sql<number>`COUNT(DISTINCT saleDate)`,
  }).from(dailySales);
  return result[0] || null;
}

// ─── Daily P&L with actual payroll data ───
export async function getDailyPnlForDate(dateStr: string) {
  const db = await getDb();
  if (!db) return [];
  const sales = await db.select().from(dailySales).where(sql`saleDate = ${dateStr}`);
  const allLocs = await db.select().from(locations);
  const locMap = new Map(allLocs.map(l => [l.id, l]));
  
  // Get the payroll period that contains this date
  const payroll = await db.select().from(payrollRecords)
    .where(sql`periodStart <= ${dateStr} AND periodEnd >= ${dateStr}`);
  const payrollByLoc = new Map(payroll.map(p => [p.locationId, p]));
  
  return sales.map(s => {
    const loc = locMap.get(s.locationId);
    const revenue = Number(s.totalSales || 0);
    const foodCostPct = Number(loc?.foodCostTarget || 30) / 100;
    const estimatedCogs = revenue * foodCostPct;
    const actualLabourCost = Number(s.labourCost || 0);
    const orderCount = Number(s.orderCount || 0);
    
    // Use actual labour cost from Koomi POS if available, otherwise fall back to payroll or estimate
    let labor: number;
    let laborSource: 'actual' | 'payroll' | 'estimated';
    if (actualLabourCost > 0) {
      labor = actualLabourCost;
      laborSource = 'actual';
    } else {
      const pr = payrollByLoc.get(s.locationId);
      if (pr) {
        const periodStart = new Date(pr.periodStart!);
        const periodEnd = new Date(pr.periodEnd!);
        const daysInPeriod = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        labor = (Number(pr.grossWages || 0) + Number(pr.employerContributions || 0)) / daysInPeriod;
        laborSource = 'payroll';
      } else {
        labor = revenue * (Number(loc?.laborTarget || 25) / 100);
        laborSource = 'estimated';
      }
    }
    
    const grossProfit = revenue - estimatedCogs;
    const opProfit = grossProfit - labor;
    
    return {
      locationId: s.locationId,
      locationName: loc?.name || 'Unknown',
      locationCode: loc?.code || '??',
      revenue,
      cogs: estimatedCogs,
      grossProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      labor,
      laborPct: revenue > 0 ? (labor / revenue) * 100 : 0,
      laborSource,
      operatingProfit: opProfit,
      operatingMargin: revenue > 0 ? (opProfit / revenue) * 100 : 0,
      gst: Number(s.gstCollected || 0),
      qst: Number(s.qstCollected || 0),
      orderCount,
    };
  });
}

// ─── Recipe CRUD ───
export async function getRecipeWithIngredients(recipeId: number) {
  const db = await getDb();
  if (!db) return null;
  const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!recipe) return null;
  const ingredients = await db.select().from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  return { ...recipe, ingredients };
}

export async function getAllRecipesWithIngredients() {
  const db = await getDb();
  if (!db) return [];
  const allRecipes = await db.select().from(recipes).where(eq(recipes.isActive, true)).orderBy(asc(recipes.name));
  const allIngredients = await db.select().from(recipeIngredients);
  const ingByRecipe = new Map<number, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingByRecipe.get(ing.recipeId) || [];
    list.push(ing);
    ingByRecipe.set(ing.recipeId, list);
  }
  return allRecipes.map(r => ({
    ...r,
    ingredients: ingByRecipe.get(r.id) || [],
  }));
}

export async function createRecipe(data: {
  name: string;
  category?: string;
  sellingPrice?: string;
  isSubRecipe?: boolean;
  ingredients: Array<{
    ingredientName: string;
    quantity: string;
    unit: string;
    inventoryItemId?: number | null;
  }>;
}) {
  const db = await getDb();
  if (!db) return null;

  // Look up ingredient costs from inventoryItems
  const allItems = await db.select().from(inventoryItems);
  const itemMap = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

  let totalCost = 0;
  const ingredientRows = data.ingredients.map(ing => {
    const item = itemMap.get(ing.ingredientName.toLowerCase());
    const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : 0;
    const qty = Number(ing.quantity);
    const lineCost = qty * usableUnitCost;
    totalCost += lineCost;
    return {
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      inventoryItemId: ing.inventoryItemId || (item ? item.id : null),
      usableUnitCost: usableUnitCost.toFixed(4),
      lineCost: lineCost.toFixed(4),
    };
  });

  const sellingPrice = Number(data.sellingPrice || 0);
  const profit = sellingPrice - totalCost;
  const foodCostPct = sellingPrice > 0 ? (totalCost / sellingPrice) * 100 : 0;

  await db.insert(recipes).values({
    name: data.name,
    category: data.category || "Uncategorized",
    yield: "1.00",
    yieldUnit: "Unit",
    sellingPrice: sellingPrice.toFixed(2),
    totalCost: totalCost.toFixed(4),
    profit: profit.toFixed(4),
    foodCostPct: foodCostPct.toFixed(2),
    isSubRecipe: data.isSubRecipe || false,
    isActive: true,
  });

  const [newRecipe] = await db.select().from(recipes).where(eq(recipes.name, data.name)).orderBy(desc(recipes.id)).limit(1);
  if (!newRecipe) return null;

  for (const ing of ingredientRows) {
    await db.insert(recipeIngredients).values({
      recipeId: newRecipe.id,
      inventoryItemId: ing.inventoryItemId,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      usableUnitCost: ing.usableUnitCost,
      lineCost: ing.lineCost,
    });
  }

  return getRecipeWithIngredients(newRecipe.id);
}

export async function updateRecipe(recipeId: number, data: {
  name?: string;
  category?: string;
  sellingPrice?: string;
  isActive?: boolean;
  ingredients?: Array<{
    ingredientName: string;
    quantity: string;
    unit: string;
    inventoryItemId?: number | null;
  }>;
}) {
  const db = await getDb();
  if (!db) return null;

  if (data.ingredients) {
    // Recalculate costs
    const allItems = await db.select().from(inventoryItems);
    const itemMap = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

    let totalCost = 0;
    const ingredientRows = data.ingredients.map(ing => {
      const item = itemMap.get(ing.ingredientName.toLowerCase());
      const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : 0;
      const qty = Number(ing.quantity);
      const lineCost = qty * usableUnitCost;
      totalCost += lineCost;
      return {
        ingredientName: ing.ingredientName,
        quantity: ing.quantity,
        unit: ing.unit,
        inventoryItemId: ing.inventoryItemId || (item ? item.id : null),
        usableUnitCost: usableUnitCost.toFixed(4),
        lineCost: lineCost.toFixed(4),
      };
    });

    const sellingPrice = Number(data.sellingPrice || 0);
    const profit = sellingPrice - totalCost;
    const foodCostPct = sellingPrice > 0 ? (totalCost / sellingPrice) * 100 : 0;

    // Delete old ingredients and insert new ones
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
    for (const ing of ingredientRows) {
      await db.insert(recipeIngredients).values({
        recipeId,
        inventoryItemId: ing.inventoryItemId,
        ingredientName: ing.ingredientName,
        quantity: ing.quantity,
        unit: ing.unit,
        usableUnitCost: ing.usableUnitCost,
        lineCost: ing.lineCost,
      });
    }

    await db.update(recipes).set({
      ...(data.name && { name: data.name }),
      ...(data.category && { category: data.category }),
      sellingPrice: sellingPrice.toFixed(2),
      totalCost: totalCost.toFixed(4),
      profit: profit.toFixed(4),
      foodCostPct: foodCostPct.toFixed(2),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    }).where(eq(recipes.id, recipeId));
  } else {
    // Update recipe metadata only
    await db.update(recipes).set({
      ...(data.name && { name: data.name }),
      ...(data.category && { category: data.category }),
      ...(data.sellingPrice && { sellingPrice: data.sellingPrice }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    }).where(eq(recipes.id, recipeId));
  }

  return getRecipeWithIngredients(recipeId);
}

export async function deleteRecipe(recipeId: number) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  await db.delete(recipes).where(eq(recipes.id, recipeId));
  return true;
}

// ─── Ingredient CRUD ───
export async function createIngredient(data: {
  name: string;
  category?: string;
  unit: string;
  purchaseAmount?: string;
  purchaseCost?: string;
  yieldPct?: string;
  supplierName?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const costPerUnit = Number(data.purchaseCost || 0) / Math.max(Number(data.purchaseAmount || 1), 0.001);
  const yieldPct = Number(data.yieldPct || 100);
  const costPerUsableUnit = yieldPct > 0 ? costPerUnit / (yieldPct / 100) : costPerUnit;

  await db.insert(inventoryItems).values({
    name: data.name,
    category: data.category || "Uncategorized",
    unit: data.unit,
    purchaseAmount: data.purchaseAmount || "1",
    purchaseCost: data.purchaseCost || "0",
    avgCost: costPerUnit.toFixed(4),
    lastCost: costPerUnit.toFixed(4),
    yieldPct: yieldPct.toFixed(1),
    costPerUsableUnit: costPerUsableUnit.toFixed(4),
    supplierName: data.supplierName || null,
    notes: data.notes || null,
    isActive: true,
  });

  const [newItem] = await db.select().from(inventoryItems).where(eq(inventoryItems.name, data.name)).orderBy(desc(inventoryItems.id)).limit(1);
  return newItem;
}

export async function updateIngredient(itemId: number, data: {
  name?: string;
  category?: string;
  unit?: string;
  purchaseAmount?: string;
  purchaseCost?: string;
  yieldPct?: string;
  supplierName?: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) return null;

  // Get current item
  const [current] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!current) return null;

  const purchaseAmount = Number(data.purchaseAmount ?? current.purchaseAmount ?? 1);
  const purchaseCost = Number(data.purchaseCost ?? current.purchaseCost ?? 0);
  const yieldPct = Number(data.yieldPct ?? current.yieldPct ?? 100);
  const costPerUnit = purchaseAmount > 0 ? purchaseCost / purchaseAmount : 0;
  const costPerUsableUnit = yieldPct > 0 ? costPerUnit / (yieldPct / 100) : costPerUnit;

  await db.update(inventoryItems).set({
    ...(data.name && { name: data.name }),
    ...(data.category && { category: data.category }),
    ...(data.unit && { unit: data.unit }),
    purchaseAmount: purchaseAmount.toFixed(3),
    purchaseCost: purchaseCost.toFixed(2),
    avgCost: costPerUnit.toFixed(4),
    lastCost: costPerUnit.toFixed(4),
    yieldPct: yieldPct.toFixed(1),
    costPerUsableUnit: costPerUsableUnit.toFixed(4),
    ...(data.supplierName !== undefined && { supplierName: data.supplierName }),
    ...(data.notes !== undefined && { notes: data.notes }),
  }).where(eq(inventoryItems.id, itemId));

  return db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).then(r => r[0]);
}

// ─── Auto-Cost Recalculation ───
// Recalculates all recipe costs based on current ingredient prices
export async function recalculateAllRecipeCosts() {
  const db = await getDb();
  if (!db) return { updated: 0 };

  const allItems = await db.select().from(inventoryItems);
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

  const allRecipeList = await db.select().from(recipes).where(eq(recipes.isActive, true));
  let updated = 0;

  for (const recipe of allRecipeList) {
    const ingredients = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipe.id));
    let totalCost = 0;

    for (const ing of ingredients) {
      const item = ing.inventoryItemId ? itemMap.get(ing.inventoryItemId) : itemByName.get(ing.ingredientName.toLowerCase());
      const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : Number(ing.usableUnitCost || 0);
      const qty = Number(ing.quantity || 0);
      const lineCost = qty * usableUnitCost;
      totalCost += lineCost;

      // Update the ingredient line cost
      await db.update(recipeIngredients).set({
        usableUnitCost: usableUnitCost.toFixed(4),
        lineCost: lineCost.toFixed(4),
        inventoryItemId: item?.id || ing.inventoryItemId,
      }).where(eq(recipeIngredients.id, ing.id));
    }

    const sellingPrice = Number(recipe.sellingPrice || 0);
    const profit = sellingPrice - totalCost;
    const foodCostPct = sellingPrice > 0 ? (totalCost / sellingPrice) * 100 : 0;

    await db.update(recipes).set({
      totalCost: totalCost.toFixed(4),
      profit: profit.toFixed(4),
      foodCostPct: foodCostPct.toFixed(2),
    }).where(eq(recipes.id, recipe.id));
    updated++;
  }

  return { updated };
}

// ─── Update ingredient price from invoice line item ───
export async function updateIngredientPriceFromInvoice(ingredientName: string, newCostPerUnit: number, supplierName?: string) {
  const db = await getDb();
  if (!db) return null;

  const items = await db.select().from(inventoryItems)
    .where(sql`LOWER(name) = LOWER(${ingredientName})`);
  if (items.length === 0) return null;

  const item = items[0];
  const yieldPct = Number(item.yieldPct || 100);
  const costPerUsableUnit = yieldPct > 0 ? newCostPerUnit / (yieldPct / 100) : newCostPerUnit;

  await db.update(inventoryItems).set({
    lastCost: newCostPerUnit.toFixed(4),
    avgCost: newCostPerUnit.toFixed(4),
    costPerUsableUnit: costPerUsableUnit.toFixed(4),
    ...(supplierName && { supplierName }),
  }).where(eq(inventoryItems.id, item.id));

  return { itemId: item.id, name: item.name, newCostPerUsableUnit: costPerUsableUnit };
}


// ─── Menu Items (items without recipes widget) ───

export async function getAllMenuItems() {
  const db = await getDb();
  return db!.select().from(menuItems).orderBy(menuItems.category, menuItems.name);
}

export async function getMenuItemsWithoutRecipes() {
  const db = await getDb();
  return db!.select().from(menuItems)
    .where(eq(menuItems.hasRecipe, false))
    .orderBy(menuItems.category, menuItems.name);
}

export async function getMenuItemsWithRecipes() {
  const db = await getDb();
  return db!.select().from(menuItems)
    .where(eq(menuItems.hasRecipe, true))
    .orderBy(menuItems.category, menuItems.name);
}

export async function updateMenuItemCogs(id: number, cogsPct: string) {
  const db = await getDb();
  await db!.update(menuItems).set({ defaultCogsPct: cogsPct }).where(eq(menuItems.id, id));
  return true;
}

export async function bulkUpdateMenuItemCogs(updates: { id: number; cogsPct: string }[]) {
  const db = await getDb();
  for (const u of updates) {
    await db!.update(menuItems).set({ defaultCogsPct: u.cogsPct }).where(eq(menuItems.id, u.id));
  }
  return true;
}

export async function createMenuItem(data: {
  name: string;
  category?: string;
  sellingPrice?: string;
  defaultCogsPct?: string;
}) {
  const db = await getDb();
  const result = await db!.insert(menuItems).values({
    name: data.name,
    category: data.category || "Uncategorized",
    sellingPrice: data.sellingPrice || "0.00",
    hasRecipe: false,
    defaultCogsPct: data.defaultCogsPct || "30.00",
    isActive: true,
  });
  return { id: Number(result[0].insertId) };
}

export async function deleteMenuItem(id: number) {
  const db = await getDb();
  await db!.delete(menuItems).where(eq(menuItems.id, id));
  return true;
}

export async function linkMenuItemToRecipe(menuItemId: number, recipeId: number) {
  const db = await getDb();
  // Get the recipe's food cost %
  const [recipe] = await db!.select().from(recipes).where(eq(recipes.id, recipeId));
  if (!recipe) return false;
  await db!.update(menuItems).set({
    hasRecipe: true,
    recipeId: recipeId,
    defaultCogsPct: recipe.foodCostPct || "0.00",
  }).where(eq(menuItems.id, menuItemId));
  return true;
}

export async function unlinkMenuItemFromRecipe(menuItemId: number) {
  const db = await getDb();
  await db!.update(menuItems).set({
    hasRecipe: false,
    recipeId: null,
    defaultCogsPct: "30.00",
  }).where(eq(menuItems.id, menuItemId));
  return true;
}

export async function getMenuItemsSummary() {
  const db = await getDb();
  const all = await db!.select().from(menuItems).orderBy(menuItems.category, menuItems.name);
  const withRecipe = all.filter(i => i.hasRecipe);
  const withoutRecipe = all.filter(i => !i.hasRecipe);

  // Group without-recipe items by category
  const byCategory: Record<string, typeof withoutRecipe> = {};
  for (const item of withoutRecipe) {
    const cat = item.category || "Uncategorized";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  return {
    totalItems: all.length,
    withRecipe: withRecipe.length,
    withoutRecipe: withoutRecipe.length,
    coveragePercent: all.length > 0 ? Math.round((withRecipe.length / all.length) * 100) : 0,
    itemsWithoutRecipe: withoutRecipe,
    byCategory,
  };
}


// ─── Upsert Single Daily Sale (for 7shifts sync) ───
export async function upsertDailySale(data: {
  locationId: number;
  saleDate: string;
  totalSales?: string;
  taxExemptSales?: string;
  taxableSales?: string;
  gstCollected?: string;
  qstCollected?: string;
  totalDeposit?: string;
  tipsCollected?: string;
  orderCount?: number;
  labourCost?: string;
}): Promise<'inserted' | 'updated'> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if record exists
  const existing = await db.select().from(dailySales)
    .where(sql`locationId = ${data.locationId} AND saleDate = ${data.saleDate}`)
    .limit(1);

  if (existing.length > 0) {
    // Update existing - merge non-zero values
    const updates: Record<string, unknown> = {};
    if (data.totalSales && parseFloat(data.totalSales) > 0) updates.totalSales = data.totalSales;
    if (data.taxExemptSales && parseFloat(data.taxExemptSales) > 0) updates.taxExemptSales = data.taxExemptSales;
    if (data.taxableSales && parseFloat(data.taxableSales) > 0) updates.taxableSales = data.taxableSales;
    if (data.gstCollected && parseFloat(data.gstCollected) > 0) updates.gstCollected = data.gstCollected;
    if (data.qstCollected && parseFloat(data.qstCollected) > 0) updates.qstCollected = data.qstCollected;
    if (data.totalDeposit && parseFloat(data.totalDeposit) > 0) updates.totalDeposit = data.totalDeposit;
    if (data.tipsCollected && parseFloat(data.tipsCollected) > 0) updates.tipsCollected = data.tipsCollected;
    if (data.orderCount && data.orderCount > 0) updates.orderCount = data.orderCount;
    if (data.labourCost && parseFloat(data.labourCost) > 0) updates.labourCost = data.labourCost;

    if (Object.keys(updates).length > 0) {
      await db.update(dailySales)
        .set(updates)
        .where(sql`locationId = ${data.locationId} AND saleDate = ${data.saleDate}`);
    }
    return 'updated';
  } else {
    // Insert new record
    await db.insert(dailySales).values({
      locationId: data.locationId,
      saleDate: data.saleDate,
      totalSales: data.totalSales || "0.00",
      taxExemptSales: data.taxExemptSales || "0.00",
      taxableSales: data.taxableSales || "0.00",
      gstCollected: data.gstCollected || "0.00",
      qstCollected: data.qstCollected || "0.00",
      totalDeposit: data.totalDeposit || "0.00",
      tipsCollected: data.tipsCollected || "0.00",
      merchantFees: "0.00",
      orderCount: data.orderCount || 0,
      labourCost: data.labourCost || "0.00",
    } as any);
    return 'inserted';
  }
}

// ─── Bank Accounts ───
export async function listBankAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bankAccounts).orderBy(asc(bankAccounts.locationId));
}

export async function getBankAccountsByLocation(locationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bankAccounts).where(eq(bankAccounts.locationId, locationId));
}

export async function createBankAccount(data: {
  name: string;
  bankName?: string;
  accountNumber?: string;
  locationId: number;
  accountType?: "checking" | "savings" | "credit_card";
  currency?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(bankAccounts).values({
    name: data.name,
    bankName: data.bankName || null,
    accountNumber: data.accountNumber || null,
    locationId: data.locationId,
    accountType: data.accountType || "checking",
    currency: data.currency || "CAD",
  } as any);
  return result[0].insertId;
}

export async function updateBankAccount(id: number, data: Partial<{
  name: string;
  bankName: string;
  accountNumber: string;
  accountType: "checking" | "savings" | "credit_card";
  currency: string;
  qboAccountId: string;
  isActive: boolean;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id));
}


// ─── Product Sales (Breakdown by Item) ───

export async function importProductSales(rows: {
  locationId: number;
  periodStart: string;
  periodEnd: string;
  section: "items" | "options";
  itemName: string;
  category: string | null;
  groupName: string | null;
  totalRevenue: string;
  quantitySold: number;
  quantityRefunded: number;
}[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    // Check for existing record (same location, period, section, item, category)
    const existing = await db.select()
      .from(productSales)
      .where(
        and(
          eq(productSales.locationId, row.locationId),
          sql`${productSales.periodStart} = ${row.periodStart}`,
          sql`${productSales.periodEnd} = ${row.periodEnd}`,
          eq(productSales.section, row.section),
          eq(productSales.itemName, row.itemName),
          row.category ? eq(productSales.category, row.category) : isNull(productSales.category)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing record (overwrite)
      await db.update(productSales)
        .set({
          totalRevenue: row.totalRevenue,
          quantitySold: row.quantitySold,
          quantityRefunded: row.quantityRefunded,
          groupName: row.groupName,
        })
        .where(eq(productSales.id, existing[0].id));
      updated++;
    } else {
      await db.insert(productSales).values({
        locationId: row.locationId,
        periodStart: new Date(row.periodStart + "T00:00:00"),
        periodEnd: new Date(row.periodEnd + "T00:00:00"),
        section: row.section,
        itemName: row.itemName,
        category: row.category,
        groupName: row.groupName,
        totalRevenue: row.totalRevenue,
        quantitySold: row.quantitySold,
        quantityRefunded: row.quantityRefunded,
      });
      imported++;
    }
  }

  return { imported, updated, skipped };
}

export async function getProductSalesSummary(locationId?: number, periodStart?: string, periodEnd?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(productSales.section, "items")];
  if (locationId) conditions.push(eq(productSales.locationId, locationId));
  if (periodStart) conditions.push(sql`${productSales.periodStart} >= ${periodStart}`);
  if (periodEnd) conditions.push(sql`${productSales.periodEnd} <= ${periodEnd}`);

  const rows = await db.select()
    .from(productSales)
    .where(and(...conditions))
    .orderBy(desc(productSales.totalRevenue));

  return rows;
}

export async function getProductSalesCategories(locationId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(productSales.section, "items")];
  if (locationId) conditions.push(eq(productSales.locationId, locationId));

  const rows = await db.selectDistinct({ category: productSales.category })
    .from(productSales)
    .where(and(...conditions));

  return rows.map(r => r.category).filter(Boolean);
}

export async function getProductSalesPeriods(locationId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: any[] = [];
  if (locationId) conditions.push(eq(productSales.locationId, locationId));

  const rows = await db.selectDistinct({
    periodStart: productSales.periodStart,
    periodEnd: productSales.periodEnd,
    locationId: productSales.locationId,
  })
    .from(productSales)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productSales.periodStart));

  return rows;
}

// ─── Product Sales with Cost Enrichment ───
export async function getProductSalesWithCosts(locationId?: number, periodStart?: string, periodEnd?: string, category?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get product sales
  const conditions = [eq(productSales.section, "items")];
  if (locationId) conditions.push(eq(productSales.locationId, locationId));
  if (periodStart) conditions.push(sql`${productSales.periodStart} >= ${periodStart}`);
  if (periodEnd) conditions.push(sql`${productSales.periodEnd} <= ${periodEnd}`);
  if (category) conditions.push(eq(productSales.category, category));

  const salesRows = await db.select()
    .from(productSales)
    .where(and(...conditions))
    .orderBy(desc(productSales.totalRevenue));

  // Get all menu items with their recipe costs
  const allMenuItems = await db.select({
    name: menuItems.name,
    sellingPrice: menuItems.sellingPrice,
    recipeId: menuItems.recipeId,
    hasRecipe: menuItems.hasRecipe,
    defaultCogsPct: menuItems.defaultCogsPct,
  }).from(menuItems);

  // Get all recipes with costs
  const allRecipes = await db.select({
    id: recipes.id,
    name: recipes.name,
    totalCost: recipes.totalCost,
    sellingPrice: recipes.sellingPrice,
    foodCostPct: recipes.foodCostPct,
  }).from(recipes);

  // Build lookup maps (normalize names to lowercase for matching)
  const menuMap = new Map<string, typeof allMenuItems[0]>();
  for (const mi of allMenuItems) {
    menuMap.set(mi.name.toLowerCase().trim(), mi);
  }

  const recipeMap = new Map<number, typeof allRecipes[0]>();
  for (const r of allRecipes) {
    recipeMap.set(r.id, r);
  }

  // Also build recipe name map for direct matching
  const recipeNameMap = new Map<string, typeof allRecipes[0]>();
  for (const r of allRecipes) {
    recipeNameMap.set(r.name.toLowerCase().trim(), r);
  }

  // Enrich each product sale with cost data using French→English name mapping
  const enriched = salesRows.map(sale => {
    const revenue = parseFloat(sale.totalRevenue || "0");
    const qty = sale.quantitySold || 0;
    const itemNameLower = sale.itemName.toLowerCase().trim();

    // Step 1: Try direct menu item match
    let menuItem = menuMap.get(itemNameLower);
    
    // Step 2: If no direct match, use French→English name mapping
    if (!menuItem) {
      const englishName = findMenuItemMatch(sale.itemName);
      if (englishName) {
        menuItem = menuMap.get(englishName.toLowerCase().trim());
      }
    }

    let unitCost = 0;
    let costSource: "recipe" | "default_cogs" | "none" = "none";
    let foodCostPct = 0;

    if (menuItem) {
      if (menuItem.hasRecipe && menuItem.recipeId) {
        const recipe = recipeMap.get(menuItem.recipeId);
        if (recipe && recipe.totalCost) {
          unitCost = parseFloat(recipe.totalCost);
          costSource = "recipe";
          foodCostPct = recipe.foodCostPct ? parseFloat(recipe.foodCostPct) : 0;
        }
      }
      if (costSource === "none" && menuItem.defaultCogsPct) {
        const cogsPct = parseFloat(menuItem.defaultCogsPct);
        if (cogsPct > 0 && revenue > 0 && qty > 0) {
          unitCost = (revenue / qty) * (cogsPct / 100);
          costSource = "default_cogs";
          foodCostPct = cogsPct;
        }
      }
    } else {
      // Step 3: Try direct recipe name match as fallback
      const recipe = recipeNameMap.get(itemNameLower);
      if (recipe && recipe.totalCost) {
        unitCost = parseFloat(recipe.totalCost);
        costSource = "recipe";
        foodCostPct = recipe.foodCostPct ? parseFloat(recipe.foodCostPct) : 0;
      }
    }

    const totalCost = unitCost * qty;
    const grossProfit = revenue - totalCost;
    const grossMarginPct = revenue > 0 ? ((grossProfit / revenue) * 100) : 0;

    return {
      ...sale,
      unitCost: unitCost.toFixed(4),
      totalCost: totalCost.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      grossMarginPct: grossMarginPct.toFixed(1),
      foodCostPct: foodCostPct.toFixed(1),
      costSource,
    };
  });

  return enriched;
}

// ─── Month-over-Month Comparison ───
export async function getProductSalesMoM(locationId?: number, currentPeriodStart?: string, currentPeriodEnd?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Current period
  const currentConditions = [eq(productSales.section, "items")];
  if (locationId) currentConditions.push(eq(productSales.locationId, locationId));
  if (currentPeriodStart) currentConditions.push(sql`${productSales.periodStart} >= ${currentPeriodStart}`);
  if (currentPeriodEnd) currentConditions.push(sql`${productSales.periodEnd} <= ${currentPeriodEnd}`);

  const currentRows = await db.select()
    .from(productSales)
    .where(and(...currentConditions));

  // Calculate previous period (shift back by the same duration)
  let prevRows: typeof currentRows = [];
  if (currentPeriodStart && currentPeriodEnd) {
    const start = new Date(currentPeriodStart);
    const end = new Date(currentPeriodEnd);
    const durationMs = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - durationMs - 86400000); // -1 day buffer
    const prevEnd = new Date(start.getTime() - 86400000);

    const prevStartStr = prevStart.toISOString().split("T")[0];
    const prevEndStr = prevEnd.toISOString().split("T")[0];

    const prevConditions = [eq(productSales.section, "items")];
    if (locationId) prevConditions.push(eq(productSales.locationId, locationId));
    prevConditions.push(sql`${productSales.periodStart} >= ${prevStartStr}`);
    prevConditions.push(sql`${productSales.periodEnd} <= ${prevEndStr}`);

    prevRows = await db.select()
      .from(productSales)
      .where(and(...prevConditions));
  }

  // Aggregate by item name
  const currentMap = new Map<string, { revenue: number; qty: number; category: string | null }>();
  for (const row of currentRows) {
    const key = row.itemName;
    const existing = currentMap.get(key) || { revenue: 0, qty: 0, category: row.category };
    existing.revenue += parseFloat(row.totalRevenue || "0");
    existing.qty += (row.quantitySold || 0);
    currentMap.set(key, existing);
  }

  const prevMap = new Map<string, { revenue: number; qty: number }>();
  for (const row of prevRows) {
    const key = row.itemName;
    const existing = prevMap.get(key) || { revenue: 0, qty: 0 };
    existing.revenue += parseFloat(row.totalRevenue || "0");
    existing.qty += (row.quantitySold || 0);
    prevMap.set(key, existing);
  }

  // Build comparison
  const allItems = new Set([...Array.from(currentMap.keys()), ...Array.from(prevMap.keys())]);
  const comparison = Array.from(allItems).map(itemName => {
    const curr = currentMap.get(itemName) || { revenue: 0, qty: 0, category: null };
    const prev = prevMap.get(itemName) || { revenue: 0, qty: 0 };

    const revenueChange = prev.revenue > 0 ? ((curr.revenue - prev.revenue) / prev.revenue) * 100 : (curr.revenue > 0 ? 100 : 0);
    const qtyChange = prev.qty > 0 ? ((curr.qty - prev.qty) / prev.qty) * 100 : (curr.qty > 0 ? 100 : 0);

    return {
      itemName,
      category: curr.category,
      currentRevenue: curr.revenue,
      previousRevenue: prev.revenue,
      revenueChange: parseFloat(revenueChange.toFixed(1)),
      currentQty: curr.qty,
      previousQty: prev.qty,
      qtyChange: parseFloat(qtyChange.toFixed(1)),
      isNew: prev.revenue === 0 && curr.revenue > 0,
      isDropped: curr.revenue === 0 && prev.revenue > 0,
    };
  });

  return comparison.sort((a, b) => b.currentRevenue - a.currentRevenue);
}

// ─── Menu Engineering Quadrant Analysis ───
export async function getMenuEngineering(locationId?: number, periodStart?: string, periodEnd?: string) {
  // Get enriched sales data
  const enriched = await getProductSalesWithCosts(locationId, periodStart, periodEnd);

  if (enriched.length === 0) return { items: [], avgMargin: 0, avgPopularity: 0 };

  // Calculate averages for quadrant thresholds
  const totalRevenue = enriched.reduce((s, r) => s + parseFloat(r.totalRevenue || "0"), 0);
  const totalQty = enriched.reduce((s, r) => s + (r.quantitySold || 0), 0);
  const avgMargin = enriched.reduce((s, r) => s + parseFloat(r.grossMarginPct), 0) / enriched.length;
  const avgPopularity = totalQty / enriched.length;

  // Classify each item
  const items = enriched.map(item => {
    const margin = parseFloat(item.grossMarginPct);
    const popularity = item.quantitySold || 0;
    const revenue = parseFloat(item.totalRevenue || "0");

    let quadrant: "star" | "plowhorse" | "puzzle" | "dog";
    if (margin >= avgMargin && popularity >= avgPopularity) {
      quadrant = "star"; // High margin, high popularity
    } else if (margin < avgMargin && popularity >= avgPopularity) {
      quadrant = "plowhorse"; // Low margin, high popularity
    } else if (margin >= avgMargin && popularity < avgPopularity) {
      quadrant = "puzzle"; // High margin, low popularity
    } else {
      quadrant = "dog"; // Low margin, low popularity
    }

    return {
      itemName: item.itemName,
      category: item.category,
      revenue,
      quantity: popularity,
      grossMarginPct: margin,
      costSource: item.costSource,
      quadrant,
      unitCost: parseFloat(item.unitCost),
      totalCost: parseFloat(item.totalCost),
      grossProfit: parseFloat(item.grossProfit),
    };
  });

  return {
    items,
    avgMargin: parseFloat(avgMargin.toFixed(1)),
    avgPopularity: Math.round(avgPopularity),
    totalRevenue,
    totalQty,
  };
}

// ─── CFO Intelligence Dashboard ───

/**
 * Get profitability analysis by store for a date range.
 * Computes revenue, labor cost, estimated COGS, gross profit, and margins.
 */
export async function getCFOProfitability(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    locationId: dailySales.locationId,
    revenue: sql<string>`SUM(${dailySales.totalSales})`,
    laborCost: sql<string>`SUM(${dailySales.labourCost})`,
    orders: sql<number>`SUM(${dailySales.orderCount})`,
    tips: sql<string>`SUM(${dailySales.tipsCollected})`,
    gst: sql<string>`SUM(${dailySales.gstCollected})`,
    qst: sql<string>`SUM(${dailySales.qstCollected})`,
    merchantFees: sql<string>`SUM(${dailySales.merchantFees})`,
    days: sql<number>`COUNT(DISTINCT ${dailySales.saleDate})`,
  }).from(dailySales)
    .where(sql`${dailySales.saleDate} >= ${startDate} AND ${dailySales.saleDate} <= ${endDate}`)
    .groupBy(dailySales.locationId);

  const locations = await getAllLocations();
  const locMap = new Map(locations.map(l => [l.id, l]));

  return rows.map(r => {
    const loc = locMap.get(r.locationId);
    const revenue = parseFloat(r.revenue || "0");
    const laborCost = parseFloat(r.laborCost || "0");
    const foodCostTarget = parseFloat(loc?.foodCostTarget || "30") / 100;
    const laborTarget = parseFloat(loc?.laborTarget || "25") / 100;
    const estimatedCOGS = revenue * foodCostTarget;
    const grossProfit = revenue - estimatedCOGS;
    const netAfterLabor = grossProfit - laborCost;
    const laborPct = revenue > 0 ? (laborCost / revenue) * 100 : 0;
    const primeCostPct = revenue > 0 ? ((laborCost + estimatedCOGS) / revenue) * 100 : 0;
    const avgDailyRevenue = r.days > 0 ? revenue / r.days : 0;
    const avgTicket = r.orders > 0 ? revenue / r.orders : 0;

    return {
      locationId: r.locationId,
      code: loc?.code || 'UNK',
      name: loc?.name || 'Unknown',
      revenue,
      laborCost,
      estimatedCOGS,
      grossProfit,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      netAfterLabor,
      netMarginPct: revenue > 0 ? (netAfterLabor / revenue) * 100 : 0,
      laborPct,
      laborTarget: laborTarget * 100,
      foodCostTarget: foodCostTarget * 100,
      primeCostPct,
      orders: r.orders,
      avgDailyRevenue,
      avgTicket,
      tips: parseFloat(r.tips || "0"),
      gst: parseFloat(r.gst || "0"),
      qst: parseFloat(r.qst || "0"),
      merchantFees: parseFloat(r.merchantFees || "0"),
      days: r.days,
    };
  });
}

/**
 * Get monthly revenue trends for YoY/MoM comparison.
 */
export async function getCFORevenueTrends(locationId?: number) {
  const db = await getDb();
  if (!db) return [];
  const locFilter = locationId ? sql`WHERE locationId = ${locationId}` : sql``;
  const rows = await db.execute(sql`
    SELECT
      DATE_FORMAT(saleDate, '%Y-%m') AS month,
      SUM(totalSales) AS revenue,
      SUM(labourCost) AS laborCost,
      SUM(orderCount) AS orders,
      COUNT(DISTINCT saleDate) AS days
    FROM dailySales
    ${locFilter}
    GROUP BY DATE_FORMAT(saleDate, '%Y-%m')
    ORDER BY DATE_FORMAT(saleDate, '%Y-%m') ASC
  `);

  const data = (rows as any)[0] || rows;
  return (Array.isArray(data) ? data : []).map((r: any) => {
    const revenue = parseFloat(r.revenue || '0');
    const laborCost = parseFloat(r.laborCost || '0');
    const orders = parseInt(r.orders || '0', 10);
    const days = parseInt(r.days || '0', 10);
    return {
      month: String(r.month || ''),
      revenue,
      laborCost,
      orders,
      days,
      avgDaily: days > 0 ? revenue / days : 0,
      avgTicket: orders > 0 ? revenue / orders : 0,
    };
  });
}

/**
 * Get labor efficiency metrics by store.
 */
export async function getCFOLaborEfficiency(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];

  // Get daily sales labor data
  const salesLabor = await db.select({
    locationId: dailySales.locationId,
    revenue: sql<string>`SUM(${dailySales.totalSales})`,
    laborCost: sql<string>`SUM(${dailySales.labourCost})`,
    orders: sql<number>`SUM(${dailySales.orderCount})`,
    days: sql<number>`COUNT(DISTINCT ${dailySales.saleDate})`,
  }).from(dailySales)
    .where(sql`${dailySales.saleDate} >= ${startDate} AND ${dailySales.saleDate} <= ${endDate}`)
    .groupBy(dailySales.locationId);

  // Get payroll data for hours
  const payroll = await db.select({
    locationId: payrollRecords.locationId,
    totalHours: sql<string>`SUM(${payrollRecords.totalHours})`,
    grossWages: sql<string>`SUM(${payrollRecords.grossWages})`,
    headcount: sql<number>`SUM(${payrollRecords.headcount})`,
  }).from(payrollRecords)
    .where(sql`${payrollRecords.periodStart} >= ${startDate} AND ${payrollRecords.periodEnd} <= ${endDate}`)
    .groupBy(payrollRecords.locationId);

  const payrollMap = new Map(payroll.map(p => [p.locationId, p]));
  const locations = await getAllLocations();
  const locMap = new Map(locations.map(l => [l.id, l]));

  return salesLabor.map(s => {
    const loc = locMap.get(s.locationId);
    const pay = payrollMap.get(s.locationId);
    const revenue = parseFloat(s.revenue || "0");
    const laborCost = parseFloat(s.laborCost || "0");
    const hours = parseFloat(pay?.totalHours || "0");
    const revenuePerHour = hours > 0 ? revenue / hours : 0;
    const laborPct = revenue > 0 ? (laborCost / revenue) * 100 : 0;
    const target = parseFloat(loc?.laborTarget || "25");

    return {
      locationId: s.locationId,
      code: loc?.code || 'UNK',
      name: loc?.name || 'Unknown',
      revenue,
      laborCost,
      laborPct,
      laborTarget: target,
      laborVariance: laborPct - target,
      hours,
      revenuePerHour,
      costPerHour: hours > 0 ? laborCost / hours : 0,
      avgDailyRevenue: s.days > 0 ? revenue / s.days : 0,
      orders: s.orders,
      headcount: pay?.headcount || 0,
      days: s.days,
    };
  });
}

/**
 * Get seasonal heatmap data: monthly item popularity.
 */
export async function getSeasonalHeatmap(locationId?: number) {
  const db = await getDb();
  if (!db) return [];

  const locFilter = locationId ? sql`AND locationId = ${locationId}` : sql``;
  const rows = await db.execute(sql`
    SELECT
      itemName,
      category,
      DATE_FORMAT(periodStart, '%Y-%m') AS month,
      SUM(totalRevenue) AS revenue,
      SUM(quantitySold) AS quantity
    FROM productSales
    WHERE section = 'items' ${locFilter}
    GROUP BY itemName, category, DATE_FORMAT(periodStart, '%Y-%m')
    ORDER BY SUM(totalRevenue) DESC
  `);

  const data = (rows as any)[0] || rows;
  return (Array.isArray(data) ? data : []).map((r: any) => ({
    itemName: String(r.itemName || ''),
    category: r.category ? String(r.category) : null,
    month: String(r.month || ''),
    revenue: parseFloat(r.revenue || '0'),
    quantity: parseInt(r.quantity || '0', 10),
  }));
}

/**
 * Cash Flow Forecast: projects revenue for 30/60/90 days using weighted moving average + day-of-week seasonality.
 * Uses last 90 days of actual data to build the model.
 */
export async function getCashFlowForecast() {
  const db = await getDb();
  if (!db) return null;

  // Get last 180 days of daily sales data per location for trend + seasonality
  const rows = await db.execute(sql`
    SELECT
      locationId,
      saleDate,
      totalSales AS revenue,
      labourCost,
      orderCount
    FROM dailySales
    WHERE saleDate >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)
    ORDER BY saleDate ASC
  `);

  const data = (rows as any)[0] || rows;
  if (!Array.isArray(data) || data.length === 0) return null;

  // Get all locations
  const locRows = await db.execute(sql`SELECT id, code, name FROM locations WHERE isActive = 1`);
  const locData = (locRows as any)[0] || locRows;
  const locationMap = new Map<number, { code: string; name: string }>();
  for (const loc of (locData as any[])) {
    locationMap.set(loc.id, { code: loc.code, name: loc.name });
  }

  // Group data by location
  const byLocation = new Map<number, { date: string; revenue: number; laborCost: number; orders: number }[]>();
  for (const row of (data as any[])) {
    const locId = row.locationId;
    if (!byLocation.has(locId)) byLocation.set(locId, []);
    byLocation.get(locId)!.push({
      date: typeof row.saleDate === 'string' ? row.saleDate : new Date(row.saleDate).toISOString().slice(0, 10),
      revenue: parseFloat(row.revenue || '0'),
      laborCost: parseFloat(row.labourCost || '0'),
      orders: parseInt(row.orderCount || '0', 10),
    });
  }

  // Build forecast per location
  const forecasts: {
    locationId: number;
    locationCode: string;
    locationName: string;
    historicalDays: number;
    avgDailyRevenue: number;
    recentTrend: number; // % change last 30d vs prior 30d
    forecast30: number;
    forecast60: number;
    forecast90: number;
    forecastOptimistic30: number;
    forecastOptimistic60: number;
    forecastOptimistic90: number;
    forecastPessimistic30: number;
    forecastPessimistic60: number;
    forecastPessimistic90: number;
    laborForecast30: number;
    laborForecast60: number;
    laborForecast90: number;
    dailyProjections: { date: string; projected: number; optimistic: number; pessimistic: number }[];
  }[] = [];

  type SaleEntry = { date: string; revenue: number; laborCost: number; orders: number };
  for (const [locId, sales] of Array.from(byLocation.entries())) {
    const loc = locationMap.get(locId);
    if (!loc || sales.length < 14) continue; // Need at least 14 days

    // Sort by date
    sales.sort((a: SaleEntry, b: SaleEntry) => a.date.localeCompare(b.date));

    // Calculate day-of-week seasonality factors (0=Sun, 6=Sat)
    const dowRevenues: number[][] = [[], [], [], [], [], [], []];
    for (const s of sales) {
      const dow = new Date(s.date + 'T12:00:00').getDay();
      dowRevenues[dow].push(s.revenue);
    }
    const overallAvg = sales.reduce((sum: number, s: SaleEntry) => sum + s.revenue, 0) / sales.length;
    const dowFactors = dowRevenues.map(arr =>
      arr.length > 0 ? (arr.reduce((a: number, b: number) => a + b, 0) / arr.length) / (overallAvg || 1) : 1
    );

    // Weighted moving average: more recent days get higher weight
    // Use last 90 days with exponential decay
    const recent90 = sales.slice(-90);
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < recent90.length; i++) {
      const weight = Math.exp(0.02 * (i - recent90.length + 1)); // exponential decay
      weightedSum += recent90[i].revenue * weight;
      weightTotal += weight;
    }
    const weightedAvg = weightTotal > 0 ? weightedSum / weightTotal : overallAvg;

    // Recent trend: last 30d vs prior 30d
    const last30 = sales.slice(-30);
    const prior30 = sales.slice(-60, -30);
    const last30Avg = last30.length > 0 ? last30.reduce((s: number, d: SaleEntry) => s + d.revenue, 0) / last30.length : 0;
    const prior30Avg = prior30.length > 0 ? prior30.reduce((s: number, d: SaleEntry) => s + d.revenue, 0) / prior30.length : 0;
    const trendPct = prior30Avg > 0 ? ((last30Avg - prior30Avg) / prior30Avg) * 100 : 0;

    // Daily trend adjustment (small linear trend per day)
    const dailyTrendFactor = prior30Avg > 0 ? (last30Avg - prior30Avg) / (30 * prior30Avg) : 0;

    // Labor cost ratio
    const totalLabor = sales.reduce((s: number, d: SaleEntry) => s + d.laborCost, 0);
    const totalRevenue = sales.reduce((s: number, d: SaleEntry) => s + d.revenue, 0);
    const laborRatio = totalRevenue > 0 ? totalLabor / totalRevenue : 0.25;

    // Standard deviation for confidence intervals
    const revenueValues: number[] = last30.map((d: SaleEntry) => d.revenue);
    const mean = revenueValues.reduce((a: number, b: number) => a + b, 0) / (revenueValues.length || 1);
    const variance = revenueValues.reduce((sum: number, v: number) => sum + (v - mean) ** 2, 0) / (revenueValues.length || 1);
    const stdDev = Math.sqrt(variance);
    const confidenceMultiplier = 1.28; // ~80% confidence interval

    // Project each day for next 90 days
    const dailyProjections: { date: string; projected: number; optimistic: number; pessimistic: number }[] = [];
    let forecast30 = 0, forecast60 = 0, forecast90 = 0;
    let optimistic30 = 0, optimistic60 = 0, optimistic90 = 0;
    let pessimistic30 = 0, pessimistic60 = 0, pessimistic90 = 0;

    const today = new Date();
    for (let d = 1; d <= 90; d++) {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + d);
      const dow = futureDate.getDay();
      const dateStr = futureDate.toISOString().slice(0, 10);

      // Base projection = weighted avg * day-of-week factor * trend adjustment
      const trendAdj = 1 + (dailyTrendFactor * d);
      const projected = Math.max(0, weightedAvg * dowFactors[dow] * trendAdj);
      const optimistic = Math.max(0, projected + stdDev * confidenceMultiplier * Math.sqrt(d / 30));
      const pessimistic = Math.max(0, projected - stdDev * confidenceMultiplier * Math.sqrt(d / 30));

      dailyProjections.push({ date: dateStr, projected, optimistic, pessimistic });

      if (d <= 30) {
        forecast30 += projected;
        optimistic30 += optimistic;
        pessimistic30 += pessimistic;
      }
      if (d <= 60) {
        forecast60 += projected;
        optimistic60 += optimistic;
        pessimistic60 += pessimistic;
      }
      forecast90 += projected;
      optimistic90 += optimistic;
      pessimistic90 += pessimistic;
    }

    forecasts.push({
      locationId: locId,
      locationCode: loc.code,
      locationName: loc.name,
      historicalDays: sales.length,
      avgDailyRevenue: overallAvg,
      recentTrend: trendPct,
      forecast30, forecast60, forecast90,
      forecastOptimistic30: optimistic30,
      forecastOptimistic60: optimistic60,
      forecastOptimistic90: optimistic90,
      forecastPessimistic30: pessimistic30,
      forecastPessimistic60: pessimistic60,
      forecastPessimistic90: pessimistic90,
      laborForecast30: forecast30 * laborRatio,
      laborForecast60: forecast60 * laborRatio,
      laborForecast90: forecast90 * laborRatio,
      dailyProjections,
    });
  }

  // Compute totals across all locations
  const total30 = forecasts.reduce((s, f) => s + f.forecast30, 0);
  const total60 = forecasts.reduce((s, f) => s + f.forecast60, 0);
  const total90 = forecasts.reduce((s, f) => s + f.forecast90, 0);
  const totalOpt30 = forecasts.reduce((s, f) => s + f.forecastOptimistic30, 0);
  const totalOpt60 = forecasts.reduce((s, f) => s + f.forecastOptimistic60, 0);
  const totalOpt90 = forecasts.reduce((s, f) => s + f.forecastOptimistic90, 0);
  const totalPess30 = forecasts.reduce((s, f) => s + f.forecastPessimistic30, 0);
  const totalPess60 = forecasts.reduce((s, f) => s + f.forecastPessimistic60, 0);
  const totalPess90 = forecasts.reduce((s, f) => s + f.forecastPessimistic90, 0);
  const totalLabor30 = forecasts.reduce((s, f) => s + f.laborForecast30, 0);
  const totalLabor60 = forecasts.reduce((s, f) => s + f.laborForecast60, 0);
  const totalLabor90 = forecasts.reduce((s, f) => s + f.laborForecast90, 0);

  return {
    generatedAt: new Date().toISOString(),
    storeForecasts: forecasts,
    totals: {
      forecast30: total30, forecast60: total60, forecast90: total90,
      optimistic30: totalOpt30, optimistic60: totalOpt60, optimistic90: totalOpt90,
      pessimistic30: totalPess30, pessimistic60: totalPess60, pessimistic90: totalPess90,
      laborForecast30: totalLabor30, laborForecast60: totalLabor60, laborForecast90: totalLabor90,
    },
  };
}


// ─── Quotations / Proformas ───
export async function getQuotations(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(quotations).where(eq(quotations.status, status as any)).orderBy(desc(quotations.quotationDate));
  }
  return db.select().from(quotations).orderBy(desc(quotations.quotationDate));
}

export async function getQuotationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  return rows[0] || null;
}

export async function getQuotationCount() {
  const db = await getDb();
  if (!db) return { total: 0, draft: 0, pendingAdvance: 0, advancePaid: 0, converted: 0, expired: 0, totalAmount: 0, pendingAdvanceAmount: 0 };
  const result = await db.select({
    total: sql<number>`COUNT(*)`,
    draft: sql<number>`SUM(CASE WHEN quotation_status = 'draft' THEN 1 ELSE 0 END)`,
    pendingAdvance: sql<number>`SUM(CASE WHEN quotation_status = 'pending_advance' THEN 1 ELSE 0 END)`,
    advancePaid: sql<number>`SUM(CASE WHEN quotation_status = 'advance_paid' THEN 1 ELSE 0 END)`,
    converted: sql<number>`SUM(CASE WHEN quotation_status = 'converted' THEN 1 ELSE 0 END)`,
    expired: sql<number>`SUM(CASE WHEN quotation_status = 'expired' THEN 1 ELSE 0 END)`,
    totalAmount: sql<number>`COALESCE(SUM(total), 0)`,
    pendingAdvanceAmount: sql<number>`COALESCE(SUM(CASE WHEN quotation_status = 'pending_advance' THEN advanceAmount ELSE 0 END), 0)`,
  }).from(quotations);
  return result[0] || { total: 0, draft: 0, pendingAdvance: 0, advancePaid: 0, converted: 0, expired: 0, totalAmount: 0, pendingAdvanceAmount: 0 };
}

export async function createQuotation(data: {
  quotationNumber?: string;
  supplierId?: number;
  locationId?: number;
  quotationDate?: string;
  expiryDate?: string;
  subtotal?: string;
  gst?: string;
  qst?: string;
  total?: string;
  status?: string;
  advanceRequired?: boolean;
  advanceAmount?: string;
  advancePaidStatus?: string;
  glAccount?: string;
  notes?: string;
  fileUrl?: string;
  fileKey?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(quotations).values(data as any);
  return (result as any)[0]?.insertId;
}

export async function updateQuotation(id: number, data: Record<string, any>) {
  const db = await getDb();
  if (!db) return;
  await db.update(quotations).set(data as any).where(eq(quotations.id, id));
}

export async function updateQuotationAdvance(id: number, data: {
  advancePaidStatus: "not_required" | "unpaid" | "paid";
  advancePaidAt?: Date | null;
  advancePaymentRef?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, any> = { advancePaidStatus: data.advancePaidStatus };
  if (data.advancePaidStatus === "paid") {
    updateData.advancePaidAt = data.advancePaidAt || new Date();
    updateData.advancePaymentRef = data.advancePaymentRef || null;
    updateData.status = "advance_paid";
  } else if (data.advancePaidStatus === "unpaid") {
    updateData.advancePaidAt = null;
    updateData.advancePaymentRef = null;
    updateData.status = "pending_advance";
  }
  await db.update(quotations).set(updateData as any).where(eq(quotations.id, id));
}

export async function convertQuotationToInvoice(quotationId: number) {
  const db = await getDb();
  if (!db) return null;
  const q = await getQuotationById(quotationId);
  if (!q) throw new Error("Quotation not found");
  if (q.status === "converted") throw new Error("Quotation already converted to invoice");
  if (q.advanceRequired && q.advancePaidStatus !== "paid") {
    throw new Error("Advance payment must be paid before converting to invoice");
  }
  // Create invoice from quotation data
  const invoiceData: Record<string, any> = {
    supplierId: q.supplierId,
    locationId: q.locationId,
    invoiceDate: q.quotationDate,
    subtotal: q.subtotal,
    gst: q.gst,
    qst: q.qst,
    total: q.total,
    status: "pending",
    glAccount: q.glAccount,
    notes: q.notes ? `Converted from Quotation #${q.quotationNumber || q.id}. ${q.notes}` : `Converted from Quotation #${q.quotationNumber || q.id}`,
    quotationId: q.id,
  };
  const result = await db.insert(invoices).values(invoiceData as any);
  const invoiceId = (result as any)[0]?.insertId;
  // Update quotation status
  await db.update(quotations).set({
    status: "converted" as any,
    convertedInvoiceId: invoiceId,
  }).where(eq(quotations.id, quotationId));
  return invoiceId;
}

export async function updateQuotationFile(id: number, data: {
  fileUrl?: string | null;
  fileKey?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(quotations).set(data as any).where(eq(quotations.id, id));
}

// ─── Processed Emails ───

export async function getProcessedEmails(limit = 50, offset = 0) {
  const d = await getDb();
  if (!d) return [];
  return d.select().from(processedEmails).orderBy(sql`${processedEmails.receivedAt} DESC`).limit(limit).offset(offset);
}

export async function getProcessedEmailByMessageId(messageId: string) {
  const d = await getDb();
  if (!d) return null;
  const rows = await d.select().from(processedEmails).where(eq(processedEmails.messageId, messageId)).limit(1);
  return rows[0] || null;
}

export async function upsertProcessedEmail(data: {
  messageId: string;
  subject?: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt?: Date;
  hasAttachments?: boolean;
  attachmentCount?: number;
  status?: "pending" | "processed" | "skipped" | "error";
  extractedSupplier?: string;
  extractedAmount?: number;
  extractedInvoiceNumber?: string;
  extractedDate?: string;
  linkedInvoiceId?: number;
  fileUrl?: string;
  notes?: string;
  processedAt?: Date;
}) {
  const d = await getDb();
  if (!d) return;
  const existing = await getProcessedEmailByMessageId(data.messageId);
  if (existing) {
    await d.update(processedEmails).set({
      ...data,
      extractedAmount: data.extractedAmount !== undefined ? String(data.extractedAmount) : undefined,
    } as any).where(eq(processedEmails.messageId, data.messageId));
    return existing.id;
  } else {
    const result = await d.insert(processedEmails).values({
      ...data,
      extractedAmount: data.extractedAmount !== undefined ? String(data.extractedAmount) : undefined,
    } as any);
    return (result as any)[0]?.insertId;
  }
}

export async function getProcessedEmailStats() {
  const d = await getDb();
  if (!d) return { total: 0, processed: 0, pending: 0, skipped: 0, error: 0 };
  const rows = await d.select({
    status: processedEmails.status,
    count: sql<number>`count(*)`,
  }).from(processedEmails).groupBy(processedEmails.status);
  const stats = { total: 0, processed: 0, pending: 0, skipped: 0, error: 0 };
  for (const r of rows) {
    const c = Number(r.count);
    stats.total += c;
    if (r.status === "processed") stats.processed = c;
    if (r.status === "pending") stats.pending = c;
    if (r.status === "skipped") stats.skipped = c;
    if (r.status === "error") stats.error = c;
  }
  return stats;
}
