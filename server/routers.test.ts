import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-owner",
      email: "toufic@bagelandcafe.com",
      name: "Toufic R. Hinnawi",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("locations", () => {
  it("returns all locations", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const locations = await caller.locations.list();
    expect(Array.isArray(locations)).toBe(true);
    expect(locations.length).toBeGreaterThanOrEqual(1);
    expect(locations[0]).toHaveProperty("name");
    expect(locations[0]).toHaveProperty("code");
    expect(locations[0]).toHaveProperty("laborTarget");
    expect(locations[0]).toHaveProperty("foodCostTarget");
  });
});

describe("dashboard", () => {
  it("returns KPIs for a given date", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const kpis = await caller.dashboard.kpis({ date: "2025-03-10" });
    expect(kpis).toHaveProperty("totalSales");
    expect(kpis).toHaveProperty("pendingInvoices");
    expect(kpis).toHaveProperty("alertCount");
    expect(typeof kpis.totalSales).toBe("number");
    expect(typeof kpis.pendingInvoices).toBe("number");
  });

  it("returns store performance for a date range", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const perf = await caller.dashboard.storePerformance({
      startDate: "2025-03-01",
      endDate: "2025-03-14",
    });
    expect(Array.isArray(perf)).toBe(true);
    if (perf.length > 0) {
      expect(perf[0]).toHaveProperty("locationId");
      expect(perf[0]).toHaveProperty("name");
      expect(perf[0]).toHaveProperty("revenue");
      expect(perf[0]).toHaveProperty("laborPct");
      expect(perf[0]).toHaveProperty("laborTarget");
    }
  });

  it("returns sales trend data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const trend = await caller.dashboard.salesTrend({
      startDate: "2025-03-01",
      endDate: "2025-03-14",
    });
    expect(Array.isArray(trend)).toBe(true);
    if (trend.length > 0) {
      expect(trend[0]).toHaveProperty("date");
      expect(trend[0]).toHaveProperty("total");
      expect(typeof trend[0].total).toBe("number");
    }
  });

  it("returns monthly summary", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.dashboard.monthlySummary({ year: 2025 });
    expect(Array.isArray(summary)).toBe(true);
  });
});

describe("invoices", () => {
  it("returns all invoices when no filter is provided", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const invoices = await caller.invoices.list();
    expect(Array.isArray(invoices)).toBe(true);
    expect(invoices.length).toBeGreaterThanOrEqual(1);
    expect(invoices[0]).toHaveProperty("invoiceNumber");
    expect(invoices[0]).toHaveProperty("supplierName");
    expect(invoices[0]).toHaveProperty("locationName");
    expect(invoices[0]).toHaveProperty("total");
  });

  it("filters invoices by status", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const pending = await caller.invoices.list({ status: "pending" });
    expect(Array.isArray(pending)).toBe(true);
    for (const inv of pending) {
      expect(inv.status).toBe("pending");
    }
  });

  it("returns paid invoices", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const paid = await caller.invoices.list({ status: "paid" });
    expect(Array.isArray(paid)).toBe(true);
    for (const inv of paid) {
      expect(inv.status).toBe("paid");
    }
  });
});

describe("suppliers", () => {
  it("returns all suppliers", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const suppliers = await caller.suppliers.list();
    expect(Array.isArray(suppliers)).toBe(true);
    expect(suppliers.length).toBeGreaterThanOrEqual(1);
    expect(suppliers[0]).toHaveProperty("name");
  });
});

describe("inventory", () => {
  it("returns all inventory items", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.inventory.items();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toHaveProperty("name");
    expect(items[0]).toHaveProperty("unit");
    expect(items[0]).toHaveProperty("avgCost");
  });

  it("returns all recipes", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.inventory.recipes();
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    expect(recipes[0]).toHaveProperty("name");
    expect(recipes[0]).toHaveProperty("sellingPrice");
    expect(recipes[0]).toHaveProperty("totalCost");
    expect(recipes[0]).toHaveProperty("foodCostPct");
  });
});

describe("purchasing", () => {
  it("returns all purchase orders with supplier and location names", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const orders = await caller.purchasing.orders();
    expect(Array.isArray(orders)).toBe(true);
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders[0]).toHaveProperty("poNumber");
    expect(orders[0]).toHaveProperty("supplierName");
    expect(orders[0]).toHaveProperty("locationName");
    expect(orders[0]).toHaveProperty("subtotal");
  });
});

