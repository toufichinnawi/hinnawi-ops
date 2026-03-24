/**
 * Invoice → Inventory → Recipe Cost Pipeline
 * 
 * Automated flow:
 * 1. Invoice approved → match line items to inventory items (AI + fuzzy)
 * 2. Update ingredient costs (lastCost, avgCost, costPerUsableUnit)
 * 3. Log price changes to history table
 * 4. Auto-recalculate ALL recipe costs
 * 5. Create alerts for significant price changes (>10%)
 */

import { getDb } from "./db";
import {
  invoiceLineItems, inventoryItems, invoices, suppliers,
  ingredientPriceHistory, invoiceLineItemMatches, alerts, recipes, recipeIngredients,
} from "../drizzle/schema";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

// ─── Types ───

interface MatchResult {
  invoiceLineItemId: number;
  inventoryItemId: number | null;
  matchedItemName: string | null;
  confidence: number;
  matchMethod: "exact" | "fuzzy" | "ai" | "manual";
  unitPrice: number;
  quantity: number;
  unit: string | null;
}

interface PriceUpdateResult {
  itemId: number;
  itemName: string;
  previousCost: number;
  newCost: number;
  previousCostPerUsable: number;
  newCostPerUsable: number;
  changePercent: number;
}

interface PipelineResult {
  invoiceId: number;
  matchResults: MatchResult[];
  priceUpdates: PriceUpdateResult[];
  recipesRecalculated: number;
  alertsCreated: number;
  errors: string[];
}

// ─── Step 1: Match invoice line items to inventory items ───

/**
 * Try exact match first (case-insensitive name match),
 * then fuzzy match (substring/token overlap),
 * then AI match for remaining unmatched items.
 */
export async function matchInvoiceLineItems(invoiceId: number): Promise<MatchResult[]> {
  const db = await getDb();
  if (!db) return [];

  // Get all line items for this invoice
  const lineItems = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));

  if (lineItems.length === 0) return [];

  // Get all active inventory items
  const items = await db.select().from(inventoryItems)
    .where(eq(inventoryItems.isActive, true));

  if (items.length === 0) return [];

  const results: MatchResult[] = [];
  const unmatchedLines: typeof lineItems = [];

  // Phase 1: Exact match (case-insensitive)
  for (const line of lineItems) {
    const desc = (line.description || "").toLowerCase().trim();
    if (!desc) {
      unmatchedLines.push(line);
      continue;
    }

    const exactMatch = items.find(item =>
      item.name.toLowerCase().trim() === desc ||
      (item.itemCode && item.itemCode.toLowerCase().trim() === (line.productCode || "").toLowerCase().trim())
    );

    if (exactMatch) {
      results.push({
        invoiceLineItemId: line.id,
        inventoryItemId: exactMatch.id,
        matchedItemName: exactMatch.name,
        confidence: 100,
        matchMethod: "exact",
        unitPrice: Number(line.unitPrice || 0),
        quantity: Number(line.quantity || 0),
        unit: exactMatch.unit || null,
      });
    } else {
      unmatchedLines.push(line);
    }
  }

  // Phase 2: Fuzzy match (token overlap scoring)
  const stillUnmatched: typeof lineItems = [];
  for (const line of unmatchedLines) {
    const desc = (line.description || "").toLowerCase().trim();
    const tokens = desc.split(/[\s,\-\/]+/).filter(t => t.length > 2);

    let bestMatch: typeof items[0] | null = null;
    let bestScore = 0;

    for (const item of items) {
      const itemTokens = item.name.toLowerCase().split(/[\s,\-\/]+/).filter(t => t.length > 2);
      const overlap = tokens.filter(t => itemTokens.some(it => it.includes(t) || t.includes(it)));
      const score = tokens.length > 0 ? (overlap.length / Math.max(tokens.length, itemTokens.length)) * 100 : 0;

      if (score > bestScore && score >= 50) {
        bestScore = score;
        bestMatch = item;
      }
    }

    if (bestMatch && bestScore >= 50) {
      results.push({
        invoiceLineItemId: line.id,
        inventoryItemId: bestMatch.id,
        matchedItemName: bestMatch.name,
        confidence: Math.round(bestScore),
        matchMethod: "fuzzy",
        unitPrice: Number(line.unitPrice || 0),
        quantity: Number(line.quantity || 0),
        unit: bestMatch.unit || null,
      });
    } else {
      stillUnmatched.push(line);
    }
  }

  // Phase 3: AI match for remaining unmatched items
  if (stillUnmatched.length > 0 && items.length > 0) {
    try {
      const aiMatches = await aiMatchLineItems(stillUnmatched, items);
      results.push(...aiMatches);
    } catch (err) {
      console.error("[CostPipeline] AI matching failed:", err);
      // Add as unmatched
      for (const line of stillUnmatched) {
        results.push({
          invoiceLineItemId: line.id,
          inventoryItemId: null,
          matchedItemName: null,
          confidence: 0,
          matchMethod: "ai",
          unitPrice: Number(line.unitPrice || 0),
          quantity: Number(line.quantity || 0),
          unit: null,
        });
      }
    }
  }

  // Save matches to DB
  for (const match of results) {
    await db.insert(invoiceLineItemMatches).values({
      invoiceLineItemId: match.invoiceLineItemId,
      invoiceId,
      inventoryItemId: match.inventoryItemId,
      lineDescription: lineItems.find(l => l.id === match.invoiceLineItemId)?.description || null,
      matchedItemName: match.matchedItemName,
      confidence: String(match.confidence),
      matchMethod: match.matchMethod,
      status: match.inventoryItemId ? "auto_matched" : "unmatched",
      unitPrice: String(match.unitPrice),
      quantity: String(match.quantity),
      unit: match.unit,
      priceApplied: false,
    } as any);
  }

  return results;
}

