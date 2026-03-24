import { getDb } from "./db";
import { menuItems, recipes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Seed the menuItems table with all known Hinnawi Bros menu items.
 * Items that match a recipe get hasRecipe=true and recipeId linked.
 * Items without a recipe get hasRecipe=false and a default COGS %.
 */
async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }

  // Get all existing recipes
  const allRecipes = await db.select().from(recipes);
  const recipeMap = new Map(allRecipes.map(r => [r.name.toLowerCase().trim(), r]));

  // Full Hinnawi Bros menu (from Koomi POS + recipe catalog + known items)
  // Categories: Sandwiches, Breakfast, Salads, Cream Cheese, Beverages, Sides, Desserts, Extras
  const knownMenuItems = [
    // ── Sandwiches (have recipes) ──
    { name: "Amelia with Ham", category: "Sandwiches", sellingPrice: "10.99" },
    { name: "Amelia with Turkey", category: "Sandwiches", sellingPrice: "10.99" },
    { name: "Bacon Jam Sandwich", category: "Sandwiches", sellingPrice: "9.99" },
    { name: "BLT", category: "Sandwiches", sellingPrice: "10.99" },
    { name: "George", category: "Sandwiches", sellingPrice: "12.99" },
    { name: "Mila", category: "Sandwiches", sellingPrice: "14.75" },
    { name: "Montréal", category: "Sandwiches", sellingPrice: "13.99" },
    { name: "New York", category: "Sandwiches", sellingPrice: "13.99" },
    { name: "Shanghai", category: "Sandwiches", sellingPrice: "11.99" },
    { name: "Toronto", category: "Sandwiches", sellingPrice: "13.99" },
    { name: "Vegetarian", category: "Sandwiches", sellingPrice: "10.99" },

    // ── Breakfast (have recipes) ──
    { name: "Petit-déjeuner", category: "Breakfast", sellingPrice: "8.99" },
    { name: "Petit-Quebec", category: "Breakfast", sellingPrice: "8.99" },
    { name: "Petit-Quebec with Bacon", category: "Breakfast", sellingPrice: "12.98" },
    { name: "Petit-Quebec with Ham", category: "Breakfast", sellingPrice: "12.98" },
    { name: "Quebec", category: "Breakfast", sellingPrice: "6.99" },
    { name: "Wake Up", category: "Breakfast", sellingPrice: "5.49" },

    // ── Salads (have recipes) ──
    { name: "Avocado Salad", category: "Salads", sellingPrice: "12.98" },
    { name: "Chicken Salad", category: "Salads", sellingPrice: "13.98" },
    { name: "Tofu Salad", category: "Salads", sellingPrice: "12.98" },

    // ── Cream Cheese (have recipes) ──
    { name: "Cream Cheese Bagel", category: "Cream Cheese", sellingPrice: "2.99" },
    { name: "Cream Cheese with Lox", category: "Cream Cheese", sellingPrice: "10.99" },

    // ── Beverages (NO recipes) ──
    { name: "Espresso", category: "Beverages", sellingPrice: "2.75" },
    { name: "Americano", category: "Beverages", sellingPrice: "3.50" },
    { name: "Latte", category: "Beverages", sellingPrice: "4.75" },
    { name: "Cappuccino", category: "Beverages", sellingPrice: "4.50" },
    { name: "Flat White", category: "Beverages", sellingPrice: "4.75" },
    { name: "Mocha", category: "Beverages", sellingPrice: "5.25" },
    { name: "Hot Chocolate", category: "Beverages", sellingPrice: "4.25" },
    { name: "Chai Latte", category: "Beverages", sellingPrice: "4.75" },
    { name: "Matcha Latte", category: "Beverages", sellingPrice: "5.50" },
    { name: "Drip Coffee", category: "Beverages", sellingPrice: "2.50" },
    { name: "Iced Coffee", category: "Beverages", sellingPrice: "4.25" },
    { name: "Iced Latte", category: "Beverages", sellingPrice: "5.25" },
    { name: "Fresh Orange Juice", category: "Beverages", sellingPrice: "5.99" },
    { name: "Smoothie", category: "Beverages", sellingPrice: "6.99" },
    { name: "Tea", category: "Beverages", sellingPrice: "2.75" },
    { name: "Soft Drink", category: "Beverages", sellingPrice: "2.25" },
    { name: "Water Bottle", category: "Beverages", sellingPrice: "1.99" },

    // ── Sides (NO recipes) ──
    { name: "Bagel (Plain)", category: "Sides", sellingPrice: "1.50" },
    { name: "Bagel (Sesame)", category: "Sides", sellingPrice: "1.50" },
    { name: "Bagel (Everything)", category: "Sides", sellingPrice: "1.75" },
    { name: "Soup of the Day", category: "Sides", sellingPrice: "5.99" },
    { name: "Side Salad", category: "Sides", sellingPrice: "4.99" },
    { name: "Extra Avocado", category: "Extras", sellingPrice: "2.50" },
    { name: "Extra Bacon", category: "Extras", sellingPrice: "2.50" },
    { name: "Extra Egg", category: "Extras", sellingPrice: "1.50" },
    { name: "Extra Cheese", category: "Extras", sellingPrice: "1.50" },
    { name: "Extra Lox", category: "Extras", sellingPrice: "3.50" },

    // ── Desserts (NO recipes) ──
    { name: "Cookie", category: "Desserts", sellingPrice: "2.99" },
    { name: "Brownie", category: "Desserts", sellingPrice: "3.49" },
    { name: "Muffin", category: "Desserts", sellingPrice: "3.49" },

    // ── Catering / Platters (NO recipes) ──
    { name: "Sandwich Platter (10)", category: "Catering", sellingPrice: "89.99" },
    { name: "Breakfast Platter (10)", category: "Catering", sellingPrice: "79.99" },
    { name: "Bagel & Cream Cheese Platter", category: "Catering", sellingPrice: "39.99" },
  ];

  // Clear existing menu items
  await db.delete(menuItems);
  console.log("Cleared existing menu items");

  let withRecipe = 0;
  let withoutRecipe = 0;

  for (const item of knownMenuItems) {
    // Try to match with a recipe (fuzzy match on name)
    const nameLower = item.name.toLowerCase().trim();
    let matchedRecipe = recipeMap.get(nameLower);

    // Try partial matching for common variations
    if (!matchedRecipe) {
      for (const [rName, recipe] of Array.from(recipeMap.entries())) {
        if (rName.includes(nameLower) || nameLower.includes(rName)) {
          matchedRecipe = recipe;
          break;
        }
        // Handle "Bacon Jam Sandwich" -> "Bacon jam" recipe
        const simpleName = nameLower.replace(' sandwich', '').replace(' bagel', '');
        if (rName === simpleName || simpleName === rName) {
          matchedRecipe = recipe;
          break;
        }
      }
    }

    const hasRecipeFlag = !!matchedRecipe;
    // Default COGS by category for items without recipes
    let defaultCogs = "30.00";
    if (!hasRecipeFlag) {
      switch (item.category) {
        case "Beverages": defaultCogs = "20.00"; break; // Coffee/drinks typically 15-25%
        case "Sides": defaultCogs = "25.00"; break;
        case "Extras": defaultCogs = "35.00"; break;
        case "Desserts": defaultCogs = "28.00"; break;
        case "Catering": defaultCogs = "32.00"; break;
        default: defaultCogs = "30.00";
      }
    }

    await db.insert(menuItems).values({
      name: item.name,
      category: item.category,
      sellingPrice: item.sellingPrice,
      recipeId: matchedRecipe?.id || null,
      hasRecipe: hasRecipeFlag,
      defaultCogsPct: hasRecipeFlag ? (matchedRecipe?.foodCostPct || "0.00") : defaultCogs,
      isActive: true,
    });

    if (hasRecipeFlag) {
      withRecipe++;
      console.log(`  ✓ ${item.name} → linked to recipe "${matchedRecipe!.name}" (${matchedRecipe!.foodCostPct}%)`);
    } else {
      withoutRecipe++;
      console.log(`  ✗ ${item.name} → NO RECIPE (default COGS: ${defaultCogs}%)`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total menu items: ${knownMenuItems.length}`);
  console.log(`With recipe: ${withRecipe}`);
  console.log(`Without recipe: ${withoutRecipe}`);
  process.exit(0);
}

main();