describe("alerts", () => {
  it("returns active alerts", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const alerts = await caller.alerts.active();
    expect(Array.isArray(alerts)).toBe(true);
    if (alerts.length > 0) {
      expect(alerts[0]).toHaveProperty("title");
      expect(alerts[0]).toHaveProperty("severity");
      expect(alerts[0]).toHaveProperty("description");
    }
  });
});

describe("integrations", () => {
  it("returns all integrations", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const integrations = await caller.integrations.list();
    expect(Array.isArray(integrations)).toBe(true);
    expect(integrations.length).toBeGreaterThanOrEqual(1);
    expect(integrations[0]).toHaveProperty("name");
    expect(integrations[0]).toHaveProperty("type");
    expect(integrations[0]).toHaveProperty("status");
  });
});

describe("workforce", () => {
  it("returns labor targets (locations)", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const targets = await caller.workforce.laborTargets();
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBeGreaterThanOrEqual(1);
    expect(targets[0]).toHaveProperty("laborTarget");
    expect(targets[0]).toHaveProperty("foodCostTarget");
  });

  it("returns payroll data for a date range", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const payroll = await caller.workforce.payroll({
      startDate: "2025-03-01",
      endDate: "2025-03-14",
    });
    expect(Array.isArray(payroll)).toBe(true);
  });
});

describe("reporting", () => {
  it("returns daily P&L for a given date", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const pnl = await caller.reporting.dailyPnl({ date: "2025-03-10" });
    expect(Array.isArray(pnl)).toBe(true);
    if (pnl.length > 0) {
      expect(pnl[0]).toHaveProperty("locationName");
      expect(pnl[0]).toHaveProperty("revenue");
      expect(pnl[0]).toHaveProperty("cogs");
      expect(pnl[0]).toHaveProperty("grossProfit");
      expect(pnl[0]).toHaveProperty("grossMargin");
      expect(pnl[0]).toHaveProperty("labor");
      expect(pnl[0]).toHaveProperty("operatingProfit");
      expect(pnl[0]).toHaveProperty("operatingMargin");
    }
  });
});

describe("invoice status update (protected)", () => {
  it("updates invoice status when authenticated", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // Get a pending invoice first
    const invoices = await caller.invoices.list({ status: "pending" });
    if (invoices.length > 0) {
      const result = await caller.invoices.updateStatus({
        id: invoices[0].id,
        status: "approved",
      });
      expect(result).toEqual({ success: true });

      // Revert back to pending for idempotency
      await caller.invoices.updateStatus({
        id: invoices[0].id,
        status: "pending",
      });
    }
  });
});

describe("recipes", () => {
  it("returns all recipes with ingredients", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.recipes.list();
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    expect(recipes[0]).toHaveProperty("name");
    expect(recipes[0]).toHaveProperty("category");
    expect(recipes[0]).toHaveProperty("totalCost");
    expect(recipes[0]).toHaveProperty("sellingPrice");
    expect(recipes[0]).toHaveProperty("foodCostPct");
    expect(recipes[0]).toHaveProperty("ingredients");
    expect(Array.isArray(recipes[0].ingredients)).toBe(true);
  });

  it("returns recipe detail by id", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.recipes.list();
    if (recipes.length > 0) {
      const detail = await caller.recipes.get({ id: recipes[0].id });
      expect(detail).not.toBeNull();
      expect(detail!.name).toBe(recipes[0].name);
      expect(detail).toHaveProperty("ingredients");
    }
  });

  it("returns all master ingredients via inventory.items", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.inventory.items();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toHaveProperty("name");
    expect(items[0]).toHaveProperty("unit");
    expect(items[0]).toHaveProperty("avgCost");
  });

  it("recipe list includes food cost percentage", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.recipes.list();
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    // Recipes with sellingPrice should have foodCostPct calculated
    const withPrice = recipes.filter(r => r.sellingPrice && Number(r.sellingPrice) > 0);
    if (withPrice.length > 0) {
      expect(withPrice[0]).toHaveProperty("foodCostPct");
      // foodCostPct can be string from DB decimal
      expect(Number(withPrice[0].foodCostPct)).not.toBeNaN();
    }
  });

  it("can create and delete a recipe (protected)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const created = await caller.recipes.create({
      name: "Test Recipe Vitest",
      category: "Sandwiches",
      sellingPrice: "12.99",
      isSubRecipe: false,
      ingredients: [
        { ingredientName: "Test Ingredient", quantity: "0.5", unit: "Kg" },
      ],
    });
    expect(created).toHaveProperty("id");
    expect(created.name).toBe("Test Recipe Vitest");

    // Clean up
    const deleted = await caller.recipes.delete({ id: created.id });
    expect(deleted).toBe(true);
  });
});

