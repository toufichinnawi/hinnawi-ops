/**
 * Procurement Module — Backend Engine
 *
 * PIN authentication, PO workflow, stock tracking, waste/leftover reporting,
 * and smart ordering recommendations.
 */
import { eq, sql, desc, asc, and, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import {
  locationPins, inventoryLevels, stockMovements, purchaseOrders, poLineItems,
  wasteReports, wasteReportItems, leftoverReports, leftoverReportItems,
  orderRecommendations, vendorCatalogItems, inventoryItems, suppliers,
  locations, dailySales, recipes, recipeIngredients, productSales,
} from "../drizzle/schema";
import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════════
// PIN AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════════

function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin.trim()).digest("hex");
}

export async function createPin(data: {
  locationId: number;
  pin: string;
  label: string;
  role: "manager" | "ops_manager" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const pinH = hashPin(data.pin);
  await db.insert(locationPins).values({
    locationId: data.locationId,
    pinHash: pinH,
    label: data.label,
    role: data.role,
  });
  return { success: true };
}

export async function verifyPin(pin: string, locationId?: number): Promise<{
  valid: boolean;
  pinId?: number;
  locationId?: number;
  role?: string;
  label?: string;
}> {
  const db = await getDb();
  if (!db) return { valid: false };
  const pinH = hashPin(pin);

  let rows;
  if (locationId) {
    rows = await db.select().from(locationPins)
      .where(and(
        eq(locationPins.pinHash, pinH),
        eq(locationPins.locationId, locationId),
        eq(locationPins.isActive, true),
      ));
  } else {
    rows = await db.select().from(locationPins)
      .where(and(eq(locationPins.pinHash, pinH), eq(locationPins.isActive, true)));
  }

  if (rows.length === 0) return { valid: false };
  const match = rows[0];

  // Update last used
  await db.update(locationPins).set({ lastUsedAt: new Date() }).where(eq(locationPins.id, match.id));

  return {
    valid: true,
    pinId: match.id,
    locationId: match.locationId,
    role: match.role,
    label: match.label,
  };
}

export async function listPins() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: locationPins.id,
    locationId: locationPins.locationId,
    label: locationPins.label,
    role: locationPins.role,
    isActive: locationPins.isActive,
    lastUsedAt: locationPins.lastUsedAt,
    createdAt: locationPins.createdAt,
  }).from(locationPins).orderBy(asc(locationPins.locationId), asc(locationPins.role));
  return rows;
}

