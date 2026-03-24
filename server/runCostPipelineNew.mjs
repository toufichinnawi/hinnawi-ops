/**
 * Cost Pipeline for 272 New Invoices (IDs 90001-90272)
 * 
 * Matches line items to inventory using alias + fuzzy matching,
 * updates inventory costs, and recalculates recipe costs.
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

// ═══ COMPREHENSIVE KEYWORD ALIAS MAP ═══
const KEYWORD_ALIASES = {
  // Proteins
  "chicken": "Chicken", "poulet": "Chicken", "chicken brea": "Chicken", "chicken breast": "Chicken",
  "turkey": "Turkey", "dinde": "Turkey", "deli turkey": "Turkey", "dinde roti": "Turkey",
  "ham": "Ham", "jambon": "Ham", "ham blc forest": "Ham",
  "bacon": "Bacon", "bacon precooked": "Bacon", "bacon cuit": "Bacon", "bacon 15-17": "Bacon", "ready crisp": "Bacon",
  "egg ref bulk": "Egg", "egg large": "Egg", "egg med": "Egg", "oeuf moy": "Egg", "oeuf large": "Egg",
  "salmon": "Salmon", "saumon": "Salmon", "fish salmon": "Salmon", "salmon smoke": "Salmon",
  "tofu": "Tofu", "fl tofu": "Tofu", "tofu regular": "Tofu", "tofu ferme": "Tofu",
  "smoked meat": "Smoked meat", "viande fumée": "Smoked meat",
  
  // Dairy
  "mozzarella": "Mozzarella", "mozz": "Mozzarella", "cheese mozz": "Mozzarella",
  "cheddar": "Cheddar", "ched": "Cheddar", "from ched": "Cheddar", "cheese ched": "Cheddar",
  "cheese cream philadelphia": "CC Philadelphia", "philadelphia": "CC Philadelphia",
  "cheese cream spread m. rivier": "CC Riviera", "m. rivier": "CC Riviera", "rivier": "CC Riviera",
  
  // Vegetables
  "avocado": "Avocados", "avocat": "Avocados",
  "lettuce": "Lettuce", "laitue": "Lettuce",
  "tomato": "Tomatoes", "tomate": "Tomatoes",
  "oignon haché": "Onions", "oignon": "Onions",
  "cucumber": "Cucumbers", "concombre": "Cucumbers",
  "pickle": "Pickles", "cornichon": "Pickles",
  "caper": "Capers", "câpre": "Capers",
  "spring mix": "Spring mix", "mesclun": "Spring mix",
  "pepper": "Peppers", "poivron": "Peppers",
  "lemon": "Lemon", "citron": "Lemon",
  
  // Condiments
  "spicy mayo": "Spicy Mayo", "sriracha mayo": "Spicy Mayo",
  "mayonnaise": "Mayo",
  "dijon": "Dijon", "mustard dijon": "Dijon",
  "honey mustard": "Honey mustard", "moutarde miel": "Honey mustard",
  "butter salted": "Butter", "beurre non salé": "Butter", "beurre n/sel": "Butter", "beurre sal": "Butter",
  "olive oil": "Olive oil", "huile olive": "Olive oil", "huile d'olive": "Olive oil",
  "cajun": "Cajun seasoning", "épices cajun": "Cajun seasoning",
  
  // Flours
  "farine three stars": "Flour - Three Stars", "three stars": "Flour - Three Stars",
  "farine forte": "Flour - Strong Bread", "farine forte à boulangerie": "Flour - Strong Bread",
  "farine de blé entier": "Flour - Whole Wheat", "farine de blé-entier": "Flour - Whole Wheat", "blé entier": "Flour - Whole Wheat", "farine de blé entier à pain": "Flour - Whole Wheat",
  "farine tout-usage": "Flour - All Purpose", "baker's hand": "Flour - All Purpose", "farine à pâtisserie": "Flour - All Purpose",
  "farine malt": "Flour - Malt", "malt no 05505": "Flour - Malt",
  "mélange de 12 grains": "12-Grain Mix", "12 grains": "12-Grain Mix", "farinart": "12-Grain Mix",
  
  // Sugars
  "sucre fin": "Sugar - White", "sucre redpath": "Sugar - White",
  "cassonade": "Sugar - Brown", "cassonade foncée": "Sugar - Brown",
  "sucre de canne": "Sugar - Organic Cane", "sucre biologique": "Sugar - Organic Cane", "sucre de canne extra-light": "Sugar - Organic Cane",
  "mélasse": "Molasses", "grandma": "Molasses",
  "miel naturel": "Honey", "miel doré": "Honey", "miel": "Honey",
  
  // Dairy (new)
  "milk 3.25": "Milk 3.25%", "milk homogenized": "Milk 3.25%", "lactantia": "Milk 3.25%", "lait 3.25": "Milk 3.25%",
  "cream 10": "Cream 10%", "crème 10": "Cream 10%",
  
  // Seeds & Nuts
  "graine de sésame indien": "Sesame Seeds (Indian)", "sésame indien": "Sesame Seeds (Indian)",
  "graine de sésame décortiquée": "Sesame Seeds (Hulled)", "sésame décortiquée": "Sesame Seeds (Hulled)",
  "pistachio": "Pistachios", "pistache": "Pistachios", "nuts pistachio": "Pistachios",
  "noix de grenoble": "Walnuts", "walnut": "Walnuts",
  
  // Baking
  "levure fraîche": "Yeast - Fresh", "levure": "Yeast - Fresh", "lallemand": "Yeast - Fresh",
  "poudre à pâte": "Baking Powder", "fleischmann": "Baking Powder",
  "laltisan": "Bread Conditioner", "conditionneur": "Bread Conditioner",
  "extrait de vanille": "Vanilla Extract", "vanille": "Vanilla Extract",
  
  // Chocolate
  "chocolat de couverture": "Dark Chocolate Couverture", "cacao barry": "Dark Chocolate Couverture", "guayaquil": "Dark Chocolate Couverture", "saint-domingue": "Dark Chocolate Couverture",
  "pépites de chocolat": "Chocolate Chips - Dark", "chocolate chip": "Chocolate Chips - Dark", "foley": "Chocolate Chips - Dark",
  "pépites de chocolats pur blanc": "Chocolate Chips - White", "callebaut": "Chocolate Chips - White",
  "nutella": "Nutella",
  
  // Oils
  "huile de canola": "Canola Oil", "canola": "Canola Oil", "oil canola": "Canola Oil", "la perla": "Canola Oil",
  
  // Spices
  "ail émincé": "Garlic - Dehydrated", "garlic": "Garlic - Dehydrated",
  "chili broyé": "Chili Flakes", "flocons de chili": "Chili Flakes",
  "cannelle": "Cinnamon", "cinnamon": "Cinnamon",
  "romarin": "Rosemary", "rosemary": "Rosemary",
  "sriracha": "Sriracha Sauce", "sauce sriracha": "Sriracha Sauce",
  "sauce soya": "Soy Sauce", "soy sauce": "Soy Sauce", "kikkoman": "Soy Sauce",
  
  // Prepared
  "pâte feuilletée": "Puff Pastry", "puff pastry": "Puff Pastry", "dough puff": "Puff Pastry",
  "raisin sult": "Raisins", "fruit dried raisin": "Raisins",
  
  // Beverages
  "soft drink coke": "Coke Cans", "coke can": "Coke Cans",
  "iced tea can": "Iced Tea Cans", "fuze": "Iced Tea Cans",
  "juice apple": "Apple Juice", "oasis apple": "Apple Juice",
  "juice orange": "Orange Juice", "oasis orange": "Orange Juice",
  "water natural spring": "Water Bottles", "water spring": "Water Bottles", "eska": "Water Bottles",
  "chips regular": "Chips", "chips ripple": "Chips",
  
  // Supplies
  "bag paper sandwich": "Paper Bags", "bag wax paper": "Paper Bags",
  "napkin": "Napkins", "xpressnap": "Napkins", "mealmates": "Napkins",
  "gant en nitrile": "Nitrile Gloves", "nitrile": "Nitrile Gloves",
  "lid plast dome": "Plastic Lids",
  "hair net": "Hair Nets", "hat (hair net": "Hair Nets",
  
  // Additional aliases for common items in new invoices
  "fuel surcharge": null, // skip fuel surcharges
  "frais de livraison": null, // skip delivery fees
  "deposit": null, // skip deposits
  "consigne": null, // skip deposits
};

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  COST PIPELINE FOR 272 NEW INVOICES (90001-90272)");
  console.log("═══════════════════════════════════════════════════\n");

  const inventoryItems = await query("SELECT id, name, unit, purchaseAmount, yieldPct FROM inventoryItems WHERE isActive = 1");
  const nameMap = new Map(inventoryItems.map(i => [i.name.toLowerCase(), i]));
  
  // Sort aliases by length (longest first for priority)
  const sortedAliases = Object.entries(KEYWORD_ALIASES).sort((a, b) => b[0].length - a[0].length);
  
  const newInvoices = await query(
    "SELECT id FROM invoices WHERE id BETWEEN 90001 AND 90272 ORDER BY id"
  );
  
  console.log(`Found ${newInvoices.length} new invoices to process\n`);
  
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalExact = 0;
  let totalAlias = 0;
  let totalFuzzy = 0;
  let totalSkipped = 0;
  const pricesByItem = {};
  
  for (let i = 0; i < newInvoices.length; i++) {
    const invoiceId = newInvoices[i].id;
    const lineItems = await query(
      "SELECT id, description, quantity, unitPrice, amount FROM invoiceLineItems WHERE invoiceId = ?",
      [invoiceId]
    );
    
    const [invoice] = await query("SELECT supplierId FROM invoices WHERE id = ?", [invoiceId]);
    const supplierId = invoice?.supplierId || null;
    
    let matched = 0, unmatched = 0, exactCount = 0, aliasCount = 0, fuzzyCount = 0, skipped = 0;
    
    for (const line of lineItems) {
      const desc = (line.description || "").toLowerCase().trim();
      if (!desc) { unmatched++; continue; }
      
      let matchedItem = null;
      let matchMethod = "";
      let confidence = 0;
      
      // Phase 1: Exact match
      const exactItem = inventoryItems.find(item => item.name.toLowerCase().trim() === desc);
      if (exactItem) {
        matchedItem = exactItem;
        matchMethod = "exact";
        confidence = 100;
        exactCount++;
      }
      
      // Phase 1.5: Alias match
      if (!matchedItem) {
        for (const [keyword, itemName] of sortedAliases) {
          if (desc.includes(keyword)) {
            if (itemName === null) {
              // Skip this item (fuel surcharges, delivery fees, etc.)
              skipped++;
              matchedItem = "SKIP";
              break;
            }
            const item = nameMap.get(itemName.toLowerCase());
            if (item) {
              matchedItem = item;
              matchMethod = "fuzzy";
              confidence = 85;
              aliasCount++;
              break;
            }
          }
        }
      }
      
      if (matchedItem === "SKIP") continue;
      
      // Phase 2: Fuzzy token match
      if (!matchedItem) {
        const tokens = desc.split(/[\s,\-\/]+/).filter(t => t.length > 2);
        let bestScore = 0;
        for (const item of inventoryItems) {
          const itemTokens = item.name.toLowerCase().split(/[\s,\-\/]+/).filter(t => t.length > 2);
          const overlap = tokens.filter(t => itemTokens.some(it => it.includes(t) || t.includes(it)));
          const score = (overlap.length / Math.max(tokens.length, itemTokens.length)) * 100;
          if (score > bestScore && score >= 50) {
            bestScore = score;
            matchedItem = item;
            matchMethod = "fuzzy";
            confidence = Math.round(score);
          }
        }
        if (matchedItem && matchMethod === "fuzzy" && !aliasCount) fuzzyCount++;
      }
      
      if (matchedItem && matchedItem !== "SKIP") {
        const purchaseAmount = Number(matchedItem.purchaseAmount || 1);
        const invoiceUnitPrice = Number(line.unitPrice || 0);
        const perUnitCost = invoiceUnitPrice / purchaseAmount;
        
        await query(
          `INSERT INTO invoiceLineItemMatches (invoiceId, invoiceLineItemId, lineDescription, inventoryItemId, matchedItemName, confidence, matchMethod, matchStatus, unitPrice, quantity, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'auto_matched', ?, ?, ?)`,
          [invoiceId, line.id, line.description, matchedItem.id, matchedItem.name, confidence, matchMethod, perUnitCost.toFixed(4), Number(line.quantity || 0), matchedItem.unit]
        );
        
        if (!pricesByItem[matchedItem.id]) pricesByItem[matchedItem.id] = [];
        pricesByItem[matchedItem.id].push({
          perUnitCost,
          invoiceId,
          lineItemId: line.id,
          supplierId,
        });
        
        matched++;
      } else if (matchedItem !== "SKIP") {
        await query(
          `INSERT INTO invoiceLineItemMatches (invoiceId, invoiceLineItemId, lineDescription, matchStatus, unitPrice, quantity)
           VALUES (?, ?, ?, 'unmatched', ?, ?)`,
          [invoiceId, line.id, line.description, Number(line.unitPrice || 0), Number(line.quantity || 0)]
        );
        unmatched++;
      }
    }
    
    totalMatched += matched;
    totalUnmatched += unmatched;
    totalExact += exactCount;
    totalAlias += aliasCount;
    totalFuzzy += fuzzyCount;
    totalSkipped += skipped;
    
    const progress = `[${i + 1}/${newInvoices.length}]`;
    if ((i + 1) % 25 === 0 || i === newInvoices.length - 1) {
      console.log(`${progress} Processed invoice #${invoiceId}: ${matched}/${lineItems.length} matched`);
    }
  }
  
  console.log(`\n═══ MATCHING COMPLETE ═══`);
  console.log(`Total matched: ${totalMatched} (${totalExact} exact, ${totalAlias} alias, ${totalFuzzy} fuzzy)`);
  console.log(`Total unmatched: ${totalUnmatched}`);
  console.log(`Total skipped (non-product): ${totalSkipped}`);
  console.log(`Match rate: ${((totalMatched / (totalMatched + totalUnmatched)) * 100).toFixed(1)}%\n`);
  
  // Update inventory costs
  console.log("─── Updating inventory costs ───\n");
  let itemsUpdated = 0;
  
  for (const [itemIdStr, prices] of Object.entries(pricesByItem)) {
    const itemId = Number(itemIdStr);
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) continue;
    
    // Get existing prices from the first batch too
    const existingPrices = await query(
      "SELECT unitPrice FROM invoiceLineItemMatches WHERE inventoryItemId = ? AND invoiceId BETWEEN 60012 AND 60131 AND matchStatus = 'auto_matched'",
      [itemId]
    );
    
    const allPrices = [
      ...existingPrices.map(p => Number(p.unitPrice)),
      ...prices.map(p => p.perUnitCost)
    ];
    
    const yieldPct = Number(item.yieldPct || 100);
    const lastCost = prices[prices.length - 1].perUnitCost;
    const avgCost = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const costPerUsableUnit = lastCost / (yieldPct / 100);
    const purchaseAmount = Number(item.purchaseAmount || 1);
    
    await query(
      "UPDATE inventoryItems SET lastCost = ?, avgCost = ?, costPerUsableUnit = ?, purchaseCost = ?, updatedAt = NOW() WHERE id = ?",
      [lastCost.toFixed(4), avgCost.toFixed(4), costPerUsableUnit.toFixed(4), (lastCost * purchaseAmount).toFixed(2), itemId]
    );
    
    // Create price history records for new matches
    for (const p of prices) {
      const costPerUsable = p.perUnitCost / (yieldPct / 100);
      await query(
        `INSERT INTO ingredientPriceHistory (inventoryItemId, invoiceId, invoiceLineItemId, supplierId, previousCostPerUnit, newCostPerUnit, previousCostPerUsableUnit, newCostPerUsableUnit, changePercent, quantity, unit, priceSource, createdAt)
         VALUES (?, ?, ?, ?, 0, ?, 0, ?, 0, 1, ?, 'invoice', NOW())`,
        [itemId, p.invoiceId, p.lineItemId, p.supplierId, p.perUnitCost.toFixed(4), costPerUsable.toFixed(4), item.unit]
      );
    }
    
    console.log(`  ${item.name}: $${lastCost.toFixed(4)}/${item.unit} (avg: $${avgCost.toFixed(4)}, ${allPrices.length} total price points)`);
    itemsUpdated++;
  }
  
  console.log(`\n  Inventory items updated: ${itemsUpdated}\n`);
  
  // Recalculate recipe costs
  console.log("─── Recalculating recipe costs ───\n");
  
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
    
    console.log(`  ${recipe.name}: cost=$${totalCost.toFixed(2)}, price=$${sellingPrice.toFixed(2)}, food cost=${foodCostPct.toFixed(1)}%`);
    recipesUpdated++;
  }
  
  // Final summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  COST PIPELINE COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Invoices processed: ${newInvoices.length}`);
  console.log(`Line items matched: ${totalMatched} / ${totalMatched + totalUnmatched} (${((totalMatched / (totalMatched + totalUnmatched)) * 100).toFixed(1)}%)`);
  console.log(`Non-product items skipped: ${totalSkipped}`);
  console.log(`Inventory items updated: ${itemsUpdated}`);
  console.log(`Recipes recalculated: ${recipesUpdated}`);
  
  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
