import { useState, useMemo, useEffect, useCallback } from "react";
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
  Building2, Eye, EyeOff, FileSpreadsheet,
} from "lucide-react";
import { format, subMonths } from "date-fns";
import { toast } from "sonner";

type PeriodMode = "monthly" | "yearly" | "custom";

function getFiscalYearDates(year: number) {
  return { start: `${year}-09-01`, end: `${year + 1}-08-31` };
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
  const [eliminateIC, setEliminateIC] = useState(true);
  const [showEntityBreakdown, setShowEntityBreakdown] = useState(false);
  const [showEliminations, setShowEliminations] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const dateRange = useMemo(() => {
    if (periodMode === "monthly") {
      const [y, m] = selectedMonth.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { startDate: start, endDate: end };
    } else if (periodMode === "yearly") {
      const fy = getFiscalYearDates(selectedFY);
      return { startDate: fy.start, endDate: fy.end };
    }
    return { startDate: format(subMonths(new Date(), 1), "yyyy-MM-01"), endDate: format(new Date(), "yyyy-MM-dd") };
  }, [periodMode, selectedMonth, selectedFY]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: report, isLoading, error, refetch } = trpc.financialStatements.consolidated.profitAndLoss.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    includeComparison: true,
    eliminateIntercompany: eliminateIC,
    forceRefresh: isRefreshing,
  });

  const utils = trpc.useUtils();
  const clearCacheMutation = trpc.financialStatements.cache.clear.useMutation();

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // Clear ALL entity caches (consolidated spans all entities)
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

  // Auto-refresh every 5 minutes
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Period:</span>
              <div className="flex border rounded-md overflow-hidden">
                {(["monthly", "yearly"] as PeriodMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPeriodMode(mode)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      periodMode === mode ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {mode === "monthly" ? "Monthly" : "Yearly"}
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
              {periodMode === "yearly" && (
                <Select value={selectedFY.toString()} onValueChange={(v) => setSelectedFY(Number(v))}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[currentFY, currentFY - 1, currentFY - 2].map((y) => (
                      <SelectItem key={y} value={y.toString()}>FY {y}/{y + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Intercompany elimination toggle */}
            <div className="flex items-center gap-2">
              <Switch checked={eliminateIC} onCheckedChange={setEliminateIC} id="ic-toggle" />
              <label htmlFor="ic-toggle" className="text-xs font-medium cursor-pointer">
                Eliminate Intercompany
              </label>
            </div>

            {/* Entity breakdown toggle */}
            <div className="flex items-center gap-2">
              <Switch checked={showEntityBreakdown} onCheckedChange={setShowEntityBreakdown} id="breakdown-toggle" />
              <label htmlFor="breakdown-toggle" className="text-xs font-medium cursor-pointer">
                Show Entity Breakdown
              </label>
            </div>

            <div className="flex-1" />

            {/* Actions */}
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

      {/* Consolidated P&L Table */}
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 text-xs text-muted-foreground">
                  <th className="text-left py-2 font-medium min-w-[250px]">Account</th>
                  <th className="text-right py-2 font-medium w-[120px]">Consolidated</th>
                  {eliminateIC && <th className="text-right py-2 font-medium w-[100px]">Eliminations</th>}
                  {eliminateIC && <th className="text-right py-2 font-medium w-[120px]">Net</th>}
                  {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                    <th key={e.entityId} className="text-right py-2 font-medium w-[100px] text-xs">
                      {e.entityName}
                    </th>
                  ))}
                  <th className="text-right py-2 font-medium w-[110px]">Prior Period</th>
                  <th className="text-right py-2 font-medium w-[100px]">Variance $</th>
                  <th className="text-right py-2 font-medium w-[80px]">Variance %</th>
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
                    <>
                      <tr
                        key={idx}
                        className={`border-b transition-colors ${
                          isTotal ? "bg-gray-100 font-bold border-t-2" :
                          isSubtotal ? "bg-gray-50 font-semibold" :
                          isHeader ? "font-semibold" :
                          "hover:bg-muted/30"
                        } ${hasAccounts ? "cursor-pointer" : ""}`}
                        onClick={() => hasAccounts && toggleRow(key)}
                      >
                        <td className={`py-1.5 ${line.lineType === "detail" ? "pl-6" : ""}`}>
                          <div className="flex items-center gap-1">
                            {hasAccounts && (
                              isExpanded ?
                                <ChevronDown className="h-3 w-3 text-muted-foreground" /> :
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            )}
                            {line.label}
                          </div>
                        </td>
                        <td className="text-right py-1.5 font-mono text-xs">
                          {fmt(eliminateIC ? line.netAmount : line.consolidatedAmount)}
                        </td>
                        {eliminateIC && (
                          <td className={`text-right py-1.5 font-mono text-xs ${
                            line.eliminationAmount ? "text-amber-600" : "text-muted-foreground"
                          }`}>
                            {line.eliminationAmount ? fmt(line.eliminationAmount) : "—"}
                          </td>
                        )}
                        {eliminateIC && (
                          <td className="text-right py-1.5 font-mono text-xs font-medium">
                            {fmt(line.netAmount)}
                          </td>
                        )}
                        {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                          <td key={e.entityId} className="text-right py-1.5 font-mono text-xs">
                            {fmt(line.entityAmounts?.[e.entityId.toString()] || 0)}
                          </td>
                        ))}
                        <td className="text-right py-1.5 font-mono text-xs text-muted-foreground">
                          {fmt(line.priorAmount)}
                        </td>
                        <td className={`text-right py-1.5 font-mono text-xs ${
                          (line.varianceDollar ?? 0) > 0 ? "text-green-600" :
                          (line.varianceDollar ?? 0) < 0 ? "text-red-600" : ""
                        }`}>
                          {fmtVar(line.varianceDollar)}
                        </td>
                        <td className={`text-right py-1.5 font-mono text-xs ${
                          (line.variancePct ?? 0) > 0 ? "text-green-600" :
                          (line.variancePct ?? 0) < 0 ? "text-red-600" : ""
                        }`}>
                          {fmtPct(line.variancePct)}
                        </td>
                      </tr>
                      {/* Expanded account details */}
                      {isExpanded && hasAccounts && line.accounts.map((acct: any, ai: number) => (
                        <tr key={`${idx}-${ai}`} className={`border-b text-xs ${acct.isEliminated ? "bg-amber-50/50 line-through text-amber-600" : "bg-muted/20"}`}>
                          <td className="py-1 pl-12 text-muted-foreground">
                            {acct.accountName}
                            <span className="ml-2 text-[10px] opacity-60">({acct.entityName})</span>
                            {acct.isEliminated && (
                              <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0 border-amber-300 text-amber-600">IC</Badge>
                            )}
                          </td>
                          <td className="text-right py-1 font-mono">{fmt(acct.amount)}</td>
                          {eliminateIC && <td></td>}
                          {eliminateIC && <td></td>}
                          {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                            <td key={e.entityId} className="text-right py-1 font-mono">
                              {e.entityId === acct.entityId ? fmt(acct.amount) : ""}
                            </td>
                          ))}
                          <td></td><td></td><td></td>
                        </tr>
                      ))}
                    </>
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
