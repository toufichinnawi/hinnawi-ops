import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { useState, useMemo, useCallback } from "react";

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ExportPanelProps {
  /** Default start date (YYYY-MM-DD) */
  defaultStartDate?: string;
  /** Default end date (YYYY-MM-DD) */
  defaultEndDate?: string;
  /** Compact mode — single row of buttons, no card wrapper */
  compact?: boolean;
  /** If provided, only show these export types */
  types?: ('dailySales' | 'payroll' | 'productSales' | 'combined')[];
}

export default function DataExportPanel({ defaultStartDate, defaultEndDate, compact, types }: ExportPanelProps) {
  const { data: dateRange } = trpc.reporting.dateRange.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  const defaultStart = defaultStartDate || dateRange?.minDate || '2025-01-01';
  const defaultEnd = defaultEndDate || dateRange?.maxDate || new Date().toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [exporting, setExporting] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{ type: string; rows: number } | null>(null);

  const effectiveStart = startDate || defaultStart;
  const effectiveEnd = endDate || defaultEnd;

  const locationIds = useMemo(() => {
    if (storeFilter === 'all') return undefined;
    return [Number(storeFilter)];
  }, [storeFilter]);

  const utils = trpc.useUtils();

  const handleExport = useCallback(async (type: 'dailySales' | 'payroll' | 'productSales' | 'combined') => {
    setExporting(type);
    setLastExport(null);
    try {
      let result: { csv: string; rowCount: number; filename: string };
      if (type === 'dailySales') {
        result = await utils.export.dailySales.fetch({ startDate: effectiveStart, endDate: effectiveEnd, locationIds });
      } else if (type === 'payroll') {
        result = await utils.export.payroll.fetch({ startDate: effectiveStart, endDate: effectiveEnd, locationIds });
      } else if (type === 'productSales') {
        result = await utils.export.productSales.fetch({
          startDate: effectiveStart,
          endDate: effectiveEnd,
          locationId: locationIds?.[0],
        });
      } else {
        result = await utils.export.combined.fetch({ startDate: effectiveStart, endDate: effectiveEnd, locationIds });
      }
      downloadCsv(result.csv, result.filename);
      setLastExport({ type, rows: result.rowCount });
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  }, [effectiveStart, effectiveEnd, locationIds, utils]);

  const allTypes: { key: 'dailySales' | 'payroll' | 'productSales' | 'combined'; label: string; desc: string }[] = [
    { key: 'dailySales', label: 'Daily Sales', desc: 'Revenue, taxes, tips, labor, orders per store per day' },
    { key: 'payroll', label: 'Payroll Records', desc: 'Gross wages, employer contributions, headcount, hours' },
    { key: 'productSales', label: 'Product Sales', desc: 'Item-level sales by store, category, and period' },
    { key: 'combined', label: 'Sales + Labor Summary', desc: 'Revenue, labor cost, labor %, avg ticket, gross margin' },
  ];

  const visibleTypes = types ? allTypes.filter(t => types.includes(t.key)) : allTypes;

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-medium">Export CSV:</span>
        {visibleTypes.map(t => (
          <Button
            key={t.key}
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={!!exporting}
            onClick={() => handleExport(t.key)}
          >
            {exporting === t.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {t.label}
          </Button>
        ))}
        {lastExport && (
          <Badge variant="secondary" className="text-xs gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {lastExport.rows} rows exported
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base font-semibold">Data Export</CardTitle>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={startDate || effectiveStart}
              onChange={e => setStartDate(e.target.value)}
              className="w-[140px] h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate || effectiveEnd}
              onChange={e => setEndDate(e.target.value)}
              className="w-[140px] h-8 text-xs"
            />
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="All Stores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {locations?.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.code} - {l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleTypes.map(t => (
            <button
              key={t.key}
              className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border/50 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left group disabled:opacity-50"
              disabled={!!exporting}
              onClick={() => handleExport(t.key)}
            >
              <div className="flex items-center gap-2 w-full">
                {exporting === t.key ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                ) : (
                  <Download className="h-4 w-4 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                )}
                <span className="text-sm font-medium">{t.label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
              {lastExport?.type === t.key && (
                <Badge variant="secondary" className="text-xs gap-1 mt-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  {lastExport.rows} rows
                </Badge>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
