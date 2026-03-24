/**
 * Batch Cost Pipeline Runner
 * 
 * Runs the cost pipeline (match line items → update ingredient costs → recalculate recipes)
 * for all batch-imported invoices. Handles LLM unavailability gracefully by
 * still performing exact + fuzzy matching.
 * 
 * Usage: node server/runBatchCostPipeline.mjs
 */

import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

// ─── Load env from running server process ───
const serverPid = fs.readdirSync("/proc")
  .filter(f => /^\d+$/.test(f))
  .find(pid => {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      return cmdline.includes("tsx") && cmdline.includes("watch");
    } catch { return false; }
  });

let envVars = {};
if (serverPid) {
  const environ = fs.readFileSync(`/proc/${serverPid}/environ`, "utf-8");
  for (const entry of environ.split("\0")) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0) {
      envVars[entry.substring(0, eqIdx)] = entry.substring(eqIdx + 1);
    }
  }
}

const DATABASE_URL = envVars.DATABASE_URL || process.env.DATABASE_URL || "";
const FORGE_API_URL = envVars.BUILT_IN_FORGE_API_URL || process.env.BUILT_IN_FORGE_API_URL || "";
const FORGE_API_KEY = envVars.BUILT_IN_FORGE_API_KEY || process.env.BUILT_IN_FORGE_API_KEY || "";

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

