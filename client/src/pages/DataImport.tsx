import { useState, useCallback, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, DollarSign, Building2,
  CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, AlertTriangle, Loader2, FolderUp, X,
  CalendarRange, Database, TrendingUp, Landmark, BarChart3
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as XLSX from "xlsx";
import Papa from "papaparse";

type ImportType = "pos_sales" | "payroll" | "bank_statement" | "lightspeed_month" | "product_breakdown";

interface DetectedFormat {
  type: ImportType;
  confidence: string;
  details: string;
}

interface ParsedResult {
  fileName: string;
  format: DetectedFormat;
  rows: Record<string, any>[];
  summary: { totalSales?: number; totalOrders?: number; dateRange?: string; rowCount: number };
}

interface FileStatus {
  file: File;
  status: "pending" | "parsing" | "importing" | "done" | "error";
  parsed?: ParsedResult;
  result?: { imported: number; skipped: number; updated?: number };
  error?: string;
}

// ─── Auto-detect file format from content ───
function detectFormat(headers: string[], rawLines?: string): DetectedFormat {
  const hLower = headers.map(h => h.toLowerCase().replace(/[_\s-]/g, ""));

  if (rawLines && rawLines.includes("RESTAURANT SUMMARY MONTH REPORT")) {
    return { type: "lightspeed_month", confidence: "high", details: "Lightspeed Monthly Report" };
  }

  // Koomi Breakdown Sales: line 1 is store name, line 4 has ITEMS,CATEGORY,GROUP,TOTALS
  if (rawLines) {
    const firstLines = rawLines.split('\n').slice(0, 6).map(l => l.trim());
    if (firstLines.some(l => l.startsWith('ITEMS,CATEGORY,GROUP,TOTALS'))) {
      return { type: "product_breakdown", confidence: "high", details: "Koomi Item Breakdown" };
    }
  }

  if (hLower.some(h => h.includes("totalsales") || h.includes("netsales")) &&
      hLower.some(h => h.includes("date") || h.includes("saledate"))) {
    return { type: "pos_sales", confidence: "high", details: "Koomi POS" };
  }

  if (hLower.some(h => h.includes("grosswages") || h.includes("grosspay")) &&
      hLower.some(h => h.includes("paydate") || h.includes("date"))) {
    return { type: "payroll", confidence: "high", details: "ADP Payroll" };
  }

  if (hLower.some(h => h.includes("description") || h.includes("memo")) &&
      (hLower.some(h => h.includes("debit") || h.includes("credit")) || hLower.some(h => h === "amount"))) {
    return { type: "bank_statement", confidence: "high", details: "Bank Statement" };
  }

  if (hLower.some(h => h.includes("sales") || h.includes("revenue"))) {
    return { type: "pos_sales", confidence: "medium", details: "POS Sales (auto)" };
  }

  return { type: "pos_sales", confidence: "low", details: "Unknown format" };
}

// ─── Auto-map columns for standard CSV formats ───
function autoMapColumns(headers: string[], type: ImportType): Record<string, string> {
  const mapping: Record<string, string> = {};
  const hLower = headers.map(h => h.toLowerCase().replace(/[_\s-]/g, ""));

  const findHeader = (patterns: string[]): string | undefined => {
    for (const pattern of patterns) {
      const idx = hLower.findIndex(h => h.includes(pattern) || pattern.includes(h));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };

  if (type === "pos_sales") {
    mapping.saleDate = findHeader(["saledate", "date"]) || "";
    mapping.totalSales = findHeader(["totalsales", "netsales", "total", "sales"]) || "";
    mapping.taxExemptSales = findHeader(["taxexempt", "notax"]) || "";
    mapping.taxableSales = findHeader(["taxablesales", "taxable"]) || "";
    mapping.gstCollected = findHeader(["gst", "tps", "federaltax"]) || "";
    mapping.qstCollected = findHeader(["qst", "tvq", "provincialtax"]) || "";
    mapping.totalDeposit = findHeader(["totaldeposit", "deposit"]) || "";
    mapping.tipsCollected = findHeader(["tips", "tipscollected"]) || "";
    mapping.merchantFees = findHeader(["merchantfees", "fees", "processingfees"]) || "";
  } else if (type === "payroll") {
    mapping.payDate = findHeader(["paydate", "date"]) || "";
    mapping.grossWages = findHeader(["grosswages", "grosspay", "gross"]) || "";
    mapping.periodStart = findHeader(["periodstart", "startdate"]) || "";
    mapping.periodEnd = findHeader(["periodend", "enddate"]) || "";
    mapping.employerContributions = findHeader(["employercontributions", "employer"]) || "";
    mapping.netPayroll = findHeader(["netpayroll", "netpay", "net"]) || "";
    mapping.headcount = findHeader(["headcount", "employees", "count"]) || "";
    mapping.totalHours = findHeader(["totalhours", "hours"]) || "";
  } else if (type === "bank_statement") {
    mapping.transactionDate = findHeader(["transactiondate", "date", "postdate"]) || "";
    mapping.description = findHeader(["description", "memo", "narrative", "details"]) || "";
    mapping.debit = findHeader(["debit", "withdrawal"]) || "";
    mapping.credit = findHeader(["credit", "deposit"]) || "";
    mapping.amount = findHeader(["amount", "value"]) || "";
    mapping.balance = findHeader(["balance", "runningbalance"]) || "";
  }

  return mapping;
}

// ─── Parse Lightspeed structured monthly report ───
function parseLightspeedMonthReport(rawContent: string): Record<string, any>[] {
  const lines = rawContent.split('\n');
  const days: Record<string, any>[] = [];

  let dayRevenuesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('DAY REVENUES:')) {
      dayRevenuesStart = i;
      break;
    }
  }
  if (dayRevenuesStart === -1) return [];

  let i = dayRevenuesStart + 2;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    const fields = parseCSVLine(line);
    const dayNum = parseInt(fields[0]);
    if (isNaN(dayNum)) { i++; continue; }

    const startDate = fields[1]?.trim();
    const tickets = parseInt(fields[3]) || 0;
    const totalRevenue = parseFloat(fields[4]) || 0;

    let saleDate = '';
    if (startDate) {
      const datePart = startDate.split(' ')[0];
      const parts = datePart.split('-');
      if (parts.length === 3) {
        const year = parts[0].length === 2 ? '20' + parts[0] : parts[0];
        saleDate = `${year}-${parts[1]}-${parts[2]}`;
      }
    }

    let gst = 0, qst = 0, noTaxNet = 0;
    const taxName1 = fields[5]?.trim() || '';
    const netRev1 = parseFloat(fields[7]) || 0;
    const taxAmt1 = parseFloat(fields[8]) || 0;

    if (taxName1 === 'No Tax') noTaxNet = netRev1;
    else if (taxName1 === 'T.P.S') gst = taxAmt1;
    else if (taxName1 === 'T.V.Q') qst = taxAmt1;

    i++;
    while (i < lines.length) {
      const nextLine = lines[i].trim();
      if (!nextLine) { i++; continue; }
      const nextFields = parseCSVLine(nextLine);
      if (nextFields[0]?.trim() !== '') break;
      const taxName = nextFields[5]?.trim() || '';
      const netRev = parseFloat(nextFields[7]) || 0;
      const taxAmt = parseFloat(nextFields[8]) || 0;
      if (taxName === 'No Tax') noTaxNet = netRev;
      else if (taxName === 'T.P.S') gst = taxAmt;
      else if (taxName === 'T.V.Q') qst = taxAmt;
      i++;
    }

    if (saleDate) {
      days.push({
        saleDate,
        totalSales: totalRevenue.toFixed(2),
        taxExemptSales: noTaxNet.toFixed(2),
        taxableSales: (totalRevenue - gst - qst - noTaxNet).toFixed(2),
        gstCollected: gst.toFixed(2),
        qstCollected: qst.toFixed(2),
        orderCount: tickets,
        totalDeposit: totalRevenue.toFixed(2),
      });
    }
  }
  return days;
}

