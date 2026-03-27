import { useState, useMemo } from "react";
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
} from "lucide-react";
import { format, subYears } from "date-fns";

interface Props {
  entityId: number;
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

export default function BalanceSheet({ entityId, entityName }: Props) {
  const [asOfDate, setAsOfDate] = useState<Date>(new Date());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const asOfStr = format(asOfDate, "yyyy-MM-dd");

  const { data: report, isLoading, refetch } = trpc.financialStatements.reports.balanceSheet.useQuery({
    entityId,
    asOfDate: asOfStr,
  }, { enabled: !!entityId });

  const toggleRow = (key: string) => {
    const next = new Set(expandedRows);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedRows(next);
  };

  const handleExport = (exportFormat: "pdf" | "excel" | "csv") => {
    console.log("Export BS", exportFormat, asOfStr);
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

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAsOfDate(new Date())}>Today</Button>
              <Button variant="ghost" size="sm" onClick={() => {
                const now = new Date();
                const fyEnd = now.getMonth() >= 8
                  ? new Date(now.getFullYear(), 7, 31)
                  : new Date(now.getFullYear() - 1, 7, 31);
                setAsOfDate(fyEnd);
              }}>Last FY End</Button>
              <Button variant="ghost" size="sm" onClick={() => setAsOfDate(subYears(new Date(), 1))}>1 Year Ago</Button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48" align="end">
                  <div className="space-y-1">
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("pdf")}>
                      <FileTextIcon className="h-4 w-4 mr-2" /> PDF
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("excel")}>
                      <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" size="sm" onClick={() => handleExport("csv")}>
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
                {report?.periodLabel || `As of ${format(asOfDate, "MMMM d, yyyy")}`}
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
          ) : !report || !report.lines ? (
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
                    <th className="text-right py-2 px-3 font-semibold">Current</th>
                    <th className="text-right py-2 px-3 font-semibold">Prior Year-End</th>
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
                    const isBold = isTotal || isSubtotal;
                    const rowKey = `bs-${line.category}::${line.subcategory || ""}::${idx}`;
                    const hasAccounts = line.accounts && line.accounts.length > 0;
                    const isExpanded = expandedRows.has(rowKey);
                    const varColor = (val: number | null) => {
                      if (val == null) return "";
                      return val >= 0 ? "text-green-600" : "text-red-600";
                    };

                    return (
                      <tr key={idx}>
                        <td colSpan={8} className="p-0">
                          <table className="w-full">
                            <tbody>
                              <tr className={`border-b hover:bg-muted/30 ${isTotal ? "bg-primary/5 font-bold" : isSubtotal ? "bg-muted/30 font-semibold" : ""}`}>
                                <td className="py-2 px-3 w-[300px]">
                                  <div className="flex items-center gap-1">
                                    {hasAccounts && !isBold && (
                                      <button onClick={() => toggleRow(rowKey)} className="p-0.5 hover:bg-muted rounded">
                                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                      </button>
                                    )}
                                    <span className={`${isBold ? "" : "pl-4"} ${isTotal ? "text-base" : ""}`}>
                                      {line.label}
                                    </span>
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3">{fmt(line.currentAmount)}</td>
                                <td className="text-right py-2 px-3 text-muted-foreground">{fmt(line.priorAmount)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceDollar)}`}>{fmtVar(line.varianceDollar)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.variancePct)}`}>{fmtPct(line.variancePct)}</td>
                                <td className="text-right py-2 px-3 text-muted-foreground">{fmt(line.priorYearAmount)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceYoyDollar)}`}>{fmtVar(line.varianceYoyDollar)}</td>
                                <td className={`text-right py-2 px-3 ${varColor(line.varianceYoyPct)}`}>{fmtPct(line.varianceYoyPct)}</td>
                              </tr>
                              {isExpanded && hasAccounts && line.accounts.map((acct: any, ai: number) => (
                                <tr key={`${idx}-${ai}`} className="border-b bg-muted/10 text-xs text-muted-foreground">
                                  <td className="py-1 px-3 pl-10">{acct.name || acct.accountName}</td>
                                  <td className="text-right py-1 px-3">{fmt(acct.amount)}</td>
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
