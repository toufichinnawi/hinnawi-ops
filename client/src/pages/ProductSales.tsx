import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, TrendingDown, Trophy, Crown, AlertTriangle, ShieldAlert,
  Upload, Download, BarChart3, Minus, Loader2, Star, Tractor, Puzzle, Dog,
  ArrowUpRight, ArrowDownRight, Sparkles
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";

// ─── Helpers ───

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(val);
}

function formatNumber(val: number) {
  return new Intl.NumberFormat("en-CA").format(val);
}

function formatPct(val: number) {
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

// ─── Date range presets ───

type DatePreset = "today" | "yesterday" | "last_week" | "this_month" | "this_year" | "last_month" | "last_year" | "custom";

function getDateRange(preset: DatePreset, customFrom?: string, customTill?: string): { start: string; end: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate();

  switch (preset) {
    case "today":
      return { start: fmt(now), end: fmt(now) };
    case "yesterday": {
      const d = new Date(y, m, day - 1);
      return { start: fmt(d), end: fmt(d) };
    }
    case "last_week": {
      const dow = now.getDay();
      const lastSun = new Date(y, m, day - dow - 7);
      const lastSat = new Date(y, m, day - dow - 1);
      return { start: fmt(lastSun), end: fmt(lastSat) };
    }
    case "this_month":
      return { start: `${y}-${String(m + 1).padStart(2, "0")}-01`, end: fmt(now) };
    case "this_year":
      return { start: `${y}-01-01`, end: fmt(now) };
    case "last_month": {
      const s = new Date(y, m - 1, 1);
      const e = new Date(y, m, 0);
      return { start: fmt(s), end: fmt(e) };
    }
    case "last_year":
      return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    case "custom":
      return { start: customFrom || fmt(now), end: customTill || fmt(now) };
    default:
      return { start: fmt(now), end: fmt(now) };
  }
}

// ─── Component ───

export default function ProductSales() {
  const [, navigate] = useLocation();
  const { data: allLocations } = trpc.locations.list.useQuery();
  const { data: categories } = trpc.productSales.categories.useQuery();

  // Filters
  const [datePreset, setDatePreset] = useState<DatePreset>("this_year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTill, setCustomTill] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCount, setShowCount] = useState(10);
  const [activeTab, setActiveTab] = useState("top-items");

  const dateRange = useMemo(() => getDateRange(datePreset, customFrom, customTill), [datePreset, customFrom, customTill]);
  const locationId = storeFilter !== "all" ? parseInt(storeFilter) : undefined;

  // Enriched data with costs
  const { data: enrichedData, isLoading } = trpc.productSales.withCosts.useQuery({
    locationId,
    periodStart: dateRange.start,
    periodEnd: dateRange.end,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });

  // Month-over-month data
  const { data: momData, isLoading: momLoading } = trpc.productSales.monthOverMonth.useQuery({
    locationId,
    currentPeriodStart: dateRange.start,
    currentPeriodEnd: dateRange.end,
  });

  // Menu engineering data
  const { data: meData, isLoading: meLoading } = trpc.productSales.menuEngineering.useQuery({
    locationId,
    periodStart: dateRange.start,
    periodEnd: dateRange.end,
  });

  // Aggregate enriched data by item name
  const aggregatedItems = useMemo(() => {
    if (!enrichedData) return [];
    const map = new Map<string, {
      itemName: string; category: string; totalRevenue: number; quantitySold: number;
      quantityRefunded: number; avgPrice: number; totalCost: number; grossProfit: number;
      grossMarginPct: number; costSource: string; unitCost: number;
    }>();

    for (const row of enrichedData) {
      const key = `${row.itemName}|||${row.category || ""}`;
      const rev = parseFloat(row.totalRevenue || "0");
      const qty = row.quantitySold || 0;
      const cost = parseFloat(row.totalCost || "0");
      const profit = parseFloat(row.grossProfit || "0");

      const existing = map.get(key);
      if (existing) {
        existing.totalRevenue += rev;
        existing.quantitySold += qty;
        existing.quantityRefunded += (row.quantityRefunded || 0);
        existing.totalCost += cost;
        existing.grossProfit += profit;
      } else {
        map.set(key, {
          itemName: row.itemName,
          category: row.category || "Uncategorized",
          totalRevenue: rev,
          quantitySold: qty,
          quantityRefunded: row.quantityRefunded || 0,
          avgPrice: 0,
          totalCost: cost,
          grossProfit: profit,
          grossMarginPct: 0,
          costSource: row.costSource,
          unitCost: parseFloat(row.unitCost || "0"),
        });
      }
    }

    const items = Array.from(map.values());
    for (const item of items) {
      item.avgPrice = item.quantitySold > 0 ? item.totalRevenue / item.quantitySold : 0;
      item.unitCost = item.quantitySold > 0 ? item.totalCost / item.quantitySold : 0;
      item.grossMarginPct = item.totalRevenue > 0 ? (item.grossProfit / item.totalRevenue) * 100 : 0;
    }
    return items.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [enrichedData]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { revenue: number; units: number }>();
    for (const item of aggregatedItems) {
      const existing = map.get(item.category);
      if (existing) {
        existing.revenue += item.totalRevenue;
        existing.units += item.quantitySold;
      } else {
        map.set(item.category, { revenue: item.totalRevenue, units: item.quantitySold });
      }
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v.revenue, 0);
    return Array.from(map.entries())
      .map(([category, v]) => ({ category, revenue: v.revenue, units: v.units, pct: total > 0 ? (v.revenue / total) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [aggregatedItems]);

  const totalRevenue = aggregatedItems.reduce((s, i) => s + i.totalRevenue, 0);
  const totalUnits = aggregatedItems.reduce((s, i) => s + i.quantitySold, 0);

  // KPIs
  const topItem = aggregatedItems[0];
  const topCategory = categoryBreakdown[0];

  // Highest margin item (with recipe cost)
  const highestMarginItem = useMemo(() => {
    const withCosts = aggregatedItems.filter(i => i.costSource === "recipe" && i.totalRevenue > 0);
    if (withCosts.length === 0) return null;
    return withCosts.sort((a, b) => b.grossMarginPct - a.grossMarginPct)[0];
  }, [aggregatedItems]);

  // Menu risk: lowest margin item with recipe cost
  const menuRiskItem = useMemo(() => {
    const withCosts = aggregatedItems.filter(i => i.costSource === "recipe" && i.totalRevenue > 0);
    if (withCosts.length < 2) {
      // Fallback: lowest revenue item
      if (aggregatedItems.length < 3) return null;
      return [...aggregatedItems].sort((a, b) => a.totalRevenue - b.totalRevenue)[0];
    }
    return withCosts.sort((a, b) => a.grossMarginPct - b.grossMarginPct)[0];
  }, [aggregatedItems]);

  const topItems = aggregatedItems.slice(0, showCount);

  const datePresets: { label: string; value: DatePreset }[] = [
    { label: "Today", value: "today" },
    { label: "Yesterday", value: "yesterday" },
    { label: "Last Week", value: "last_week" },
    { label: "This Month", value: "this_month" },
    { label: "This Year", value: "this_year" },
    { label: "Last Month", value: "last_month" },
    { label: "Last Year", value: "last_year" },
    { label: "Custom", value: "custom" },
  ];

  const storeOptions = useMemo(() => {
    const opts = [{ label: "All Stores", value: "all" }];
    if (allLocations) {
      for (const loc of allLocations) {
        opts.push({ label: `${loc.code} - ${loc.name}`, value: String(loc.id) });
      }
    }
    return opts;
  }, [allLocations]);

  const categoryOptions = useMemo(() => {
    const opts = ["all"];
    if (categories) opts.push(...categories.filter((c): c is string => c !== null));
    return opts;
  }, [categories]);

  // Export CSV
  const exportCSV = () => {
    const headers = ["Rank", "Item", "Category", "Units Sold", "Sales", "Avg Price", "Unit Cost", "Gross Margin %", "Cost Source"];
    const csvRows = [headers.join(",")];
    topItems.forEach((item, idx) => {
      csvRows.push([
        idx + 1,
        `"${item.itemName}"`,
        `"${item.category}"`,
        item.quantitySold,
        item.totalRevenue.toFixed(2),
        item.avgPrice.toFixed(2),
        item.unitCost.toFixed(4),
        item.grossMarginPct.toFixed(1),
        item.costSource,
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `product-sales-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Menu Engineering helpers ───
  const meItems = meData?.items || [];
  const meStars = meItems.filter(i => i.quadrant === "star");
  const mePlowhorses = meItems.filter(i => i.quadrant === "plowhorse");
  const mePuzzles = meItems.filter(i => i.quadrant === "puzzle");
  const meDogs = meItems.filter(i => i.quadrant === "dog");

  const quadrantColors = {
    star: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Stars", desc: "High popularity, high margin" },
    plowhorse: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", label: "Plowhorses", desc: "High popularity, low margin" },
    puzzle: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Puzzles", desc: "Low popularity, high margin" },
    dog: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "Dogs", desc: "Low popularity, low margin" },
  };

  // MoM filtered
  const momFiltered = useMemo(() => {
    if (!momData) return [];
    if (categoryFilter !== "all") return momData.filter(i => i.category === categoryFilter);
    return momData;
  }, [momData, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Sales Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track top-selling items, compare trends, and optimize your menu with engineering analysis
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/data-import")}>
            <Upload className="h-4 w-4 mr-1.5" />
            Upload Breakdown
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={aggregatedItems.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {datePresets.map(p => (
              <Button
                key={p.value}
                variant={datePreset === p.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDatePreset(p.value)}
                className="text-xs"
              >
                {p.label}
              </Button>
            ))}

            {datePreset === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 w-36 text-xs" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={customTill} onChange={e => setCustomTill(e.target.value)} className="h-8 w-36 text-xs" />
              </div>
            )}

            <div className="h-6 w-px bg-border mx-1" />

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryOptions.filter(c => c !== "all").map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                {storeOptions.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium">Top Item</p>
                <p className="text-sm font-semibold truncate">{topItem?.itemName || "No data"}</p>
                {topItem && <p className="text-xs text-muted-foreground">{formatCurrency(topItem.totalRevenue)} · {formatNumber(topItem.quantitySold)} units</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Crown className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium">Top Category</p>
                <p className="text-sm font-semibold truncate">{topCategory?.category || "No data"}</p>
                {topCategory && <p className="text-xs text-muted-foreground">{formatCurrency(topCategory.revenue)} · {topCategory.pct.toFixed(1)}% of total</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium">Highest Margin</p>
                {highestMarginItem ? (
                  <>
                    <p className="text-sm font-semibold truncate">{highestMarginItem.itemName}</p>
                    <p className="text-xs text-muted-foreground">{highestMarginItem.grossMarginPct.toFixed(1)}% margin · {formatCurrency(highestMarginItem.grossProfit)} profit</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-muted-foreground">No recipe costs linked</p>
                    <p className="text-xs text-muted-foreground">Link recipes to see margins</p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-50 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-red-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground font-medium">Menu Risk</p>
                {menuRiskItem ? (
                  <>
                    <p className="text-sm font-semibold truncate">{menuRiskItem.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {menuRiskItem.costSource === "recipe"
                        ? `${menuRiskItem.grossMarginPct.toFixed(1)}% margin · ${formatCurrency(menuRiskItem.totalRevenue)}`
                        : `${formatCurrency(menuRiskItem.totalRevenue)} · ${formatNumber(menuRiskItem.quantitySold)} units`
                      }
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-muted-foreground">Need more data</p>
                    <p className="text-xs text-muted-foreground">Upload breakdown CSVs</p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-bold">{formatCurrency(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Total Units Sold</p>
            <p className="text-lg font-bold">{formatNumber(totalUnits)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Unique Items</p>
            <p className="text-lg font-bold">{formatNumber(aggregatedItems.length)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Categories</p>
            <p className="text-lg font-bold">{formatNumber(categoryBreakdown.length)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Top Items | Month-over-Month | Menu Engineering */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="top-items">Top Items</TabsTrigger>
          <TabsTrigger value="mom">Month-over-Month</TabsTrigger>
          <TabsTrigger value="menu-engineering">Menu Engineering</TabsTrigger>
          <TabsTrigger value="heatmap">Seasonal Heatmap</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: Top Items with Cost Data ═══ */}
        <TabsContent value="top-items">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Top {showCount} Items</CardTitle>
                    <CardDescription>Ranked by sales revenue with cost analysis</CardDescription>
                  </div>
                  <Select value={String(showCount)} onValueChange={v => setShowCount(parseInt(v))}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">Top 10</SelectItem>
                      <SelectItem value="25">Top 25</SelectItem>
                      <SelectItem value="50">Top 50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : topItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No product sales data for this period</p>
                    <p className="text-xs mt-1">Upload Koomi Item Breakdown CSVs via Data Import</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/data-import")}>
                      <Upload className="h-4 w-4 mr-1.5" />
                      Go to Data Import
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground w-10">#</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Category</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Units</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Sales</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Unit Cost</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Gross Margin</th>
                          <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Cost Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topItems.map((item, idx) => (
                          <tr key={`${item.itemName}-${item.category}`} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2.5 pr-3 text-muted-foreground font-medium">{idx + 1}</td>
                            <td className="py-2.5 pr-3 font-medium">{item.itemName}</td>
                            <td className="py-2.5 pr-3">
                              <Badge variant="secondary" className="text-xs font-normal">{item.category}</Badge>
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(item.quantitySold)}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{formatCurrency(item.totalRevenue)}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {item.costSource !== "none" ? formatCurrency(item.unitCost) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right">
                              {item.costSource !== "none" ? (
                                <span className={`text-xs font-medium ${item.grossMarginPct >= 60 ? "text-emerald-600" : item.grossMarginPct >= 40 ? "text-amber-600" : "text-red-500"}`}>
                                  {item.grossMarginPct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              {item.costSource === "recipe" ? (
                                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">Recipe</Badge>
                              ) : item.costSource === "default_cogs" ? (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Default COGS</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">No cost</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Category Sidebar */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Category Sales Share</CardTitle>
                </CardHeader>
                <CardContent>
                  {categoryBreakdown.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No data</p>
                  ) : (
                    <div className="space-y-3">
                      {categoryBreakdown.slice(0, 8).map((cat, idx) => {
                        const colors = [
                          "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
                          "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-indigo-500"
                        ];
                        return (
                          <div key={cat.category}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium truncate mr-2">{cat.category}</span>
                              <span className="text-muted-foreground shrink-0">{cat.pct.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${colors[idx % colors.length]}`} style={{ width: `${Math.max(cat.pct, 1)}%` }} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(cat.revenue)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Top 5 by Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  {aggregatedItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No data</p>
                  ) : (
                    <div className="space-y-2">
                      {aggregatedItems.slice(0, 5).map((item, idx) => (
                        <div key={item.itemName} className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                            <span className="text-sm truncate">{item.itemName}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums shrink-0 ml-2">{formatCurrency(item.totalRevenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Top 5 by Units Sold</CardTitle>
                </CardHeader>
                <CardContent>
                  {aggregatedItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No data</p>
                  ) : (
                    <div className="space-y-2">
                      {[...aggregatedItems].sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 5).map((item, idx) => (
                        <div key={item.itemName} className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                            <span className="text-sm truncate">{item.itemName}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums shrink-0 ml-2">{formatNumber(item.quantitySold)} units</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 2: Month-over-Month Comparison ═══ */}
        <TabsContent value="mom">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Month-over-Month Comparison</CardTitle>
              <CardDescription>
                Compare current period ({dateRange.start} to {dateRange.end}) vs. previous equivalent period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {momLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : momFiltered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">No comparison data available</p>
                  <p className="text-xs mt-1">Need data from at least two periods to compare</p>
                </div>
              ) : (
                <>
                  {/* MoM Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                      <p className="text-xs text-emerald-700 font-medium">New Items</p>
                      <p className="text-xl font-bold text-emerald-800">{momFiltered.filter(i => i.isNew).length}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                      <p className="text-xs text-red-700 font-medium">Dropped Items</p>
                      <p className="text-xl font-bold text-red-800">{momFiltered.filter(i => i.isDropped).length}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <p className="text-xs text-blue-700 font-medium">Growing</p>
                      <p className="text-xl font-bold text-blue-800">{momFiltered.filter(i => i.revenueChange > 0 && !i.isNew).length}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                      <p className="text-xs text-amber-700 font-medium">Declining</p>
                      <p className="text-xl font-bold text-amber-800">{momFiltered.filter(i => i.revenueChange < 0 && !i.isDropped).length}</p>
                    </div>
                  </div>

                  {/* MoM Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Category</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Current Rev</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Previous Rev</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Rev Change</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Current Qty</th>
                          <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Previous Qty</th>
                          <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Qty Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {momFiltered.slice(0, 50).map(item => (
                          <tr key={item.itemName} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2.5 pr-3 font-medium">
                              {item.itemName}
                              {item.isNew && <Badge className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 border-0">NEW</Badge>}
                              {item.isDropped && <Badge className="ml-2 text-[10px] bg-red-100 text-red-700 border-0">DROPPED</Badge>}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge variant="secondary" className="text-xs font-normal">{item.category || "—"}</Badge>
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{formatCurrency(item.currentRevenue)}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(item.previousRevenue)}</td>
                            <td className="py-2.5 pr-3 text-right">
                              {item.isNew || item.isDropped ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${item.revenueChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {item.revenueChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                  {formatPct(item.revenueChange)}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">{formatNumber(item.currentQty)}</td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(item.previousQty)}</td>
                            <td className="py-2.5 text-right">
                              {item.isNew || item.isDropped ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${item.qtyChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {item.qtyChange >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                  {formatPct(item.qtyChange)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TAB 3: Menu Engineering ═══ */}
        <TabsContent value="menu-engineering">
          <div className="space-y-6">
            {/* Quadrant Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(["star", "plowhorse", "puzzle", "dog"] as const).map(q => {
                const config = quadrantColors[q];
                const items = meItems.filter(i => i.quadrant === q);
                const totalRev = items.reduce((s, i) => s + i.revenue, 0);
                const icons = { star: Star, plowhorse: Tractor, puzzle: Puzzle, dog: Dog };
                const Icon = icons[q];
                return (
                  <Card key={q} className={`${config.border} border`}>
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`h-8 w-8 rounded-lg ${config.bg} flex items-center justify-center`}>
                          <Icon className={`h-4 w-4 ${config.text}`} />
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${config.text}`}>{config.label}</p>
                          <p className="text-[10px] text-muted-foreground">{config.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="text-xl font-bold">{items.length}</span>
                        <span className="text-xs text-muted-foreground">{formatCurrency(totalRev)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Thresholds info */}
            {meData && meData.items.length > 0 && (
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Avg Margin Threshold:</span>
                      <span className="font-semibold">{meData.avgMargin}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Avg Popularity Threshold:</span>
                      <span className="font-semibold">{formatNumber(meData.avgPopularity)} units</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Total Revenue:</span>
                      <span className="font-semibold">{formatCurrency(meData.totalRevenue || 0)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Total Items:</span>
                      <span className="font-semibold">{meData.items.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {meLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : meItems.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">No menu engineering data available</p>
                  <p className="text-xs mt-1">Upload item breakdown CSVs and link recipes with costs to enable analysis</p>
                </CardContent>
              </Card>
            ) : (
              /* Quadrant detail tables */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {(["star", "plowhorse", "puzzle", "dog"] as const).map(q => {
                  const config = quadrantColors[q];
                  const items = q === "star" ? meStars : q === "plowhorse" ? mePlowhorses : q === "puzzle" ? mePuzzles : meDogs;
                  return (
                    <Card key={q} className={`${config.border} border`}>
                      <CardHeader className="pb-2">
                        <CardTitle className={`text-base ${config.text}`}>{config.label}</CardTitle>
                        <CardDescription>{config.desc}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {items.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No items in this quadrant</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-left">
                                  <th className="pb-2 pr-2 text-xs font-medium text-muted-foreground">Item</th>
                                  <th className="pb-2 pr-2 text-xs font-medium text-muted-foreground text-right">Qty</th>
                                  <th className="pb-2 pr-2 text-xs font-medium text-muted-foreground text-right">Revenue</th>
                                  <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Margin</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(item => (
                                  <tr key={item.itemName} className="border-b last:border-0 hover:bg-muted/30">
                                    <td className="py-2 pr-2 font-medium text-xs">
                                      {item.itemName}
                                      {item.costSource !== "recipe" && (
                                        <span className="ml-1 text-[10px] text-muted-foreground">(est.)</span>
                                      )}
                                    </td>
                                    <td className="py-2 pr-2 text-right tabular-nums text-xs">{formatNumber(item.quantity)}</td>
                                    <td className="py-2 pr-2 text-right tabular-nums text-xs">{formatCurrency(item.revenue)}</td>
                                    <td className="py-2 text-right">
                                      <span className={`text-xs font-medium ${item.grossMarginPct >= 60 ? "text-emerald-600" : item.grossMarginPct >= 40 ? "text-amber-600" : "text-red-500"}`}>
                                        {item.grossMarginPct.toFixed(1)}%
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ─── Seasonal Heatmap Tab ─── */}
        <TabsContent value="heatmap">
          <SeasonalHeatmap locationId={storeFilter !== 'all' ? parseInt(storeFilter) : undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Seasonal Heatmap Component ───

function SeasonalHeatmap({ locationId }: { locationId?: number }) {
  const { data, isLoading } = trpc.cfo.seasonalHeatmap.useQuery(
    locationId ? { locationId } : undefined
  );

  const heatmapData = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Get all unique months and top items by total revenue
    const itemTotals = new Map<string, { revenue: number; category: string | null }>(); 
    const months = new Set<string>();

    for (const row of data) {
      months.add(row.month);
      const existing = itemTotals.get(row.itemName) || { revenue: 0, category: row.category };
      existing.revenue += row.revenue;
      itemTotals.set(row.itemName, existing);
    }

    // Top 20 items by total revenue
    const topItems = Array.from(itemTotals.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 20)
      .map(([name]) => name);

    const sortedMonths = Array.from(months).sort();

    // Build matrix: item -> month -> revenue
    const matrix: { item: string; values: { month: string; revenue: number; quantity: number }[] }[] = [];
    let maxRevenue = 0;

    for (const item of topItems) {
      const values = sortedMonths.map(month => {
        const match = data.find(d => d.itemName === item && d.month === month);
        const rev = match?.revenue || 0;
        if (rev > maxRevenue) maxRevenue = rev;
        return { month, revenue: rev, quantity: match?.quantity || 0 };
      });
      matrix.push({ item, values });
    }

    return { matrix, sortedMonths, maxRevenue };
  }, [data]);

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading heatmap data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!heatmapData || heatmapData.matrix.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No product sales data available for heatmap.</p>
          <p className="text-xs text-muted-foreground mt-1">Upload Breakdown CSVs via Data Import to populate this view.</p>
        </CardContent>
      </Card>
    );
  }

  const { matrix, sortedMonths, maxRevenue } = heatmapData;

  function getHeatColor(revenue: number): string {
    if (revenue === 0) return 'bg-gray-50';
    const intensity = Math.min(revenue / maxRevenue, 1);
    if (intensity < 0.2) return 'bg-emerald-50 text-emerald-700';
    if (intensity < 0.4) return 'bg-emerald-100 text-emerald-800';
    if (intensity < 0.6) return 'bg-emerald-200 text-emerald-900';
    if (intensity < 0.8) return 'bg-emerald-400 text-white';
    return 'bg-emerald-600 text-white';
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Seasonal Item Popularity</CardTitle>
        <CardDescription>Monthly revenue heatmap for top 20 items. Darker = higher revenue.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium text-muted-foreground sticky left-0 bg-background min-w-[180px]">Item</th>
                {sortedMonths.map(m => (
                  <th key={m} className="text-center py-2 px-1 font-medium text-muted-foreground min-w-[60px]">
                    {m.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map(row => (
                <tr key={row.item} className="border-b last:border-0">
                  <td className="py-1.5 px-2 font-medium sticky left-0 bg-background truncate max-w-[180px]" title={row.item}>
                    {row.item}
                  </td>
                  {row.values.map(v => (
                    <td key={v.month} className="py-1 px-0.5 text-center">
                      <div
                        className={`rounded px-1 py-1.5 text-[10px] font-medium ${getHeatColor(v.revenue)}`}
                        title={`${row.item} — ${v.month}: ${formatCurrency(v.revenue)} (${v.quantity} sold)`}
                      >
                        {v.revenue > 0 ? formatCurrency(v.revenue).replace('CA', '').replace('$', '$') : '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <span>Low</span>
          <div className="flex gap-0.5">
            <div className="w-6 h-3 rounded bg-emerald-50" />
            <div className="w-6 h-3 rounded bg-emerald-100" />
            <div className="w-6 h-3 rounded bg-emerald-200" />
            <div className="w-6 h-3 rounded bg-emerald-400" />
            <div className="w-6 h-3 rounded bg-emerald-600" />
          </div>
          <span>High</span>
        </div>
      </CardContent>
    </Card>
  );
}