/**
 * Use LLM to match invoice line descriptions to inventory items
 */
async function aiMatchLineItems(
  lineItems: { id: number; description: string | null; productCode: string | null; unitPrice: any; quantity: any }[],
  inventoryItemsList: { id: number; name: string; itemCode: string | null; unit: string | null; category: string | null }[]
): Promise<MatchResult[]> {
  const lineDescriptions = lineItems.map(l => ({
    id: l.id,
    description: l.description || "Unknown",
    productCode: l.productCode || "",
    unitPrice: Number(l.unitPrice || 0),
    quantity: Number(l.quantity || 0),
  }));

  const inventoryList = inventoryItemsList.map(i => ({
    id: i.id,
    name: i.name,
    code: i.itemCode || "",
    unit: i.unit || "",
    category: i.category || "",
  }));

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a food service inventory matching assistant. Match invoice line item descriptions to inventory items from the master catalog. 
Consider that:
- Invoice descriptions may be in French or English
- They may include brand names, package sizes, or product codes
- Match based on the actual ingredient/product, ignoring packaging details
- If no good match exists, return null for inventoryItemId
Return ONLY valid JSON array.`,
      },
      {
        role: "user",
        content: `Match these invoice line items to inventory items:

INVOICE LINE ITEMS:
${JSON.stringify(lineDescriptions, null, 2)}

INVENTORY ITEMS:
${JSON.stringify(inventoryList, null, 2)}

Return a JSON array where each element has:
- lineItemId: number (from invoice line items)
- inventoryItemId: number or null (from inventory items, null if no match)
- matchedItemName: string or null
- confidence: number (0-100)`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "line_item_matches",
        strict: true,
        schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lineItemId: { type: "integer" },
                  inventoryItemId: { type: ["integer", "null"] },
                  matchedItemName: { type: ["string", "null"] },
                  confidence: { type: "integer" },
                },
                required: ["lineItemId", "inventoryItemId", "matchedItemName", "confidence"],
                additionalProperties: false,
              },
            },
          },
          required: ["matches"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content as string;
  const parsed = JSON.parse(content);

  return (parsed.matches || []).map((m: any) => {
    const line = lineItems.find(l => l.id === m.lineItemId);
    return {
      invoiceLineItemId: m.lineItemId,
      inventoryItemId: m.inventoryItemId,
      matchedItemName: m.matchedItemName,
      confidence: m.confidence || 0,
      matchMethod: "ai" as const,
      unitPrice: Number(line?.unitPrice || 0),
      quantity: Number(line?.quantity || 0),
      unit: m.inventoryItemId
        ? inventoryItemsList.find(i => i.id === m.inventoryItemId)?.unit || null
        : null,
    };
  });
}

// ─── Step 2: Update ingredient costs from matched line items ───

export async function updateIngredientCostsFromInvoice(
  invoiceId: number,
  matches: MatchResult[]
): Promise<PriceUpdateResult[]> {
  const db = await getDb();
  if (!db) return [];

  const priceUpdates: PriceUpdateResult[] = [];

  // Get invoice info for the history record
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);

  for (const match of matches) {
    if (!match.inventoryItemId || match.confidence < 50) continue;

    // Get current inventory item
    const [item] = await db.select().from(inventoryItems)
      .where(eq(inventoryItems.id, match.inventoryItemId)).limit(1);
    if (!item) continue;

    const previousCost = Number(item.lastCost || 0);
    const previousCostPerUsable = Number(item.costPerUsableUnit || 0);
    const newCostPerUnit = match.unitPrice;

    // Skip if price hasn't changed
    if (Math.abs(previousCost - newCostPerUnit) < 0.001) {
      // Mark as applied even if no change
      await db.update(invoiceLineItemMatches)
        .set({ priceApplied: true })
        .where(eq(invoiceLineItemMatches.invoiceLineItemId, match.invoiceLineItemId));
      continue;
    }

    // Calculate new costPerUsableUnit with yield
    const yieldPct = Number(item.yieldPct || 100);
    const newCostPerUsable = yieldPct > 0 ? newCostPerUnit / (yieldPct / 100) : newCostPerUnit;

    // Calculate weighted average cost (simple moving average with last 2 prices)
    const avgCost = previousCost > 0
      ? (previousCost + newCostPerUnit) / 2
      : newCostPerUnit;

    const changePercent = previousCost > 0
      ? ((newCostPerUnit - previousCost) / previousCost) * 100
      : 0;

    // Update inventory item
    await db.update(inventoryItems).set({
      lastCost: newCostPerUnit.toFixed(4),
      avgCost: avgCost.toFixed(4),
      costPerUsableUnit: newCostPerUsable.toFixed(4),
      purchaseCost: (newCostPerUnit * Number(item.purchaseAmount || 1)).toFixed(2),
      ...(inv?.supplierId && { supplierId: inv.supplierId }),
    }).where(eq(inventoryItems.id, match.inventoryItemId));

    // Log price change to history
    await db.insert(ingredientPriceHistory).values({
      inventoryItemId: match.inventoryItemId,
      invoiceId,
      invoiceLineItemId: match.invoiceLineItemId,
      supplierId: inv?.supplierId || null,
      previousCostPerUnit: previousCost.toFixed(4),
      newCostPerUnit: newCostPerUnit.toFixed(4),
      previousCostPerUsableUnit: previousCostPerUsable.toFixed(4),
      newCostPerUsableUnit: newCostPerUsable.toFixed(4),
      changePercent: changePercent.toFixed(2),
      quantity: String(match.quantity),
      unit: match.unit,
      source: "invoice",
    } as any);

    // Mark match as price applied
    await db.update(invoiceLineItemMatches)
      .set({ priceApplied: true })
      .where(eq(invoiceLineItemMatches.invoiceLineItemId, match.invoiceLineItemId));

    priceUpdates.push({
      itemId: match.inventoryItemId,
      itemName: item.name,
      previousCost,
      newCost: newCostPerUnit,
      previousCostPerUsable,
      newCostPerUsable,
      changePercent,
    });
  }

  return priceUpdates;
}

// ─── Step 3: Recalculate ALL recipe costs ───

export async function recalculateAllRecipeCosts(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Get all inventory items for cost lookup
  const allItems = await db.select().from(inventoryItems);
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

  // Get all recipes
  const allRecipes = await db.select().from(recipes);
  let updated = 0;

  for (const recipe of allRecipes) {
    const ingredients = await db.select().from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipe.id));

    let totalCost = 0;
    for (const ing of ingredients) {
      const item = ing.inventoryItemId ? itemMap.get(ing.inventoryItemId) : itemByName.get(ing.ingredientName.toLowerCase());
      const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : Number(ing.usableUnitCost || 0);
      const qty = Number(ing.quantity || 0);
      const lineCost = qty * usableUnitCost;
      totalCost += lineCost;

      // Update the ingredient's stored cost reference
      if (item) {
        await db.update(recipeIngredients).set({
          usableUnitCost: usableUnitCost.toFixed(4),
          lineCost: lineCost.toFixed(4),
          inventoryItemId: item.id,
        }).where(eq(recipeIngredients.id, ing.id));
      }
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

  return updated;
}

// ─── Step 4: Create alerts for significant price changes ───

export async function createPriceChangeAlerts(
  priceUpdates: PriceUpdateResult[],
  invoiceId: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let alertsCreated = 0;
  const significantChanges: PriceUpdateResult[] = [];

  for (const update of priceUpdates) {
    const absChange = Math.abs(update.changePercent);
    if (absChange < 10) continue; // Only alert on >10% changes

    const direction = update.changePercent > 0 ? "increased" : "decreased";
    const severity = absChange >= 25 ? "urgent" : "medium";

    await db.insert(alerts).values({
      type: "inventory",
      severity,
      title: `Price ${direction} ${absChange.toFixed(1)}%: ${update.itemName}`,
      description: `${update.itemName} price ${direction} from $${update.previousCost.toFixed(4)} to $${update.newCost.toFixed(4)} per unit (${update.changePercent > 0 ? "+" : ""}${update.changePercent.toFixed(1)}%). Source: Invoice #${invoiceId}. This affects recipe costs.`,
      isRead: false,
      isResolved: false,
    } as any);

    significantChanges.push(update);
    alertsCreated++;
  }

  // Notify owner if there are significant changes
  if (significantChanges.length > 0) {
    const summary = significantChanges.map(u =>
      `• ${u.itemName}: $${u.previousCost.toFixed(2)} → $${u.newCost.toFixed(2)} (${u.changePercent > 0 ? "+" : ""}${u.changePercent.toFixed(1)}%)`
    ).join("\n");

    try {
      await notifyOwner({
        title: `⚠️ ${significantChanges.length} Ingredient Price Change${significantChanges.length > 1 ? "s" : ""} Detected`,
        content: `Invoice #${invoiceId} triggered the following significant price changes (>10%):\n\n${summary}\n\nRecipe costs have been automatically recalculated.`,
      });
    } catch (err) {
      console.error("[CostPipeline] Failed to notify owner:", err);
    }
  }

  return alertsCreated;
}