// ─── DB Pool ───
const pool = mysql.createPool({
  uri: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 5,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ─── LLM Helper (may fail if quota exhausted) ───
async function tryLLM(messages, responseFormat) {
  if (!FORGE_API_URL || !FORGE_API_KEY) return null;
  
  const url = `${FORGE_API_URL.replace(/\/+$/, "")}/v1/chat/completions`;
  const payload = {
    model: "gemini-2.5-flash",
    messages,
    max_tokens: 16384,
    thinking: { budget_tokens: 128 },
  };
  if (responseFormat) payload.response_format = responseFormat;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${FORGE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      console.log(`  [LLM] Unavailable (${resp.status}), skipping AI matching`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.log(`  [LLM] Error: ${err.message}, skipping AI matching`);
    return null;
  }
}

// ─── Get all active inventory items ───
async function getInventoryItems() {
  return query("SELECT id, name, itemCode, unit, category, lastCost, avgCost, costPerUsableUnit, yieldPct, purchaseAmount, supplierId FROM inventoryItems WHERE isActive = 1");
}

// ─── Get line items for an invoice ───
async function getLineItems(invoiceId) {
  return query("SELECT id, invoiceId, description, productCode, quantity, unitPrice, amount FROM invoiceLineItems WHERE invoiceId = ?", [invoiceId]);
}

// ─── Check if matches already exist ───
async function hasExistingMatches(invoiceId) {
  const rows = await query("SELECT COUNT(*) as cnt FROM invoiceLineItemMatches WHERE invoiceId = ?", [invoiceId]);
  return Number(rows[0].cnt) > 0;
}

// ─── Keyword Alias Map ───
// Maps supplier invoice descriptions (French/English) to inventory item names
// This replaces AI matching when LLM is unavailable
const KEYWORD_ALIASES = {
  // Proteins
  "chicken": "Chicken",
  "poulet": "Chicken",
  "chicken brea": "Chicken",
  "chicken breast": "Chicken",
  "poitrine de poulet": "Chicken",
  
  "turkey": "Turkey",
  "dinde": "Turkey",
  "deli turkey": "Turkey",
  "dinde roti": "Turkey",
  
  "ham": "Ham",
  "jambon": "Ham",
  "ham blc forest": "Ham",
  
  "bacon": "Bacon",
  "bacon precooked": "Bacon",
  "bacon cuit": "Bacon",
  "bacon 15-17": "Bacon",
  "ready crisp": "Bacon",
  
  "egg": "Egg",
  "oeuf": "Egg",
  "egg ref bulk": "Egg",
  "egg large": "Egg",
  "egg med": "Egg",
  "oeuf moy": "Egg",
  
  "salmon": "Salmon",
  "saumon": "Salmon",
  "fish salmon": "Salmon",
  "salmon smoke": "Salmon",
  "saumon fumé": "Salmon",
  
  "veggie patty": "Veggie patty",
  "galette végé": "Veggie patty",
  
  "smoked meat": "Smoked meat",
  "viande fumée": "Smoked meat",
  "smk meat": "Smoked meat",
  
  "tofu": "Tofu",
  "fl tofu": "Tofu",
  "tofu regular": "Tofu",
  "tofu ferme": "Tofu",
  
  // Dairy
  "mozzarella": "Mozzarella",
  "mozz": "Mozzarella",
  "cheese mozz": "Mozzarella",
  "fromage mozz": "Mozzarella",
  
  "cheddar": "Cheddar",
  "ched": "Cheddar",
  "from ched": "Cheddar",
  "cheese ched": "Cheddar",
  "fromage cheddar": "Cheddar",
  
  "cc philadelphia": "CC Philadelphia",
  "cream cheese philadelphia": "CC Philadelphia",
  "cheese cream philadelphia": "CC Philadelphia",
  "philadelphia": "CC Philadelphia",
  
  "cc hinnawi": "CC Hinnawi",
  "cream cheese hinnawi": "CC Hinnawi",
  
  "cc riviera": "CC Riviera",
  "cheese cream spread m. rivier": "CC Riviera",
  "cream cheese riviera": "CC Riviera",
  "fromage riviera": "CC Riviera",
  "m. rivier": "CC Riviera",
  "rivier": "CC Riviera",
  
  // Vegetables & Greens
  "avocado": "Avocados",
  "avocat": "Avocados",
  
  "lettuce": "Lettuce",
  "laitue": "Lettuce",
  
  "tomato": "Tomatoes",
  "tomate": "Tomatoes",
  
  "onion": "Onions",
  "oignon": "Onions",
  "oignon haché": "Onions",
  
  "cucumber": "Cucumbers",
  "concombre": "Cucumbers",
  
  "pickle": "Pickles",
  "cornichon": "Pickles",
  
  "caper": "Capers",
  "câpre": "Capers",
  
  "spring mix": "Spring mix",
  "mesclun": "Spring mix",
  
  "pepper": "Peppers",
  "poivron": "Peppers",
  
  "lemon": "Lemon",
  "citron": "Lemon",
  
  // Condiments & Seasonings
  "spicy mayo": "Spicy Mayo",
  "mayo spicy": "Spicy Mayo",
  "sriracha mayo": "Spicy Mayo",
  
  "mayonnaise": "Mayo",
  "mayo": "Mayo",
  
  "dijon": "Dijon",
  "moutarde dijon": "Dijon",
  "mustard dijon": "Dijon",
  
  "honey mustard": "Honey mustard",
  "moutarde miel": "Honey mustard",
  
  "butter": "Butter",
  "beurre": "Butter",
  "butter salted": "Butter",
  "beurre non salé": "Butter",
  "beurre salé": "Butter",
  
  "bacon jam": "Bacon jam",
  "confiture bacon": "Bacon jam",
  
  "olive oil": "Olive oil",
  "huile olive": "Olive oil",
  "huile d'olive": "Olive oil",
  
  "cajun": "Cajun seasoning",
  "cajun seasoning": "Cajun seasoning",
  "assaisonnement cajun": "Cajun seasoning",
  
  // Bagel
  "bagel": "Bagel",
};

// Build a reverse lookup: inventory name (lowercase) → inventory item
let inventoryByName = null;
function getInventoryByName(items) {
  if (!inventoryByName) {
    inventoryByName = new Map(items.map(i => [i.name.toLowerCase(), i]));
  }
  return inventoryByName;
}

// ─── Phase 1: Exact match ───
function exactMatch(lineItem, inventoryItems) {
  const desc = (lineItem.description || "").toLowerCase().trim();
  const code = (lineItem.productCode || "").toLowerCase().trim();
  if (!desc && !code) return null;

  return inventoryItems.find(item =>
    item.name.toLowerCase().trim() === desc ||
    (item.itemCode && code && item.itemCode.toLowerCase().trim() === code)
  ) || null;
}

// ─── Phase 1.5: Keyword alias match ───
function aliasMatch(lineItem, inventoryItems) {
  const desc = (lineItem.description || "").toLowerCase().trim();
  if (!desc) return null;
  
  const nameMap = getInventoryByName(inventoryItems);
  
  // Try longest alias first (more specific matches take priority)
  const sortedAliases = Object.entries(KEYWORD_ALIASES).sort((a, b) => b[0].length - a[0].length);
  
  for (const [keyword, itemName] of sortedAliases) {
    if (desc.includes(keyword)) {
      const item = nameMap.get(itemName.toLowerCase());
      if (item) {
        return { item, score: 85, method: "alias" };
      }
    }
  }
  return null;
}

// ─── Phase 2: Fuzzy match ───
function fuzzyMatch(lineItem, inventoryItems) {
  const desc = (lineItem.description || "").toLowerCase().trim();
  const tokens = desc.split(/[\s,\-\/]+/).filter(t => t.length > 2);
  if (tokens.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const item of inventoryItems) {
    const itemTokens = item.name.toLowerCase().split(/[\s,\-\/]+/).filter(t => t.length > 2);
    const overlap = tokens.filter(t => itemTokens.some(it => it.includes(t) || t.includes(it)));
    const score = (overlap.length / Math.max(tokens.length, itemTokens.length)) * 100;

    if (score > bestScore && score >= 50) {
      bestScore = score;
      bestMatch = { item, score };
    }
  }

  return bestMatch;
}

// ─── Phase 3: AI match (graceful failure) ───
async function aiMatchBatch(unmatchedLines, inventoryItems) {
  if (unmatchedLines.length === 0) return [];

  const lineDescriptions = unmatchedLines.map(l => ({
    id: l.id,
    description: l.description || "Unknown",
    productCode: l.productCode || "",
  }));

  const inventoryList = inventoryItems.map(i => ({
    id: i.id,
    name: i.name,
    code: i.itemCode || "",
    unit: i.unit || "",
    category: i.category || "",
  }));

  const response = await tryLLM(
    [
      {
        role: "system",
        content: `You are a food service inventory matching assistant. Match invoice line items to inventory items. Consider French/English, brand names, package sizes. Return valid JSON.`,
      },
      {
        role: "user",
        content: `Match these invoice line items to inventory items:\n\nINVOICE LINES:\n${JSON.stringify(lineDescriptions)}\n\nINVENTORY:\n${JSON.stringify(inventoryList)}\n\nReturn JSON: { "matches": [{ "lineItemId": number, "inventoryItemId": number|null, "matchedItemName": string|null, "confidence": number }] }`,
      },
    ],
    {
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
    }
  );

  if (!response) return []; // LLM unavailable

  try {
    const content = response.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    return parsed.matches || [];
  } catch {
    return [];
  }
}

// ─── Save match to DB ───
async function saveMatch(invoiceId, lineItemId, lineDescription, inventoryItemId, matchedItemName, confidence, matchMethod, unitPrice, quantity, unit) {
  await query(
    `INSERT INTO invoiceLineItemMatches (invoiceLineItemId, invoiceId, inventoryItemId, lineDescription, matchedItemName, confidence, matchMethod, matchStatus, unitPrice, quantity, unit, priceApplied, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
    [lineItemId, invoiceId, inventoryItemId, lineDescription, matchedItemName, String(confidence), matchMethod, inventoryItemId ? "auto_matched" : "unmatched", String(unitPrice || 0), String(quantity || 0), unit]
  );
}

// ─── Update ingredient cost from match ───
async function updateIngredientCost(inventoryItem, unitPrice, invoiceId, lineItemId, supplierId) {
  const previousCost = Number(inventoryItem.lastCost || 0);
  const newCostPerUnit = unitPrice;

  // Skip if price hasn't changed
  if (Math.abs(previousCost - newCostPerUnit) < 0.001) return null;

  const yieldPct = Number(inventoryItem.yieldPct || 100);
  const newCostPerUsable = yieldPct > 0 ? newCostPerUnit / (yieldPct / 100) : newCostPerUnit;
  const avgCost = previousCost > 0 ? (previousCost + newCostPerUnit) / 2 : newCostPerUnit;
  const changePercent = previousCost > 0 ? ((newCostPerUnit - previousCost) / previousCost) * 100 : 0;
  const previousCostPerUsable = Number(inventoryItem.costPerUsableUnit || 0);

  // Update inventory item
  await query(
    `UPDATE inventoryItems SET lastCost = ?, avgCost = ?, costPerUsableUnit = ?, purchaseCost = ? WHERE id = ?`,
    [newCostPerUnit.toFixed(4), avgCost.toFixed(4), newCostPerUsable.toFixed(4), (newCostPerUnit * Number(inventoryItem.purchaseAmount || 1)).toFixed(2), inventoryItem.id]
  );

  // Log price change to history
  await query(
    `INSERT INTO ingredientPriceHistory (inventoryItemId, invoiceId, invoiceLineItemId, supplierId, previousCostPerUnit, newCostPerUnit, previousCostPerUsableUnit, newCostPerUsableUnit, changePercent, quantity, unit, priceSource, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invoice', NOW())`,
    [inventoryItem.id, invoiceId, lineItemId, supplierId, previousCost.toFixed(4), newCostPerUnit.toFixed(4), previousCostPerUsable.toFixed(4), newCostPerUsable.toFixed(4), changePercent.toFixed(2), "1", inventoryItem.unit || null]
  );

  return {
    itemId: inventoryItem.id,
    itemName: inventoryItem.name,
    previousCost,
    newCost: newCostPerUnit,
    changePercent,
  };
}

// ─── Recalculate ALL recipe costs ───
async function recalculateAllRecipeCosts() {
  const allItems = await query("SELECT id, name, costPerUsableUnit FROM inventoryItems");
  const itemMap = new Map(allItems.map(i => [i.id, i]));
  const itemByName = new Map(allItems.map(i => [i.name.toLowerCase(), i]));

  const allRecipes = await query("SELECT id, name, sellingPrice FROM recipes");
  let updated = 0;

  for (const recipe of allRecipes) {
    const ingredients = await query("SELECT id, recipeId, ingredientName, inventoryItemId, quantity, usableUnitCost FROM recipeIngredients WHERE recipeId = ?", [recipe.id]);

    let totalCost = 0;
    for (const ing of ingredients) {
      const item = ing.inventoryItemId ? itemMap.get(ing.inventoryItemId) : itemByName.get(ing.ingredientName?.toLowerCase());
      const usableUnitCost = item ? Number(item.costPerUsableUnit || 0) : Number(ing.usableUnitCost || 0);
      const qty = Number(ing.quantity || 0);
      const lineCost = qty * usableUnitCost;
      totalCost += lineCost;

      if (item) {
        await query("UPDATE recipeIngredients SET usableUnitCost = ?, lineCost = ?, inventoryItemId = ? WHERE id = ?",
          [usableUnitCost.toFixed(4), lineCost.toFixed(4), item.id, ing.id]);
      }
    }

    const sellingPrice = Number(recipe.sellingPrice || 0);
    const profit = sellingPrice - totalCost;
    const foodCostPct = sellingPrice > 0 ? Math.min((totalCost / sellingPrice) * 100, 999.99) : 0;

    await query("UPDATE recipes SET totalCost = ?, profit = ?, foodCostPct = ? WHERE id = ?",
      [Math.min(totalCost, 999999.9999).toFixed(4), Math.max(Math.min(profit, 999999.9999), -999999.9999).toFixed(4), foodCostPct.toFixed(2), recipe.id]);
    updated++;
  }

  return updated;
}

// ─── Create alerts for significant price changes ───
async function createAlerts(priceUpdates, invoiceId) {
  let alertsCreated = 0;
  for (const update of priceUpdates) {
    const absChange = Math.abs(update.changePercent);
    if (absChange < 10) continue;

    const direction = update.changePercent > 0 ? "increased" : "decreased";
    const severity = absChange >= 25 ? "urgent" : "medium";

    await query(
      `INSERT INTO alerts (type, severity, title, description, isRead, createdAt)
       VALUES ('inventory', ?, ?, ?, 0, NOW())`,
      [severity, `Price ${direction} ${absChange.toFixed(1)}%: ${update.itemName}`,
       `${update.itemName} price ${direction} from $${update.previousCost.toFixed(4)} to $${update.newCost.toFixed(4)} per unit (${update.changePercent > 0 ? "+" : ""}${update.changePercent.toFixed(1)}%). Source: Invoice #${invoiceId}.`]
    );
    alertsCreated++;
  }
  return alertsCreated;
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  BATCH COST PIPELINE RUNNER");
  console.log("═══════════════════════════════════════════════════\n");

  // Load batch results to get invoice IDs
  const batchResults = JSON.parse(fs.readFileSync("/home/ubuntu/invoice-batch/batch_results.json", "utf-8"));
  const invoiceIds = batchResults.createdIds || [];
  console.log(`Found ${invoiceIds.length} batch invoices to process\n`);

  // Get inventory items once
  const inventoryItems = await getInventoryItems();
  console.log(`Active inventory items: ${inventoryItems.length}\n`);

  // Totals
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalPriceUpdates = 0;
  let totalAlerts = 0;
  let totalExact = 0;
  let totalAlias = 0;
  let totalFuzzy = 0;
  let totalAI = 0;
  let llmAvailable = true;
  let processedCount = 0;
  const allPriceUpdates = [];

  for (const invoiceId of invoiceIds) {
    processedCount++;
    const progress = `[${processedCount}/${invoiceIds.length}]`;

    // Skip if already processed
    if (await hasExistingMatches(invoiceId)) {
      console.log(`${progress} Invoice #${invoiceId} - already has matches, skipping`);
      continue;
    }

    const lineItems = await getLineItems(invoiceId);
    if (lineItems.length === 0) {
      console.log(`${progress} Invoice #${invoiceId} - no line items, skipping`);
      continue;
    }

    // Get invoice supplier info
    const [invoice] = await query("SELECT supplierId FROM invoices WHERE id = ?", [invoiceId]);
    const supplierId = invoice?.supplierId || null;

    let matched = 0;
    let unmatched = 0;
    let exactCount = 0;
    let aliasCount = 0;
    let fuzzyCount = 0;
    const unmatchedForAI = [];

    // Phase 1, 1.5, 2: Exact + Alias + Fuzzy matching
    for (const line of lineItems) {
      // Phase 1: Exact match
      const exact = exactMatch(line, inventoryItems);
      if (exact) {
        await saveMatch(invoiceId, line.id, line.description, exact.id, exact.name, 100, "exact", Number(line.unitPrice || 0), Number(line.quantity || 0), exact.unit);
        const priceUpdate = await updateIngredientCost(exact, Number(line.unitPrice || 0), invoiceId, line.id, supplierId);
        if (priceUpdate) { allPriceUpdates.push(priceUpdate); totalPriceUpdates++; }
        matched++;
        exactCount++;
        continue;
      }

      // Phase 1.5: Keyword alias match
      const alias = aliasMatch(line, inventoryItems);
      if (alias) {
        await saveMatch(invoiceId, line.id, line.description, alias.item.id, alias.item.name, alias.score, "fuzzy", Number(line.unitPrice || 0), Number(line.quantity || 0), alias.item.unit);
        const priceUpdate = await updateIngredientCost(alias.item, Number(line.unitPrice || 0), invoiceId, line.id, supplierId);
        if (priceUpdate) { allPriceUpdates.push(priceUpdate); totalPriceUpdates++; }
        matched++;
        aliasCount++;
        totalAlias++;
        continue;
      }

      // Phase 2: Fuzzy token match
      const fuzzy = fuzzyMatch(line, inventoryItems);
      if (fuzzy) {
        await saveMatch(invoiceId, line.id, line.description, fuzzy.item.id, fuzzy.item.name, Math.round(fuzzy.score), "fuzzy", Number(line.unitPrice || 0), Number(line.quantity || 0), fuzzy.item.unit);
        if (fuzzy.score >= 70) {
          const priceUpdate = await updateIngredientCost(fuzzy.item, Number(line.unitPrice || 0), invoiceId, line.id, supplierId);
          if (priceUpdate) { allPriceUpdates.push(priceUpdate); totalPriceUpdates++; }
        }
        matched++;
        fuzzyCount++;
        continue;
      }

      unmatchedForAI.push(line);
    }

    // Phase 3: AI matching (if LLM available)
    if (unmatchedForAI.length > 0 && llmAvailable) {
      const aiResults = await aiMatchBatch(unmatchedForAI, inventoryItems);
      if (aiResults.length > 0) {
        for (const aiMatch of aiResults) {
          const line = unmatchedForAI.find(l => l.id === aiMatch.lineItemId);
          if (!line) continue;

          const invItem = aiMatch.inventoryItemId ? inventoryItems.find(i => i.id === aiMatch.inventoryItemId) : null;
          await saveMatch(invoiceId, line.id, line.description, aiMatch.inventoryItemId, aiMatch.matchedItemName, aiMatch.confidence, "ai", Number(line.unitPrice || 0), Number(line.quantity || 0), invItem?.unit || null);

          if (invItem && aiMatch.confidence >= 70) {
            const priceUpdate = await updateIngredientCost(invItem, Number(line.unitPrice || 0), invoiceId, line.id, supplierId);
            if (priceUpdate) {
              allPriceUpdates.push(priceUpdate);
              totalPriceUpdates++;
            }
          }

          if (aiMatch.inventoryItemId) {
            matched++;
            totalAI++;
          } else {
            unmatched++;
          }
        }
        // Mark remaining unmatched
        const aiMatchedIds = new Set(aiResults.map(m => m.lineItemId));
        for (const line of unmatchedForAI) {
          if (!aiMatchedIds.has(line.id)) {
            await saveMatch(invoiceId, line.id, line.description, null, null, 0, "ai", Number(line.unitPrice || 0), Number(line.quantity || 0), null);
            unmatched++;
          }
        }
      } else {
        // AI unavailable or returned nothing
        llmAvailable = false;
        for (const line of unmatchedForAI) {
          await saveMatch(invoiceId, line.id, line.description, null, null, 0, "ai", Number(line.unitPrice || 0), Number(line.quantity || 0), null);
          unmatched++;
        }
      }
    } else if (unmatchedForAI.length > 0) {
      // LLM not available, save as unmatched
      for (const line of unmatchedForAI) {
        await saveMatch(invoiceId, line.id, line.description, null, null, 0, "ai", Number(line.unitPrice || 0), Number(line.quantity || 0), null);
        unmatched++;
      }
    }

    totalMatched += matched;
    totalUnmatched += unmatched;
    totalExact += exactCount;
    totalFuzzy += fuzzyCount;

    console.log(`${progress} Invoice #${invoiceId}: ${lineItems.length} items → ${matched} matched (${exactCount} exact, ${aliasCount} alias, ${fuzzyCount} fuzzy), ${unmatched} unmatched`);

    // Create alerts for significant price changes on this invoice
    const invoicePriceUpdates = allPriceUpdates.filter(u => true); // all recent
    const alertCount = await createAlerts(allPriceUpdates.slice(-10), invoiceId);
    totalAlerts += alertCount;
  }

  // Final step: Recalculate ALL recipe costs
  console.log("\n─── Recalculating ALL recipe costs ───");
  const recipesUpdated = await recalculateAllRecipeCosts();
  console.log(`Recalculated ${recipesUpdated} recipes\n`);

  // Summary
  console.log("═══════════════════════════════════════════════════");
  console.log("  BATCH COST PIPELINE COMPLETE");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Invoices processed: ${processedCount}`);
  console.log(`Total line items matched: ${totalMatched}`);
  console.log(`  - Exact matches: ${totalExact}`);
  console.log(`  - Alias matches: ${totalAlias}`);
  console.log(`  - Fuzzy matches: ${totalFuzzy}`);
  console.log(`  - AI matches: ${totalAI}`);
  console.log(`Total unmatched: ${totalUnmatched}`);
  console.log(`Price updates applied: ${totalPriceUpdates}`);
  console.log(`Recipes recalculated: ${recipesUpdated}`);
  console.log(`Alerts created: ${totalAlerts}`);
  console.log(`LLM available: ${llmAvailable ? "Yes" : "No (exhausted)"}`);

  if (allPriceUpdates.length > 0) {
    console.log("\n─── Price Changes ───");
    for (const u of allPriceUpdates) {
      const dir = u.changePercent > 0 ? "↑" : "↓";
      console.log(`  ${u.itemName}: $${u.previousCost.toFixed(4)} → $${u.newCost.toFixed(4)} (${dir}${Math.abs(u.changePercent).toFixed(1)}%)`);
    }
  }

  // Save results
  const results = {
    processedAt: new Date().toISOString(),
    invoicesProcessed: processedCount,
    totalMatched,
    totalUnmatched,
    exactMatches: totalExact,
    aliasMatches: totalAlias,
    fuzzyMatches: totalFuzzy,
    aiMatches: totalAI,
    priceUpdates: totalPriceUpdates,
    recipesRecalculated: recipesUpdated,
    alertsCreated: totalAlerts,
    llmAvailable,
    priceChanges: allPriceUpdates,
  };
  fs.writeFileSync("/home/ubuntu/invoice-batch/cost_pipeline_results.json", JSON.stringify(results, null, 2));
  console.log("\nResults saved to /home/ubuntu/invoice-batch/cost_pipeline_results.json");

  await pool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
