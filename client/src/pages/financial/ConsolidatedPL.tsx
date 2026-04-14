import React, { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Download, RefreshCw, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Building2, Eye, EyeOff, FileSpreadsheet, Calendar as CalendarIcon,
} from "lucide-react";
import { format, subMonths } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

type PeriodMode = "monthly" | "quarterly" | "yearly" | "custom";

function getFiscalYearDates(year: number) {
  return { start: `${year}-09-01`, end: `${year + 1}-08-31` };
}

function getFiscalQuarterDates(fiscalYear: number, quarter: 1 | 2 | 3 | 4) {
  switch (quarter) {
    case 1: return { start: `${fiscalYear}-09-01`, end: `${fiscalYear}-11-30` };
    case 2: return { start: `${fiscalYear}-12-01`, end: `${fiscalYear + 1}-02-${new Date(fiscalYear + 1, 2, 0).getDate()}` };
    case 3: return { start: `${fiscalYear + 1}-03-01`, end: `${fiscalYear + 1}-05-31` };
    case 4: return { start: `${fiscalYear + 1}-06-01`, end: `${fiscalYear + 1}-08-31` };
  }
}

function getCurrentFiscalQuarter(): 1 | 2 | 3 | 4 {
  const month = new Date().getMonth() + 1;
  if (month >= 9 && month <= 11) return 1;
  if (month >= 12 || month <= 2) return 2;
  if (month >= 3 && month <= 5) return 3;
  return 4;
}

function getCurrentFiscalYear() {
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

function fmt(val: number | null | undefined) {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(val);
}

function fmtVar(val: number | null | undefined) {
  if (val == null) return "—";
  const prefix = val >= 0 ? "+" : "";
  return prefix + new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val);
}

