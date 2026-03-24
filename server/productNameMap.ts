/**
 * Maps French product names from Koomi POS to English menu item names.
 * Used for matching product sales data to menu items/recipes for cost enrichment.
 * 
 * Key: lowercase French product name from Koomi
 * Value: lowercase English menu item name (must match menuItems.name case-insensitively)
 */
export const PRODUCT_NAME_MAP: Record<string, string> = {
  // ─── Sandwiches ───
  "amelia": "amelia with ham",
  "bacon jam": "bacon jam sandwich",
  "blt": "blt",
  "george": "george",
  "mila": "mila",
  "montréal": "montréal",
  "montreal": "montréal",
  "new york": "new york",
  "shanghai": "shanghai",
  "toronto": "toronto",
  "végétarien": "vegetarian",
  "vegetarien": "vegetarian",

  // ─── Breakfast ───
  "petit-déjeuner": "petit-déjeuner",
  "petit déjeuner": "petit-déjeuner",
  "petit québec": "petit-quebec",
  "petit quebec": "petit-quebec",
  "québec": "quebec",
  "quebec": "quebec",
  "wake up": "wake up",
  "wake up & filter coffee (large)": "wake up",
  "wake up jan 22": "wake up",
  "bagel oeuf bacon": "petit-déjeuner", // Egg bacon bagel → breakfast item

  // ─── Bagels & Cream Cheese ───
  "bagel fromage à la crème": "cream cheese bagel",
  "bagel fromage à la creme": "cream cheese bagel",
  "bagel fromage à la creme/café": "cream cheese bagel",
  "fromage à la crème": "cream cheese bagel",
  "fromage à la creme": "cream cheese bagel",
  "fromage à la crème & saumon (lox)": "cream cheese with lox",
  "fromage à la creme & saumon (lox)": "cream cheese with lox",
  "bagel": "bagel (plain)",
  "bagel du jour": "bagel (plain)",
  "bagel beurre": "bagel (plain)",
  "bagel beurre d'arachide & confiture": "bagel (plain)",
  "1/2 douzaine bagel": "bagel (plain)",
  "douzaine bagels": "bagel (plain)",

  // ─── Salads ───
  "salade avocat": "avocado salad",
  "salade poulet": "chicken salad",
  "salade tofu": "tofu salad",

  // ─── Coffee & Espresso ───
  "café filtre": "drip coffee",
  "cafe filtre": "drip coffee",
  "americano": "americano",
  "americano glacé": "americano",
  "cappuccino": "cappuccino",
  "latté": "latte",
  "latte": "latte",
  "latte glacé": "iced latte",
  "iced latte + pastry of choice": "iced latte",
  "espresso": "espresso",
  "flat white": "flat white",
  "cortado": "espresso", // Cortado is espresso-based
  "macchiato": "espresso", // Macchiato is espresso-based
  "london fog": "tea", // Earl grey latte → tea category

  // ─── Specialty Lattes ───
  "chai latté": "chai latte",
  "chai latte": "chai latte",
  "dirty chai latte": "chai latte",
  "chocolat chaud": "hot chocolate",
  "matcha latté": "matcha latte",
  "matcha latte": "matcha latte",
  "mochaccino": "mocha",

  // ─── Juice & Beverages ───
  "jus d'orange pressé": "fresh orange juice",
  "jus d'orange pressé (petit)": "fresh orange juice",
  "jus oasis": "soft drink",
  "kombucha": "soft drink",
  "san pellegrino": "soft drink",
  "eau pétillante": "water bottle",
  "bouteille d'eau": "water bottle",
  "boissons gazeuses": "soft drink",
  "thé": "tea",
  "smoothie": "smoothie",

  // ─── Pastries & Baked Goods ───
  "muffin au chocolat": "muffin",
  "biscuit au chocolat": "cookie",
  "brownie": "brownie",
  "chocolatine": "brownie", // Pastry → brownie category
  "croissant": "brownie", // Pastry category
  "croissant aux amandes": "brownie", // Pastry category
  "pain aux bananes": "muffin", // Banana bread → muffin category
  "nutella pâté feuilleté": "cookie", // Pastry
  "granola maison": "cookie", // Granola → snack category
  "yogourt granola": "cookie", // Yogurt granola → snack category

  // ─── Extras & Add-ons ───
  "side salad": "side salad",
  "soup of the day": "soup of the day",
  "extra avocado": "extra avocado",
  "extra bacon": "extra bacon",
  "extra cheese": "extra cheese",
  "extra egg": "extra egg",
  "extra lox": "extra lox",

  // ─── Platters & Combos ───
  "1$ bagel cream cheese (june 2nd)": "cream cheese bagel",
  "bagel & cream cheese platter": "bagel & cream cheese platter",
  "breakfast platter (10)": "breakfast platter (10)",
  "sandwich platter (10)": "sandwich platter (10)",
};

