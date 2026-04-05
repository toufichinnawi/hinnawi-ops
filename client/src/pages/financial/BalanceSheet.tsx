import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Download, Calendar as CalendarIcon, RefreshCw,
  ChevronDown, ChevronRight, FileSpreadsheet, FileText as FileTextIcon,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, subYears } from "date-fns";

interface Props {
  entityId: number;
  locationId: number;
  entityName: string;
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

export default function BalanceSheet({ entityId, locationId, entityName }: Props) {
  const [asOfDate, setAsOfDate] = useState<Date>(new Date());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);

  const asOfStr = format(asOfDate, "yyyy-MM-dd");
  const priorYearStr = format(subYears(asOfDate, 1), "yyyy-MM-dd");

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch Balance Sheet — always request comparison data
  const { data: report, isLoading, error, refetch } = trpc.financialStatements.reports.balanceSheet.useQuery({
    entityId,
    asOfDate: asOfStr,
    compareDate: priorYearStr,
    forceRefresh: isRefreshing,
  }, { enabled: !!entityId });

  const utils = trpc.useUtils();
  const clearCacheMutation = trpc.financialStatements.cache.clear.useMutation();

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await clearCacheMutation.mutateAsync({ entityId });
      await utils.financialStatements.reports.invalidate();
      await utils.financialStatements.consolidated.invalidate();
      await refetch();
      toast.success("Balance Sheet refreshed successfully from QuickBooks");
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
      utils.financialStatements.reports.invalidate();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [utils]);

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
          statementType: "balance_sheet",
          asOfDate: asOfStr,
          compareDate: priorYearStr,
        });
        downloadBlob(result.csv, result.fileName, 'text/csv;charset=utf-8;');
      } else if (exportFormat === "excel") {
        const result = await utils.financialStatements.reports.exportExcel.fetch({
          entityId,
          statementType: "balance_sheet",
          asOfDate: asOfStr,
          compareDate: priorYearStr,
        });
        downloadBlob(result.excel, result.fileName, 'application/vnd.ms-excel');
      } else if (exportFormat === "pdf") {
        const result = await utils.financialStatements.reports.exportHtml.fetch({
          entityId,
          statementType: "balance_sheet",
          asOfDate: asOfStr,
          compareDate: priorYearStr,
        });
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
  }, [entityId, asOfStr, priorYearStr, utils]);

  const varColor = (val: number | null) => {
    if (val == null) return "";
    return val >= 0 ? "text-green-600" : "text-red-600";
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">As of:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(asOfDate, "MMMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={asOfDate} onSelect={(d) => d && setAsOfDate(d)} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setAsOfDate(new Date())}>Today</Button>
              <Button variant="ghost" size="sm" onClick={() => {
                const now = new Date();
                const fyEnd = now.getMonth() >= 8
                  ? new Date(now.getFullYear(), 7, 31)
                  : new Date(now.getFullYear() - 1, 7, 31);
                setAsOfDate(fyEnd);
              }}>Last FY End</Button>
              <Button variant="ghost" size="sm" onClick={() => setAsOfDate(subYears(new Date(), 1))}>1 Year Ago</Button>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-xs text-muted-foreground">Quarter Ends:</span>
              {(() => {
                const now = new Date();
                const fy = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
                return [
                  { label: "Q1", date: new Date(fy, 10, 30) },
                  { label: "Q2", date: new Date(fy + 1, 1, new Date(fy + 1, 2, 0).getDate()) },
                  { label: "Q3", date: new Date(fy + 1, 4, 31) },
                  { label: "Q4", date: new Date(fy + 1, 7, 31) },
                ].filter(q => q.date <= now).map(q => (
                  <Button key={q.label} variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setAsOfDate(q.date)}>
                    {q.label} ({format(q.date, "MMM d")})
                  </Button>
                ));
              })()}
            </div>

            <Separator orientation="vertical" className="h-8" />

            <div className="text-sm text-muted-foreground">
              Comparing: <span className="font-medium">{asOfStr}</span> vs <span className="font-medium">{priorYearStr}</span>
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
              <CardTitle className="text-lg">{entityName} — Balance Sheet</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {report?.periodLabel || `As of ${asOfStr}`}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-3" />
              Loading balance sheet from QuickBooks...
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
              <p>No data available for the selected date.</p>
              <p className="text-sm mt-1">Ensure QuickBooks is synced and the entity is properly connected.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-semibold w-[300px]">Account</th>
                    <th className="text-right py-2 px-3 font-semibold">Current ({asOfStr})</th>
                    <th className="text-right py-2 px-3 font-semibold">Prior Year ({priorYearStr})</th>
                    <th className="text-right py-2 px-3 font-semibold">Variance $</th>
                    <th className="text-right py-2 px-3 font-semibold">Variance %</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines.map((line: any, idx: number) => {
                    const isTotal = line.lineType === "total";
                    const isSubtotal = line.lineType === "subtotal";
                    const isHeader = line.lineType === "header";
                    const isBold = isTotal || isSubtotal;
                    const rowKey = `bs-${line.category}::${line.subcategory || ""}::${idx}`;
                    const hasAccounts = line.accounts && line.accounts.length > 0;
                    const isExpanded = expandedRows.has(rowKey);

                    return (
                      <tr key={idx}>
                        <td colSpan={5} className="p-0">
                          <table className="w-full">
                            <tbody>
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
                                <td className="text-right py-2 px-3 text-muted-foreground">{fmt(line.priorAmount)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceDollar)}`}>{fmtVar(line.varianceDollar)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.variancePct)}`}>{fmtPct(line.variancePct)}</td>
                              </tr>
                              {isExpanded && hasAccounts && line.accounts.map((acct: any, ai: number) => (
                                <tr key={`${idx}-${ai}`} className="border-b bg-muted/10 text-xs text-muted-foreground">
                                  <td className="py-1 px-3 pl-10">{acct.name || acct.accountName}</td>
                                  <td className="text-right py-1 px-3">{fmt(acct.amount)}</td>
                                  <td className="text-right py-1 px-3">{fmt(acct.priorAmount)}</td>
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
