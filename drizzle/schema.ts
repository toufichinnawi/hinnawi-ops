import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, date, boolean, json, unique } from "drizzle-orm/mysql-core";

// ─── Users ───
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Locations ───
export const locations = mysqlTable("locations", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  entityName: varchar("entityName", { length: 256 }),
  address: text("address"),
  laborTarget: decimal("laborTarget", { precision: 5, scale: 2 }).default("25.00"),
  foodCostTarget: decimal("foodCostTarget", { precision: 5, scale: 2 }).default("30.00"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Suppliers / Vendors ───
export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  code: varchar("code", { length: 32 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
  address: text("address"),
  category: varchar("category", { length: 64 }),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Quotations / Proformas ───
export const quotations = mysqlTable("quotations", {
  id: int("id").autoincrement().primaryKey(),
  quotationNumber: varchar("quotationNumber", { length: 64 }),
  supplierId: int("supplierId"),
  locationId: int("locationId"),
  quotationDate: date("quotationDate"),
  expiryDate: date("expiryDate"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0.00"),
  gst: decimal("gst", { precision: 10, scale: 2 }).default("0.00"),
  qst: decimal("qst", { precision: 10, scale: 2 }).default("0.00"),
  total: decimal("total", { precision: 12, scale: 2 }).default("0.00"),
  status: mysqlEnum("quotation_status", ["draft", "pending_advance", "advance_paid", "accepted", "converted", "expired", "rejected"]).default("draft"),
  advanceRequired: boolean("advanceRequired").default(false),
  advanceAmount: decimal("advanceAmount", { precision: 12, scale: 2 }).default("0.00"),
  advancePaidAt: timestamp("advancePaidAt"),
  advancePaymentRef: varchar("advancePaymentRef", { length: 128 }),
  advancePaidStatus: mysqlEnum("advancePaidStatus", ["not_required", "unpaid", "paid"]).default("not_required"),
  convertedInvoiceId: int("convertedInvoiceId"),
  glAccount: varchar("glAccount", { length: 128 }),
  notes: text("notes"),
  fileUrl: text("fileUrl"),
  fileKey: varchar("fileKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Invoices (Supplier Bills) ───
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 64 }),
  supplierId: int("supplierId"),
  locationId: int("locationId"),
  invoiceDate: date("invoiceDate"),
  dueDate: date("dueDate"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0.00"),
  gst: decimal("gst", { precision: 10, scale: 2 }).default("0.00"),
  qst: decimal("qst", { precision: 10, scale: 2 }).default("0.00"),
  total: decimal("total", { precision: 12, scale: 2 }).default("0.00"),
  status: mysqlEnum("status", ["pending", "approved", "paid", "rejected"]).default("pending"),
  glAccount: varchar("glAccount", { length: 128 }),
  qboSynced: boolean("qboSynced").default(false),
  qboSyncStatus: mysqlEnum("qboSyncStatus", ["not_synced", "pending", "synced", "failed"]).default("not_synced"),
  qboSyncError: text("qboSyncError"),
  qboSyncedAt: timestamp("qboSyncedAt"),
  qboBillId: varchar("qboBillId", { length: 64 }),
  notes: text("notes"),
  fileUrl: text("fileUrl"),
  fileKey: varchar("fileKey", { length: 512 }),
  deliveryNoteUrl: text("deliveryNoteUrl"),
  deliveryNoteKey: varchar("deliveryNoteKey", { length: 512 }),
  autoApproved: boolean("autoApproved").default(false),
  quotationId: int("quotationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Invoice Line Items ───
export const invoiceLineItems = mysqlTable("invoiceLineItems", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoiceId").notNull(),
  productCode: varchar("productCode", { length: 64 }),
  description: varchar("description", { length: 512 }),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).default("0.000"),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 4 }).default("0.0000"),
  amount: decimal("amount", { precision: 12, scale: 2 }).default("0.00"),
  glAccount: varchar("glAccount", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Daily Sales (POS Data) ───
export const dailySales = mysqlTable("dailySales", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull(),
  saleDate: date("saleDate").notNull(),
  taxExemptSales: decimal("taxExemptSales", { precision: 12, scale: 2 }).default("0.00"),
  taxableSales: decimal("taxableSales", { precision: 12, scale: 2 }).default("0.00"),
  totalSales: decimal("totalSales", { precision: 12, scale: 2 }).default("0.00"),
  gstCollected: decimal("gstCollected", { precision: 10, scale: 2 }).default("0.00"),
  qstCollected: decimal("qstCollected", { precision: 10, scale: 2 }).default("0.00"),
  totalDeposit: decimal("totalDeposit", { precision: 12, scale: 2 }).default("0.00"),
  tipsCollected: decimal("tipsCollected", { precision: 10, scale: 2 }).default("0.00"),
  merchantFees: decimal("merchantFees", { precision: 10, scale: 2 }).default("0.00"),
  labourCost: decimal("labourCost", { precision: 12, scale: 2 }).default("0.00"),
  orderCount: int("orderCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Payroll Records ───
export const payrollRecords = mysqlTable("payrollRecords", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull(),
  payDate: date("payDate").notNull(),
  periodStart: date("periodStart"),
  periodEnd: date("periodEnd"),
  grossWages: decimal("grossWages", { precision: 12, scale: 2 }).default("0.00"),
  employerContributions: decimal("employerContributions", { precision: 10, scale: 2 }).default("0.00"),
  netPayroll: decimal("netPayroll", { precision: 12, scale: 2 }).default("0.00"),
  headcount: int("headcount").default(0),
  totalHours: decimal("totalHours", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Inventory Items (Master Catalog) ───
export const inventoryItems = mysqlTable("inventoryItems", {
  id: int("id").autoincrement().primaryKey(),
  itemCode: varchar("itemCode", { length: 64 }),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 128 }),
  unit: varchar("unit", { length: 32 }),
  purchaseAmount: decimal("purchaseAmount", { precision: 10, scale: 3 }),
  purchaseCost: decimal("purchaseCost", { precision: 10, scale: 2 }),
  avgCost: decimal("avgCost", { precision: 10, scale: 4 }).default("0.0000"),
  lastCost: decimal("lastCost", { precision: 10, scale: 4 }).default("0.0000"),
  yieldPct: decimal("yieldPct", { precision: 5, scale: 1 }).default("100.0"),
  costPerUsableUnit: decimal("costPerUsableUnit", { precision: 10, scale: 4 }).default("0.0000"),
  parLevel: decimal("parLevel", { precision: 10, scale: 2 }),
  supplierId: int("supplierId"),
  supplierName: varchar("supplierName", { length: 256 }),
  cogsAccount: varchar("cogsAccount", { length: 128 }),
  notes: text("notes"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Recipes ───
export const recipes = mysqlTable("recipes", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 128 }),
  yield: decimal("yield", { precision: 10, scale: 2 }).default("1.00"),
  yieldUnit: varchar("yieldUnit", { length: 32 }),
  sellingPrice: decimal("sellingPrice", { precision: 10, scale: 2 }),
  totalCost: decimal("totalCost", { precision: 10, scale: 4 }),
  profit: decimal("profit", { precision: 10, scale: 4 }),
  foodCostPct: decimal("foodCostPct", { precision: 5, scale: 2 }),
  isSubRecipe: boolean("isSubRecipe").default(false),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Recipe Ingredients ───
export const recipeIngredients = mysqlTable("recipeIngredients", {
  id: int("id").autoincrement().primaryKey(),
  recipeId: int("recipeId").notNull(),
  inventoryItemId: int("inventoryItemId"),
  ingredientName: varchar("ingredientName", { length: 256 }).notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 32 }),
  usableUnitCost: decimal("usableUnitCost", { precision: 10, scale: 4 }),
  lineCost: decimal("lineCost", { precision: 10, scale: 4 }),
});

// ─── Purchase Orders ───
export const purchaseOrders = mysqlTable("purchaseOrders", {
  id: int("id").autoincrement().primaryKey(),
  poNumber: varchar("poNumber", { length: 32 }),
  supplierId: int("supplierId").notNull(),
  locationId: int("locationId").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "received", "cancelled"]).default("draft"),
  orderDate: date("orderDate"),
  expectedDate: date("expectedDate"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0.00"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── PO Line Items ───
export const poLineItems = mysqlTable("poLineItems", {
  id: int("id").autoincrement().primaryKey(),
  purchaseOrderId: int("purchaseOrderId").notNull(),
  inventoryItemId: int("inventoryItemId"),
  description: varchar("description", { length: 512 }),
  quantity: decimal("quantity", { precision: 10, scale: 3 }).default("0.000"),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 4 }).default("0.0000"),
  receivedQty: decimal("receivedQty", { precision: 10, scale: 3 }),
  variance: decimal("variance", { precision: 10, scale: 3 }),
  amount: decimal("amount", { precision: 12, scale: 2 }).default("0.00"),
});

// ─── Alerts ───
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["inventory", "labor", "invoice", "receiving", "system"]).default("system"),
  severity: mysqlEnum("severity", ["urgent", "medium", "low"]).default("medium"),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  locationId: int("locationId"),
  isRead: boolean("isRead").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Import Logs ───
export const importLogs = mysqlTable("importLogs", {
  id: int("id").autoincrement().primaryKey(),
  importType: mysqlEnum("importType", ["pos_sales", "payroll", "bank_statement", "invoices", "product_sales"]).notNull(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  fileUrl: text("fileUrl"),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending"),
  recordsFound: int("recordsFound").default(0),
  recordsImported: int("recordsImported").default(0),
  recordsSkipped: int("recordsSkipped").default(0),
  recordsFailed: int("recordsFailed").default(0),
  locationId: int("locationId"),
  dateRangeStart: date("dateRangeStart"),
  dateRangeEnd: date("dateRangeEnd"),
  errors: json("errors"),
  importedBy: varchar("importedBy", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

// ─── Bank Transactions ───
export const bankTransactions = mysqlTable("bankTransactions", {
  id: int("id").autoincrement().primaryKey(),
  bankAccountId: int("bankAccountId"),
  accountName: varchar("accountName", { length: 256 }),
  transactionDate: date("transactionDate").notNull(),
  description: varchar("description", { length: 512 }),
  debit: decimal("debit", { precision: 12, scale: 2 }).default("0.00"),
  credit: decimal("credit", { precision: 12, scale: 2 }).default("0.00"),
  balance: decimal("balance", { precision: 14, scale: 2 }),
  category: varchar("category", { length: 128 }),
  matchedType: mysqlEnum("matchedType", ["unmatched", "sales_deposit", "payroll", "supplier_payment", "intercompany", "tax_payment", "loan", "other"]).default("unmatched"),
  matchedRecordId: int("matchedRecordId"),
  locationId: int("locationId"),
  importLogId: int("importLogId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── QBO OAuth Tokens ───
export const qboTokens = mysqlTable("qboTokens", {
  id: int("id").autoincrement().primaryKey(),
  realmId: varchar("realmId", { length: 64 }).notNull(),
  companyName: varchar("companyName", { length: 256 }),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt").notNull(),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt").notNull(),
  scope: varchar("scope", { length: 512 }),
  isActive: boolean("isActive").default(true),
  connectedBy: varchar("connectedBy", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── App Settings ───
export const appSettings = mysqlTable("appSettings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Sync Logs ───
export const syncLogs = mysqlTable("syncLogs", {
  id: int("id").autoincrement().primaryKey(),
  syncType: mysqlEnum("syncType", ["auto_retry", "manual_bulk", "manual_single", "scheduled"]).notNull(),
  invoiceId: int("invoiceId"),
  status: mysqlEnum("status", ["success", "failed", "skipped"]).notNull(),
  errorMessage: text("errorMessage"),
  qboBillId: varchar("qboBillId", { length: 64 }),
  triggeredBy: varchar("triggeredBy", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Integration Status ───
export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["live", "syncing", "error", "disconnected"]).default("disconnected"),
  lastSyncAt: timestamp("lastSyncAt"),
  config: json("config"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Product Sales (Breakdown by Item) ───
export const productSales = mysqlTable("productSales", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull(),
  periodStart: date("periodStart").notNull(),
  periodEnd: date("periodEnd").notNull(),
  section: mysqlEnum("section", ["items", "options"]).default("items").notNull(),
  itemName: varchar("itemName", { length: 256 }).notNull(),
  category: varchar("category", { length: 128 }),
  groupName: varchar("groupName", { length: 128 }),
  totalRevenue: decimal("totalRevenue", { precision: 12, scale: 2 }).default("0.00"),
  quantitySold: int("quantitySold").default(0),
  quantityRefunded: int("quantityRefunded").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Bank Accounts ───
export const bankAccounts = mysqlTable("bankAccounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  bankName: varchar("bankName", { length: 128 }),
  accountNumber: varchar("accountNumber", { length: 64 }),
  locationId: int("locationId").notNull(),
  accountType: mysqlEnum("accountType", ["checking", "savings", "credit_card"]).default("checking"),
  currency: varchar("currency", { length: 3 }).default("CAD"),
  qboAccountId: varchar("qboAccountId", { length: 64 }),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Menu Items (sold items with optional recipe linkage) ───
export const menuItems = mysqlTable("menuItems", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 64 }),
  sellingPrice: decimal("sellingPrice", { precision: 10, scale: 2 }),
  recipeId: int("recipeId"),
  hasRecipe: boolean("hasRecipe").default(false).notNull(),
  defaultCogsPct: decimal("defaultCogsPct", { precision: 5, scale: 2 }).default("30.00"),
  notes: text("notes"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Processed Emails ───
export const processedEmails = mysqlTable("processedEmails", {
  id: int("id").autoincrement().primaryKey(),
  messageId: varchar("messageId", { length: 512 }).notNull().unique(),
  subject: text("subject"),
  senderName: varchar("senderName", { length: 256 }),
  senderEmail: varchar("senderEmail", { length: 320 }),
  receivedAt: timestamp("receivedAt"),
  hasAttachments: boolean("hasAttachments").default(false),
  attachmentCount: int("attachmentCount").default(0),
  status: mysqlEnum("status", ["pending", "processed", "skipped", "error"]).default("pending").notNull(),
  extractedSupplier: varchar("extractedSupplier", { length: 256 }),
  extractedAmount: decimal("extractedAmount", { precision: 12, scale: 2 }),
  extractedInvoiceNumber: varchar("extractedInvoiceNumber", { length: 128 }),
  extractedDate: varchar("extractedDate", { length: 20 }),
  linkedInvoiceId: int("linkedInvoiceId"),
  fileUrl: text("fileUrl"),
  notes: text("notes"),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Ingredient Price History ───
export const ingredientPriceHistory = mysqlTable("ingredientPriceHistory", {
  id: int("id").autoincrement().primaryKey(),
  inventoryItemId: int("inventoryItemId").notNull(),
  invoiceId: int("invoiceId"),
  invoiceLineItemId: int("invoiceLineItemId"),
  supplierId: int("supplierId"),
  previousCostPerUnit: decimal("previousCostPerUnit", { precision: 10, scale: 4 }),
  newCostPerUnit: decimal("newCostPerUnit", { precision: 10, scale: 4 }).notNull(),
  previousCostPerUsableUnit: decimal("previousCostPerUsableUnit", { precision: 10, scale: 4 }),
  newCostPerUsableUnit: decimal("newCostPerUsableUnit", { precision: 10, scale: 4 }).notNull(),
  changePercent: decimal("changePercent", { precision: 8, scale: 2 }),
  quantity: decimal("quantity", { precision: 10, scale: 3 }),
  unit: varchar("unit", { length: 32 }),
  source: mysqlEnum("priceSource", ["invoice", "manual", "email_extraction", "import"]).default("invoice").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Invoice Line Item ↔ Inventory Item Matches ───
export const invoiceLineItemMatches = mysqlTable("invoiceLineItemMatches", {
  id: int("id").autoincrement().primaryKey(),
  invoiceLineItemId: int("invoiceLineItemId").notNull(),
  invoiceId: int("invoiceId").notNull(),
  inventoryItemId: int("inventoryItemId"),
  lineDescription: varchar("lineDescription", { length: 512 }),
  matchedItemName: varchar("matchedItemName", { length: 256 }),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  matchMethod: mysqlEnum("matchMethod", ["exact", "fuzzy", "ai", "manual"]).default("ai"),
  status: mysqlEnum("matchStatus", ["auto_matched", "confirmed", "rejected", "unmatched"]).default("auto_matched"),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 4 }),
  quantity: decimal("quantity", { precision: 10, scale: 3 }),
  unit: varchar("unit", { length: 32 }),
  priceApplied: boolean("priceApplied").default(false),
  reviewedBy: varchar("reviewedBy", { length: 256 }),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL STATEMENTS MODULE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── QBO Entity Connections (multi-company) ───
export const qboEntities = mysqlTable("qboEntities", {
  id: int("id").autoincrement().primaryKey(),
  locationId: int("locationId").notNull(),
  realmId: varchar("realmId", { length: 64 }).notNull(),
  companyName: varchar("companyName", { length: 256 }),
  legalName: varchar("legalName", { length: 256 }),
  fiscalYearStartMonth: int("fiscalYearStartMonth").default(9),
  qboDepartmentId: varchar("qboDepartmentId", { length: 64 }),
  qboClassId: varchar("qboClassId", { length: 64 }),
  lastSyncAt: timestamp("lastSyncAt"),
  syncStatus: mysqlEnum("qboEntitySyncStatus", ["idle", "syncing", "error"]).default("idle"),
  syncError: text("syncError"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── QBO Account Cache (synced from QuickBooks) ───
export const qboAccountCache = mysqlTable("qboAccountCache", {
  id: int("id").autoincrement().primaryKey(),
  qboEntityId: int("qboEntityId").notNull(),
  qboAccountId: varchar("qboAccountId", { length: 64 }).notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  fullyQualifiedName: varchar("fullyQualifiedName", { length: 512 }),
  accountType: varchar("accountType", { length: 64 }),
  accountSubType: varchar("accountSubType", { length: 64 }),
  classification: varchar("classification", { length: 32 }),
  currentBalance: decimal("currentBalance", { precision: 14, scale: 2 }),
  acctNum: varchar("acctNum", { length: 32 }),
  isActive: boolean("isActive").default(true),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

// ─── Account Mapping Versions (for historical stability) ───
export const accountMappingVersions = mysqlTable("accountMappingVersions", {
  id: int("id").autoincrement().primaryKey(),
  qboEntityId: int("qboEntityId").notNull(),
  versionNumber: int("versionNumber").notNull(),
  label: varchar("label", { length: 128 }),
  effectiveFrom: date("effectiveFrom").notNull(),
  effectiveTo: date("effectiveTo"),
  isActive: boolean("isActive").default(true),
  createdBy: varchar("createdBy", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Account Mappings (QBO account → statement line) ───
export const accountMappings = mysqlTable("accountMappings", {
  id: int("id").autoincrement().primaryKey(),
  versionId: int("versionId").notNull(),
  qboEntityId: int("qboEntityId").notNull(),
  qboAccountId: varchar("qboAccountId", { length: 64 }).notNull(),
  qboAccountName: varchar("qboAccountName", { length: 256 }),
  statementType: mysqlEnum("statementType", ["profit_loss", "balance_sheet"]).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  subcategory: varchar("subcategory", { length: 128 }),
  customLabel: varchar("customLabel", { length: 256 }),
  sortOrder: int("sortOrder").default(0),
  isHidden: boolean("isHidden").default(false),
  flags: json("flags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Account Mapping Audit Trail ───
export const accountMappingAudit = mysqlTable("accountMappingAudit", {
  id: int("id").autoincrement().primaryKey(),
  mappingId: int("mappingId"),
  versionId: int("versionId"),
  action: mysqlEnum("auditAction", ["create", "update", "delete", "reorder", "hide", "unhide"]).notNull(),
  fieldChanged: varchar("fieldChanged", { length: 64 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  changedBy: varchar("changedBy", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Financial Statement Line Definitions (target structure) ───
export const fsLineDefinitions = mysqlTable("fsLineDefinitions", {
  id: int("id").autoincrement().primaryKey(),
  statementType: mysqlEnum("fsLineStatementType", ["profit_loss", "balance_sheet"]).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  subcategory: varchar("subcategory", { length: 128 }),
  displayLabel: varchar("displayLabel", { length: 256 }).notNull(),
  lineType: mysqlEnum("lineType", ["header", "detail", "subtotal", "total", "spacer"]).default("detail"),
  sortOrder: int("sortOrder").default(0),
  isDefault: boolean("isDefault").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Shared Expenses ───
export const sharedExpenses = mysqlTable("sharedExpenses", {
  id: int("id").autoincrement().primaryKey(),
  expenseDate: date("expenseDate").notNull(),
  vendor: varchar("vendor", { length: 256 }),
  description: text("description"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  reportingPeriodStart: date("reportingPeriodStart"),
  reportingPeriodEnd: date("reportingPeriodEnd"),
  expenseCategory: varchar("expenseCategory", { length: 128 }),
  statementCategory: varchar("statementCategory", { length: 128 }),
  statementSubcategory: varchar("statementSubcategory", { length: 128 }),
  customLabel: varchar("customLabel", { length: 256 }),
  allocationBasis: mysqlEnum("allocationBasis", ["revenue", "fixed_pct", "equal", "manual", "payroll", "sqft"]).default("revenue"),
  entitiesIncluded: json("entitiesIncluded"),
  sourceType: mysqlEnum("expenseSourceType", ["manual", "credit_card", "journal_entry", "import"]).default("manual"),
  approvalStatus: mysqlEnum("approvalStatus", ["draft", "approved", "posted"]).default("draft"),
  fileUrl: text("fileUrl"),
  fileKey: varchar("fileKey", { length: 512 }),
  notes: text("notes"),
  createdBy: varchar("createdBy", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── Shared Expense Allocations (computed results) ───
export const sharedExpenseAllocations = mysqlTable("sharedExpenseAllocations", {
  id: int("id").autoincrement().primaryKey(),
  sharedExpenseId: int("sharedExpenseId").notNull(),
  locationId: int("locationId").notNull(),
  allocationBasis: mysqlEnum("seAllocationBasis", ["revenue", "fixed_pct", "equal", "manual", "payroll", "sqft"]).default("revenue"),
  basisValue: decimal("basisValue", { precision: 14, scale: 2 }),
  allocationPct: decimal("allocationPct", { precision: 8, scale: 4 }),
  allocatedAmount: decimal("allocatedAmount", { precision: 12, scale: 2 }).notNull(),
  revenueUsed: decimal("revenueUsed", { precision: 14, scale: 2 }),
  totalRevenue: decimal("totalRevenue", { precision: 14, scale: 2 }),
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  computedBy: varchar("computedBy", { length: 256 }),
});

// ─── QBO Report Cache (cached P&L / Balance Sheet data from QBO API) ───
export const qboReportCache = mysqlTable("qboReportCache", {
  id: int("id").autoincrement().primaryKey(),
  qboEntityId: int("qboEntityId").notNull(),
  reportType: mysqlEnum("reportType", ["ProfitAndLoss", "BalanceSheet"]).notNull(),
  startDate: date("startDate"),
  endDate: date("endDate"),
  asOfDate: date("asOfDate"),
  reportData: json("reportData"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});
