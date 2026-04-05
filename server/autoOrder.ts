/**
 * Auto-Order Submission
 * 
 * Generates and submits purchase orders to vendors via email.
 * 
 * Features:
 *   - Generate PO from smart recommendations
 *   - Format PO as PDF or email body
 *   - Send PO to vendor via email (using MS Graph)
 *   - Track order status and confirmations
 *   - Scheduled auto-ordering based on par levels
 */
import { getDb } from "./db";
import {
  purchaseOrders, poLineItems, suppliers, inventoryItems, locations,
  vendorCatalogItems, orderRecommendations
} from "../drizzle/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrderSubmission {
  purchaseOrderId: number;
  vendorEmail: string;
  subject: string;
  body: string;
  attachmentHtml?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PO GENERATION FROM RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a PO from smart order recommendations.
 * Groups recommendations by supplier and creates one PO per supplier.
 */
export async function generatePOsFromRecommendations(
  locationId: number,
  recommendationIds: number[],
  createdByPin?: number,
): Promise<Array<{ purchaseOrderId: number; supplierId: number; supplierName: string; totalAmount: number; lineCount: number }>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get recommendations
  const recos = await db.select().from(orderRecommendations)
    .where(and(
      eq(orderRecommendations.locationId, locationId),
      inArray(orderRecommendations.id, recommendationIds),
      eq(orderRecommendations.status, "pending"),
    ));

  if (recos.length === 0) throw new Error("No pending recommendations found");

  // Group by supplier
  const bySupplier = new Map<number, typeof recos>();
  for (const reco of recos) {
    const suppId = reco.supplierId || 0;
    if (!bySupplier.has(suppId)) bySupplier.set(suppId, []);
    bySupplier.get(suppId)!.push(reco);
  }

  const results: Array<{ purchaseOrderId: number; supplierId: number; supplierName: string; totalAmount: number; lineCount: number }> = [];

  for (const [supplierId, supplierRecos] of bySupplier) {
    // Get supplier info
    let supplierName = "Unknown Supplier";
    if (supplierId > 0) {
      const supRows = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
      if (supRows.length > 0) supplierName = supRows[0].name;
    }

    // Create PO header
    const poNumber = `PO-${locationId}-${Date.now().toString(36).toUpperCase()}`;
    const totalAmount = supplierRecos.reduce((sum, r) => sum + Number(r.estimatedCost || 0), 0);

    const [poResult] = await db.insert(purchaseOrders).values({
      locationId,
      supplierId: supplierId > 0 ? supplierId : null,
      poNumber,
      status: "draft",
      totalAmount: String(totalAmount),
      orderDate: new Date().toISOString().slice(0, 10),
      createdByPin: createdByPin || null,
    } as any);

    const poId = poResult.insertId;

    // Create line items
    for (const reco of supplierRecos) {
      // Get inventory item details
      const itemRows = await db.select().from(inventoryItems)
        .where(eq(inventoryItems.id, reco.inventoryItemId)).limit(1);
      const item = itemRows[0];

      // Get vendor catalog price
      let unitPrice = Number(reco.estimatedCost || 0) / Number(reco.recommendedQty || 1);
      if (supplierId > 0) {
        const catalogRows = await db.select().from(vendorCatalogItems)
          .where(and(
            eq(vendorCatalogItems.supplierId, supplierId),
            eq(vendorCatalogItems.inventoryItemId, reco.inventoryItemId),
          )).limit(1);
        if (catalogRows.length > 0 && catalogRows[0].unitPrice) {
          unitPrice = Number(catalogRows[0].unitPrice);
        }
      }

      await db.insert(poLineItems).values({
        purchaseOrderId: poId,
        inventoryItemId: reco.inventoryItemId,
        description: item?.name || `Item #${reco.inventoryItemId}`,
        quantity: String(reco.recommendedQty || 1),
        unitPrice: String(unitPrice),
        totalPrice: String(Number(reco.recommendedQty || 1) * unitPrice),
        unit: item?.unit || "ea",
      } as any);

      // Mark recommendation as added to PO
      await db.update(orderRecommendations).set({
        status: "added_to_po" as any,
        purchaseOrderId: poId,
      } as any).where(eq(orderRecommendations.id, reco.id));
    }

    results.push({
      purchaseOrderId: poId,
      supplierId,
      supplierName,
      totalAmount,
      lineCount: supplierRecos.length,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PO EMAIL FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format a PO as an HTML email body for sending to vendor.
 */
export async function formatPOEmail(purchaseOrderId: number): Promise<OrderSubmission | null> {
  const db = await getDb();
  if (!db) return null;

  // Get PO header
  const poRows = await db.select().from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId)).limit(1);
  if (poRows.length === 0) return null;
  const po = poRows[0];

  // Get line items
  const lines = await db.select({
    line: poLineItems,
    itemName: sql<string>`(SELECT name FROM inventoryItems WHERE id = ${poLineItems.inventoryItemId})`,
  }).from(poLineItems)
    .where(eq(poLineItems.purchaseOrderId, purchaseOrderId));

  // Get supplier
  let supplierName = "Supplier";
  let vendorEmail = "";
  if (po.supplierId) {
    const supRows = await db.select().from(suppliers)
      .where(eq(suppliers.id, po.supplierId)).limit(1);
    if (supRows.length > 0) {
      supplierName = supRows[0].name;
      vendorEmail = supRows[0].email || "";
    }
  }

  // Get location
  let locationName = "Location";
  if (po.locationId) {
    const locRows = await db.select().from(locations)
      .where(eq(locations.id, po.locationId)).limit(1);
    if (locRows.length > 0) locationName = locRows[0].name;
  }

  // Build HTML email
  const lineRows = lines.map(l => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${l.itemName || l.line.description}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:center;">${l.line.quantity} ${l.line.unit || ""}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">$${Number(l.line.unitPrice || 0).toFixed(2)}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">$${Number(l.line.totalPrice || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
      <div style="background:#1a1a2e;color:white;padding:20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">Purchase Order</h2>
        <p style="margin:5px 0 0;opacity:0.8;">${po.poNumber}</p>
      </div>
      <div style="padding:20px;border:1px solid #ddd;border-top:none;">
        <table style="width:100%;margin-bottom:20px;">
          <tr>
            <td><strong>From:</strong> ${locationName} — Hinnawi Group</td>
            <td style="text-align:right;"><strong>Date:</strong> ${po.orderDate}</td>
          </tr>
          <tr>
            <td><strong>To:</strong> ${supplierName}</td>
            <td style="text-align:right;"><strong>PO#:</strong> ${po.poNumber}</td>
          </tr>
        </table>
        
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Item</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:center;">Qty</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:right;">Unit Price</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
          </tbody>
          <tfoot>
            <tr style="background:#f5f5f5;font-weight:bold;">
              <td colspan="3" style="padding:8px;border:1px solid #ddd;text-align:right;">Total:</td>
              <td style="padding:8px;border:1px solid #ddd;text-align:right;">$${Number(po.totalAmount || 0).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        
        ${po.notes ? `<p><strong>Notes:</strong> ${po.notes}</p>` : ""}
        
        <p style="color:#666;font-size:12px;margin-top:20px;">
          This purchase order was generated by Hinnawi Ops. 
          Please confirm receipt and expected delivery date.
        </p>
      </div>
    </div>
  `;

  return {
    purchaseOrderId,
    vendorEmail,
    subject: `Purchase Order ${po.poNumber} — ${locationName}`,
    body: html,
    attachmentHtml: html,
  };
}

/**
 * Send PO to vendor via email using MS Graph.
 * Requires the MS Graph integration to be configured.
 */
export async function sendPOEmail(
  purchaseOrderId: number,
  overrideEmail?: string,
): Promise<{ success: boolean; error?: string }> {
  const submission = await formatPOEmail(purchaseOrderId);
  if (!submission) return { success: false, error: "PO not found" };

  const recipientEmail = overrideEmail || submission.vendorEmail;
  if (!recipientEmail) return { success: false, error: "No vendor email configured" };

  try {
    // Use MS Graph to send email
    // Import dynamically to avoid circular deps
    const { sendEmail } = await import("./msgraph");

    await sendEmail(
      recipientEmail,
      submission.subject,
      submission.body,
    );

    // Update PO status to submitted
    const db = await getDb();
    if (db) {
      await db.update(purchaseOrders).set({
        status: "submitted" as any,
        submittedAt: new Date(),
      } as any).where(eq(purchaseOrders.id, purchaseOrderId));
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDER TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get pending orders that need follow-up.
 */
export async function getPendingOrders(): Promise<Array<{
  id: number;
  poNumber: string;
  supplierName: string;
  locationName: string;
  totalAmount: number;
  status: string;
  orderDate: string;
  daysSinceOrder: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.execute(sql`
    SELECT 
      po.id,
      po.poNumber,
      COALESCE(s.name, 'Unknown') as supplierName,
      COALESCE(l.name, 'Unknown') as locationName,
      po.totalAmount,
      po.status,
      po.orderDate,
      DATEDIFF(CURDATE(), po.orderDate) as daysSinceOrder
    FROM purchaseOrders po
    LEFT JOIN suppliers s ON s.id = po.supplierId
    LEFT JOIN locations l ON l.id = po.locationId
    WHERE po.status IN ('submitted', 'approved', 'pending_approval')
    ORDER BY po.orderDate ASC
  `);

  return ((result as any)[0] || []).map((r: any) => ({
    id: r.id,
    poNumber: r.poNumber,
    supplierName: r.supplierName,
    locationName: r.locationName,
    totalAmount: Number(r.totalAmount || 0),
    status: r.status,
    orderDate: r.orderDate ? new Date(r.orderDate).toISOString().slice(0, 10) : "",
    daysSinceOrder: r.daysSinceOrder || 0,
  }));
}

/**
 * Get order history with delivery performance metrics.
 */
export async function getOrderHistory(
  supplierId?: number,
  locationId?: number,
  limit = 50,
): Promise<Array<{
  id: number;
  poNumber: string;
  supplierName: string;
  locationName: string;
  totalAmount: number;
  status: string;
  orderDate: string;
  receivedDate: string | null;
  lineCount: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  let query = sql`
    SELECT 
      po.id,
      po.poNumber,
      COALESCE(s.name, 'Unknown') as supplierName,
      COALESCE(l.name, 'Unknown') as locationName,
      po.totalAmount,
      po.status,
      po.orderDate,
      po.receivedAt as receivedDate,
      (SELECT COUNT(*) FROM poLineItems pli WHERE pli.purchaseOrderId = po.id) as lineCount
    FROM purchaseOrders po
    LEFT JOIN suppliers s ON s.id = po.supplierId
    LEFT JOIN locations l ON l.id = po.locationId
    WHERE 1=1
  `;

  if (supplierId) query = sql`${query} AND po.supplierId = ${supplierId}`;
  if (locationId) query = sql`${query} AND po.locationId = ${locationId}`;
  query = sql`${query} ORDER BY po.orderDate DESC LIMIT ${limit}`;

  const result = await db.execute(query);

  return ((result as any)[0] || []).map((r: any) => ({
    id: r.id,
    poNumber: r.poNumber,
    supplierName: r.supplierName,
    locationName: r.locationName,
    totalAmount: Number(r.totalAmount || 0),
    status: r.status,
    orderDate: r.orderDate ? new Date(r.orderDate).toISOString().slice(0, 10) : "",
    receivedDate: r.receivedDate ? new Date(r.receivedDate).toISOString().slice(0, 10) : null,
    lineCount: Number(r.lineCount || 0),
  }));
}
