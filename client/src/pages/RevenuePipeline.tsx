import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw,
  Eye, Edit3, Ban, ChevronLeft, ChevronRight, DollarSign,
  FileText, Filter, Download
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

function formatCurrency(val: number | string) {
  const num = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num || 0);
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  if (typeof d === "string") return d.slice(0, 10);
  // Use UTC components to avoid timezone shift (MySQL date at midnight UTC → EDT shows previous day)
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "posted":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Posted</Badge>;
    case "failed":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    case "pending":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "voided":
      return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"><Ban className="w-3 h-3 mr-1" />Voided</Badge>;
    case "deleted":
      return <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400"><XCircle className="w-3 h-3 mr-1" />Deleted</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function RevenuePipeline() {
  const [activeTab, setActiveTab] = useState("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    arAmount: "",
    taxExemptSales: "",
    taxableSales: "",
    gst: "",
    qst: "",
    tips: "",
    pettyCash: "",
  });

  const utils = trpc.useUtils();
  const { data: locations } = trpc.locations.list.useQuery();

  const statusParam = activeTab === "all" ? "all" : activeTab;
  const { data, isLoading, refetch } = trpc.revenueJE.list.useQuery({
    status: statusParam as any,
    locationId: locationFilter !== "all" ? parseInt(locationFilter) : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    pageSize: 50,
  });

  const repostMutation = trpc.revenueJE.updateAndRepost.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Posted to QBO — JE #${result.qboJeId}`);
        setEditDialogOpen(false);
        refetch();
      } else {
        toast.error(`Failed: ${result.error}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const voidMutation = trpc.revenueJE.void.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success("JE voided in QBO");
        refetch();
      } else {
        toast.error(`Failed: ${result.error}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const summary = data?.summary || { posted: 0, failed: 0, pending: 0, voided: 0, deleted: 0, total: 0 };
  const entries = data?.entries || [];
  const totalPages = Math.ceil((data?.total || 0) / 50);

  // Calculate debit/credit balance for edit form
  const editDebits = parseFloat(editForm.arAmount || "0") + parseFloat(editForm.pettyCash || "0");
  const editCredits = parseFloat(editForm.taxExemptSales || "0") + parseFloat(editForm.taxableSales || "0") +
    parseFloat(editForm.gst || "0") + parseFloat(editForm.qst || "0") + parseFloat(editForm.tips || "0");
  const editDiff = Math.round((editDebits - editCredits) * 100) / 100;
  const isBalanced = Math.abs(editDiff) < 0.02; // Allow rounding adjustment up to $0.02

  function openEditDialog(entry: any) {
    setSelectedEntry(entry);
    setEditForm({
      arAmount: entry.arAmount || "0",
      taxExemptSales: entry.taxExemptSales || "0",
      taxableSales: entry.taxableSales || "0",
      gst: entry.gst || "0",
      qst: entry.qst || "0",
      tips: entry.tips || "0",
      pettyCash: entry.pettyCash || "0",
    });
    setEditDialogOpen(true);
  }

  function openViewDialog(entry: any) {
    setSelectedEntry(entry);
    setViewDialogOpen(true);
  }

  function handleRepost() {
    if (!selectedEntry) return;
    repostMutation.mutate({
      id: selectedEntry.id,
      ...editForm,
    });
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revenue Pipeline</h1>
          <p className="text-muted-foreground">Manage POS revenue journal entries posted to QuickBooks</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="cursor-pointer hover:border-green-500 transition-colors" onClick={() => setActiveTab("posted")}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Posted</p>
                <p className="text-2xl font-bold text-green-600">{summary.posted}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-red-500 transition-colors" onClick={() => setActiveTab("failed")}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600">{summary.failed}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-yellow-500 transition-colors" onClick={() => setActiveTab("pending")}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{summary.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-gray-500 transition-colors" onClick={() => setActiveTab("voided")}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Voided</p>
                <p className="text-2xl font-bold text-gray-600">{summary.voided}</p>
              </div>
              <Ban className="w-8 h-8 text-gray-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-blue-500 transition-colors" onClick={() => setActiveTab("all")}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{summary.total}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <Select value={locationFilter} onValueChange={(v) => { setLocationFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations?.map((loc) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="w-[160px]"
              placeholder="Start Date"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="w-[160px]"
              placeholder="End Date"
            />
            {(locationFilter !== "all" || startDate || endDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setLocationFilter("all"); setStartDate(""); setEndDate(""); setPage(1); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all">All ({summary.total})</TabsTrigger>
          <TabsTrigger value="posted">Posted ({summary.posted})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({summary.failed})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({summary.pending})</TabsTrigger>
          <TabsTrigger value="voided">Voided ({summary.voided})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Entries Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-left p-3 font-medium">Location</th>
                  <th className="text-left p-3 font-medium">Doc #</th>
                  <th className="text-right p-3 font-medium">Net Revenue</th>
                  <th className="text-right p-3 font-medium">GST</th>
                  <th className="text-right p-3 font-medium">QST</th>
                  <th className="text-right p-3 font-medium">AR Amount</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">QBO JE</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={10} className="text-center p-8 text-muted-foreground">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={10} className="text-center p-8 text-muted-foreground">No entries found</td></tr>
                ) : entries.map((entry: any) => (
                  <tr key={entry.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs">{formatDate(entry.saleDate)}</td>
                    <td className="p-3">{entry.locationName}</td>
                    <td className="p-3 font-mono text-xs">{entry.docNumber || "—"}</td>
                    <td className="p-3 text-right font-mono">{formatCurrency(entry.netRevenue)}</td>
                    <td className="p-3 text-right font-mono">{formatCurrency(entry.gst)}</td>
                    <td className="p-3 text-right font-mono">{formatCurrency(entry.qst)}</td>
                    <td className="p-3 text-right font-mono font-semibold">{formatCurrency(entry.arAmount || "0")}</td>
                    <td className="p-3 text-center">{statusBadge(entry.status)}</td>
                    <td className="p-3 text-center font-mono text-xs">{entry.qboJeId || "—"}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openViewDialog(entry)} title="View Details">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {(entry.status === "failed" || entry.status === "pending") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" onClick={() => openEditDialog(entry)} title="Edit & Repost">
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {entry.status === "posted" && entry.qboJeId && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => {
                            if (confirm("Void this JE in QuickBooks?")) {
                              voidMutation.mutate({ id: entry.id });
                            }
                          }} title="Void JE">
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({data?.total} entries)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Journal Entry Details</DialogTitle>
            <DialogDescription>
              {selectedEntry?.docNumber} — {formatDate(selectedEntry?.saleDate)}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Location:</span> <strong>{selectedEntry.locationName}</strong></div>
                <div><span className="text-muted-foreground">Status:</span> {statusBadge(selectedEntry.status)}</div>
                <div><span className="text-muted-foreground">QBO JE ID:</span> <strong>{selectedEntry.qboJeId || "—"}</strong></div>
                <div><span className="text-muted-foreground">Realm:</span> <strong className="font-mono text-xs">{selectedEntry.realmId}</strong></div>
              </div>
              <Separator />
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Line Amounts</h4>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Line</th>
                      <th className="text-right p-2">Debit</th>
                      <th className="text-right p-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-2">Accounts Receivable</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.arAmount || "0")}</td>
                      <td className="p-2 text-right">—</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2">Tax-Exempt Sales</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.taxExemptSales || "0")}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2">Taxable Sales</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.taxableSales || "0")}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2">GST Payable</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.gst || "0")}</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-2">QST Payable</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.qst || "0")}</td>
                    </tr>
                    {parseFloat(selectedEntry.pettyCash || "0") > 0 && (
                      <tr className="border-t">
                        <td className="p-2">Petty Cash</td>
                        <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.pettyCash)}</td>
                        <td className="p-2 text-right">—</td>
                      </tr>
                    )}
                    <tr className="border-t">
                      <td className="p-2">Tips Payable</td>
                      <td className="p-2 text-right">—</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(selectedEntry.tips || "0")}</td>
                    </tr>
                    {parseFloat(selectedEntry.roundingAdj || "0") !== 0 && (
                      <tr className="border-t bg-yellow-50 dark:bg-yellow-900/20">
                        <td className="p-2">Rounding Adjustment</td>
                        <td className="p-2 text-right font-mono">
                          {parseFloat(selectedEntry.roundingAdj) < 0 ? formatCurrency(Math.abs(parseFloat(selectedEntry.roundingAdj))) : "—"}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {parseFloat(selectedEntry.roundingAdj) > 0 ? formatCurrency(parseFloat(selectedEntry.roundingAdj)) : "—"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {selectedEntry.errorMessage && (
                <>
                  <Separator />
                  <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm">
                    <p className="font-semibold text-red-700 dark:text-red-300 mb-1">Error Message:</p>
                    <p className="text-red-600 dark:text-red-400 font-mono text-xs">{selectedEntry.errorMessage}</p>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit & Repost Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit & Repost Journal Entry</DialogTitle>
            <DialogDescription>
              {selectedEntry?.docNumber} — {formatDate(selectedEntry?.saleDate)} — {selectedEntry?.locationName}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              {selectedEntry.errorMessage && (
                <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm">
                  <p className="font-semibold text-red-700 dark:text-red-300 mb-1">Previous Error:</p>
                  <p className="text-red-600 dark:text-red-400 font-mono text-xs">{selectedEntry.errorMessage}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">AR Amount (Debit)</Label>
                  <Input value={editForm.arAmount} onChange={(e) => setEditForm(f => ({ ...f, arAmount: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Petty Cash (Debit)</Label>
                  <Input value={editForm.pettyCash} onChange={(e) => setEditForm(f => ({ ...f, pettyCash: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Tax-Exempt Sales (Credit)</Label>
                  <Input value={editForm.taxExemptSales} onChange={(e) => setEditForm(f => ({ ...f, taxExemptSales: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Taxable Sales (Credit)</Label>
                  <Input value={editForm.taxableSales} onChange={(e) => setEditForm(f => ({ ...f, taxableSales: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">GST (Credit)</Label>
                  <Input value={editForm.gst} onChange={(e) => setEditForm(f => ({ ...f, gst: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">QST (Credit)</Label>
                  <Input value={editForm.qst} onChange={(e) => setEditForm(f => ({ ...f, qst: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Tips (Credit)</Label>
                  <Input value={editForm.tips} onChange={(e) => setEditForm(f => ({ ...f, tips: e.target.value }))} />
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-muted-foreground">Total Debits:</span>{" "}
                  <strong className="font-mono">{formatCurrency(editDebits)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Credits:</span>{" "}
                  <strong className="font-mono">{formatCurrency(editCredits)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Diff:</span>{" "}
                  <strong className={`font-mono ${isBalanced ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(Math.abs(editDiff))}
                  </strong>
                </div>
              </div>
              {!isBalanced && Math.abs(editDiff) >= 0.02 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-xs text-yellow-700 dark:text-yellow-300">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  Difference of {formatCurrency(Math.abs(editDiff))} will be posted to Rounding Adjustments account.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRepost} disabled={repostMutation.isPending}>
              {repostMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Posting...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" />Post to QBO</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