// ─── MAIN PIPELINE: Run the full flow ───

/**
 * Run the complete invoice → cost update pipeline.
 * Called automatically when an invoice is approved.
 */
export async function runInvoiceCostPipeline(invoiceId: number): Promise<PipelineResult> {
  const errors: string[] = [];
  console.log(`[CostPipeline] Starting pipeline for invoice #${invoiceId}`);

  // Step 1: Match line items to inventory
  let matchResults: MatchResult[] = [];
  try {
    matchResults = await matchInvoiceLineItems(invoiceId);
    console.log(`[CostPipeline] Matched ${matchResults.filter(m => m.inventoryItemId).length}/${matchResults.length} line items`);
  } catch (err: any) {
    errors.push(`Matching failed: ${err.message}`);
    console.error("[CostPipeline] Matching error:", err);
  }

  // Step 2: Update ingredient costs
  let priceUpdates: PriceUpdateResult[] = [];
  try {
    priceUpdates = await updateIngredientCostsFromInvoice(invoiceId, matchResults);
    console.log(`[CostPipeline] Updated prices for ${priceUpdates.length} ingredients`);
  } catch (err: any) {
    errors.push(`Price update failed: ${err.message}`);
    console.error("[CostPipeline] Price update error:", err);
  }

  // Step 3: Recalculate ALL recipe costs
  let recipesRecalculated = 0;
  try {
    recipesRecalculated = await recalculateAllRecipeCosts();
    console.log(`[CostPipeline] Recalculated costs for ${recipesRecalculated} recipes`);
  } catch (err: any) {
    errors.push(`Recipe recalculation failed: ${err.message}`);
    console.error("[CostPipeline] Recipe recalc error:", err);
  }

  // Step 4: Create alerts for significant price changes
  let alertsCreated = 0;
  try {
    alertsCreated = await createPriceChangeAlerts(priceUpdates, invoiceId);
    console.log(`[CostPipeline] Created ${alertsCreated} price change alerts`);
  } catch (err: any) {
    errors.push(`Alert creation failed: ${err.message}`);
    console.error("[CostPipeline] Alert error:", err);
  }

  console.log(`[CostPipeline] Pipeline complete for invoice #${invoiceId}: ${matchResults.length} matches, ${priceUpdates.length} price updates, ${recipesRecalculated} recipes recalculated, ${alertsCreated} alerts`);

  return {
    invoiceId,
    matchResults,
    priceUpdates,
    recipesRecalculated,
    alertsCreated,
    errors,
  };
}

