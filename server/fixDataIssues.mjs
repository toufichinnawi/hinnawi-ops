/**
 * Fix Data Issues in Inventory Costs
 * 
 * Problem: Different products matched to the same inventory item have different case sizes.
 * The per-unit cost was calculated using a single purchaseAmount, which is wrong for variants.
 * 
 * Fix approach: Use description-specific case sizes for cost calculation.
 */

import mysql from "mysql2/promise";
import fs from "fs";

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

// Description-specific case sizes (overrides the default purchaseAmount)
// Key: substring to match in description (lowercase), Value: actual kg/L/units per case
const DESCRIPTION_CASE_SIZES = {
  // Butter variants
  "nouvelle-zélande": { caseSize: 25, unit: "Kg" },        // 25 kg NZ butter
  "beurre n/sel 82pct europeen": { caseSize: 5, unit: "Kg" }, // 5 kg European butter
  "butter salted (20)": { caseSize: 5, unit: "Kg" },       // 20 pats × 0.25kg = 5kg
  
  // Milk - Lactantia 3.25% comes in cases of 4×4L = 16L
  "milk 3.25% lactantia": { caseSize: 16, unit: "L" },
  "milk homogenized 3.25": { caseSize: 16, unit: "L" },
  
  // Yeast - different package sizes
  "lallemand 20 x 2 lbs": { caseSize: 18.14, unit: "Kg" },  // 20×2lbs = 18.14 kg
  "lallemand 10 x 2 lbs": { caseSize: 9.07, unit: "Kg" },   // 10×2lbs = 9.07 kg
  "lallemand 2 lbs": { caseSize: 0.908, unit: "Kg" },        // single 2lbs = 0.908 kg
  
  // Pistachios
  "pistachio shelled uns(12": { caseSize: 5.44, unit: "Kg" }, // 12 lb = 5.44 kg
  "pistache écallée entière": { caseSize: 11.33, unit: "Kg" }, // 25 lbs = 11.33 kg
  
  // Raisins
  "raisin sult maison": { caseSize: 6.8, unit: "Kg" },  // typically 15 lb bag = 6.8 kg
  
  // Salmon - sold by weight, unitPrice IS per-kg already
  "fish salmon smoke coho": { caseSize: 1, unit: "Kg" },
  "salmon smoke": { caseSize: 1, unit: "Kg" },
  "saumon fumé": { caseSize: 1, unit: "Kg" },
  
  // Cream 10% - individual cartons, unitPrice is per carton
  "cream 10% lactantia": { caseSize: 1, unit: "L" },
  
  // Dark chocolate - different sizes
  "cacao barry 20 kg": { caseSize: 20, unit: "Kg" },
  "cacao barry 5 kg": { caseSize: 5, unit: "Kg" },
  
  // Chocolate chips
  "foley's 12 kg": { caseSize: 12, unit: "Kg" },
  "callebaut 30 lbs": { caseSize: 13.608, unit: "Kg" },
  
  // Puff pastry - 20 x 350g sheets
  "pâte feuilletée": { caseSize: 20, unit: "Unit" },
  "puff pastry": { caseSize: 20, unit: "Unit" },
};

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  FIX DATA ISSUES - Description-Specific Case Sizes");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: Fix Milk purchaseAmount to 16L (4×4L case)
  console.log("─── Step 1: Fix purchaseAmounts ───");
  await query("UPDATE inventoryItems SET purchaseAmount = 16 WHERE name = 'Milk 3.25%'");
  console.log("  Milk 3.25%: purchaseAmount 4 → 16 L (4×4L case)");
  
  // Salmon is sold by weight - purchaseAmount should be 1 (price is per kg)
  await query("UPDATE inventoryItems SET purchaseAmount = 1 WHERE name = 'Salmon'");
  console.log("  Salmon: purchaseAmount → 1 Kg (sold by weight, price is per kg)");
  
  // Cream 10% is per carton
  await query("UPDATE inventoryItems SET purchaseAmount = 1 WHERE name = 'Cream 10%'");
  console.log("  Cream 10%: purchaseAmount → 1 L (per carton)\n");

  // Step 2: Recalculate per-unit costs using description-specific case sizes
  console.log("─── Step 2: Recalculate with description-specific case sizes ───\n");

  // Get all matched items from batch invoices
  const matches = await query(`
    SELECT m.id, m.invoiceId, m.invoiceLineItemId, m.lineDescription, m.inventoryItemId, m.matchedItemName,
           li.unitPrice as rawInvoicePrice, li.quantity as rawQty
    FROM invoiceLineItemMatches m
    JOIN invoiceLineItems li ON li.id = m.invoiceLineItemId
    WHERE m.invoiceId BETWEEN 60012 AND 60131 AND m.inventoryItemId IS NOT NULL
    ORDER BY m.inventoryItemId
  `);
  
  const inventoryItems = await query("SELECT id, name, unit, purchaseAmount, yieldPct FROM inventoryItems WHERE isActive = 1");
  const itemById = new Map(inventoryItems.map(i => [i.id, i]));
  
  // Group matches by inventory item
  const matchesByItem = {};
  for (const m of matches) {
    if (!matchesByItem[m.inventoryItemId]) matchesByItem[m.inventoryItemId] = [];
    matchesByItem[m.inventoryItemId].push(m);
  }
  
  let totalFixed = 0;
  
  for (const [itemIdStr, itemMatches] of Object.entries(matchesByItem)) {
    const itemId = Number(itemIdStr);
    const item = itemById.get(itemId);
    if (!item) continue;
    
    const defaultCaseSize = Number(item.purchaseAmount || 1);
    const yieldPct = Number(item.yieldPct || 100);
    const perUnitPrices = [];
    
    for (const m of itemMatches) {
      const desc = (m.lineDescription || "").toLowerCase();
      const rawPrice = Number(m.rawInvoicePrice || 0);
      
      // Find description-specific case size
      let caseSize = defaultCaseSize;
      for (const [keyword, config] of Object.entries(DESCRIPTION_CASE_SIZES)) {
        if (desc.includes(keyword.toLowerCase())) {
          caseSize = config.caseSize;
          break;
        }
      }
      
      const perUnitCost = rawPrice / caseSize;
      const perUsableCost = perUnitCost / (yieldPct / 100);
      perUnitPrices.push(perUnitCost);
      
      // Update the match record
      await query("UPDATE invoiceLineItemMatches SET unitPrice = ? WHERE id = ?", [perUnitCost.toFixed(4), m.id]);
      
      // Update price history
      await query(
        "UPDATE ingredientPriceHistory SET newCostPerUnit = ?, newCostPerUsableUnit = ? WHERE invoiceLineItemId = ? AND inventoryItemId = ?",
        [perUnitCost.toFixed(4), perUsableCost.toFixed(4), m.invoiceLineItemId, itemId]
      );
    }
    
    // Update inventory item costs
    const lastCost = perUnitPrices[perUnitPrices.length - 1];
    const avgCost = perUnitPrices.reduce((a, b) => a + b, 0) / perUnitPrices.length;
    const costPerUsableUnit = lastCost / (yieldPct / 100);
    
    await query(
      "UPDATE inventoryItems SET lastCost = ?, avgCost = ?, costPerUsableUnit = ? WHERE id = ?",
      [lastCost.toFixed(4), avgCost.toFixed(4), costPerUsableUnit.toFixed(4), itemId]
    );
    
    console.log(`  ${item.name}: last=$${lastCost.toFixed(4)}/${item.unit}, avg=$${avgCost.toFixed(4)}/${item.unit} (${itemMatches.length} matches)`);
    totalFixed++;
  }
  
  console.log(`\n  Items recalculated: ${totalFixed}\n`);

  // Step 3: Recalculate all recipe costs
  console.log("─── Step 3: Recalculate recipe costs ───\n");
  
  const allItems = await query("SELECT id, name, costPerUsableUnit FROM inventoryItems");
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i]));
  
  const allRecipes = await query("SELECT id, name, sellingPrice FROM recipes");
  
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
    
    console.log(`  ${recipe.name}: cost=$${totalCost.toFixed(2)}, price=$${sellingPrice.toFixed(2)}, food cost=${foodCostPct.toFixed(1)}%`);
  }
  
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  DATA ISSUES FIXED");
  console.log("═══════════════════════════════════════════════════");
  
  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