describe("reporting - extended", () => {
  it("returns date range with min/max dates", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const range = await caller.reporting.dateRange();
    expect(range).toHaveProperty("minDate");
    expect(range).toHaveProperty("maxDate");
    expect(range).toHaveProperty("totalDays");
    expect(typeof range.totalDays).toBe("number");
    expect(range.totalDays).toBeGreaterThan(0);
  });

  it("returns monthly aggregated summary", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.reporting.monthlyAggregated({ year: 2025 });
    expect(Array.isArray(summary)).toBe(true);
    expect(summary.length).toBeGreaterThanOrEqual(1);
    expect(summary[0]).toHaveProperty("month");
    expect(summary[0]).toHaveProperty("totalSales");
    expect(summary[0]).toHaveProperty("totalGst");
    expect(summary[0]).toHaveProperty("totalQst");
    expect(summary[0]).toHaveProperty("daysCount");
    expect(summary[0]).toHaveProperty("locationsCount");
  });

  it("returns monthly summary by location", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.reporting.monthlySummaryByLocation({ year: 2025 });
    expect(Array.isArray(summary)).toBe(true);
  });

  it("returns location IDs that have sales data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const locationIds = await caller.reporting.locationsWithData();
    expect(Array.isArray(locationIds)).toBe(true);
    expect(locationIds.length).toBeGreaterThanOrEqual(1);
    // Should include Ontario (id=3) since 7shifts data was imported
    expect(locationIds).toContain(3);
    // Should include PK (id=1) from Koomi data
    expect(locationIds).toContain(1);
  });

  it("returns daily PnL with real Koomi data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const pnl = await caller.reporting.dailyPnl({ date: "2025-06-15" });
    expect(Array.isArray(pnl)).toBe(true);
    // Should have data for at least one location
    if (pnl.length > 0) {
      expect(pnl[0].revenue).toBeGreaterThan(0);
    }
  });
});


describe("menuItems router", () => {
  it("lists all menu items", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.menuItems.list();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // Each item should have required fields
    const first = items[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("category");
    expect(first).toHaveProperty("hasRecipe");
    expect(first).toHaveProperty("defaultCogsPct");
  });

  it("returns items without recipes", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.menuItems.withoutRecipes();
    expect(Array.isArray(items)).toBe(true);
    // All returned items should not have recipes
    for (const item of items) {
      expect(item.hasRecipe).toBe(false);
    }
  });

  it("returns items with recipes", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const items = await caller.menuItems.withRecipes();
    expect(Array.isArray(items)).toBe(true);
    // All returned items should have recipes
    for (const item of items) {
      expect(item.hasRecipe).toBe(true);
    }
  });

  it("returns summary with coverage stats", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.menuItems.summary();
    expect(summary).toHaveProperty("totalItems");
    expect(summary).toHaveProperty("withRecipe");
    expect(summary).toHaveProperty("withoutRecipe");
    expect(summary).toHaveProperty("coveragePercent");
    expect(summary).toHaveProperty("itemsWithoutRecipe");
    expect(summary).toHaveProperty("byCategory");
    expect(summary.totalItems).toBe(summary.withRecipe + summary.withoutRecipe);
    expect(summary.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(summary.coveragePercent).toBeLessThanOrEqual(100);
  });

  it("updates COGS for an item (protected)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // Get an item without recipe first
    const items = await caller.menuItems.withoutRecipes();
    if (items.length > 0) {
      const item = items[0];
      const result = await caller.menuItems.updateCogs({ id: item.id, cogsPct: "25.50" });
      expect(result).toBe(true);
      // Verify the update
      const updated = await caller.menuItems.list();
      const found = updated.find(i => i.id === item.id);
      expect(found?.defaultCogsPct).toBe("25.50");
    }
  });

  it("bulk updates COGS for multiple items (protected)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const items = await caller.menuItems.withoutRecipes();
    if (items.length >= 2) {
      const updates = items.slice(0, 2).map(i => ({ id: i.id, cogsPct: "22.00" }));
      const result = await caller.menuItems.bulkUpdateCogs({ updates });
      expect(result).toBe(true);
    }
  });

  it("creates and deletes a menu item (protected)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const { id } = await caller.menuItems.create({
      name: "Test Item XYZ",
      category: "Test",
      sellingPrice: "9.99",
      defaultCogsPct: "33.00",
    });
    expect(id).toBeGreaterThan(0);
    // Verify it exists
    const items = await caller.menuItems.list();
    const found = items.find(i => i.id === id);
    expect(found?.name).toBe("Test Item XYZ");
    // Delete it
    const deleted = await caller.menuItems.delete({ id });
    expect(deleted).toBe(true);
    // Verify it's gone
    const after = await caller.menuItems.list();
    expect(after.find(i => i.id === id)).toBeUndefined();
  });
});