// ─── Helper: Get price history for an inventory item ───

export async function getIngredientPriceHistory(inventoryItemId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(ingredientPriceHistory)
    .where(eq(ingredientPriceHistory.inventoryItemId, inventoryItemId))
    .orderBy(desc(ingredientPriceHistory.createdAt))
    .limit(limit);
}

// ─── Helper: Get all matches for an invoice ───

export async function getInvoiceMatches(invoiceId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(invoiceLineItemMatches)
    .where(eq(invoiceLineItemMatches.invoiceId, invoiceId))
    .orderBy(invoiceLineItemMatches.id);
}

// ─── Helper: Manually confirm or reject a match ───

export async function updateMatchStatus(
  matchId: number,
  status: "confirmed" | "rejected",
  inventoryItemId?: number,
  reviewedBy?: string
) {
  const db = await getDb();
  if (!db) return;

  const updates: Record<string, any> = {
    status,
    reviewedBy: reviewedBy || "admin",
    reviewedAt: new Date(),
  };

  if (inventoryItemId !== undefined) {
    updates.inventoryItemId = inventoryItemId;
    const [item] = await db.select().from(inventoryItems)
      .where(eq(inventoryItems.id, inventoryItemId)).limit(1);
    if (item) {
      updates.matchedItemName = item.name;
      updates.matchMethod = "manual";
    }
  }

  await db.update(invoiceLineItemMatches)
    .set(updates)
    .where(eq(invoiceLineItemMatches.id, matchId));
}

// ─── Helper: Get cost impact summary ───

export async function getCostImpactSummary() {
  const db = await getDb();
  if (!db) return { recentChanges: [], affectedRecipes: [], totalRecipes: 0 };

  // Get recent price changes (last 30 days)
  const recentChanges = await db.select().from(ingredientPriceHistory)
    .orderBy(desc(ingredientPriceHistory.createdAt))
    .limit(50);

  // Get all recipes with their current costs
  const allRecipes = await db.select({
    id: recipes.id,
    name: recipes.name,
    totalCost: recipes.totalCost,
    sellingPrice: recipes.sellingPrice,
    foodCostPct: recipes.foodCostPct,
    category: recipes.category,
  }).from(recipes);

  // Find recipes with high food cost (>35%)
  const affectedRecipes = allRecipes.filter(r => Number(r.foodCostPct || 0) > 35);

  return {
    recentChanges,
    affectedRecipes,
    totalRecipes: allRecipes.length,
  };
}

// ─── Helper: Get unmatched line items that need review ───

export async function getUnmatchedLineItems() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(invoiceLineItemMatches)
    .where(eq(invoiceLineItemMatches.status, "unmatched"))
    .orderBy(desc(invoiceLineItemMatches.createdAt));
}
