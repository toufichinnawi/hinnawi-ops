/**
 * Vendor Catalog Integration
 * 
 * Manages vendor product catalogs for Dubee, Gordon Food Service, Costco, and others.
 * 
 * Features:
 *   - CSV import for vendor price lists
 *   - Link vendor products to internal inventory items
 *   - Price comparison across vendors
 *   - Price history tracking
 *   - Auto-suggest cheapest vendor for each item
 */
import { getDb } from "./db";
import {
  vendorCatalogItems, inventoryItems, suppliers
} from "../drizzle/schema";
import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface VendorCatalogRow {
  supplierId: number;
  vendorSku?: string;
  vendorProductName: string;
  vendorUnit?: string;
  vendorPackSize?: string;
  unitPrice?: number;
  minOrderQty?: number;
  leadTimeDays?: number;
  inventoryItemId?: number; // link to internal inventory
}

export interface PriceComparison {
  inventoryItemId: number;
  itemName: string;
  unit: string;
  vendors: Array<{
    supplierId: number;
    supplierName: string;
    vendorProductName: string;
    vendorSku?: string;
    unitPrice: number;
    packSize?: string;
    effectivePrice: number; // normalized per unit
    isCheapest: boolean;
  }>;
  bestVendor: {
    supplierId: number;
    supplierName: string;
    unitPrice: number;
    savings: number; // vs most expensive
    savingsPct: number;
  } | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse vendor price list CSV.
 * Supports flexible column mapping for different vendor formats.
 */
export function parseVendorCSV(
  csvContent: string,
  supplierId: number,
  columnMapping: {
    sku?: string;
    productName: string;
    unit?: string;
    packSize?: string;
    price: string;
    minQty?: string;
  },
): VendorCatalogRow[] {
  const lines = csvContent.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows: VendorCatalogRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const getVal = (col?: string) => {
      if (!col) return undefined;
      const idx = headers.findIndex(h => h.toLowerCase() === col.toLowerCase());
      return idx >= 0 ? values[idx]?.trim() : undefined;
    };

    const productName = getVal(columnMapping.productName);
    if (!productName) continue;

    const priceStr = getVal(columnMapping.price);
    const price = priceStr ? Number(priceStr.replace(/[$,]/g, "")) : undefined;

    rows.push({
      supplierId,
      vendorSku: getVal(columnMapping.sku),
      vendorProductName: productName,
      vendorUnit: getVal(columnMapping.unit),
      vendorPackSize: getVal(columnMapping.packSize),
      unitPrice: price && !isNaN(price) ? price : undefined,
      minOrderQty: getVal(columnMapping.minQty) ? Number(getVal(columnMapping.minQty)) : undefined,
    });
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Import vendor catalog items (upsert by supplierId + vendorSku or vendorProductName).
 */
export async function importVendorCatalog(
  rows: VendorCatalogRow[],
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Check if item already exists
      const existing = await db.select().from(vendorCatalogItems)
        .where(and(
          eq(vendorCatalogItems.supplierId, row.supplierId),
          row.vendorSku
            ? eq(vendorCatalogItems.vendorSku, row.vendorSku)
            : eq(vendorCatalogItems.vendorProductName, row.vendorProductName),
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db.update(vendorCatalogItems).set({
          vendorProductName: row.vendorProductName,
          vendorUnit: row.vendorUnit || null,
          vendorPackSize: row.vendorPackSize || null,
          unitPrice: row.unitPrice ? String(row.unitPrice) : null,
          minOrderQty: row.minOrderQty ? String(row.minOrderQty) : null,
          leadTimeDays: row.leadTimeDays || null,
          inventoryItemId: row.inventoryItemId || existing[0].inventoryItemId || null,
          lastPriceUpdate: new Date().toISOString().slice(0, 10),
        } as any).where(eq(vendorCatalogItems.id, existing[0].id));
        updated++;
      } else {
        // Insert new
        await db.insert(vendorCatalogItems).values({
          supplierId: row.supplierId,
          vendorSku: row.vendorSku || null,
          vendorProductName: row.vendorProductName,
          vendorUnit: row.vendorUnit || null,
          vendorPackSize: row.vendorPackSize || null,
          unitPrice: row.unitPrice ? String(row.unitPrice) : null,
          minOrderQty: row.minOrderQty ? String(row.minOrderQty) : "1.00",
          leadTimeDays: row.leadTimeDays || 1,
          inventoryItemId: row.inventoryItemId || null,
          lastPriceUpdate: new Date().toISOString().slice(0, 10),
        } as any);
        imported++;
      }
    } catch (err: any) {
      errors.push(`${row.vendorProductName}: ${err.message}`);
    }
  }

  return { imported, updated, errors };
}

/**
 * Get all catalog items for a supplier.
 */
export async function getVendorCatalog(supplierId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(vendorCatalogItems)
    .where(eq(vendorCatalogItems.supplierId, supplierId))
    .orderBy(asc(vendorCatalogItems.vendorProductName));
}

/**
 * Get all catalog items linked to an inventory item (across all vendors).
 */
export async function getCatalogForItem(inventoryItemId: number) {
  const db = await getDb();
  if (!db) return [];

  const items = await db.select({
    catalogItem: vendorCatalogItems,
    supplierName: sql<string>`(SELECT name FROM suppliers WHERE id = ${vendorCatalogItems.supplierId})`,
  }).from(vendorCatalogItems)
    .where(eq(vendorCatalogItems.inventoryItemId, inventoryItemId))
    .orderBy(asc(vendorCatalogItems.unitPrice));

  return items;
}

/**
 * Link a vendor catalog item to an internal inventory item.
 */
export async function linkCatalogToInventory(
  catalogItemId: number,
  inventoryItemId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(vendorCatalogItems).set({
    inventoryItemId,
  } as any).where(eq(vendorCatalogItems.id, catalogItemId));
}

/**
 * Auto-link vendor catalog items to inventory items by fuzzy name matching.
 */
export async function autoLinkCatalogItems(supplierId: number): Promise<{
  linked: number;
  unlinked: number;
  suggestions: Array<{ catalogItemId: number; vendorProductName: string; suggestedItemId: number; suggestedItemName: string; confidence: number }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const catalogItems = await db.select().from(vendorCatalogItems)
    .where(and(
      eq(vendorCatalogItems.supplierId, supplierId),
      sql`${vendorCatalogItems.inventoryItemId} IS NULL`,
    ));

  const allInventory = await db.select().from(inventoryItems);

  let linked = 0;
  const suggestions: Array<{ catalogItemId: number; vendorProductName: string; suggestedItemId: number; suggestedItemName: string; confidence: number }> = [];

  for (const catItem of catalogItems) {
    const catName = catItem.vendorProductName.toLowerCase();

    // Try exact match first
    const exactMatch = allInventory.find(inv =>
      inv.name.toLowerCase() === catName
    );

    if (exactMatch) {
      await linkCatalogToInventory(catItem.id, exactMatch.id);
      linked++;
      continue;
    }

    // Try partial match
    let bestMatch: { id: number; name: string; score: number } | null = null;
    for (const inv of allInventory) {
      const invName = inv.name.toLowerCase();
      const score = calculateSimilarity(catName, invName);
      if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: inv.id, name: inv.name, score };
      }
    }

