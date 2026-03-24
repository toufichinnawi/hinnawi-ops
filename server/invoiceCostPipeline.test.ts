import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

function createAuthContext() {
  return {
    user: { id: 1, openId: "test", name: "Test", role: "admin" as const },
    setCookie: () => {},
    removeCookie: () => {},
  };
}

describe("Cost Pipeline", () => {
  // ─── tRPC Procedure Tests ───

  it("costPipeline.recentPriceChanges returns an array", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const changes = await caller.costPipeline.recentPriceChanges();
    expect(Array.isArray(changes)).toBe(true);
  });

  it("costPipeline.unmatchedItems returns an array", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const items = await caller.costPipeline.unmatchedItems();
    expect(Array.isArray(items)).toBe(true);
  });

  it("costPipeline.costImpact returns summary with expected shape", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const impact = await caller.costPipeline.costImpact();
    expect(impact).toHaveProperty("recentChanges");
    expect(impact).toHaveProperty("affectedRecipes");
    expect(impact).toHaveProperty("totalRecipes");
    expect(Array.isArray(impact.recentChanges)).toBe(true);
    expect(Array.isArray(impact.affectedRecipes)).toBe(true);
    expect(typeof impact.totalRecipes).toBe("number");
  });

  it("costPipeline.recalculateAll updates recipe costs", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.costPipeline.recalculateAll();
    expect(result).toHaveProperty("updated");
    expect(typeof result.updated).toBe("number");
    expect(result.updated).toBeGreaterThanOrEqual(0);
  });

  it("costPipeline.getMatches returns array for any invoice", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const matches = await caller.costPipeline.getMatches({ invoiceId: 9999 });
    expect(Array.isArray(matches)).toBe(true);
    // Non-existent invoice should return empty array
    expect(matches.length).toBe(0);
  });

  it("costPipeline.priceHistory returns array for any item", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const history = await caller.costPipeline.priceHistory({ inventoryItemId: 9999 });
    expect(Array.isArray(history)).toBe(true);
  });

  // ─── Direct Function Tests ───

  it("matchInvoiceLineItems returns empty for non-existent invoice", async () => {
    const { matchInvoiceLineItems } = await import("./invoiceCostPipeline");
    const results = await matchInvoiceLineItems(99999);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("updateIngredientCostsFromInvoice handles empty matches", async () => {
    const { updateIngredientCostsFromInvoice } = await import("./invoiceCostPipeline");
    const results = await updateIngredientCostsFromInvoice(99999, []);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it("recalculateAllRecipeCosts processes all recipes", async () => {
    const { recalculateAllRecipeCosts } = await import("./invoiceCostPipeline");
    const updated = await recalculateAllRecipeCosts();
    expect(typeof updated).toBe("number");
    expect(updated).toBeGreaterThanOrEqual(0);
  });

  it("createPriceChangeAlerts handles empty updates", async () => {
    const { createPriceChangeAlerts } = await import("./invoiceCostPipeline");
    const alertsCreated = await createPriceChangeAlerts([], 99999);
    expect(alertsCreated).toBe(0);
  });

  it("getIngredientPriceHistory returns array", async () => {
    const { getIngredientPriceHistory } = await import("./invoiceCostPipeline");
    const history = await getIngredientPriceHistory(1);
    expect(Array.isArray(history)).toBe(true);
  });

  it("getInvoiceMatches returns array", async () => {
    const { getInvoiceMatches } = await import("./invoiceCostPipeline");
    const matches = await getInvoiceMatches(1);
    expect(Array.isArray(matches)).toBe(true);
  });

  it("getCostImpactSummary returns structured data", async () => {
    const { getCostImpactSummary } = await import("./invoiceCostPipeline");
    const summary = await getCostImpactSummary();
    expect(summary).toHaveProperty("recentChanges");
    expect(summary).toHaveProperty("affectedRecipes");
    expect(summary).toHaveProperty("totalRecipes");
  });

  it("getUnmatchedLineItems returns array", async () => {
    const { getUnmatchedLineItems } = await import("./invoiceCostPipeline");
    const items = await getUnmatchedLineItems();
    expect(Array.isArray(items)).toBe(true);
  });

  it("runInvoiceCostPipeline returns structured result for non-existent invoice", async () => {
    const { runInvoiceCostPipeline } = await import("./invoiceCostPipeline");
    const result = await runInvoiceCostPipeline(99999);
    expect(result).toHaveProperty("invoiceId", 99999);
    expect(result).toHaveProperty("matchResults");
    expect(result).toHaveProperty("priceUpdates");
    expect(result).toHaveProperty("recipesRecalculated");
    expect(result).toHaveProperty("alertsCreated");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.matchResults)).toBe(true);
    expect(Array.isArray(result.priceUpdates)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