describe("recipes – CRUD, duplicate, bulk import", () => {
  it("lists all recipes with ingredients", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.recipes.list();
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThan(0);
    // Each recipe should have ingredients array
    const first = recipes[0];
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("ingredients");
    expect(Array.isArray(first.ingredients)).toBe(true);
  });

  it("gets a single recipe by id", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const recipes = await caller.recipes.list();
    const first = recipes[0];
    const recipe = await caller.recipes.get({ id: first.id });
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe(first.name);
    expect(recipe!.ingredients.length).toBeGreaterThanOrEqual(0);
  });

  it("creates a new recipe with ingredients", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.recipes.create({
      name: "Test Recipe Vitest",
      category: "Sandwiches",
      sellingPrice: "12.50",
      isSubRecipe: false,
      ingredients: [
        { ingredientName: "Test Ingredient A", quantity: "0.200", unit: "Kg" },
        { ingredientName: "Test Ingredient B", quantity: "0.050", unit: "L" },
      ],
    });
    expect(result).toHaveProperty("id");
    expect(result.id).toBeGreaterThan(0);

    // Verify it was created
    const recipe = await caller.recipes.get({ id: result.id });
    expect(recipe!.name).toBe("Test Recipe Vitest");
    expect(recipe!.ingredients.length).toBe(2);

    // Clean up
    await caller.recipes.delete({ id: result.id });
  });

  it("updates a recipe name and ingredients", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    // Create
    const { id } = await caller.recipes.create({
      name: "Update Test Recipe",
      category: "Salads",
      sellingPrice: "10.00",
      ingredients: [{ ingredientName: "Lettuce", quantity: "0.100", unit: "Kg" }],
    });
    // Update
    await caller.recipes.update({
      id,
      name: "Updated Recipe Name",
      sellingPrice: "11.00",
      ingredients: [
        { ingredientName: "Lettuce", quantity: "0.150", unit: "Kg" },
        { ingredientName: "Tomato", quantity: "0.050", unit: "Kg" },
      ],
    });
    const updated = await caller.recipes.get({ id });
    expect(updated!.name).toBe("Updated Recipe Name");
    expect(updated!.sellingPrice).toBe("11.00");
    expect(updated!.ingredients.length).toBe(2);

    // Clean up
    await caller.recipes.delete({ id });
  });

  it("duplicates a recipe", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const recipes = await caller.recipes.list();
    const original = recipes[0];
    const dup = await caller.recipes.duplicate({ id: original.id });
    expect(dup).toHaveProperty("id");
    expect(dup.id).not.toBe(original.id);

    const dupRecipe = await caller.recipes.get({ id: dup.id });
    expect(dupRecipe!.name).toBe(`${original.name} (Copy)`);
    expect(dupRecipe!.ingredients.length).toBe(original.ingredients.length);

    // Clean up
    await caller.recipes.delete({ id: dup.id });
  });

  it("bulk imports recipes and skips duplicates", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const recipes = await caller.recipes.list();
    const existingName = recipes[0].name;

    const result = await caller.recipes.bulkImport({
      recipes: [
        {
          name: existingName, // Should be skipped
          category: "Test",
          ingredients: [{ ingredientName: "X", quantity: "1", unit: "Kg" }],
        },
        {
          name: "Bulk Import Test Recipe",
          category: "Test",
          sellingPrice: "8.00",
          ingredients: [{ ingredientName: "Y", quantity: "0.5", unit: "Kg" }],
        },
      ],
    });
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);

    // Clean up
    const allRecipes = await caller.recipes.list();
    const imported = allRecipes.find(r => r.name === "Bulk Import Test Recipe");
    if (imported) await caller.recipes.delete({ id: imported.id });
  });

  it("recalculates costs for all recipes", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.recipes.recalculateCosts();
    expect(result).toHaveProperty("updated");
    expect(result.updated).toBeGreaterThanOrEqual(0);
  });

  it("deletes a recipe", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const { id } = await caller.recipes.create({
      name: "Delete Me Recipe",
      category: "Test",
      ingredients: [{ ingredientName: "Z", quantity: "1", unit: "Kg" }],
    });
    const deleted = await caller.recipes.delete({ id });
    expect(deleted).toBe(true);
    const after = await caller.recipes.get({ id });
    expect(after).toBeNull();
  });
});