// ─── Parse Koomi Breakdown Sales CSV ───
function parseKoomiBreakdown(rawContent: string, fileName: string): ParsedResult {
  const lines = rawContent.split('\n');
  // Line 1: store name (e.g., "Hinnawi Bros (Mackay)")
  // Line 2: date range (e.g., "2025-01-01 00:00:00 to 2025-01-31 23:59:59")
  const dateRangeLine = lines[1]?.replace(/"/g, '').trim() || '';
  const dateMatch = dateRangeLine.match(/(\d{4}-\d{2}-\d{2}).*to.*(\d{4}-\d{2}-\d{2})/);
  const periodStart = dateMatch?.[1] || '';
  const periodEnd = dateMatch?.[2] || '';

  const rows: Record<string, any>[] = [];
  let section: 'items' | 'options' = 'items';
  let inData = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect ITEMS header
    if (line.startsWith('ITEMS,CATEGORY,GROUP,TOTALS')) {
      section = 'items';
      inData = true;
      continue;
    }
    // Detect OPTIONS header
    if (line.startsWith('OPTIONS,GROUP')) {
      section = 'options';
      inData = true;
      continue;
    }

    if (!inData) continue;

    const fields = parseCSVLine(line);
    const itemName = fields[0]?.trim();
    if (!itemName) continue;

    if (section === 'items') {
      const category = fields[1]?.trim() || null;
      const group = fields[2]?.trim() || null;
      const totalStr = (fields[3] || '0').replace(/,/g, '').trim();
      const total = parseFloat(totalStr) || 0;
      const qtySold = parseInt(fields[4]) || 0;
      const qtyRefunded = parseInt(fields[5]) || 0;
      rows.push({
        periodStart, periodEnd, section, itemName, category, groupName: group,
        totalRevenue: total.toFixed(2), quantitySold: qtySold, quantityRefunded: qtyRefunded,
      });
    } else {
      // OPTIONS section: columns are OPTIONS, GROUP, (empty), (empty), qty, refund
      const category = fields[1]?.trim() || null;
      const totalStr = (fields[3] || '0').replace(/,/g, '').trim();
      const total = parseFloat(totalStr) || 0;
      const qtySold = parseInt(fields[4]) || 0;
      const qtyRefunded = parseInt(fields[5]) || 0;
      rows.push({
        periodStart, periodEnd, section, itemName, category, groupName: null,
        totalRevenue: total.toFixed(2), quantitySold: qtySold, quantityRefunded: qtyRefunded,
      });
    }
  }

  const itemRows = rows.filter(r => r.section === 'items');
  const totalSales = itemRows.reduce((s, r) => s + parseFloat(r.totalRevenue || '0'), 0);
  const totalUnits = itemRows.reduce((s, r) => s + (r.quantitySold || 0), 0);

  return {
    fileName,
    format: { type: 'product_breakdown', confidence: 'high', details: 'Koomi Item Breakdown' },
    rows,
    summary: {
      totalSales,
      totalOrders: totalUnits,
      dateRange: periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : '',
      rowCount: rows.length,
    },
  };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += ch;
  }
  fields.push(current);
  return fields;
}