function fmtPct(val: number | null | undefined) {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

export default function ConsolidatedPL() {
  const currentFY = getCurrentFiscalYear();
  const [periodMode, setPeriodMode] = useState<PeriodMode>("monthly");
  const [selectedMonth, setSelectedMonth] = useState(() => format(subMonths(new Date(), 1), "yyyy-MM"));
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4>(getCurrentFiscalQuarter());
  const [selectedQuarterFY, setSelectedQuarterFY] = useState(currentFY);
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined);
  const [eliminateIC, setEliminateIC] = useState(true);
  const [showEntityBreakdown, setShowEntityBreakdown] = useState(false);
  const [showEliminations, setShowEliminations] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compareWithPrior, setCompareWithPrior] = useState(true);

  const dateRange = useMemo(() => {
    if (periodMode === "monthly") {
      const [y, m] = selectedMonth.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { startDate: start, endDate: end };
    } else if (periodMode === "quarterly") {
      const q = getFiscalQuarterDates(selectedQuarterFY, selectedQuarter);
      return { startDate: q.start, endDate: q.end };
    } else if (periodMode === "yearly") {
      const fy = getFiscalYearDates(selectedFY);
      return { startDate: fy.start, endDate: fy.end };
    } else if (periodMode === "custom" && customStart && customEnd) {
      return { startDate: format(customStart, "yyyy-MM-dd"), endDate: format(customEnd, "yyyy-MM-dd") };
    }
    return { startDate: format(subMonths(new Date(), 1), "yyyy-MM-01"), endDate: format(new Date(), "yyyy-MM-dd") };
  }, [periodMode, selectedMonth, selectedFY, selectedQuarter, selectedQuarterFY, customStart, customEnd]);

  // Compute prior period label for the comparison
  const priorPeriodLabel = useMemo(() => {
    if (periodMode === "monthly") {
      const [y, m] = selectedMonth.split("-").map(Number);
      const d = new Date(y, m - 2, 1); // previous month
      return format(d, "MMMM yyyy");
    } else if (periodMode === "quarterly") {
      const prevQ = selectedQuarter === 1 ? 4 : (selectedQuarter - 1) as 1 | 2 | 3 | 4;
      const prevFY = selectedQuarter === 1 ? selectedQuarterFY - 1 : selectedQuarterFY;
      return `FY ${prevFY}/${prevFY + 1} Q${prevQ}`;
    } else if (periodMode === "yearly") {
      return `Year ${selectedFY - 1}/${selectedFY}`;
    }
    return "Prior Period";
  }, [periodMode, selectedMonth, selectedFY, selectedQuarter, selectedQuarterFY]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: report, isLoading, error, refetch } = trpc.financialStatements.consolidated.profitAndLoss.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    includeComparison: compareWithPrior,
    eliminateIntercompany: eliminateIC,
    forceRefresh: isRefreshing,
  });

  const utils = trpc.useUtils();
  const clearCacheMutation = trpc.financialStatements.cache.clear.useMutation();

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await clearCacheMutation.mutateAsync({});
      await utils.financialStatements.consolidated.invalidate();
      await utils.financialStatements.reports.invalidate();
      await refetch();
      toast.success("Consolidated P&L refreshed successfully from QuickBooks");
    } catch (err) {
      console.error("Refresh failed:", err);
      toast.error("Failed to refresh data. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, clearCacheMutation, utils, refetch]);

  useEffect(() => {
    const interval = setInterval(() => {
      utils.financialStatements.consolidated.invalidate();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [utils]);

  const monthOptions = useMemo(() => {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = subMonths(now, i);
      opts.push({ value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") });
    }
    return opts;
  }, []);

  const toggleRow = (key: string) => {
    const next = new Set(expandedRows);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedRows(next);
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = ["Account", "Category", "Subcategory", "Consolidated Amount", "Eliminations", "Net Amount"];
    if (showEntityBreakdown && report.entityBreakdown) {
      for (const e of report.entityBreakdown) headers.push(e.entityName);
    }
    headers.push("Prior Period", "Variance $", "Variance %");

    const rows = report.lines.map((line: any) => {
      const row = [
        line.label, line.category, line.subcategory || "",
        line.consolidatedAmount?.toFixed(2) || "0",
        line.eliminationAmount?.toFixed(2) || "0",
        line.netAmount?.toFixed(2) || "0",
      ];
      if (showEntityBreakdown && report.entityBreakdown) {
        for (const e of report.entityBreakdown) {
          row.push((line.entityAmounts?.[e.entityId.toString()] || 0).toFixed(2));
        }
      }
      row.push(
        line.priorAmount?.toFixed(2) || "",
        line.varianceDollar?.toFixed(2) || "",
        line.variancePct?.toFixed(1) || "",
      );
      return row;
    });

    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Consolidated_PL_${dateRange.startDate}_${dateRange.endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Compute column count for proper alignment ── */
  const entityCols = showEntityBreakdown ? (report?.entityBreakdown?.length ?? 0) : 0;
  const icCols = eliminateIC ? 2 : 0; // Eliminations + Net
  // Total data columns (excluding Account): Consolidated + IC cols + entity cols + Prior + Var$ + Var%
  const compareCols = compareWithPrior ? 3 : 0;
  const dataCols = 1 + icCols + entityCols + compareCols;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading consolidated P&L across all entities...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">Failed to load consolidated P&L</p>
          <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Period selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Period:</span>
              <div className="flex border rounded-md overflow-hidden">
                {(["monthly", "quarterly", "yearly", "custom"] as PeriodMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPeriodMode(mode)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      periodMode === mode ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {mode === "monthly" ? "Monthly" : mode === "quarterly" ? "Quarterly" : mode === "yearly" ? "Yearly" : "Custom"}
                  </button>
                ))}
              </div>
              {periodMode === "monthly" && (
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {periodMode === "quarterly" && (
                <>
                  <Select value={selectedQuarterFY.toString()} onValueChange={(v) => setSelectedQuarterFY(Number(v))}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: currentFY - 2019 + 1 }, (_, i) => currentFY - i).map((y) => (
                        <SelectItem key={y} value={y.toString()}>FY {y}/{y + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedQuarter.toString()} onValueChange={(v) => setSelectedQuarter(Number(v) as 1 | 2 | 3 | 4)}>
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Q1 (Sep – Nov)</SelectItem>
                      <SelectItem value="2">Q2 (Dec – Feb)</SelectItem>
                      <SelectItem value="3">Q3 (Mar – May)</SelectItem>
                      <SelectItem value="4">Q4 (Jun – Aug)</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
              {periodMode === "yearly" && (
                <Select value={selectedFY.toString()} onValueChange={(v) => setSelectedFY(Number(v))}>
                  <SelectTrigger className="w-[280px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: currentFY - 2019 + 1 }, (_, i) => currentFY - i).map((y) => (
                      <SelectItem key={y} value={y.toString()}>Year {y}/{y + 1} (Sep {y} – Aug {y + 1})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {periodMode === "custom" && (
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-8 text-xs w-[150px] justify-start">
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {customStart ? format(customStart, "MMM d, yyyy") : "Start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customStart} onSelect={setCustomStart} />
                    </PopoverContent>
                  </Popover>
                  <span className="text-xs text-muted-foreground">to</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-8 text-xs w-[150px] justify-start">
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {customEnd ? format(customEnd, "MMM d, yyyy") : "End date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              <Switch checked={eliminateIC} onCheckedChange={setEliminateIC} id="ic-toggle" />
              <label htmlFor="ic-toggle" className="text-xs font-medium cursor-pointer">
                Eliminate Intercompany
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={showEntityBreakdown} onCheckedChange={setShowEntityBreakdown} id="breakdown-toggle" />
              <label htmlFor="breakdown-toggle" className="text-xs font-medium cursor-pointer">
                Show Entity Breakdown
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={compareWithPrior} onCheckedChange={setCompareWithPrior} id="compare-toggle" />
              <label htmlFor="compare-toggle" className="text-xs font-medium cursor-pointer">
                Compare with Previous Period
              </label>
            </div>

            <div className="flex-1" />

            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoading} className="gap-1 h-8">
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} /> {isRefreshing ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1 h-8">
              <FileSpreadsheet className="h-3 w-3" /> Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Entity summary */}
      {report && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1">
            <Building2 className="h-3 w-3" />
            {report.entityCount} entities consolidated
          </Badge>
          {report.entityBreakdown?.map((e: any) => (
            <Badge key={e.entityId} variant="secondary" className="text-xs">
              {e.entityName}
            </Badge>
          ))}
          {eliminateIC && report.eliminatedAccounts?.length > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-300 text-amber-700 bg-amber-50 cursor-pointer"
              onClick={() => setShowEliminations(!showEliminations)}
            >
              <AlertTriangle className="h-3 w-3" />
              {report.eliminatedAccounts.length} intercompany eliminations
              {showEliminations ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </Badge>
          )}
        </div>
      )}

      {/* Eliminations detail */}
      {showEliminations && report?.eliminatedAccounts?.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-amber-800">Intercompany Eliminations</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1 font-medium">Account</th>
                  <th className="text-left py-1 font-medium">Entity</th>
                  <th className="text-right py-1 font-medium">Amount</th>
                  <th className="text-left py-1 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {report.eliminatedAccounts.map((ea: any, i: number) => (
                  <tr key={i} className="border-b border-amber-100">
                    <td className="py-1">{ea.accountName}</td>
                    <td className="py-1">{ea.entityName}</td>
                    <td className="py-1 text-right font-mono">{fmt(ea.amount)}</td>
                    <td className="py-1 text-muted-foreground">{ea.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════
           Consolidated P&L Table — FIXED column alignment
           Uses table-fixed layout with explicit col widths so
           header cells and data cells always line up perfectly.
         ═══════════════════════════════════════════════════════════ */}
      {report && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-semibold">
              Consolidated Profit & Loss
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {report.periodLabel}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse" style={{ tableLayout: "fixed" }}>
              {/* ── colgroup: explicit widths keep headers + data aligned ── */}
              <colgroup>
                <col style={{ width: "220px", minWidth: "180px" }} /> {/* Account */}
                <col style={{ width: "110px" }} /> {/* Consolidated */}
                {eliminateIC && <col style={{ width: "100px" }} />} {/* Eliminations */}
                {eliminateIC && <col style={{ width: "110px" }} />} {/* Net */}
                {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                  <col key={e.entityId} style={{ width: "105px" }} />
                ))}
                {compareWithPrior && <col style={{ width: "105px" }} />} {/* Prior Period */}
                {compareWithPrior && <col style={{ width: "95px" }} />}  {/* Variance $ */}
                {compareWithPrior && <col style={{ width: "75px" }} />}  {/* Variance % */}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b-2 text-xs text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Account</th>
                  <th className="text-right py-2 px-2 font-medium">Consolidated</th>
                  {eliminateIC && <th className="text-right py-2 px-2 font-medium">Eliminations</th>}
                  {eliminateIC && <th className="text-right py-2 px-2 font-medium">Net</th>}
                  {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                    <th key={e.entityId} className="text-right py-2 px-2 font-medium truncate" title={e.entityName}>
                      {e.entityName}
                    </th>
                  ))}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">{priorPeriodLabel}</th>}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">Variance $</th>}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">% Rev</th>}
                </tr>
              </thead>
              <tbody>
                {report.lines?.map((line: any, idx: number) => {
                  const key = `${line.category}::${line.subcategory || ""}`;
                  const isHeader = line.lineType === "header" || line.lineType === "subtotal" || line.lineType === "total";
                  const isTotal = line.lineType === "total";
                  const isSubtotal = line.lineType === "subtotal";
                  const hasAccounts = line.accounts && line.accounts.length > 0;
                  const isExpanded = expandedRows.has(key);

                  return (
                    <React.Fragment key={idx}>
                      <tr
                        className={`border-b transition-colors ${
                          isTotal ? "bg-gray-100 font-bold border-t-2" :
                          isSubtotal ? "bg-gray-50 font-semibold" :
                          isHeader ? "font-semibold" :
                          "hover:bg-muted/30"
                        } ${hasAccounts ? "cursor-pointer" : ""}`}
                        onClick={() => hasAccounts && toggleRow(key)}
                      >
                        <td className={`py-1.5 px-2 truncate ${line.lineType === "detail" ? "pl-6" : ""}`}>
                          <div className="flex items-center gap-1">
                            {hasAccounts && (
                              isExpanded ?
                                <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" /> :
                                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{line.label}</span>
                          </div>
                        </td>
                        <td className="text-right py-1.5 px-2 font-mono text-xs">
                          {fmt(eliminateIC ? line.netAmount : line.consolidatedAmount)}
                        </td>
                        {eliminateIC && (
                          <td className={`text-right py-1.5 px-2 font-mono text-xs ${
                            line.eliminationAmount ? "text-amber-600" : "text-muted-foreground"
                          }`}>
                            {line.eliminationAmount ? fmt(line.eliminationAmount) : "—"}
                          </td>
                        )}
                        {eliminateIC && (
                          <td className="text-right py-1.5 px-2 font-mono text-xs font-medium">
                            {fmt(line.netAmount)}
                          </td>
                        )}
                        {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                          <td key={e.entityId} className="text-right py-1.5 px-2 font-mono text-xs">
                            {fmt(line.entityAmounts?.[e.entityId.toString()] || 0)}
                          </td>
                        ))}
                        {compareWithPrior && (
                          <td className="text-right py-1.5 px-2 font-mono text-xs text-muted-foreground">
                            {fmt(line.priorAmount)}
                          </td>
                        )}
                        {compareWithPrior && (
                          <td className={`text-right py-1.5 px-2 font-mono text-xs ${
                            (line.varianceDollar ?? 0) > 0 ? "text-green-600" :
                            (line.varianceDollar ?? 0) < 0 ? "text-red-600" : ""
                          }`}>
                            {fmtVar(line.varianceDollar)}
                          </td>
                        )}
                        {compareWithPrior && (
                          <td className={`text-right py-1.5 px-2 font-mono text-xs ${
                            (line.variancePct ?? 0) > 0 ? "text-green-600" :
                            (line.variancePct ?? 0) < 0 ? "text-red-600" : ""
                          }`}>
                            {fmtPct(line.variancePct)}
                          </td>
                        )}
                      </tr>
                      {/* Expanded account details */}
                      {isExpanded && hasAccounts && line.accounts.map((acct: any, ai: number) => (
                        <tr key={`${idx}-${ai}`} className={`border-b text-xs ${acct.isEliminated ? "bg-amber-50/50 line-through text-amber-600" : "bg-muted/20"}`}>
                          <td className="py-1 pl-10 px-2 text-muted-foreground truncate">
                            {acct.accountName}
                            <span className="ml-2 text-[10px] opacity-60">({acct.entityName})</span>
                            {acct.isEliminated && (
                              <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0 border-amber-300 text-amber-600">IC</Badge>
                            )}
                          </td>
                          <td className="text-right py-1 px-2 font-mono">{fmt(acct.amount)}</td>
                          {eliminateIC && <td className="px-2"></td>}
                          {eliminateIC && <td className="px-2"></td>}
                          {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                            <td key={e.entityId} className="text-right py-1 px-2 font-mono">
                              {e.entityId === acct.entityId ? fmt(acct.amount) : ""}
                            </td>
                          ))}
                          {compareWithPrior && <><td className="px-2"></td><td className="px-2"></td><td className="px-2"></td></>}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