/**
 * Category mapping for items that don't match menu items.
 * Used for the seasonal heatmap and category-level analysis.
 */
export const PRODUCT_CATEGORY_MAP: Record<string, string> = {
  // Sandwiches
  "amelia": "Sandwiches", "bacon jam": "Sandwiches", "blt": "Sandwiches",
  "george": "Sandwiches", "mila": "Sandwiches", "montréal": "Sandwiches",
  "montreal": "Sandwiches", "new york": "Sandwiches", "shanghai": "Sandwiches",
  "toronto": "Sandwiches", "végétarien": "Sandwiches", "vegetarien": "Sandwiches",
  
  // Breakfast
  "petit-déjeuner": "Breakfast", "petit déjeuner": "Breakfast",
  "petit québec": "Breakfast", "petit quebec": "Breakfast",
  "québec": "Breakfast", "quebec": "Breakfast",
  "wake up": "Breakfast", "wake up & filter coffee (large)": "Breakfast",
  "wake up jan 22": "Breakfast", "bagel oeuf bacon": "Breakfast",
  
  // Bagels
  "bagel fromage à la crème": "Bagels", "bagel fromage à la creme": "Bagels",
  "bagel fromage à la creme/café": "Bagels", "fromage à la crème": "Bagels",
  "fromage à la creme": "Bagels",
  "fromage à la crème & saumon (lox)": "Bagels", "fromage à la creme & saumon (lox)": "Bagels",
  "bagel": "Bagels", "bagel du jour": "Bagels", "bagel beurre": "Bagels",
  "bagel beurre d'arachide & confiture": "Bagels",
  "1/2 douzaine bagel": "Bagels", "douzaine bagels": "Bagels",
  
  // Salads
  "salade avocat": "Salads", "salade poulet": "Salads", "salade tofu": "Salads",
  
  // Coffee
  "café filtre": "Coffee", "cafe filtre": "Coffee", "americano": "Coffee",
  "americano glacé": "Coffee", "cappuccino": "Coffee", "latté": "Coffee",
  "latte": "Coffee", "latte glacé": "Coffee", "iced latte + pastry of choice": "Coffee",
  "espresso": "Coffee", "flat white": "Coffee", "cortado": "Coffee",
  "macchiato": "Coffee", "mochaccino": "Coffee",
  
  // Specialty Drinks
  "chai latté": "Specialty Drinks", "chai latte": "Specialty Drinks",
  "dirty chai latte": "Specialty Drinks", "chocolat chaud": "Specialty Drinks",
  "matcha latté": "Specialty Drinks", "matcha latte": "Specialty Drinks",
  "london fog": "Specialty Drinks",
  
  // Beverages
  "jus d'orange pressé": "Beverages", "jus d'orange pressé (petit)": "Beverages",
  "jus oasis": "Beverages", "kombucha": "Beverages", "san pellegrino": "Beverages",
  "eau pétillante": "Beverages", "bouteille d'eau": "Beverages",
  "boissons gazeuses": "Beverages", "thé": "Beverages", "smoothie": "Beverages",
  
  // Pastries
  "muffin au chocolat": "Pastries", "biscuit au chocolat": "Pastries",
  "brownie": "Pastries", "chocolatine": "Pastries", "croissant": "Pastries",
  "croissant aux amandes": "Pastries", "pain aux bananes": "Pastries",
  "nutella pâté feuilleté": "Pastries", "granola maison": "Pastries",
  "yogourt granola": "Pastries",
};

/**
 * Normalize a product name for matching.
 */
export function normalizeProductName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Find the best matching menu item name for a given product sales name.
 * Returns the English menu item name or null if no match found.
 */
export function findMenuItemMatch(productName: string): string | null {
  const normalized = normalizeProductName(productName);
  
  // Direct map lookup
  if (PRODUCT_NAME_MAP[normalized]) {
    return PRODUCT_NAME_MAP[normalized];
  }
  
  // Try partial matching — longest match wins
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const [frenchName, englishName] of Object.entries(PRODUCT_NAME_MAP)) {
    if (normalized.includes(frenchName) && frenchName.length > bestLen) {
      bestMatch = englishName;
      bestLen = frenchName.length;
    }
  }
  
  return bestMatch;
}

/**
 * Get the standardized category for a product name.
 */
export function getProductCategory(productName: string): string {
  const normalized = normalizeProductName(productName);
  
  if (PRODUCT_CATEGORY_MAP[normalized]) {
    return PRODUCT_CATEGORY_MAP[normalized];
  }
  
  // Try partial matching
  for (const [name, cat] of Object.entries(PRODUCT_CATEGORY_MAP)) {
    if (normalized.includes(name)) return cat;
  }
  
  return "Other";
}
