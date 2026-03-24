/**
 * Import real recipe data from parsed JSON into the database.
 * Replaces all placeholder recipe/ingredient data.
 */
import { getDb } from "./db";
import { recipes, recipeIngredients, inventoryItems } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

const parsed = JSON.parse(fs.readFileSync("/tmp/parsed_recipes.json", "utf-8"));

// Ingredient name normalization map (recipe names → master list names)
const INGREDIENT_ALIAS: Record<string, string> = {
  "cream cheese": "CC Hinnawi",
  "spicy mayo (sriracha)": "Spicy Mayo",
  "spicy mayo": "Spicy Mayo",
  "cc hinnawi": "CC Hinnawi",
  "cc philadelphia": "CC Philadelphia",
  "cc riviera": "CC Riviera",
};

function normalize(name: string): string {
  const lower = name.toLowerCase().trim();
  return INGREDIENT_ALIAS[lower] || name.trim();
}

// Category assignment for recipes
function categorizeRecipe(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("salad")) return "Salads";
  if (lower.includes("petit") || lower.includes("wake up") || lower.includes("quebec")) return "Breakfast";
  if (lower.includes("cream cheese") || lower.includes("lox")) return "Cream Cheese";
  return "Sandwiches";
}

async function main() {
  console.log("=== Importing Real Recipe Data ===\n");
  const db = await getDb();
  if (!db) { console.error("No database connection"); process.exit(1); }

  // Step 1: Clear existing placeholder data
  console.log("Clearing existing recipe data...");
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(inventoryItems);
  console.log("Cleared.\n");

  // Step 2: Import master ingredients into inventoryItems
  console.log("Importing master ingredients...");
  const ingredientMap = new Map<string, number>(); // name → id

  for (const ing of parsed.ingredients) {
    const [inserted] = await db.insert(inventoryItems).values({
      name: ing.ingredient,
      category: ing.category,
      unit: ing.unit,
      purchaseAmount: ing.amount.toString(),
      purchaseCost: ing.cost.toString(),
      avgCost: ing.costPerUnit.toFixed(4),
      lastCost: ing.costPerUnit.toFixed(4),
      yieldPct: ing.yieldPct.toFixed(1),
      costPerUsableUnit: ing.costPerUsableUnit.toFixed(4),
      supplierName: ing.supplier || null,
      notes: ing.notes || null,
      isActive: true,
    });
    // Get the inserted ID
    const rows = await db.select().from(inventoryItems).where(eq(inventoryItems.name, ing.ingredient));
    if (rows.length > 0) {
      ingredientMap.set(ing.ingredient.toLowerCase(), rows[rows.length - 1].id);
    }
    console.log(`  ✓ ${ing.ingredient} (${ing.supplier}) → $${ing.costPerUsableUnit.toFixed(2)}/${ing.unit}`);
  }
  console.log(`\nImported ${ingredientMap.size} master ingredients.\n`);

  // Step 3: Import in-house compound recipes as sub-recipes
  console.log("Importing in-house compound ingredients as sub-recipes...");
  for (const ih of parsed.inHouseRecipes) {
    const [inserted] = await db.insert(recipes).values({
      name: ih.name,
      category: "In-house Production",
      yield: "1.00",
      yieldUnit: "Kg",
      totalCost: ih.costPerKg.toFixed(4),
      foodCostPct: "0.00",
      isSubRecipe: true,
      isActive: true,
    });
    const subRows = await db.select().from(recipes).where(eq(recipes.name, ih.name));
    const subRecipeId = subRows[subRows.length - 1].id;

    for (const sub of ih.ingredients) {
      const invId = ingredientMap.get(sub.ingredient.toLowerCase()) || null;
      await db.insert(recipeIngredients).values({
        recipeId: subRecipeId,
        inventoryItemId: invId,
        ingredientName: sub.ingredient,
        quantity: sub.proportion.toFixed(4),
        unit: "Kg",
        usableUnitCost: sub.costPerKg.toFixed(4),
        lineCost: (sub.proportion * sub.costPerKg).toFixed(4),
      });
    }
    console.log(`  ✓ ${ih.name}: $${ih.costPerKg.toFixed(2)}/Kg (${ih.ingredients.length} sub-ingredients)`);
  }
  console.log();

  // Step 4: Import main recipes
  console.log("Importing menu recipes...");
  for (const recipe of parsed.recipes) {
    const category = categorizeRecipe(recipe.name);
    const foodCostPct = recipe.sellingPrice > 0
      ? ((recipe.totalCost / recipe.sellingPrice) * 100).toFixed(2)
      : "0.00";
    const profit = recipe.sellingPrice > 0
      ? (recipe.sellingPrice - recipe.totalCost).toFixed(4)
      : "0.0000";

    await db.insert(recipes).values({
      name: recipe.name,
      category,
      yield: "1.00",
      yieldUnit: "Unit",
      sellingPrice: recipe.sellingPrice.toFixed(2),
      totalCost: recipe.totalCost.toFixed(4),
      profit,
      foodCostPct,
      isSubRecipe: false,
      isActive: true,
    });

    const recipeRows = await db.select().from(recipes).where(eq(recipes.name, recipe.name));
    const recipeId = recipeRows[recipeRows.length - 1].id;

    for (const ing of recipe.ingredients) {
      const normalizedName = normalize(ing.ingredient);
      const invId = ingredientMap.get(normalizedName.toLowerCase()) || null;

      await db.insert(recipeIngredients).values({
        recipeId,
        inventoryItemId: invId,
        ingredientName: ing.ingredient,
        quantity: ing.qtyUsed.toFixed(4),
        unit: ing.unit,
        usableUnitCost: ing.usableUnitCost.toFixed(4),
        lineCost: ing.ingredientCost.toFixed(4),
      });
    }

    console.log(`  ✓ ${recipe.name}: $${recipe.totalCost.toFixed(2)} cost, $${recipe.sellingPrice.toFixed(2)} sell, ${foodCostPct}% food cost (${recipe.ingredients.length} ingredients)`);
  }

  // Step 5: Summary
  const allRecipes = await db.select().from(recipes);
  const allIngredients = await db.select().from(recipeIngredients);
  const allItems = await db.select().from(inventoryItems);

  console.log("\n=== Import Complete ===");
  console.log(`  Recipes: ${allRecipes.filter(r => !r.isSubRecipe).length} menu items + ${allRecipes.filter(r => r.isSubRecipe).length} sub-recipes`);
  console.log(`  Recipe ingredients: ${allIngredients.length} lines`);
  console.log(`  Master ingredients: ${allItems.length}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