describe("reporting – labour cost & location filters", () => {
  it("daily P&L includes laborSource and orderCount fields", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const pnl = await caller.reporting.dailyPnl({ date: "2025-06-15" });
    expect(Array.isArray(pnl)).toBe(true);
    if (pnl.length > 0) {
      expect(pnl[0]).toHaveProperty("laborSource");
      expect(pnl[0]).toHaveProperty("orderCount");
      expect(["actual", "payroll", "estimated"]).toContain(pnl[0].laborSource);
      expect(typeof pnl[0].orderCount).toBe("number");
    }
  });

  it("daily P&L uses actual labour cost from Koomi POS when available", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    // 2025-06-15 is a Sunday in June 2025, should have data for PK/MK/CT
    const pnl = await caller.reporting.dailyPnl({ date: "2025-06-15" });
    const withActual = pnl.filter((p: any) => p.laborSource === "actual");
    // At least some locations should have actual labor data
    if (withActual.length > 0) {
      for (const row of withActual) {
        expect(row.labor).toBeGreaterThan(0);
      }
    }
  });

  it("monthly aggregated summary includes labour cost and orders", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.reporting.monthlyAggregated({ year: 2025 });
    expect(Array.isArray(summary)).toBe(true);
    expect(summary.length).toBeGreaterThanOrEqual(1);
    expect(summary[0]).toHaveProperty("totalLabourCost");
    expect(summary[0]).toHaveProperty("totalOrders");
    // Labour cost should be > 0 for months with data
    const withLabour = summary.filter((m: any) => Number(m.totalLabourCost) > 0);
    expect(withLabour.length).toBeGreaterThan(0);
  });

  it("monthly aggregated summary supports location filter", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    // Filter for President Kennedy only (id=1)
    const filtered = await caller.reporting.monthlyAggregated({ year: 2025, locationIds: [1] });
    const allStores = await caller.reporting.monthlyAggregated({ year: 2025 });
    expect(Array.isArray(filtered)).toBe(true);
    // Filtered should have less or equal total sales than all stores
    const filteredTotal = filtered.reduce((s: number, m: any) => s + Number(m.totalSales || 0), 0);
    const allTotal = allStores.reduce((s: number, m: any) => s + Number(m.totalSales || 0), 0);
    expect(filteredTotal).toBeLessThanOrEqual(allTotal);
    expect(filteredTotal).toBeGreaterThan(0);
  });

  it("monthly aggregated summary supports multi-location filter", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    // Filter for PK (1) + MK (2)
    const twoStores = await caller.reporting.monthlyAggregated({ year: 2025, locationIds: [1, 2] });
    const oneStore = await caller.reporting.monthlyAggregated({ year: 2025, locationIds: [1] });
    expect(Array.isArray(twoStores)).toBe(true);
    const twoTotal = twoStores.reduce((s: number, m: any) => s + Number(m.totalSales || 0), 0);
    const oneTotal = oneStore.reduce((s: number, m: any) => s + Number(m.totalSales || 0), 0);
    // Two stores should have more revenue than one
    expect(twoTotal).toBeGreaterThanOrEqual(oneTotal);
  });

  it("monthly summary by location supports location filter", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const filtered = await caller.reporting.monthlySummaryByLocation({ year: 2025, locationIds: [2] });
    expect(Array.isArray(filtered)).toBe(true);
    // All rows should be for location 2 (Mackay)
    for (const row of filtered) {
      expect(row.locationId).toBe(2);
    }
  });

  it("monthly summary by location includes labour cost and orders", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const summary = await caller.reporting.monthlySummaryByLocation({ year: 2025 });
    expect(Array.isArray(summary)).toBe(true);
    if (summary.length > 0) {
      expect(summary[0]).toHaveProperty("totalLabourCost");
      expect(summary[0]).toHaveProperty("totalOrders");
    }
  });
});