// ─── Parse any file and auto-detect format ───
function parseAndDetect(file: File): Promise<ParsedResult> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawContent = e.target?.result as string;

      // Koomi Breakdown Sales detection
      const firstFewLines = rawContent.split('\n').slice(0, 6).map((l: string) => l.trim());
      if (firstFewLines.some((l: string) => l.startsWith('ITEMS,CATEGORY,GROUP,TOTALS'))) {
        const parsed = parseKoomiBreakdown(rawContent, file.name);
        resolve(parsed);
        return;
      }

      if (rawContent.includes("RESTAURANT SUMMARY MONTH REPORT")) {
        const rows = parseLightspeedMonthReport(rawContent);
        const totalSales = rows.reduce((s, r) => s + parseFloat(r.totalSales || "0"), 0);
        const totalOrders = rows.reduce((s, r) => s + (r.orderCount || 0), 0);
        const dates = rows.filter(r => parseFloat(r.totalSales) > 0).map(r => r.saleDate).sort();
        resolve({
          fileName: file.name,
          format: { type: "lightspeed_month", confidence: "high", details: "Lightspeed Monthly Report" },
          rows,
          summary: {
            totalSales,
            totalOrders,
            dateRange: dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "",
            rowCount: rows.length,
          },
        });
        return;
      }

      if (ext === "csv" || ext === "tsv") {
        Papa.parse(rawContent, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const headers = (results.meta.fields || []).filter(h => h && h.trim() !== "");
            const data = (results.data as Record<string, string>[]).filter(
              (row) => Object.values(row).some((v) => v && String(v).trim())
            );
            const format = detectFormat(headers, rawContent);
            const mapping = autoMapColumns(headers, format.type);
            const rows = data.map(raw => {
              const mapped: Record<string, any> = {};
              for (const [key, col] of Object.entries(mapping)) {
                if (col) mapped[key] = raw[col] || "";
              }
              return mapped;
            });
            resolve({ fileName: file.name, format, rows, summary: { rowCount: rows.length } });
          },
          error: (err: any) => reject(err),
        });
      } else if (ext === "xlsx" || ext === "xls") {
        try {
          const wb = XLSX.read(rawContent, { type: "binary", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
          const headers = jsonData.length > 0 ? Object.keys(jsonData[0]).filter(h => h && h.trim() !== "") : [];
          const data = jsonData.map((row) => {
            const out: Record<string, string> = {};
            for (const k of headers) {
              const v = row[k];
              if (v instanceof Date) {
                out[k] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
              } else {
                out[k] = String(v ?? "");
              }
            }
            return out;
          });
          const format = detectFormat(headers);
          const mapping = autoMapColumns(headers, format.type);
          const rows = data.map(raw => {
            const mapped: Record<string, any> = {};
            for (const [key, col] of Object.entries(mapping)) {
              if (col) mapped[key] = raw[col] || "";
            }
            return mapped;
          });
          resolve({ fileName: file.name, format, rows, summary: { rowCount: rows.length } });
        } catch (err: any) {
          reject(err);
        }
      } else {
        reject(new Error(`Unsupported file type: .${ext}`));
      }
    };
    reader.readAsText(file, 'UTF-8');
  });
}