export async function deactivatePin(pinId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(locationPins).set({ isActive: false } as any).where(eq(locationPins.id, pinId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PURCHASE ORDER WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════════

export async function createPurchaseOrder(data: {
  supplierId: number;
  locationId: number;
  notes?: string;
  createdByPin?: number;
  items: Array<{
    inventoryItemId?: number;
    description: string;
    quantity: string;
    unitPrice: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Generate PO number
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(purchaseOrders);
  const count = Number(countResult[0]?.count || 0) + 1;
  const poNumber = `PO-${String(count).padStart(5, "0")}`;

  // Calculate totals
  let subtotal = 0;
  for (const item of data.items) {
    subtotal += Number(item.quantity) * Number(item.unitPrice);
  }
  const gst = subtotal * 0.05;
  const qst = subtotal * 0.09975;
  const total = subtotal + gst + qst;

  const result = await db.insert(purchaseOrders).values({
    poNumber,
    supplierId: data.supplierId,
    locationId: data.locationId,
    status: "draft",
    orderDate: new Date().toISOString().slice(0, 10),
    subtotal: subtotal.toFixed(2),
    gst: gst.toFixed(2),
    qst: qst.toFixed(2),
    total: total.toFixed(2),
    notes: data.notes || null,
    createdByPin: data.createdByPin || null,
  } as any);

  const poId = (result as any)[0]?.insertId;
  if (!poId) throw new Error("Failed to create PO");

  // Insert line items
  for (const item of data.items) {
    const amount = Number(item.quantity) * Number(item.unitPrice);
    await db.insert(poLineItems).values({
      purchaseOrderId: poId,
      inventoryItemId: item.inventoryItemId || null,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: amount.toFixed(2),
    } as any);
  }

  return { id: poId, poNumber };
}

export async function submitForApproval(poId: number, pinId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(purchaseOrders).set({
    status: "pending_approval",
    createdByPin: pinId,
  } as any).where(eq(purchaseOrders.id, poId));
  return { success: true };
}

export async function approvePurchaseOrder(poId: number, pinId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(purchaseOrders).set({
    status: "approved",
    approvedByPin: pinId,
    approvedAt: new Date(),
  } as any).where(eq(purchaseOrders.id, poId));
  return { success: true };
}

export async function rejectPurchaseOrder(poId: number, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(purchaseOrders).set({
    status: "draft",
    notes: notes || null,
  } as any).where(eq(purchaseOrders.id, poId));
  return { success: true };
}

export async function markSubmitted(poId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(purchaseOrders).set({
    status: "submitted",
    submittedAt: new Date(),
  } as any).where(eq(purchaseOrders.id, poId));
  return { success: true };
}

export async function receivePurchaseOrder(poId: number, receivedItems: Array<{
  poLineItemId: number;
  receivedQty: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the PO for location info
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) throw new Error("PO not found");

  let allReceived = true;
  for (const item of receivedItems) {
    const [line] = await db.select().from(poLineItems).where(eq(poLineItems.id, item.poLineItemId));
    if (!line) continue;

    const orderedQty = Number(line.quantity);
    const recvQty = Number(item.receivedQty);
    const variance = recvQty - orderedQty;

    await db.update(poLineItems).set({
      receivedQty: item.receivedQty,
      variance: variance.toFixed(3),
    } as any).where(eq(poLineItems.id, item.poLineItemId));

    if (recvQty < orderedQty) allReceived = false;

    // Create stock movement for received items
    if (line.inventoryItemId && recvQty > 0) {
      await recordStockMovement({
        locationId: po.locationId,
        inventoryItemId: line.inventoryItemId,
        movementType: "purchase_received",
        quantity: item.receivedQty,
        unitCost: line.unitPrice ? String(line.unitPrice) : undefined,
        referenceType: "purchase_order",
        referenceId: poId,
        movementDate: new Date().toISOString().slice(0, 10),
      });
    }
  }

  await db.update(purchaseOrders).set({
    status: allReceived ? "received" : "partially_received",
    receivedAt: new Date(),
  } as any).where(eq(purchaseOrders.id, poId));

  return { success: true, fullyReceived: allReceived };
}

export async function getPurchaseOrderWithLines(poId: number) {
  const db = await getDb();
  if (!db) return null;
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
  if (!po) return null;
  const lines = await db.select().from(poLineItems).where(eq(poLineItems.purchaseOrderId, poId));
  return { ...po, lines };
}

export async function getPurchaseOrdersByStatus(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.status, status as any))
      .orderBy(desc(purchaseOrders.createdAt));
  }
  return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt));
}