// ─── 7shifts Integration Tests ───
describe("7shifts integration", () => {
  it("sevenShifts.status returns connection info", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const status = await caller.sevenShifts.status();
    expect(status).toHaveProperty("connected");
    if (status.connected) {
      expect(status).toHaveProperty("companyName");
      expect(status).toHaveProperty("companyId");
      expect(status).toHaveProperty("locationId");
      expect(status).toHaveProperty("dbLocationId");
      expect(status.companyId).toBe(308388);
      expect(status.locationId).toBe(379210);
      expect(status.dbLocationId).toBe(3);
    }
  });

  it("upsertDailySale inserts and updates Ontario data", async () => {
    const { upsertDailySale, getDailySalesForDate } = await import("./db");
    
    // Insert a test record
    const result1 = await upsertDailySale({
      locationId: 3,
      saleDate: "2099-01-01",
      totalSales: "500.00",
      orderCount: 25,
      labourCost: "100.00",
    });
    expect(result1).toBe("inserted");

    // Update the same record
    const result2 = await upsertDailySale({
      locationId: 3,
      saleDate: "2099-01-01",
      totalSales: "600.00",
      orderCount: 30,
      labourCost: "120.00",
    });
    expect(result2).toBe("updated");

    // Verify the data
    const sales = await getDailySalesForDate("2099-01-01");
    const ontarioSale = sales.find(s => s.locationId === 3);
    expect(ontarioSale).toBeDefined();
    if (ontarioSale) {
      expect(Number(ontarioSale.totalSales)).toBe(600);
      expect(Number(ontarioSale.labourCost)).toBe(120);
      expect(ontarioSale.orderCount).toBe(30);
    }

    // Cleanup
    const { getDb } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      await db.execute(sql`DELETE FROM dailySales WHERE locationId = 3 AND saleDate = '2099-01-01'`);
    }
  });

  it("Ontario location exists in database with id 3", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const locations = await caller.locations.list();
    const ontario = locations.find(l => l.id === 3);
    expect(ontario).toBeDefined();
    expect(ontario?.code).toBe("ONT");
    expect(ontario?.name).toContain("Ontario");
  });

  it("Ontario daily sales data exists in database", async () => {
    const { getSalesRange } = await import("./db");
    const sales = await getSalesRange("2025-12-01", "2026-12-31");
    const ontarioSales = sales.filter(s => s.locationId === 3);
    expect(ontarioSales.length).toBeGreaterThan(0);
  });
});