// ─── Import a single parsed result to the backend ───
async function importParsedResult(
  parsed: ParsedResult,
  locationId: number,
  mutations: {
    parsePOS: any;
    parsePayroll: any;
    parseBankStatement: any;
    parseLightspeedDay: any;
    parseProductBreakdown: any;
  },
  bankAccountId?: number,
  bankAccountName?: string,
): Promise<{ imported: number; skipped: number; updated?: number }> {
  if (parsed.format.type === "product_breakdown") {
    const res = await mutations.parseProductBreakdown.mutateAsync({
      rows: parsed.rows,
      fileName: parsed.fileName,
      locationId,
    });
    return { imported: res.imported, skipped: res.skipped, updated: res.updated };
  } else if (parsed.format.type === "lightspeed_month") {
    const mappedData = parsed.rows.map(r => ({
      saleDate: r.saleDate,
      totalSales: r.totalSales,
      receipts: String(r.orderCount || 0),
      taxExemptSales: r.taxExemptSales,
      taxableSales: r.taxableSales,
      gstCollected: r.gstCollected,
      qstCollected: r.qstCollected,
      totalDeposit: r.totalDeposit,
    }));
    const res = await mutations.parseLightspeedDay.mutateAsync({
      data: mappedData,
      fileName: parsed.fileName,
      locationId,
      columnMapping: { saleDate: "saleDate", totalSales: "totalSales", receipts: "receipts" },
    });
    return { imported: res.imported, skipped: res.skipped, updated: res.updated };
  } else if (parsed.format.type === "pos_sales") {
    const mappedData = parsed.rows.map(r => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k] = String(v || "");
      return out;
    });
    const res = await mutations.parsePOS.mutateAsync({
      data: mappedData,
      fileName: parsed.fileName,
      locationId,
      columnMapping: {
        saleDate: "saleDate", totalSales: "totalSales", taxExemptSales: "taxExemptSales",
        taxableSales: "taxableSales", gstCollected: "gstCollected", qstCollected: "qstCollected",
        totalDeposit: "totalDeposit", tipsCollected: "tipsCollected", merchantFees: "merchantFees",
      },
    });
    return { imported: res.imported, skipped: res.skipped };
  } else if (parsed.format.type === "payroll") {
    const mappedData = parsed.rows.map(r => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k] = String(v || "");
      return out;
    });
    const res = await mutations.parsePayroll.mutateAsync({
      data: mappedData,
      fileName: parsed.fileName,
      locationId,
      columnMapping: {
        payDate: "payDate", grossWages: "grossWages", periodStart: "periodStart",
        periodEnd: "periodEnd", employerContributions: "employerContributions",
        netPayroll: "netPayroll", headcount: "headcount", totalHours: "totalHours",
      },
    });
    return { imported: res.imported, skipped: res.skipped };
  } else {
    const mappedData = parsed.rows.map(r => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k] = String(v || "");
      return out;
    });
    const res = await mutations.parseBankStatement.mutateAsync({
      data: mappedData,
      fileName: parsed.fileName,
      accountName: bankAccountName,
      locationId,
      bankAccountId,
      columnMapping: {
        transactionDate: "transactionDate", description: "description",
        debit: "debit", credit: "credit", amount: "amount", balance: "balance",
      },
    });
    return { imported: res.imported, skipped: res.skipped };
  }
}