export async function updatePurchaseOrderLines(poId: number, items: Array<{
  id?: number;
  inventoryItemId?: number;
  description: string;
  quantity: string;
  unitPrice: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete existing lines and re-insert
  await db.delete(poLineItems).where(eq(poLineItems.purchaseOrderId, poId));

  let subtotal = 0;
  for (const item of items) {
    const amount = Number(item.quantity) * Number(item.unitPrice);
    subtotal += amount;
    await db.insert(poLineItems).values({
      purchaseOrderId: poId,
      inventoryItemId: item.inventoryItemId || null,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: amount.toFixed(2),
    } as any);
  }

  const gst = subtotal * 0.05;
  const qst = subtotal * 0.09975;
  const total = subtotal + gst + qst;

  await db.update(purchaseOrders).set({
    subtotal: subtotal.toFixed(2),
    gst: gst.toFixed(2),
    qst: qst.toFixed(2),
    total: total.toFixed(2),
  } as any).where(eq(purchaseOrders.id, poId));

  return { success: true, subtotal, total };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY LEVELS & STOCK MOVEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getInventoryLevels(locationId?: number) {
  const db = await getDb();
  if (!db) return [];
  if (locationId) {
    return db.select().from(inventoryLevels)
      .where(eq(inventoryLevels.locationId, locationId))
      .orderBy(asc(inventoryLevels.inventoryItemId));
  }
  return db.select().from(inventoryLevels).orderBy(asc(inventoryLevels.locationId));
}

export async function getInventoryLevelWithItem(locationId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    levelId: inventoryLevels.id,
    locationId: inventoryLevels.locationId,
    inventoryItemId: inventoryLevels.inventoryItemId,
    currentQty: inventoryLevels.currentQty,
    parLevel: inventoryLevels.parLevel,
    reorderPoint: inventoryLevels.reorderPoint,
    maxLevel: inventoryLevels.maxLevel,
    avgDailyUsage: inventoryLevels.avgDailyUsage,
    lastCountDate: inventoryLevels.lastCountDate,
    itemName: inventoryItems.name,
    itemCategory: inventoryItems.category,
    itemUnit: inventoryItems.unit,
    avgCost: inventoryItems.avgCost,
    lastCost: inventoryItems.lastCost,
    supplierId: inventoryItems.supplierId,
    supplierName: inventoryItems.supplierName,
  }).from(inventoryLevels)
    .innerJoin(inventoryItems, eq(inventoryLevels.inventoryItemId, inventoryItems.id))
    .where(eq(inventoryLevels.locationId, locationId))
    .orderBy(asc(inventoryItems.name));
  return rows;
}

