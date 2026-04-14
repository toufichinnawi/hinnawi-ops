import React, { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Download, RefreshCw, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Building2, Eye, EyeOff, FileSpreadsheet, Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format, subMonths } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type BSPeriodMode = "preset" | "yearly" | "custom";

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

export default function ConsolidatedBS() {
  const currentFY = getCurrentFiscalYear();

  const [periodMode, setPeriodMode] = useState<BSPeriodMode>("preset");
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [compareWithPrior, setCompareWithPrior] = useState(false);

  // Preset date options (same as before)
  const [presetDate, setPresetDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const presetOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    const now = new Date();
    const curFY = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

    // Today
    opts.push({ value: format(now, "yyyy-MM-dd"), label: `Today (${format(now, "MMM d, yyyy")})` });

    // Fiscal year ends
    for (let fy = curFY; fy >= 2019; fy--) {
      const val = `${fy + 1}-08-31`;
      if (!opts.find(o => o.value === val)) {
        opts.push({ value: val, label: `FY ${fy}/${fy + 1} End (Aug 31, ${fy + 1})` });
      }
    }

    // Quarter ends for current and prior FY
    for (let fy = curFY; fy >= curFY - 1; fy--) {
      const q1End = `${fy}-11-30`;
      const febDays = new Date(fy + 1, 2, 0).getDate();
      const q2End = `${fy + 1}-02-${String(febDays).padStart(2, "0")}`;
      const q3End = `${fy + 1}-05-31`;
      const q4End = `${fy + 1}-08-31`;
      const quarters = [
        { value: q1End, label: `FY ${fy}/${fy + 1} Q1 End (Nov 30, ${fy})` },
        { value: q2End, label: `FY ${fy}/${fy + 1} Q2 End (Feb ${febDays}, ${fy + 1})` },
        { value: q3End, label: `FY ${fy}/${fy + 1} Q3 End (May 31, ${fy + 1})` },
        { value: q4End, label: `FY ${fy}/${fy + 1} Q4 End (Aug 31, ${fy + 1})` },
      ];
      for (const q of quarters) {
        if (new Date(q.value) <= now && !opts.find(o => o.value === q.value)) {
          opts.push(q);
        }
      }
    }

    // Monthly end-of-month (last 12 months)
    for (let i = 1; i <= 12; i++) {
      const d = subMonths(now, i);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const val = format(lastDay, "yyyy-MM-dd");
      if (!opts.find(o => o.value === val)) {
        opts.push({ value: val, label: `End of ${format(lastDay, "MMMM yyyy")}` });
      }
    }

    return opts;
  }, []);

  // Compute the as-of date based on period mode
  const asOfDate = useMemo(() => {
    if (periodMode === "yearly") {
      return `${selectedFY + 1}-08-31`; // End of fiscal year
    } else if (periodMode === "custom" && customDate) {
      return format(customDate, "yyyy-MM-dd");
    }
    return presetDate;
  }, [periodMode, selectedFY, customDate, presetDate]);

  // Compute the comparison date (previous period)
  const compareDate = useMemo(() => {
    if (!compareWithPrior) return undefined;
    if (periodMode === "yearly") {
      return `${selectedFY}-08-31`; // End of previous fiscal year
    } else if (periodMode === "custom" && customDate) {
      // Compare with same date one year ago
      const prior = new Date(customDate);
      prior.setFullYear(prior.getFullYear() - 1);
      return format(prior, "yyyy-MM-dd");
    }
    // For preset: compare with same date one year ago
    const d = new Date(presetDate);
    d.setFullYear(d.getFullYear() - 1);
    return format(d, "yyyy-MM-dd");
  }, [compareWithPrior, periodMode, selectedFY, customDate, presetDate]);

  // Prior period label
  const priorPeriodLabel = useMemo(() => {
    if (periodMode === "yearly") {
      return `Year ${selectedFY - 1}/${selectedFY}`;
    }
    if (compareDate) {
      return `As of ${compareDate}`;
    }
    return "Prior Period";
  }, [periodMode, selectedFY, compareDate]);

  const [eliminateIC, setEliminateIC] = useState(true);
  const [showEntityBreakdown, setShowEntityBreakdown] = useState(false);
  const [showEliminations, setShowEliminations] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: report, isLoading, error, refetch } = trpc.financialStatements.consolidated.balanceSheet.useQuery({
    asOfDate,
    compareDate,
    eliminateIntercompany: eliminateIC,
    forceRefresh: isRefreshing,
  });

  // Fetch prior period report when comparison is enabled
  const { data: priorReport } = trpc.financialStatements.consolidated.balanceSheet.useQuery(
    {
      asOfDate: compareDate || asOfDate,
      eliminateIntercompany: eliminateIC,
    },
    { enabled: compareWithPrior && !!compareDate }
  );

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
      toast.success("Consolidated Balance Sheet refreshed successfully from QuickBooks");
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

  const toggleRow = (key: string) => {
    const next = new Set(expandedRows);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedRows(next);
  };

  // Build a map of prior period amounts by line label for comparison
  const priorAmountMap = useMemo(() => {
    if (!priorReport?.lines) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const line of priorReport.lines as any[]) {
      const key = line.label;
      const amount = eliminateIC ? (line.netAmount ?? line.consolidatedAmount ?? 0) : (line.consolidatedAmount ?? 0);
      map.set(key, amount);
    }
    return map;
  }, [priorReport, eliminateIC]);

  const exportCsv = () => {
    if (!report) return;
    const headers = ["Account", "Category", "Subcategory", "Consolidated Amount", "Eliminations", "Net Amount"];
    if (showEntityBreakdown && report.entityBreakdown) {
      for (const e of report.entityBreakdown) headers.push(e.entityName);
    }
    if (compareWithPrior) {
      headers.push("Prior Period", "Variance $", "Variance %");
    }

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
      if (compareWithPrior) {
        const currentAmt = eliminateIC ? (line.netAmount ?? 0) : (line.consolidatedAmount ?? 0);
        const priorAmt = priorAmountMap.get(line.label) ?? 0;
        const variance = currentAmt - priorAmt;
        const variancePct = priorAmt !== 0 ? (variance / Math.abs(priorAmt)) * 100 : 0;
        row.push(priorAmt.toFixed(2), variance.toFixed(2), variancePct.toFixed(1));
      }
      return row;
    });

    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Consolidated_BS_${asOfDate}.csv`;
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
          <p className="text-muted-foreground">Loading consolidated Balance Sheet across all entities...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 font-medium">Failed to load consolidated Balance Sheet</p>
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
            {/* Period mode selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Period:</span>
              <div className="flex border rounded-md overflow-hidden">
                {([
                  { key: "preset" as BSPeriodMode, label: "Preset Dates" },
                  { key: "yearly" as BSPeriodMode, label: "Yearly" },
                  { key: "custom" as BSPeriodMode, label: "Custom" },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPeriodMode(key)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      periodMode === key ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {periodMode === "preset" && (
                <Select value={presetDate} onValueChange={setPresetDate}>
                  <SelectTrigger className="w-[260px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {presetOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-8 text-xs w-[180px] justify-start">
                      <CalendarIcon className="mr-2 h-3 w-3" />
                      {customDate ? format(customDate, "MMM d, yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customDate} onSelect={setCustomDate} />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="flex items-center gap-2">
              <Switch checked={eliminateIC} onCheckedChange={setEliminateIC} id="ic-toggle-bs" />
              <label htmlFor="ic-toggle-bs" className="text-xs font-medium cursor-pointer">
                Eliminate Intercompany
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={showEntityBreakdown} onCheckedChange={setShowEntityBreakdown} id="breakdown-toggle-bs" />
              <label htmlFor="breakdown-toggle-bs" className="text-xs font-medium cursor-pointer">
                Show Entity Breakdown
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={compareWithPrior} onCheckedChange={setCompareWithPrior} id="compare-toggle-bs" />
              <label htmlFor="compare-toggle-bs" className="text-xs font-medium cursor-pointer">
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

      {/* Consolidated BS Table */}
      {report && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-semibold">
              Consolidated Balance Sheet
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {report.periodLabel}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4 overflow-x-auto">
            <table className="w-full text-sm border-collapse" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "220px", minWidth: "180px" }} /> {/* Account */}
                <col style={{ width: "120px" }} /> {/* Consolidated */}
                {eliminateIC && <col style={{ width: "100px" }} />} {/* Eliminations */}
                {eliminateIC && <col style={{ width: "120px" }} />} {/* Net */}
                {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                  <col key={e.entityId} style={{ width: "105px" }} />
                ))}
                {compareWithPrior && <col style={{ width: "110px" }} />} {/* Prior Period */}
                {compareWithPrior && <col style={{ width: "100px" }} />} {/* Variance $ */}
                {compareWithPrior && <col style={{ width: "80px" }} />}  {/* Variance % */}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b-2 text-xs text-muted-foreground">
                  <th className="text-left py-2 px-2 font-medium">Account</th>
                  <th className="text-right py-2 px-2 font-medium">Consolidated</th>
                  {eliminateIC && <th className="text-right py-2 px-2 font-medium">Eliminations</th>}
                  {eliminateIC && <th className="text-right py-2 px-2 font-medium">Net</th>}
                  {showEntityBreakdown && report.entityBreakdown?.map((e: any) => (
                    <th key={e.entityId} className="text-right py-2 px-2 font-medium text-xs truncate" title={e.entityName}>
                      {e.entityName}
                    </th>
                  ))}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">{priorPeriodLabel}</th>}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">Variance $</th>}
                  {compareWithPrior && <th className="text-right py-2 px-2 font-medium">Variance %</th>}
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

                  // Compute comparison values
                  const currentAmt = eliminateIC ? (line.netAmount ?? line.consolidatedAmount ?? 0) : (line.consolidatedAmount ?? 0);
                  const priorAmt = priorAmountMap.get(line.label) ?? null;
                  const variance = priorAmt != null ? currentAmt - priorAmt : null;
                  const variancePct = priorAmt != null && priorAmt !== 0 ? (variance! / Math.abs(priorAmt)) * 100 : null;

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
                            {priorAmt != null ? fmt(priorAmt) : "—"}
                          </td>
                        )}
                        {compareWithPrior && (
                          <td className={`text-right py-1.5 px-2 font-mono text-xs ${
                            (variance ?? 0) > 0 ? "text-green-600" :
                            (variance ?? 0) < 0 ? "text-red-600" : ""
                          }`}>
                            {variance != null ? fmtVar(variance) : "—"}
                          </td>
                        )}
                        {compareWithPrior && (
                          <td className={`text-right py-1.5 px-2 font-mono text-xs ${
                            (variancePct ?? 0) > 0 ? "text-green-600" :
                            (variancePct ?? 0) < 0 ? "text-red-600" : ""
                          }`}>
                            {variancePct != null ? fmtPct(variancePct) : "—"}
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
