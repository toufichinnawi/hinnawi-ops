import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Download, Calendar as CalendarIcon, RefreshCw, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, Eye, EyeOff, FileSpreadsheet, FileText as FileTextIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, subMonths, subYears } from "date-fns";

interface Props {
  entityId: number;
  locationId: number;
  entityName: string;
}

// Fiscal year: Sep 1 - Aug 31
function getFiscalYearDates(year: number) {
  return {
    start: `${year}-09-01`,
    end: `${year + 1}-08-31`,
  };
}

/** Fiscal quarters based on Sep 1 fiscal year start */
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

function fmtPct(val: number | null | undefined) {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

function fmtVar(val: number | null | undefined) {
  if (val == null) return "—";
  const prefix = val >= 0 ? "+" : "";
  return prefix + new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(val);
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type PeriodMode = "monthly" | "quarterly" | "yearly" | "custom";

export default function ProfitAndLoss({ entityId, locationId, entityName }: Props) {
  const currentFY = getCurrentFiscalYear();
  const [periodMode, setPeriodMode] = useState<PeriodMode>("monthly");
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return format(subMonths(now, 1), "yyyy-MM");
  });
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4>(getCurrentFiscalQuarter());
  const [selectedQuarterFY, setSelectedQuarterFY] = useState(currentFY);
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined);
  const [includeShared, setIncludeShared] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);

  // Compute date range
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
    } else if (customStart && customEnd) {
      return {
        startDate: format(customStart, "yyyy-MM-dd"),
        endDate: format(customEnd, "yyyy-MM-dd"),
      };
    }
    return { startDate: format(subMonths(new Date(), 1), "yyyy-MM-01"), endDate: format(new Date(), "yyyy-MM-dd") };
  }, [periodMode, selectedMonth, selectedFY, selectedQuarter, selectedQuarterFY, customStart, customEnd]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch P&L — ALWAYS request comparison and YoY data
  const { data: report, isLoading, error, refetch } = trpc.financialStatements.reports.profitAndLoss.useQuery({
    entityId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    includeComparison: true,
    includeYoY: true,
    includeSharedExpenses: includeShared,
    locationId: includeShared ? locationId : undefined,
    forceRefresh: isRefreshing,
  }, { enabled: !!entityId });

  const utils = trpc.useUtils();
  const clearCacheMutation = trpc.financialStatements.cache.clear.useMutation();

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // Step 1: Clear server-side cache for this entity
      await clearCacheMutation.mutateAsync({ entityId });
      // Step 2: Invalidate all React Query caches for financial statements
      await utils.financialStatements.reports.invalidate();
      await utils.financialStatements.consolidated.invalidate();
      // Step 3: Refetch the current query
      await refetch();
      toast.success("P&L data refreshed successfully from QuickBooks");
    } catch (err) {
      console.error("Refresh failed:", err);
      toast.error("Failed to refresh data. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [entityId, isRefreshing, clearCacheMutation, utils, refetch]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      // Silent auto-refresh: invalidate queries so they refetch with cache (5-min TTL)
      utils.financialStatements.reports.invalidate();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [utils]);

  // Generate month options (last 24 months)
  const monthOptions = useMemo(() => {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = subMonths(now, i);
      opts.push({
        value: format(d, "yyyy-MM"),
        label: format(d, "MMMM yyyy"),
      });
    }
    return opts;
  }, []);

  // Generate fiscal year options
  const fyOptions = useMemo(() => {
    const opts = [];
    for (let y = currentFY; y >= currentFY - 5; y--) {
      opts.push({
        value: y,
        label: `FY ${y}/${y + 1} (Sep ${y} - Aug ${y + 1})`,
      });
    }
    return opts;
  }, [currentFY]);

  const toggleRow = (key: string) => {
    const next = new Set(expandedRows);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedRows(next);
  };

  const handleExport = useCallback(async (exportFormat: "pdf" | "excel" | "csv") => {
    setExporting(exportFormat);
    try {
      if (exportFormat === "csv") {
        const result = await utils.financialStatements.reports.exportCsv.fetch({
          entityId,
          statementType: "profit_loss",
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          includeComparison: true,
          includeYoY: true,
          includeSharedExpenses: includeShared,
          locationId: includeShared ? locationId : undefined,
        });
        downloadBlob(result.csv, result.fileName, 'text/csv;charset=utf-8;');
      } else if (exportFormat === "excel") {
        const result = await utils.financialStatements.reports.exportExcel.fetch({
          entityId,
          statementType: "profit_loss",
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          includeComparison: true,
          includeYoY: true,
          includeSharedExpenses: includeShared,
          locationId: includeShared ? locationId : undefined,
        });
        downloadBlob(result.excel, result.fileName, 'application/vnd.ms-excel');
      } else if (exportFormat === "pdf") {
        const result = await utils.financialStatements.reports.exportHtml.fetch({
          entityId,
          statementType: "profit_loss",
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          includeComparison: true,
          includeYoY: true,
          includeSharedExpenses: includeShared,
          locationId: includeShared ? locationId : undefined,
        });
        // Open HTML in new window for print-to-PDF
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(result.html);
          w.document.close();
          setTimeout(() => w.print(), 500);
        }
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  }, [entityId, dateRange, includeShared, locationId, utils]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Period Mode */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Period:</span>
              <Select value={periodMode} onValueChange={(v) => setPeriodMode(v as PeriodMode)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Month Selector */}
            {periodMode === "monthly" && (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Quarter Selector */}
            {periodMode === "quarterly" && (
              <div className="flex items-center gap-2">
                <Select value={selectedQuarterFY.toString()} onValueChange={(v) => setSelectedQuarterFY(Number(v))}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fyOptions.map(fy => (
                      <SelectItem key={fy.value} value={fy.value.toString()}>FY {fy.value}/{fy.value + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedQuarter.toString()} onValueChange={(v) => setSelectedQuarter(Number(v) as 1 | 2 | 3 | 4)}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Q1 (Sep – Nov)</SelectItem>
                    <SelectItem value="2">Q2 (Dec – Feb)</SelectItem>
                    <SelectItem value="3">Q3 (Mar – May)</SelectItem>
                    <SelectItem value="4">Q4 (Jun – Aug)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* FY Selector */}
            {periodMode === "yearly" && (
              <Select value={selectedFY.toString()} onValueChange={(v) => setSelectedFY(Number(v))}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fyOptions.map(fy => (
                    <SelectItem key={fy.value} value={fy.value.toString()}>{fy.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Custom Date Pickers */}
            {periodMode === "custom" && (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customStart ? format(customStart, "MMM d, yyyy") : "Start date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customStart} onSelect={setCustomStart} />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">to</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[150px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customEnd ? format(customEnd, "MMM d, yyyy") : "End date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <Separator orientation="vertical" className="h-8" />

            {/* Shared Expenses Toggle */}
            <div className="flex items-center gap-2">
              <Switch checked={includeShared} onCheckedChange={setIncludeShared} />
              <span className="text-sm">Include Shared Expenses</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!!exporting}>
                    {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Export
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48" align="end">
                  <div className="space-y-1">
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("pdf")} disabled={!!exporting}>
                      <FileTextIcon className="h-4 w-4 mr-2" /> PDF (Print)
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("excel")} disabled={!!exporting}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("csv")} disabled={!!exporting}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" /> CSV
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{entityName} — Profit & Loss</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {report?.periodLabel || `${dateRange.startDate} to ${dateRange.endDate}`}
              </p>
            </div>
            {report?.reportMode && (
              <Badge variant={report.reportMode === "qbo_plus_shared" ? "default" : "outline"}>
                {report.reportMode === "qbo_plus_shared" ? "QBO + Shared Expenses" : "QuickBooks Only"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3" />
              Loading financial data from QuickBooks...
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <div className="text-red-500 font-medium mb-2">Error loading report</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {error.message || "Failed to fetch data from QuickBooks. Please check the entity's QBO connection and try again."}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Retry
              </Button>
            </div>
          ) : !report || !report.lines || report.lines.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <p>No data available for the selected period.</p>
              <p className="text-sm mt-1">Ensure QuickBooks is synced and the entity is properly connected.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-semibold w-[300px]">Account</th>
                    <th className="text-right py-2 px-3 font-semibold">Current Period</th>
                    {includeShared && (
                      <th className="text-right py-2 px-3 font-semibold">Shared Alloc.</th>
                    )}
                    {includeShared && (
                      <th className="text-right py-2 px-3 font-semibold">Total</th>
                    )}
                    <th className="text-right py-2 px-3 font-semibold">Prior Period</th>
                    <th className="text-right py-2 px-3 font-semibold">Variance $</th>
                    <th className="text-right py-2 px-3 font-semibold">Variance %</th>
                    <th className="text-right py-2 px-3 font-semibold">Prior Year</th>
                    <th className="text-right py-2 px-3 font-semibold">YoY $</th>
                    <th className="text-right py-2 px-3 font-semibold">YoY %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines.map((line: any, idx: number) => {
                    const isTotal = line.lineType === "total";
                    const isSubtotal = line.lineType === "subtotal";
                    const isHeader = line.lineType === "header";
                    const isBold = isTotal || isSubtotal;
                    const rowKey = `${line.category}::${line.subcategory || ""}::${idx}`;
                    const hasAccounts = line.accounts && line.accounts.length > 0;
                    const isExpanded = expandedRows.has(rowKey);
                    const varColor = (val: number | null) => {
                      if (val == null) return "";
                      return val >= 0 ? "text-green-600" : "text-red-600";
                    };

                    return (
                      <tr key={idx}>
                        <td colSpan={includeShared ? 10 : 8} className="p-0">
                          <table className="w-full">
                            <tbody>
                              {/* Main row */}
                              <tr className={`border-b hover:bg-muted/30 ${isTotal ? "bg-primary/5 font-bold" : isSubtotal ? "bg-muted/30 font-semibold" : isHeader ? "bg-muted/20" : ""}`}>
                                <td className="py-2 px-3 w-[300px]">
                                  <div className="flex items-center gap-1">
                                    {hasAccounts && !isBold && !isHeader && (
                                      <button onClick={() => toggleRow(rowKey)} className="p-0.5 hover:bg-muted rounded">
                                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                      </button>
                                    )}
                                    <span className={`${isBold || isHeader ? "" : "pl-4"} ${isTotal ? "text-base" : ""}`}>
                                      {line.label}
                                    </span>
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3">{fmt(line.currentAmount)}</td>
                                {includeShared && (
                                  <td className="text-right py-2 px-3 text-blue-600">
                                    {line.sharedExpenseAmount ? fmt(line.sharedExpenseAmount) : "—"}
                                  </td>
                                )}
                                {includeShared && (
                                  <td className="text-right py-2 px-3 font-medium">
                                    {fmt(line.totalWithShared)}
                                  </td>
                                )}
                                <td className="text-right py-2 px-3 text-muted-foreground">{fmt(line.priorAmount)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceDollar)}`}>{fmtVar(line.varianceDollar)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.variancePct)}`}>{fmtPct(line.variancePct)}</td>
                                <td className="text-right py-2 px-3 text-muted-foreground">{fmt(line.priorYearAmount)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceYoyDollar)}`}>{fmtVar(line.varianceYoyDollar)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceYoyPct)}`}>{fmtPct(line.varianceYoyPct)}</td>
                              </tr>
                              {/* Expanded account detail */}
                              {isExpanded && hasAccounts && line.accounts.map((acct: any, ai: number) => (
                                <tr key={`${idx}-${ai}`} className="border-b bg-muted/10 text-xs text-muted-foreground">
                                  <td className="py-1 px-3 pl-10">{acct.name || acct.accountName}</td>
                                  <td className="text-right py-1 px-3">{fmt(acct.amount)}</td>
                                  {includeShared && <td className="text-right py-1 px-3">—</td>}
                                  {includeShared && <td className="text-right py-1 px-3">{fmt(acct.amount)}</td>}
                                  <td className="text-right py-1 px-3">{fmt(acct.priorAmount)}</td>
                                  <td className="text-right py-1 px-3">—</td>
                                  <td className="text-right py-1 px-3">—</td>
                                  <td className="text-right py-1 px-3">{fmt(acct.priorYearAmount)}</td>
                                  <td className="text-right py-1 px-3">—</td>
                                  <td className="text-right py-1 px-3">—</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