export async function upsertInventoryLevel(data: {
  locationId: number;
  inventoryItemId: number;
  currentQty?: string;
  parLevel?: string;
  reorderPoint?: string;
  maxLevel?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(inventoryLevels)
    .where(and(
      eq(inventoryLevels.locationId, data.locationId),
      eq(inventoryLevels.inventoryItemId, data.inventoryItemId),
    ));

  if (existing.length > 0) {
    const updates: any = {};
    if (data.currentQty !== undefined) updates.currentQty = data.currentQty;
    if (data.parLevel !== undefined) updates.parLevel = data.parLevel;
    if (data.reorderPoint !== undefined) updates.reorderPoint = data.reorderPoint;
    if (data.maxLevel !== undefined) updates.maxLevel = data.maxLevel;
    await db.update(inventoryLevels).set(updates).where(eq(inventoryLevels.id, existing[0].id));
    return existing[0].id;
  } else {
    const result = await db.insert(inventoryLevels).values({
      locationId: data.locationId,
      inventoryItemId: data.inventoryItemId,
      currentQty: data.currentQty || "0.000",
      parLevel: data.parLevel || null,
      reorderPoint: data.reorderPoint || null,
      maxLevel: data.maxLevel || null,
    } as any);
    return (result as any)[0]?.insertId;
  }
}

export async function recordStockMovement(data: {
  locationId: number;
  inventoryItemId: number;
  movementType: "purchase_received" | "consumption" | "waste" | "leftover" | "transfer_in" | "transfer_out" | "adjustment" | "count_correction" | "return_to_vendor";
  quantity: string;
  unitCost?: string;
  referenceType?: string;
  referenceId?: number;
  notes?: string;
  reportedByPin?: number;
  movementDate: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const qty = Number(data.quantity);
  const unitCost = data.unitCost ? Number(data.unitCost) : undefined;
  const totalCost = unitCost ? (qty * unitCost) : undefined;

  await db.insert(stockMovements).values({
    locationId: data.locationId,
    inventoryItemId: data.inventoryItemId,
    movementType: data.movementType,
    quantity: data.quantity,
    unitCost: data.unitCost || null,
    totalCost: totalCost?.toFixed(2) || null,
    referenceType: data.referenceType || null,
    referenceId: data.referenceId || null,
    notes: data.notes || null,
    reportedByPin: data.reportedByPin || null,
    movementDate: data.movementDate,
  } as any);

  // Update inventory level
  const isIncrease = ["purchase_received", "transfer_in", "count_correction", "leftover"].includes(data.movementType);
  const isDecrease = ["consumption", "waste", "transfer_out", "return_to_vendor"].includes(data.movementType);

  if (isIncrease || isDecrease) {
    const existing = await db.select().from(inventoryLevels)
      .where(and(
        eq(inventoryLevels.locationId, data.locationId),
        eq(inventoryLevels.inventoryItemId, data.inventoryItemId),
      ));

    const currentQty = existing.length > 0 ? Number(existing[0].currentQty) : 0;
    const newQty = isIncrease ? currentQty + qty : Math.max(0, currentQty - qty);

    if (existing.length > 0) {
      await db.update(inventoryLevels).set({
        currentQty: newQty.toFixed(3),
      } as any).where(eq(inventoryLevels.id, existing[0].id));
    } else {
      await db.insert(inventoryLevels).values({
        locationId: data.locationId,
        inventoryItemId: data.inventoryItemId,
        currentQty: newQty.toFixed(3),
      } as any);
    }
  }

  // For count_correction, also set lastCountDate
  if (data.movementType === "count_correction") {
    await db.update(inventoryLevels).set({
      lastCountDate: data.movementDate,
      lastCountQty: data.quantity,
    } as any).where(and(
      eq(inventoryLevels.locationId, data.locationId),
      eq(inventoryLevels.inventoryItemId, data.inventoryItemId),
    ));
  }

  return { success: true };
}

export async function getStockMovements(locationId: number, opts?: {
  inventoryItemId?: number;
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(stockMovements.locationId, locationId)];
  if (opts?.inventoryItemId) conditions.push(eq(stockMovements.inventoryItemId, opts.inventoryItemId));
  if (opts?.startDate) conditions.push(gte(stockMovements.movementDate, opts.startDate));
  if (opts?.endDate) conditions.push(lte(stockMovements.movementDate, opts.endDate));

  return db.select().from(stockMovements)
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(opts?.limit || 200);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WASTE REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

export async function createWasteReport(data: {
  locationId: number;
  reportDate: string;
  reportedByPin?: number;
  notes?: string;
  items: Array<{
    inventoryItemId: number;
    quantity: string;
    unit?: string;
    reason: "expired" | "spoiled" | "overproduction" | "damaged" | "quality_issue" | "prep_waste" | "customer_return" | "other";
    notes?: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Calculate total waste cost
  let totalCost = 0;
  const itemCosts: number[] = [];
  for (const item of data.items) {
    const [inv] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.inventoryItemId));
    const cost = inv ? Number(inv.avgCost) * Number(item.quantity) : 0;
    itemCosts.push(cost);
    totalCost += cost;
  }

  const result = await db.insert(wasteReports).values({
    locationId: data.locationId,
    reportDate: data.reportDate,
    reportedByPin: data.reportedByPin || null,
    status: "submitted",
    totalWasteCost: totalCost.toFixed(2),
    notes: data.notes || null,
  } as any);

  const reportId = (result as any)[0]?.insertId;
  if (!reportId) throw new Error("Failed to create waste report");

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    await db.insert(wasteReportItems).values({
      wasteReportId: reportId,
      inventoryItemId: item.inventoryItemId,
      quantity: item.quantity,
      unit: item.unit || null,
      reason: item.reason,
      estimatedCost: itemCosts[i].toFixed(2),
      notes: item.notes || null,
    } as any);

    // Record stock movement
    await recordStockMovement({
      locationId: data.locationId,
      inventoryItemId: item.inventoryItemId,
      movementType: "waste",
      quantity: item.quantity,
      referenceType: "waste_report",
      referenceId: reportId,
      reportedByPin: data.reportedByPin,
      movementDate: data.reportDate,
      notes: `Waste: ${item.reason}`,
    });
  }

  return { id: reportId, totalWasteCost: totalCost };
}

export async function getWasteReports(locationId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  if (locationId) {
    return db.select().from(wasteReports)
      .where(eq(wasteReports.locationId, locationId))
      .orderBy(desc(wasteReports.reportDate))
      .limit(limit);
  }
  return db.select().from(wasteReports).orderBy(desc(wasteReports.reportDate)).limit(limit);
}

export async function getWasteReportWithItems(reportId: number) {
  const db = await getDb();
  if (!db) return null;
  const [report] = await db.select().from(wasteReports).where(eq(wasteReports.id, reportId));
  if (!report) return null;
  const items = await db.select({
    id: wasteReportItems.id,
    inventoryItemId: wasteReportItems.inventoryItemId,
    quantity: wasteReportItems.quantity,
    unit: wasteReportItems.unit,
    reason: wasteReportItems.reason,
    estimatedCost: wasteReportItems.estimatedCost,
    notes: wasteReportItems.notes,
    itemName: inventoryItems.name,
    itemCategory: inventoryItems.category,
  }).from(wasteReportItems)
    .leftJoin(inventoryItems, eq(wasteReportItems.inventoryItemId, inventoryItems.id))
    .where(eq(wasteReportItems.wasteReportId, reportId));
  return { ...report, items };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEFTOVER REPORTING
// ═══════════════════════════════════════════════════════════════════════════════

export async function createLeftoverReport(data: {
  locationId: number;
  reportDate: string;
  reportedByPin?: number;
  notes?: string;
  items: Array<{
    inventoryItemId: number;
    quantity: string;
    unit?: string;
    disposition: "carry_forward" | "discount_sale" | "staff_meal" | "donate" | "discard";
    notes?: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(leftoverReports).values({
    locationId: data.locationId,
    reportDate: data.reportDate,
    reportedByPin: data.reportedByPin || null,
    status: "submitted",
    notes: data.notes || null,
  } as any);

  const reportId = (result as any)[0]?.insertId;
  if (!reportId) throw new Error("Failed to create leftover report");

  for (const item of data.items) {
    const [inv] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.inventoryItemId));
    const cost = inv ? Number(inv.avgCost) * Number(item.quantity) : 0;

    await db.insert(leftoverReportItems).values({
      leftoverReportId: reportId,
      inventoryItemId: item.inventoryItemId,
      quantity: item.quantity,
      unit: item.unit || null,
      disposition: item.disposition,
      estimatedCost: cost.toFixed(2),
      notes: item.notes || null,
    } as any);

    // If discarded, record as waste movement; if carry_forward, record as leftover
    if (item.disposition === "discard") {
      await recordStockMovement({
        locationId: data.locationId,
        inventoryItemId: item.inventoryItemId,
        movementType: "waste",
        quantity: item.quantity,
        referenceType: "leftover_report",
        referenceId: reportId,
        movementDate: data.reportDate,
        notes: "Leftover discarded",
      });
    }
    // carry_forward doesn't change stock (it's already counted)
  }

  return { id: reportId };
}

export async function getLeftoverReports(locationId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  if (locationId) {
    return db.select().from(leftoverReports)
      .where(eq(leftoverReports.locationId, locationId))
      .orderBy(desc(leftoverReports.reportDate))
      .limit(limit);
  }
  return db.select().from(leftoverReports).orderBy(desc(leftoverReports.reportDate)).limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART ORDERING RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateOrderRecommendations(locationId: number) {
  const db = await getDb();
  if (!db) return [];

  // Get all inventory levels for this location
  const levels = await db.select({
    inventoryItemId: inventoryLevels.inventoryItemId,
    currentQty: inventoryLevels.currentQty,
    parLevel: inventoryLevels.parLevel,
    reorderPoint: inventoryLevels.reorderPoint,
    maxLevel: inventoryLevels.maxLevel,
    avgDailyUsage: inventoryLevels.avgDailyUsage,
    itemName: inventoryItems.name,
    itemUnit: inventoryItems.unit,
    supplierId: inventoryItems.supplierId,
    lastCost: inventoryItems.lastCost,
    avgCost: inventoryItems.avgCost,
    globalParLevel: inventoryItems.parLevel,
  }).from(inventoryLevels)
    .innerJoin(inventoryItems, eq(inventoryLevels.inventoryItemId, inventoryItems.id))
    .where(eq(inventoryLevels.locationId, locationId));

  // Calculate average daily usage from stock movements (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const usageData = await db.select({
    inventoryItemId: stockMovements.inventoryItemId,
    totalUsed: sql<string>`SUM(CAST(${stockMovements.quantity} AS DECIMAL(12,3)))`,
  }).from(stockMovements)
    .where(and(
      eq(stockMovements.locationId, locationId),
      eq(stockMovements.movementType, "consumption"),
      gte(stockMovements.movementDate, thirtyDaysStr),
    ))
    .groupBy(stockMovements.inventoryItemId);

  const usageMap = new Map(usageData.map(u => [u.inventoryItemId, Number(u.totalUsed) / 30]));

  // Clear old recommendations for this location
  await db.delete(orderRecommendations).where(
    and(
      eq(orderRecommendations.locationId, locationId),
      eq(orderRecommendations.status, "pending"),
    )
  );

  const recommendations: Array<{
    inventoryItemId: number;
    itemName: string;
    currentQty: number;
    parLevel: number;
    avgDailyUsage: number;
    daysUntilStockout: number;
    recommendedQty: number;
    estimatedCost: number;
    urgency: "critical" | "high" | "medium" | "low";
    supplierId: number | null;
  }> = [];

  for (const level of levels) {
    const currentQty = Number(level.currentQty);
    const par = Number(level.parLevel || level.globalParLevel || 0);
    const reorder = Number(level.reorderPoint || par * 0.5);
    const maxLvl = Number(level.maxLevel || par * 1.5);
    const avgUsage = usageMap.get(level.inventoryItemId) || Number(level.avgDailyUsage);
    const cost = Number(level.lastCost || level.avgCost || 0);

    if (par <= 0) continue; // No par level set, skip

    // Calculate days until stockout
    const daysUntilStockout = avgUsage > 0 ? Math.floor(currentQty / avgUsage) : 999;

    // Determine if reorder is needed
    if (currentQty > reorder && daysUntilStockout > 3) continue; // Sufficient stock

    // Recommended order: bring up to par (or max level)
    const targetLevel = maxLvl > 0 ? maxLvl : par;
    const recommendedQty = Math.max(0, targetLevel - currentQty);
    if (recommendedQty <= 0) continue;

    // Determine urgency
    let urgency: "critical" | "high" | "medium" | "low" = "medium";
    if (currentQty <= 0 || daysUntilStockout <= 1) urgency = "critical";
    else if (daysUntilStockout <= 2) urgency = "high";
    else if (daysUntilStockout <= 5) urgency = "medium";
    else urgency = "low";

    const estimatedCost = recommendedQty * cost;

    recommendations.push({
      inventoryItemId: level.inventoryItemId,
      itemName: level.itemName,
      currentQty,
      parLevel: par,
      avgDailyUsage: avgUsage,
      daysUntilStockout,
      recommendedQty,
      estimatedCost,
      urgency,
      supplierId: level.supplierId,
    });

    // Save to database
    await db.insert(orderRecommendations).values({
      locationId,
      inventoryItemId: level.inventoryItemId,
      supplierId: level.supplierId || null,
      currentQty: currentQty.toFixed(3),
      parLevel: par.toFixed(2),
      avgDailyUsage: avgUsage.toFixed(3),
      daysUntilStockout,
      recommendedQty: recommendedQty.toFixed(2),
      estimatedCost: estimatedCost.toFixed(2),
      urgency,
      status: "pending",
    } as any);

    // Update avg daily usage on the inventory level
    if (avgUsage > 0) {
      await db.update(inventoryLevels).set({
        avgDailyUsage: avgUsage.toFixed(3),
      } as any).where(and(
        eq(inventoryLevels.locationId, locationId),
        eq(inventoryLevels.inventoryItemId, level.inventoryItemId),
      ));
    }
  }

  // Sort by urgency
  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return recommendations;
}

export async function getOrderRecommendations(locationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orderRecommendations)
    .where(and(
      eq(orderRecommendations.locationId, locationId),
      eq(orderRecommendations.status, "pending"),
    ))
    .orderBy(asc(orderRecommendations.urgency));
}

export async function createPOFromRecommendations(locationId: number, supplierId: number, recommendationIds: number[], pinId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const recos = await db.select().from(orderRecommendations)
    .where(and(
      eq(orderRecommendations.locationId, locationId),
      sql`${orderRecommendations.id} IN (${sql.raw(recommendationIds.join(","))})`,
    ));

  if (recos.length === 0) throw new Error("No recommendations found");

  // Get item details
  const items: Array<{
    inventoryItemId: number;
    description: string;
    quantity: string;
    unitPrice: string;
  }> = [];

  for (const reco of recos) {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, reco.inventoryItemId));
    if (!item) continue;
    items.push({
      inventoryItemId: item.id,
      description: item.name,
      quantity: String(reco.recommendedQty),
      unitPrice: String(item.lastCost || item.avgCost || "0"),
    });
  }

  const po = await createPurchaseOrder({
    supplierId,
    locationId,
    createdByPin: pinId,
    notes: "Auto-generated from order recommendations",
    items,
  });

  // Mark recommendations as added to PO
  for (const reco of recos) {
    await db.update(orderRecommendations).set({
      status: "added_to_po",
      purchaseOrderId: po.id,
    } as any).where(eq(orderRecommendations.id, reco.id));
  }

  return po;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY COUNT (Physical Count)