    if (bestMatch) {
      if (bestMatch.score > 0.85) {
        // High confidence — auto-link
        await linkCatalogToInventory(catItem.id, bestMatch.id);
        linked++;
      } else {
        // Medium confidence — suggest
        suggestions.push({
          catalogItemId: catItem.id,
          vendorProductName: catItem.vendorProductName,
          suggestedItemId: bestMatch.id,
          suggestedItemName: bestMatch.name,
          confidence: Math.round(bestMatch.score * 100),
        });
      }
    }
  }

  return {
    linked,
    unlinked: catalogItems.length - linked - suggestions.length,
    suggestions,
  };
}

/**
 * Simple string similarity (Jaccard on word tokens).
 */
function calculateSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
  const tokensB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare prices across all vendors for items that have multiple suppliers.
 */
export async function getPriceComparisons(): Promise<PriceComparison[]> {
  const db = await getDb();
  if (!db) return [];

  // Get all linked catalog items with supplier info
  const catalogWithSuppliers = await db.select({
    catalog: vendorCatalogItems,
    supplierName: sql<string>`(SELECT name FROM suppliers WHERE id = ${vendorCatalogItems.supplierId})`,
    itemName: sql<string>`(SELECT name FROM inventoryItems WHERE id = ${vendorCatalogItems.inventoryItemId})`,
    itemUnit: sql<string>`(SELECT unit FROM inventoryItems WHERE id = ${vendorCatalogItems.inventoryItemId})`,
  }).from(vendorCatalogItems)
    .where(sql`${vendorCatalogItems.inventoryItemId} IS NOT NULL AND ${vendorCatalogItems.unitPrice} IS NOT NULL`)
    .orderBy(asc(vendorCatalogItems.inventoryItemId));

  // Group by inventory item
  const byItem = new Map<number, typeof catalogWithSuppliers>();
  for (const row of catalogWithSuppliers) {
    const itemId = row.catalog.inventoryItemId!;
    if (!byItem.has(itemId)) byItem.set(itemId, []);
    byItem.get(itemId)!.push(row);
  }

  const comparisons: PriceComparison[] = [];

  for (const [itemId, rows] of byItem) {
    if (rows.length < 2) continue; // Need at least 2 vendors to compare

    const vendors = rows.map(r => ({
      supplierId: r.catalog.supplierId,
      supplierName: r.supplierName || "Unknown",
      vendorProductName: r.catalog.vendorProductName,
      vendorSku: r.catalog.vendorSku || undefined,
      unitPrice: Number(r.catalog.unitPrice || 0),
      packSize: r.catalog.vendorPackSize || undefined,
      effectivePrice: Number(r.catalog.unitPrice || 0), // TODO: normalize by pack size
      isCheapest: false,
    }));

    // Find cheapest
    let cheapestIdx = 0;
    for (let i = 1; i < vendors.length; i++) {
      if (vendors[i].effectivePrice < vendors[cheapestIdx].effectivePrice) {
        cheapestIdx = i;
      }
    }
    vendors[cheapestIdx].isCheapest = true;

    // Find most expensive for savings calculation
    const mostExpensive = Math.max(...vendors.map(v => v.effectivePrice));
    const cheapest = vendors[cheapestIdx];

    comparisons.push({
      inventoryItemId: itemId,
      itemName: rows[0].itemName || "Unknown",
      unit: rows[0].itemUnit || "",
      vendors,
      bestVendor: {
        supplierId: cheapest.supplierId,
        supplierName: cheapest.supplierName,
        unitPrice: cheapest.unitPrice,
        savings: mostExpensive - cheapest.effectivePrice,
        savingsPct: mostExpensive > 0 ? ((mostExpensive - cheapest.effectivePrice) / mostExpensive) * 100 : 0,
      },
    });
  }

  // Sort by savings potential (highest first)
  comparisons.sort((a, b) => (b.bestVendor?.savings || 0) - (a.bestVendor?.savings || 0));

  return comparisons;
}

/**
 * Get the best vendor recommendation for a list of items.
 */
export async function getBestVendors(
  inventoryItemIds: number[],
): Promise<Map<number, { supplierId: number; supplierName: string; unitPrice: number }>> {
  const db = await getDb();
  if (!db) return new Map();

  const result = new Map<number, { supplierId: number; supplierName: string; unitPrice: number }>();

  for (const itemId of inventoryItemIds) {
    const vendorOptions = await getCatalogForItem(itemId);
    if (vendorOptions.length > 0) {
      const cheapest = vendorOptions.reduce((best, curr) =>
        Number(curr.catalogItem.unitPrice || Infinity) < Number(best.catalogItem.unitPrice || Infinity) ? curr : best
      );
      result.set(itemId, {
        supplierId: cheapest.catalogItem.supplierId,
        supplierName: cheapest.supplierName || "Unknown",
        unitPrice: Number(cheapest.catalogItem.unitPrice || 0),
      });
    }
  }

  return result;
}