// ─── Bank Accounts Tests ───
describe("bankAccounts", () => {
  it("list returns all bank accounts", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.bankAccounts.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  it("byLocation returns accounts for President Kennedy (location 1)", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.bankAccounts.byLocation({ locationId: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((b: any) => b.locationId === 1)).toBe(true);
    expect(result.some((b: any) => b.name === "7553-CIBC PK")).toBe(true);
  });

  it("list contains all 5 expected bank accounts", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.bankAccounts.list();
    const names = result.map((b: any) => b.name);
    expect(names).toContain("7553-CIBC PK");
    expect(names).toContain("720-BMO MK");
    expect(names).toContain("Desjardins-Tunnel");
    expect(names).toContain("615-CIBC Ontario");
    expect(names).toContain("811-CIBC CK");
  });

  it("each bank account has correct structure", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.bankAccounts.list();
    for (const account of result) {
      expect(account).toHaveProperty("id");
      expect(account).toHaveProperty("name");
      expect(account).toHaveProperty("locationId");
      expect(account).toHaveProperty("accountType");
      expect(account).toHaveProperty("currency");
    }
  });

  it("byLocation returns empty for non-existent location", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.bankAccounts.byLocation({ locationId: 999 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("productSales.withCosts", () => {
  it("returns enriched product sales with cost data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.withCosts({});
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("itemName");
      expect(item).toHaveProperty("totalRevenue");
      expect(item).toHaveProperty("quantitySold");
      expect(item).toHaveProperty("totalCost");
      expect(item).toHaveProperty("grossProfit");
      expect(item).toHaveProperty("grossMarginPct");
      expect(item).toHaveProperty("costSource");
      expect(item).toHaveProperty("unitCost");
    }
  });

  it("filters by location", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.withCosts({ locationId: 2 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("filters by date range", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.withCosts({
      periodStart: "2025-01-01",
      periodEnd: "2025-01-31",
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("filters by category", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.withCosts({
      category: "Sandwiches",
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("productSales.monthOverMonth", () => {
  it("returns month-over-month comparison data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.monthOverMonth({
      currentPeriodStart: "2025-01-01",
      currentPeriodEnd: "2025-01-31",
    });
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("itemName");
      expect(item).toHaveProperty("currentRevenue");
      expect(item).toHaveProperty("previousRevenue");
      expect(item).toHaveProperty("revenueChange");
      expect(item).toHaveProperty("currentQty");
      expect(item).toHaveProperty("previousQty");
      expect(item).toHaveProperty("qtyChange");
      expect(item).toHaveProperty("isNew");
      expect(item).toHaveProperty("isDropped");
    }
  });

  it("returns empty array when no data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.monthOverMonth({
      currentPeriodStart: "2020-01-01",
      currentPeriodEnd: "2020-01-31",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("productSales.menuEngineering", () => {
  it("returns menu engineering quadrant analysis", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.menuEngineering({});
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("avgMargin");
    expect(result).toHaveProperty("avgPopularity");
    expect(Array.isArray(result.items)).toBe(true);
    if (result.items.length > 0) {
      const item = result.items[0];
      expect(item).toHaveProperty("itemName");
      expect(item).toHaveProperty("quantity");
      expect(item).toHaveProperty("revenue");
      expect(item).toHaveProperty("grossMarginPct");
      expect(item).toHaveProperty("quadrant");
      expect(["star", "plowhorse", "puzzle", "dog"]).toContain(item.quadrant);
      expect(item).toHaveProperty("costSource");
    }
  });

  it("filters by date range", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.productSales.menuEngineering({
      periodStart: "2025-01-01",
      periodEnd: "2025-01-31",
    });
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });
});

// ─── CFO Intelligence Tests ───

describe("cfo.profitability", () => {
  it("returns profitability data for a date range", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.cfo.profitability({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("locationId");
      expect(item).toHaveProperty("revenue");
      expect(item).toHaveProperty("laborCost");
      expect(item).toHaveProperty("grossProfit");
      expect(item).toHaveProperty("grossMarginPct");
      expect(item).toHaveProperty("primeCostPct");
      expect(item).toHaveProperty("avgTicket");
      expect(typeof item.revenue).toBe("number");
      expect(typeof item.grossMarginPct).toBe("number");
    }
  });
});

describe("cfo.revenueTrends", () => {
  it("returns monthly revenue trends", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.cfo.revenueTrends();
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("month");
      expect(item).toHaveProperty("revenue");
      expect(item).toHaveProperty("avgDaily");
      expect(item).toHaveProperty("avgTicket");
      expect(typeof item.revenue).toBe("number");
    }
  });

  it("filters by location", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.cfo.revenueTrends({ locationId: 1 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("cfo.laborEfficiency", () => {
  it("returns labor efficiency data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.cfo.laborEfficiency({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("laborPct");
      expect(item).toHaveProperty("laborTarget");
      expect(item).toHaveProperty("laborVariance");
      expect(item).toHaveProperty("revenuePerHour");
    }
  });
});

describe("cfo.seasonalHeatmap", () => {
  it("returns seasonal heatmap data", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.cfo.seasonalHeatmap();
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      const item = result[0];
      expect(item).toHaveProperty("itemName");
      expect(item).toHaveProperty("month");
      expect(item).toHaveProperty("revenue");
      expect(item).toHaveProperty("quantity");
    }
  });
});

describe("quotations", () => {
  it("returns empty or existing list of quotations", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const quots = await caller.quotations.list();
    expect(Array.isArray(quots)).toBe(true);
  });

  it("returns quotation counts", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const counts = await caller.quotations.counts();
    expect(counts).toHaveProperty("total");
    expect(typeof counts.total).toBe("number");
  });

  let createdQuotId: number;

  it("creates a quotation without advance requirement", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.quotations.create({
      quotationNumber: "QT-TEST-001",
      subtotal: "1000.00",
      gst: "50.00",
      qst: "99.75",
      total: "1149.75",
      advanceRequired: false,
      notes: "Test quotation without advance",
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
    createdQuotId = result.id!;
  });

  it("creates a quotation with advance requirement", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.quotations.create({
      quotationNumber: "QT-TEST-002",
      subtotal: "5000.00",
      gst: "250.00",
      qst: "498.75",
      total: "5748.75",
      advanceRequired: true,
      advanceAmount: "2000.00",
      notes: "Test quotation with advance",
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();
  });

  it("lists quotations with supplier and location names", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const quots = await caller.quotations.list();
    expect(quots.length).toBeGreaterThanOrEqual(2);
    expect(quots[0]).toHaveProperty("supplierName");
    expect(quots[0]).toHaveProperty("locationName");
    expect(quots[0]).toHaveProperty("quotationNumber");
  });

  it("gets a single quotation by id", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const quot = await caller.quotations.get({ id: createdQuotId });
    expect(quot).not.toBeNull();
    expect(quot!.quotationNumber).toBe("QT-TEST-001");
    expect(quot!.supplierName).toBeDefined();
  });

  it("updates a quotation", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.quotations.update({
      id: createdQuotId,
      notes: "Updated test notes",
    });
    expect(result.success).toBe(true);
    const updated = await appRouter.createCaller(createPublicContext()).quotations.get({ id: createdQuotId });
    expect(updated!.notes).toBe("Updated test notes");
  });

  it("updates quotation status", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.quotations.updateStatus({ id: createdQuotId, status: "accepted" });
    expect(result.success).toBe(true);
    const updated = await appRouter.createCaller(createPublicContext()).quotations.get({ id: createdQuotId });
    expect(updated!.status).toBe("accepted");
  });

  it("marks advance as paid with payment reference", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const quots = await appRouter.createCaller(createPublicContext()).quotations.list();
    const advanceQuot = quots.find(q => q.quotationNumber === "QT-TEST-002");
    expect(advanceQuot).toBeDefined();
    const result = await caller.quotations.markAdvancePaid({
      id: advanceQuot!.id,
      paymentRef: "CHQ-12345",
    });
    expect(result.success).toBe(true);
    const updated = await appRouter.createCaller(createPublicContext()).quotations.get({ id: advanceQuot!.id });
    expect(updated!.advancePaidStatus).toBe("paid");
    expect(updated!.advancePaymentRef).toBe("CHQ-12345");
  });

  it("marks advance as unpaid (reversal)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const quots = await appRouter.createCaller(createPublicContext()).quotations.list();
    const advanceQuot = quots.find(q => q.quotationNumber === "QT-TEST-002");
    const result = await caller.quotations.markAdvanceUnpaid({ id: advanceQuot!.id });
    expect(result.success).toBe(true);
    const updated = await appRouter.createCaller(createPublicContext()).quotations.get({ id: advanceQuot!.id });
    expect(updated!.advancePaidStatus).toBe("unpaid");
    expect(updated!.advancePaymentRef).toBeNull();
  });

  it("converts quotation to invoice", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.quotations.convertToInvoice({ id: createdQuotId });
    expect(result.success).toBe(true);
    expect(result.invoiceId).toBeDefined();
    const updated = await appRouter.createCaller(createPublicContext()).quotations.get({ id: createdQuotId });
    expect(updated!.status).toBe("converted");
    const invoices = await appRouter.createCaller(createPublicContext()).invoices.list();
    const linkedInvoice = invoices.find(i => i.quotationId === createdQuotId);
    expect(linkedInvoice).toBeDefined();
  });

  it("filters quotations by status", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const converted = await caller.quotations.list({ status: "converted" });
    expect(Array.isArray(converted)).toBe(true);
    for (const q of converted) {
      expect(q.status).toBe("converted");
    }
  });
});
