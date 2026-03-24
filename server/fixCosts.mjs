/**
 * Fix Per-Unit Cost Calculation
 * 
 * Problem: The batch cost pipeline set lastCost = invoice unitPrice (the case/package price)
 * instead of dividing by purchaseAmount to get the true per-unit cost.
 * 
 * Fix: For each matched inventory item:
 * 1. Get all price history records from batch invoices
 * 2. Recalculate per-unit cost = unitPrice / purchaseAmount
 * 3. Update lastCost, avgCost, costPerUsableUnit
 * 4. Update price history records
 * 5. Recalculate all recipe costs
 */

import mysql from "mysql2/promise";
import fs from "fs";

// Get DATABASE_URL from running server process
function getDatabaseUrl() {
  const pids = fs.readdirSync("/proc").filter(f => /^\d+$/.test(f));
  for (const pid of pids) {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      if (cmdline.includes("tsx")) {
        const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf-8");
        for (const entry of environ.split("\0")) {
          const eqIdx = entry.indexOf("=");
          if (eqIdx > 0 && entry.substring(0, eqIdx) === "DATABASE_URL") {
            return entry.substring(eqIdx + 1);
          }
        }
      }
    } catch {}
  }
  throw new Error("Could not find DATABASE_URL");
}

const pool = mysql.createPool({
  uri: getDatabaseUrl(),
  ssl: { rejectUnauthorized: true },
  connectionLimit: 3,
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params || []);
  return rows;
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  FIX PER-UNIT COST CALCULATION");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: Get all inventory items with their purchase amounts
  const inventoryItems = await query(
    "SELECT id, name, unit, purchaseAmount, purchaseCost, yieldPct, lastCost, avgCost, costPerUsableUnit FROM inventoryItems WHERE isActive = 1"
  );
  console.log(`Found ${inventoryItems.length} active inventory items\n`);

  // Step 2: For each matched inventory item, recalculate costs from price history
  const matchedItems = await query(`
    SELECT DISTINCT m.inventoryItemId, i.name, i.purchaseAmount, i.yieldPct, i.unit
    FROM invoiceLineItemMatches m
    JOIN inventoryItems i ON i.id = m.inventoryItemId
    WHERE m.invoiceId BETWEEN 60012 AND 60131 AND m.inventoryItemId IS NOT NULL
  `);
  console.log(`Found ${matchedItems.length} inventory items matched from batch invoices\n`);

  let itemsUpdated = 0;
  let priceHistoryFixed = 0;

  for (const item of matchedItems) {
    const purchaseAmount = Number(item.purchaseAmount || 1);
    const yieldPct = Number(item.yieldPct || 100);

    // Get all invoice line items matched to this inventory item
    const matches = await query(`
      SELECT m.id as matchId, m.unitPrice as matchUnitPrice, m.quantity as matchQty,
             li.unitPrice as invoiceUnitPrice, li.quantity as invoiceQty, li.description,
             ph.id as priceHistoryId, ph.newCostPerUnit, ph.newCostPerUsableUnit
      FROM invoiceLineItemMatches m
      JOIN invoiceLineItems li ON li.id = m.invoiceLineItemId
      LEFT JOIN ingredientPriceHistory ph ON ph.invoiceLineItemId = m.invoiceLineItemId AND ph.inventoryItemId = m.inventoryItemId
      WHERE m.inventoryItemId = ? AND m.invoiceId BETWEEN 60012 AND 60131
      ORDER BY m.id
    `, [item.inventoryItemId]);

    if (matches.length === 0) continue;

    console.log(`\n─── ${item.name} (${item.unit}, purchaseAmt=${purchaseAmount}, yield=${yieldPct}%) ───`);

    const perUnitPrices = [];

    for (const match of matches) {
      const invoiceUnitPrice = Number(match.invoiceUnitPrice || 0);
      
      // The invoice unitPrice is the price per case/package
      // Divide by purchaseAmount to get per-unit cost
      const perUnitCost = invoiceUnitPrice / purchaseAmount;
      const perUsableUnitCost = perUnitCost / (yieldPct / 100);

      perUnitPrices.push(perUnitCost);

      console.log(`  ${match.description}: $${invoiceUnitPrice.toFixed(2)}/case ÷ ${purchaseAmount} = $${perUnitCost.toFixed(4)}/${item.unit}`);

      // Fix the match record's unitPrice to be per-unit
      await query(
        "UPDATE invoiceLineItemMatches SET unitPrice = ? WHERE id = ?",
        [perUnitCost.toFixed(4), match.matchId]
      );

      // Fix price history record if it exists
      if (match.priceHistoryId) {
        await query(
          "UPDATE ingredientPriceHistory SET newCostPerUnit = ?, newCostPerUsableUnit = ? WHERE id = ?",
          [perUnitCost.toFixed(4), perUsableUnitCost.toFixed(4), match.priceHistoryId]
        );
        priceHistoryFixed++;
      }
    }

    // Calculate new lastCost (most recent) and avgCost (average of all)
    const lastCost = perUnitPrices[perUnitPrices.length - 1];
    const avgCost = perUnitPrices.reduce((a, b) => a + b, 0) / perUnitPrices.length;
    const costPerUsableUnit = lastCost / (yieldPct / 100);

    console.log(`  → lastCost: $${lastCost.toFixed(4)}/${item.unit}, avgCost: $${avgCost.toFixed(4)}/${item.unit}, costPerUsable: $${costPerUsableUnit.toFixed(4)}/${item.unit}`);

    // Update inventory item
    await query(
      "UPDATE inventoryItems SET lastCost = ?, avgCost = ?, costPerUsableUnit = ?, purchaseCost = ?, updatedAt = NOW() WHERE id = ?",
      [lastCost.toFixed(4), avgCost.toFixed(4), costPerUsableUnit.toFixed(4), (lastCost * purchaseAmount).toFixed(2), item.inventoryItemId]
    );
    itemsUpdated++;
  }

  console.log(`\n\n═══ INVENTORY ITEMS UPDATED: ${itemsUpdated} ═══`);
  console.log(`═══ PRICE HISTORY RECORDS FIXED: ${priceHistoryFixed} ═══\n`);

  // Step 3: Recalculate ALL recipe costs
  console.log("─── Recalculating ALL recipe costs ───\n");

  const allItems = await query("SELECT id, name, costPerUsableUnit FROM inventoryItems");
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

  const allRecipes = await query("SELECT id, name, sellingPrice FROM recipes");
  let recipesUpdated = 0;

  for (const recipe of allRecipes) {
    const ingredients = await query(
      "SELECT id, ingredientName, inventoryItemId, quantity, usableUnitCost FROM recipeIngredients WHERE recipeId = ?",
      [recipe.id]
    );

    let totalCost = 0;
    for (const ing of ingredients) {
      const item = ing.inventoryItemId
        ? itemMap.get(ing.inventoryItemId)
        : itemByName.get(ing.ingredientName?.toLowerCase());

      const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : Number(ing.usableUnitCost || 0);
      const qty = Number(ing.quantity || 0);
      const lineCost = qty * usableUnitCost;
      totalCost += lineCost;

      if (item) {
        await query(
          "UPDATE recipeIngredients SET usableUnitCost = ?, lineCost = ?, inventoryItemId = ? WHERE id = ?",
          [usableUnitCost.toFixed(4), lineCost.toFixed(4), item.id, ing.id]
        );
      }
    }

    const sellingPrice = Number(recipe.sellingPrice || 0);
    const profit = sellingPrice - totalCost;
    const foodCostPct = sellingPrice > 0 ? Math.min((totalCost / sellingPrice) * 100, 999.99) : 0;

    await query(
      "UPDATE recipes SET totalCost = ?, profit = ?, foodCostPct = ? WHERE id = ?",
      [Math.min(totalCost, 999999.9999).toFixed(4), Math.max(Math.min(profit, 999999.9999), -999999.9999).toFixed(4), foodCostPct.toFixed(2), recipe.id]
    );

    console.log(`  ${recipe.name}: cost=$${totalCost.toFixed(2)}, price=$${sellingPrice.toFixed(2)}, food cost=${foodCostPct.toFixed(1)}%, profit=$${profit.toFixed(2)}`);
    recipesUpdated++;
  }

  console.log(`\n═══ RECIPES RECALCULATED: ${recipesUpdated} ═══`);

  // Step 4: Clean up excessive alerts from the batch run
  const alertsDeleted = await query(
    "DELETE FROM alerts WHERE title LIKE 'Price %' AND createdAt > DATE_SUB(NOW(), INTERVAL 2 HOUR)"
  );
  console.log(`\nCleaned up ${alertsDeleted.affectedRows || 0} batch-generated price alerts`);

  // Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  FIX COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Inventory items updated: ${itemsUpdated}`);
  console.log(`Price history records fixed: ${priceHistoryFixed}`);
  console.log(`Recipes recalculated: ${recipesUpdated}`);

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