// ═══════════════════════════════════════════════════════════════════════════════

export async function submitInventoryCount(data: {
  locationId: number;
  countDate: string;
  reportedByPin?: number;
  items: Array<{
    inventoryItemId: number;
    countedQty: string;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  for (const item of data.items) {
    const existing = await db.select().from(inventoryLevels)
      .where(and(
        eq(inventoryLevels.locationId, data.locationId),
        eq(inventoryLevels.inventoryItemId, item.inventoryItemId),
      ));

    const currentQty = existing.length > 0 ? Number(existing[0].currentQty) : 0;
    const countedQty = Number(item.countedQty);
    const diff = countedQty - currentQty;

    if (Math.abs(diff) > 0.001) {
      await recordStockMovement({
        locationId: data.locationId,
        inventoryItemId: item.inventoryItemId,
        movementType: "count_correction",
        quantity: Math.abs(diff).toFixed(3),
        notes: `Physical count: ${countedQty} (was ${currentQty.toFixed(3)}, diff: ${diff > 0 ? "+" : ""}${diff.toFixed(3)})`,
        reportedByPin: data.reportedByPin,
        movementDate: data.countDate,
      });

      // Override the stock level to the counted quantity
      if (existing.length > 0) {
        await db.update(inventoryLevels).set({
          currentQty: item.countedQty,
          lastCountDate: data.countDate,
          lastCountQty: item.countedQty,
        } as any).where(eq(inventoryLevels.id, existing[0].id));
      } else {
        await db.insert(inventoryLevels).values({
          locationId: data.locationId,
          inventoryItemId: item.inventoryItemId,
          currentQty: item.countedQty,
          lastCountDate: data.countDate,
          lastCountQty: item.countedQty,
        } as any);
      }
    }
  }

  return { success: true, itemsCounted: data.items.length };
}