// ─── Bulk Import Wizard ───
function BulkImportWizard({ onComplete }: { onComplete: () => void }) {
  const [locationId, setLocationId] = useState<string>("");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  const { data: locations } = trpc.locations.list.useQuery();
  const { data: bankAccountsList } = trpc.bankAccounts.list.useQuery();
  const parsePOS = trpc.imports.parsePOS.useMutation();
  const parsePayroll = trpc.imports.parsePayroll.useMutation();
  const parseBankStatement = trpc.imports.parseBankStatement.useMutation();
  const parseLightspeedDay = trpc.imports.parseLightspeedDay.useMutation();
  const parseProductBreakdown = trpc.productSales.import.useMutation();

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const validExts = [".csv", ".tsv", ".xls", ".xlsx"];
    const validFiles = fileArray.filter(f => validExts.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (validFiles.length < fileArray.length) {
      toast.warning(`${fileArray.length - validFiles.length} file(s) skipped — only CSV/TSV/XLS/XLSX supported`);
    }
    const newStatuses: FileStatus[] = validFiles.map(f => ({ file: f, status: "pending" }));
    // Clear completed files when adding new ones — they're already in the database
    setFiles(prev => [...prev.filter(f => f.status !== "done"), ...newStatuses]);
    if (validFiles.length > 0) {
      toast.success(`Added ${validFiles.length} file(s) — ${validFiles.length + files.length} total`);
    }
  }, [files.length]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!locationId) {
      toast.error("Please select a store first");
      return;
    }
    addFiles(e.dataTransfer.files);
  }, [locationId, addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = ""; // reset so same files can be re-selected
  }, [addFiles]);

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    abortRef.current = false;
  };

  const runBulkImport = async () => {
    if (!locationId || files.length === 0) return;
    setIsRunning(true);
    abortRef.current = false;

    const locId = parseInt(locationId);
    const selectedBank = (bankAccountsList || []).find((b: any) => String(b.id) === bankAccountId);
    const mutations = { parsePOS, parsePayroll, parseBankStatement, parseLightspeedDay, parseProductBreakdown };

    for (let idx = 0; idx < files.length; idx++) {
      if (abortRef.current) break;
      const fs = files[idx];
      if (fs.status === "done") continue; // skip already imported

      // Parse
      setFiles(prev => prev.map((f, i) => i === idx ? { ...f, status: "parsing" } : f));
      try {
        const parsed = await parseAndDetect(fs.file);
        setFiles(prev => prev.map((f, i) => i === idx ? { ...f, parsed, status: "importing" } : f));

        // Import
        const result = await importParsedResult(
          parsed, locId, mutations,
          bankAccountId ? parseInt(bankAccountId) : undefined,
          selectedBank?.name,
        );
        setFiles(prev => prev.map((f, i) => i === idx ? { ...f, status: "done", result } : f));
      } catch (err: any) {
        setFiles(prev => prev.map((f, i) => i === idx ? { ...f, status: "error", error: err.message } : f));
      }
    }

    setIsRunning(false);
    onComplete();
    toast.success("Bulk import complete!");
  };

  const doneCount = files.filter(f => f.status === "done").length;
  const errorCount = files.filter(f => f.status === "error").length;
  const pendingCount = files.filter(f => f.status === "pending").length;
  const totalImported = files.reduce((s, f) => s + (f.result?.imported || 0), 0);
  const totalSkipped = files.reduce((s, f) => s + (f.result?.skipped || 0), 0);
  const totalUpdated = files.reduce((s, f) => s + (f.result?.updated || 0), 0);
  const currentIdx = files.findIndex(f => f.status === "parsing" || f.status === "importing");

  const hasBankFiles = files.some(f => f.parsed?.format.type === "bank_statement");

  return (
    <Card className="border-2">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <FolderUp className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">Bulk Import</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Select a store, then drop all your files at once — each is auto-detected and imported
            </CardDescription>
          </div>
          {files.length > 0 && !isRunning && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Select Store */}
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium w-28 shrink-0">
            Store <span className="text-destructive">*</span>
          </label>
          <Select value={locationId} onValueChange={(val) => { setLocationId(val); setBankAccountId(""); setFiles(prev => prev.filter(f => f.status !== "done")); }} disabled={isRunning}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select store first" />
            </SelectTrigger>
            <SelectContent>
              {(locations || []).map((loc: any) => (
                <SelectItem key={loc.id} value={String(loc.id)}>
                  {loc.code} - {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Optional: Bank Account for bank statements */}
        {hasBankFiles && locationId && (
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium w-28 shrink-0">
              Bank Account
            </label>
            <Select value={bankAccountId} onValueChange={setBankAccountId} disabled={isRunning}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Select bank account (for bank statements)" />
              </SelectTrigger>
              <SelectContent>
                {(bankAccountsList || []).filter((b: any) => String(b.locationId) === locationId).map((b: any) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Step 2: Drop Zone */}
        {locationId && (
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
              !isRunning ? "cursor-pointer" : ""
            } ${
              isDragging ? "border-primary bg-primary/5" :
              files.length > 0 ? "border-muted-foreground/30 bg-muted/20" :
              "border-muted-foreground/20 hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); if (!isRunning) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={isRunning ? (e) => e.preventDefault() : handleDrop}
            onClick={() => !isRunning && fileInputRef.current?.click()}
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">
              {files.length === 0 ? "Drop files here or click to browse" : "Drop more files or click to add"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports CSV, TSV, XLS, XLSX — drag as many files as you need
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.xls,.xlsx"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1 mb-2">
              <span>{pendingCount > 0 ? `${pendingCount} file${pendingCount !== 1 ? "s" : ""} queued` : `${files.length} file${files.length !== 1 ? "s" : ""}`}</span>
              <div className="flex gap-3">
                {doneCount > 0 && <span className="text-emerald-600">{doneCount} done</span>}
                {errorCount > 0 && <span className="text-destructive">{errorCount} failed</span>}
                {pendingCount > 0 && !isRunning && <span>{pendingCount} pending</span>}
              </div>
            </div>

            {/* Progress bar when running */}
            {isRunning && (
              <div className="w-full bg-muted rounded-full h-2 mb-3">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((doneCount + errorCount) / files.length) * 100}%` }}
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto space-y-1 border rounded-lg p-2">
              {files.map((fs, idx) => (
                <div
                  key={`${fs.file.name}-${idx}`}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                    fs.status === "done" ? "bg-emerald-50/50" :
                    fs.status === "error" ? "bg-destructive/5" :
                    (fs.status === "parsing" || fs.status === "importing") ? "bg-blue-50/50" :
                    ""
                  }`}
                >
                  {/* Status icon */}
                  {fs.status === "pending" && <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />}
                  {fs.status === "parsing" && <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />}
                  {fs.status === "importing" && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
                  {fs.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                  {fs.status === "error" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}

                  {/* File name */}
                  <span className="truncate flex-1 text-xs" title={fs.file.name}>
                    {fs.file.name}
                  </span>

                  {/* Status details */}
                  {fs.status === "parsing" && <span className="text-[10px] text-blue-500 shrink-0">Parsing...</span>}
                  {fs.status === "importing" && <span className="text-[10px] text-primary shrink-0">Importing...</span>}
                  {fs.status === "done" && fs.result && (
                    <span className="text-[10px] text-emerald-600 shrink-0">
                      {fs.result.imported} imported
                      {(fs.result.updated || 0) > 0 && `, ${fs.result.updated} updated`}
                      {fs.result.skipped > 0 && `, ${fs.result.skipped} skipped`}
                    </span>
                  )}
                  {fs.status === "done" && fs.parsed && (
                    <Badge variant="outline" className="text-[10px] shrink-0 h-5">{fs.parsed.format.details}</Badge>
                  )}
                  {fs.status === "error" && (
                    <span className="text-[10px] text-destructive shrink-0 max-w-48 truncate" title={fs.error}>
                      {fs.error}
                    </span>
                  )}

                  {/* Remove button (only when not running) */}
                  {!isRunning && fs.status === "pending" && (
                    <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary when done */}
        {!isRunning && doneCount > 0 && doneCount + errorCount === files.length && (
          <div className="bg-emerald-50/50 border border-emerald-200 rounded-lg p-4 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="font-semibold">Bulk Import Complete</p>
            <div className="flex justify-center gap-6 text-sm">
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-600">{totalImported}</p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              {totalUpdated > 0 && (
                <div className="text-center">
                  <p className="text-xl font-bold text-blue-500">{totalUpdated}</p>
                  <p className="text-xs text-muted-foreground">Updated</p>
                </div>
              )}
              {totalSkipped > 0 && (
                <div className="text-center">
                  <p className="text-xl font-bold text-amber-500">{totalSkipped}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              )}
              {errorCount > 0 && (
                <div className="text-center">
                  <p className="text-xl font-bold text-destructive">{errorCount}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {doneCount} of {files.length} files processed successfully
            </p>
          </div>
        )}

        {/* Action buttons */}
        {files.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            {isRunning ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Processing {currentIdx >= 0 ? currentIdx + 1 : "..."} of {files.length}...
                </p>
                <Button variant="destructive" size="sm" onClick={() => { abortRef.current = true; }}>
                  Stop Import
                </Button>
              </>
            ) : doneCount + errorCount === files.length && files.length > 0 ? (
              <>
                <div />
                <Button variant="outline" size="sm" onClick={clearAll}>
                  Start New Batch
                </Button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {pendingCount} file{pendingCount !== 1 ? "s" : ""} ready to import
                </p>
                <Button
                  size="sm"
                  disabled={!locationId || pendingCount === 0}
                  onClick={runBulkImport}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  Import {pendingCount} File{pendingCount !== 1 ? "s" : ""}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportHistory() {
  const { data: logs, isLoading } = trpc.imports.logs.useQuery();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return null;
  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No imports yet. Upload a file above to get started.</p>
        </CardContent>
      </Card>
    );
  }

  const displayLogs = expanded ? logs : logs.slice(0, 5);

  const typeLabels: Record<string, string> = {
    pos_sales: "POS Sales",
    payroll: "Payroll",
    bank_statement: "Bank Statement",
    invoices: "Invoices",
  };

  const statusIcons: Record<string, React.ReactNode> = {
    completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    failed: <XCircle className="h-4 w-4 text-destructive" />,
    processing: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Import History</CardTitle>
          <Badge variant="secondary">{logs.length} imports</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">File</th>
                <th className="text-right py-2 px-2 font-medium text-muted-foreground">Records</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date Range</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">Imported By</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody>
              {displayLogs.map((log: any) => (
                <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-2">{statusIcons[log.status] || statusIcons.pending}</td>
                  <td className="py-2 px-2">
                    <Badge variant="outline" className="text-xs">
                      {typeLabels[log.importType] || log.importType}
                    </Badge>
                  </td>
                  <td className="py-2 px-2 max-w-48 truncate" title={log.fileName}>
                    {log.fileName}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {log.recordsImported || 0}
                    {(log.recordsSkipped || 0) > 0 && (
                      <span className="text-amber-500 ml-1">(+{log.recordsSkipped} skipped)</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">
                    {log.dateRangeStart && log.dateRangeEnd
                      ? `${log.dateRangeStart} to ${log.dateRangeEnd}`
                      : "—"}
                  </td>
                  <td className="py-2 px-2 text-xs">{log.importedBy || "—"}</td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">
                    {log.createdAt ? new Date(log.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <><ChevronUp className="h-4 w-4 mr-1" /> Show Less</>
            ) : (
              <><ChevronDown className="h-4 w-4 mr-1" /> Show All ({logs.length})</>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Data Coverage Panel ───
const DATA_TYPES = [
  { key: "POS Sales", label: "POS Sales", icon: <DollarSign className="h-3.5 w-3.5" />, color: "bg-emerald-500", lightColor: "bg-emerald-100 text-emerald-700" },
  { key: "Product Sales", label: "Product Breakdown", icon: <BarChart3 className="h-3.5 w-3.5" />, color: "bg-blue-500", lightColor: "bg-blue-100 text-blue-700" },
  { key: "Payroll", label: "Payroll", icon: <FileSpreadsheet className="h-3.5 w-3.5" />, color: "bg-orange-500", lightColor: "bg-orange-100 text-orange-700" },
  { key: "Invoices", label: "Invoices", icon: <TrendingUp className="h-3.5 w-3.5" />, color: "bg-purple-500", lightColor: "bg-purple-100 text-purple-700" },
  { key: "Bank Statements", label: "Bank Statements", icon: <Landmark className="h-3.5 w-3.5" />, color: "bg-violet-500", lightColor: "bg-violet-100 text-violet-700" },
];

function DataCoveragePanel() {
  const { data: coverage, isLoading: coverageLoading } = trpc.dataCoverage.all.useQuery();
  const { data: bankCoverage, isLoading: bankLoading } = trpc.bankAccounts.bankCoverage.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  const isLoading = coverageLoading || bankLoading;

  const locMap = useMemo(() => {
    const m = new Map<number, { code: string; name: string }>();
    if (locations) locations.forEach((l: any) => m.set(Number(l.id), { code: l.code, name: l.name }));
    return m;
  }, [locations]);

  // Build coverage map: dataType -> locationId -> { earliest, latest, records }
  const coverageMap = useMemo(() => {
    const m = new Map<string, Map<number, { earliest: string; latest: string; records: number }>>();
    if (!coverage) return m;
    for (const row of coverage as any[]) {
      const dt = row.dataType;
      const locId = row.locationId ? Number(row.locationId) : 0;
      if (!m.has(dt)) m.set(dt, new Map());
      m.get(dt)!.set(locId, {
        earliest: row.earliest,
        latest: row.latest,
        records: Number(row.records),
      });
    }
    return m;
  }, [coverage]);

  const today = new Date().toISOString().slice(0, 10);

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  }

  function daysSince(d: string | null) {
    if (!d) return Infinity;
    const diff = (new Date(today).getTime() - new Date(d).getTime()) / 86400000;
    return Math.floor(diff);
  }

  function getStatusBadge(earliest: string | null, latest: string | null, records: number) {
    if (!earliest || records === 0) {
      return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">No Data</Badge>;
    }
    const gap = daysSince(latest);
    if (gap <= 2) {
      return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-600 border-emerald-200">Up to Date</Badge>;
    }
    if (gap <= 7) {
      return <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-600 border-amber-200">{gap}d Behind</Badge>;
    }
    if (gap <= 30) {
      return <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-600 border-orange-200">{gap}d Behind</Badge>;
    }
    return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">{gap}d Behind</Badge>;
  }

  // Timeline bar: show coverage as a visual bar from earliest to latest relative to a global range
  const globalEarliest = "2025-01-01";
  const globalLatest = today;
  const globalRange = (new Date(globalLatest).getTime() - new Date(globalEarliest).getTime()) || 1;

  function getBarStyle(earliest: string | null, latest: string | null) {
    if (!earliest || !latest) return { left: "0%", width: "0%" };
    const start = Math.max(0, new Date(earliest).getTime() - new Date(globalEarliest).getTime());
    const end = Math.max(0, new Date(latest).getTime() - new Date(globalEarliest).getTime());
    const left = (start / globalRange) * 100;
    const width = Math.max(1, ((end - start) / globalRange) * 100);
    return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
  }

  const locationIds = (Array.from(locMap.keys()) as number[]).sort((a, b) => a - b);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Data Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading coverage data...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-4 w-4" />
              Data Coverage
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Jan 2025 — Today
            </p>
          </div>
          <CardDescription className="text-xs">
            Shows what date ranges have been imported for each data type per location. Red = missing, green = up to date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-32">Data Type</th>
                  {locationIds.map((id: number) => (
                    <th key={id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[180px]">
                      {locMap.get(id)?.code || `Loc ${id}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DATA_TYPES.filter(dt => dt.key !== "Bank Statements").map(dt => (
                  <tr key={dt.key} className="border-b last:border-0">
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`${dt.lightColor} p-1 rounded`}>{dt.icon}</span>
                        <span className="text-xs font-medium">{dt.label}</span>
                      </div>
                    </td>
                    {locationIds.map((locId: number) => {
                      const data = coverageMap.get(dt.key)?.get(locId);
                      const earliest = data?.earliest || null;
                      const latest = data?.latest || null;
                      const records = data?.records || 0;
                      const barStyle = getBarStyle(earliest, latest);
                      return (
                        <td key={locId} className="py-2.5 px-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="space-y-1.5 cursor-default">
                                <div className="flex items-center justify-between">
                                  {getStatusBadge(earliest, latest, records)}
                                  <span className="text-[10px] text-muted-foreground tabular-nums">{records > 0 ? `${records.toLocaleString()} rec` : ""}</span>
                                </div>
                                <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                                  {records > 0 && (
                                    <div
                                      className={`absolute h-full rounded-full ${dt.color} opacity-70`}
                                      style={barStyle}
                                    />
                                  )}
                                </div>
                                {records > 0 ? (
                                  <p className="text-[10px] text-muted-foreground tabular-nums">
                                    {formatDate(earliest)} → {formatDate(latest)}
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-red-500 font-medium">No data uploaded</p>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              <p className="font-medium">{dt.label} — {locMap.get(locId)?.name}</p>
                              {records > 0 ? (
                                <>
                                  <p>From: {formatDate(earliest)}</p>
                                  <p>To: {formatDate(latest)}</p>
                                  <p>{records.toLocaleString()} records</p>
                                  <p className="text-muted-foreground mt-1">
                                    {daysSince(latest) <= 2 ? "Current — no action needed" : `${daysSince(latest)} days since last update — upload needed`}
                                  </p>
                                </>
                              ) : (
                                <p className="text-red-400">No data has been uploaded yet. Upload a CSV to get started.</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bank Statements — separate section since they're per-account not per-location */}
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="bg-violet-100 text-violet-700 p-1 rounded"><Landmark className="h-3.5 w-3.5" /></span>
              <span className="text-xs font-medium">Bank Statements</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(bankCoverage as any[] || []).map((ba: any) => {
                const records = Number(ba.txnCount) || 0;
                const earliest = ba.earliest;
                const latest = ba.latest;
                const barStyle = getBarStyle(earliest, latest);
                const loc = locMap.get(Number(ba.locationId));
                return (
                  <Tooltip key={ba.bankAccountId}>
                    <TooltipTrigger asChild>
                      <div className="p-3 rounded-lg border bg-card space-y-2 cursor-default hover:border-primary/30 transition-colors">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium">{ba.bankAccountName}</p>
                            <p className="text-[10px] text-muted-foreground">{ba.bankName} · {loc?.code || "?"}</p>
                          </div>
                          {getStatusBadge(earliest, latest, records)}
                        </div>
                        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                          {records > 0 && (
                            <div
                              className="absolute h-full rounded-full bg-violet-500 opacity-70"
                              style={barStyle}
                            />
                          )}
                        </div>
                        {records > 0 ? (
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {formatDate(earliest)} → {formatDate(latest)} · {records.toLocaleString()} txns
                          </p>
                        ) : (
                          <p className="text-[10px] text-red-500 font-medium">No statements uploaded — upload CSV via Import above</p>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p className="font-medium">{ba.bankAccountName}</p>
                      <p>{ba.bankName} · Acct# {ba.accountNumber || "—"} · {loc?.name}</p>
                      {records > 0 ? (
                        <>
                          <p>From: {formatDate(earliest)}</p>
                          <p>To: {formatDate(latest)}</p>
                          <p>{records.toLocaleString()} transactions</p>
                        </>
                      ) : (
                        <p className="text-red-400">No bank statement data. Download CSV from your bank and upload it above.</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

export default function DataImport() {
  const utils = trpc.useUtils();

  const handleComplete = () => {
    utils.imports.logs.invalidate();
    utils.dataCoverage.all.invalidate();
    utils.bankAccounts.bankCoverage.invalidate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Data Import Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a store, then drag and drop all your files at once. Format is auto-detected and columns are auto-mapped.
        </p>
      </div>

      {/* Data Coverage Dashboard */}
      <DataCoveragePanel />

      {/* Bulk Import Wizard */}
      <BulkImportWizard onComplete={handleComplete} />

      {/* Supported formats reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: <DollarSign className="h-4 w-4" />, label: "Koomi POS", color: "text-emerald-600", desc: "Daily sales CSV" },
          { icon: <FileSpreadsheet className="h-4 w-4" />, label: "Lightspeed", color: "text-orange-600", desc: "Monthly report CSV" },
          { icon: <FileSpreadsheet className="h-4 w-4" />, label: "ADP Payroll", color: "text-blue-600", desc: "Payroll CSV/Excel" },
          { icon: <Building2 className="h-4 w-4" />, label: "Bank Statement", color: "text-violet-600", desc: "Transaction CSV" },
        ].map((fmt) => (
          <div key={fmt.label} className="flex items-center gap-2 p-3 rounded-lg bg-card border text-sm">
            <div className={`${fmt.color}`}>{fmt.icon}</div>
            <div>
              <p className="font-medium text-xs">{fmt.label}</p>
              <p className="text-[10px] text-muted-foreground">{fmt.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* OneDrive Reference */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">OneDrive Archive Structure</p>
              <p className="text-muted-foreground mt-1">
                Original files should also be archived in OneDrive under:
                <code className="mx-1 px-1.5 py-0.5 bg-muted rounded text-xs">
                  Hinnawi Bros - Accounting / [Entity] / POS Sales Data
                </code>
                or
                <code className="mx-1 px-1.5 py-0.5 bg-muted rounded text-xs">
                  Hinnawi Bros - Accounting / [Entity] / Payroll
                </code>
                for audit trail purposes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import History */}
      <ImportHistory />
    </div>
  );
}
