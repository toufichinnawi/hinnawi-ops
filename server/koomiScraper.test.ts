import { describe, it, expect } from "vitest";
import {
  KOOMI_STORE_MAP,
  KOOMI_NAME_MAP,
  formatDate,
  getYesterday,
  breakdownToProductSalesRows,
  type BreakdownStoreBlock,
} from "./koomiScraper";

describe("Koomi Store Mapping", () => {
  it("maps all 3 Koomi locations to DB location IDs", () => {
    expect(Object.keys(KOOMI_STORE_MAP)).toHaveLength(3);
    expect(KOOMI_STORE_MAP["2207"].dbLocationId).toBe(2); // Mackay
    expect(KOOMI_STORE_MAP["1036"].dbLocationId).toBe(4); // Cathcart/Tunnel
    expect(KOOMI_STORE_MAP["1037"].dbLocationId).toBe(1); // President Kennedy
  });

  it("maps store names to DB location IDs", () => {
    expect(KOOMI_NAME_MAP["Hinnawi Bros (Mackay)"]).toBe(2);
    expect(KOOMI_NAME_MAP["Hinnawi Bros (Cathcart)"]).toBe(4);
    expect(KOOMI_NAME_MAP["Hinnawi Bros (President Kennedy)"]).toBe(1);
  });

  it("has correct store codes", () => {
    expect(KOOMI_STORE_MAP["2207"].code).toBe("MK");
    expect(KOOMI_STORE_MAP["1036"].code).toBe("CT");
    expect(KOOMI_STORE_MAP["1037"].code).toBe("PK");
  });
});

describe("formatDate", () => {
  it("formats a Date object as YYYY-MM-DD", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(formatDate(d)).toBe("2026-03-15");
  });

  it("pads single-digit months and days", () => {
    const d = new Date("2026-01-05T00:00:00Z");
    expect(formatDate(d)).toBe("2026-01-05");
  });
});

describe("getYesterday", () => {
  it("returns a valid YYYY-MM-DD string", () => {
    const result = getYesterday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a date before today", () => {
    const yesterday = new Date(getYesterday());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(yesterday.getTime()).toBeLessThan(today.getTime());
  });
});

describe("breakdownToProductSalesRows", () => {
  it("converts breakdown blocks to product sales rows", () => {
    const blocks: BreakdownStoreBlock[] = [
      {
        storeName: "Hinnawi Bros (Mackay)",
        dbLocationId: 2,
        dateRange: { from: "2026-03-15", to: "2026-03-15" },
        items: [
          {
            itemName: "Latte",
            category: "Coffee",
            group: "Hot Drinks",
            totalRevenue: 45.50,
            quantitySold: 10,
            quantityRefunded: 0,
          },
          {
            itemName: "Croissant",
            category: "Pastry",
            group: "Bakery",
            totalRevenue: 32.00,
            quantitySold: 8,
            quantityRefunded: 1,
          },
        ],
      },
    ];

    const rows = breakdownToProductSalesRows(blocks);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toEqual({
      locationId: 2,
      periodStart: "2026-03-15",
      periodEnd: "2026-03-15",
      section: "items",
      itemName: "Latte",
      category: "Coffee",
      groupName: "Hot Drinks",
      totalRevenue: "45.50",
      quantitySold: 10,
      quantityRefunded: 0,
    });

    expect(rows[1]).toEqual({
      locationId: 2,
      periodStart: "2026-03-15",
      periodEnd: "2026-03-15",
      section: "items",
      itemName: "Croissant",
      category: "Pastry",
      groupName: "Bakery",
      totalRevenue: "32.00",
      quantitySold: 8,
      quantityRefunded: 1,
    });
  });

  it("handles multiple store blocks", () => {
    const blocks: BreakdownStoreBlock[] = [
      {
        storeName: "Hinnawi Bros (Mackay)",
        dbLocationId: 2,
        dateRange: { from: "2026-03-15", to: "2026-03-15" },
        items: [
          { itemName: "Espresso", category: "Coffee", group: "Hot", totalRevenue: 20.0, quantitySold: 5, quantityRefunded: 0 },
        ],
      },
      {
        storeName: "Hinnawi Bros (President Kennedy)",
        dbLocationId: 1,
        dateRange: { from: "2026-03-15", to: "2026-03-15" },
        items: [
          { itemName: "Bagel", category: "Food", group: "Bakery", totalRevenue: 15.0, quantitySold: 3, quantityRefunded: 0 },
        ],
      },
    ];

    const rows = breakdownToProductSalesRows(blocks);
    expect(rows).toHaveLength(2);
    expect(rows[0].locationId).toBe(2);
    expect(rows[1].locationId).toBe(1);
  });

  it("returns empty array for empty blocks", () => {
    const rows = breakdownToProductSalesRows([]);
    expect(rows).toHaveLength(0);
  });

  it("skips blocks with no items", () => {
    const blocks: BreakdownStoreBlock[] = [
      {
        storeName: "Hinnawi Bros (Mackay)",
        dbLocationId: 2,
        dateRange: { from: "2026-03-15", to: "2026-03-15" },
        items: [],
      },
    ];
    const rows = breakdownToProductSalesRows(blocks);
    expect(rows).toHaveLength(0);
  });
});
