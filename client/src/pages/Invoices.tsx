import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  FileText, CheckCircle2, Clock, XCircle, DollarSign, Filter, Upload, RefreshCw,
  CloudUpload, Plus, AlertTriangle, CloudOff, Eye, Paperclip, Truck, ShieldCheck,
  Download, Trash2, FileUp, X, MapPin, Pencil
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  pending: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-50', icon: Clock },
  approved: { label: 'Approved', color: 'text-blue-700', bg: 'bg-blue-50', icon: CheckCircle2 },
  paid: { label: 'Paid', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
};

/* ─── Invoice Detail Side Panel ─── */
function InvoiceDetailPanel({ invoiceId, onClose, onStatusChange }: {
  invoiceId: number;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const { data: inv, isLoading, refetch } = trpc.invoices.get.useQuery({ id: invoiceId });
  const { data: locationsList } = trpc.locations.list.useQuery();
  const [editingLocation, setEditingLocation] = useState(false);
  const updateLocation = trpc.invoices.updateLocation.useMutation({
    onSuccess: () => {
      refetch();
      onStatusChange();
      setEditingLocation(false);
      toast.success('Location updated');
    },
    onError: (err) => toast.error(`Failed to update location: ${err.message}`),
  });
  const uploadFile = trpc.invoices.uploadFile.useMutation({
    onSuccess: (data, vars) => {
      refetch();
      onStatusChange();
      toast.success(vars.fileType === 'invoice' ? 'Invoice PDF uploaded' : 'Delivery note uploaded');
    },
    onError: (err) => toast.error(`Upload failed: ${err.message}`),
  });
  const removeFile = trpc.invoices.removeFile.useMutation({
    onSuccess: () => { refetch(); toast.success('File removed'); },
    onError: (err) => toast.error(`Remove failed: ${err.message}`),
  });
  const updateStatus = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => { refetch(); onStatusChange(); toast.success('Status updated'); },
  });

  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const deliveryInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File, fileType: 'invoice' | 'deliveryNote') => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Max 10MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      uploadFile.mutate({
        invoiceId,
        fileType,
        fileData: base64,
        fileName: file.name,
        contentType: file.type || 'application/pdf',
      });
    };
    reader.readAsDataURL(file);
  }, [invoiceId, uploadFile]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-muted/50 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-muted/50 rounded animate-pulse w-1/2" />
        <div className="h-64 bg-muted/50 rounded animate-pulse" />
      </div>
    );
  }

  if (!inv) {
    return <div className="p-6 text-muted-foreground">Invoice not found</div>;
  }

  const sc = statusConfig[inv.status || 'pending'] || statusConfig.pending;
  const StatusIcon = sc.icon;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold font-mono">{inv.invoiceNumber || 'No Invoice #'}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{inv.supplierName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={`${sc.bg} ${sc.color} text-xs`}>
              <StatusIcon className="h-3 w-3 mr-1" /> {sc.label}
            </Badge>
            {inv.autoApproved && (
              <Badge variant="secondary" className="bg-violet-50 text-violet-700 text-xs">
                <ShieldCheck className="h-3 w-3 mr-1" /> Auto-Approved
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-6 pt-2">
            <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Details</TabsTrigger>
            <TabsTrigger value="invoice-pdf" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Invoice PDF {inv.fileUrl && <CheckCircle2 className="h-3 w-3 ml-1 text-emerald-600" />}
            </TabsTrigger>
            <TabsTrigger value="delivery-note" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">
              Delivery Note {inv.deliveryNoteUrl && <CheckCircle2 className="h-3 w-3 ml-1 text-emerald-600" />}
            </TabsTrigger>
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Location</p>
                {editingLocation ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={inv.locationId ? String(inv.locationId) : ""}
                      onValueChange={(v) => {
                        updateLocation.mutate({ id: invoiceId, locationId: parseInt(v) });
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {(locationsList as any[] || []).map((l: any) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs text-muted-foreground"
                      onClick={() => setEditingLocation(false)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {inv.locationName === 'Unknown' || !inv.locationId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100 font-medium"
                        onClick={() => setEditingLocation(true)}
                      >
                        <MapPin className="h-3.5 w-3.5 mr-1.5" /> Assign Location
                      </Button>
                    ) : (
                      <>
                        <p className="text-sm font-medium">{inv.locationName}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground border-dashed"
                          onClick={() => setEditingLocation(true)}
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Change
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">GL Account</p>
                <p className="text-sm font-medium">{inv.glAccount || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Invoice Date</p>
                <p className="text-sm font-medium">
                  {inv.invoiceDate ? new Date(String(inv.invoiceDate)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                <p className="text-sm font-medium">
                  {inv.dueDate ? new Date(String(inv.dueDate)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                </p>
              </div>
            </div>

            <Separator />

            {/* Financial Summary */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(Number(inv.subtotal))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">GST (5%)</span>
                <span>{formatCurrency(Number(inv.gst))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">QST (9.975%)</span>
                <span>{formatCurrency(Number(inv.qst))}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm font-bold">
                <span>Total</span>
                <span className="text-lg">{formatCurrency(Number(inv.total))}</span>
              </div>
            </div>

            {/* Line Items */}
            {inv.lineItems && inv.lineItems.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold mb-3">Line Items</h4>
                  <div className="space-y-2">
                    {inv.lineItems.map((li: any) => (
                      <div key={li.id} className="flex justify-between items-center text-sm bg-muted/20 rounded-lg px-3 py-2">
                        <div>
                          <span className="font-medium">{li.description || li.productCode}</span>
                          {li.quantity && <span className="text-muted-foreground ml-2">x{li.quantity}</span>}
                        </div>
                        <span className="font-medium">{formatCurrency(Number(li.total || li.amount || 0))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            {inv.notes && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold mb-1">Notes</h4>
                  <p className="text-sm text-muted-foreground">{inv.notes}</p>
                </div>
              </>
            )}

            {/* QBO Sync Status */}
            <Separator />
            <div>
              <h4 className="text-sm font-semibold mb-2">QuickBooks Sync</h4>
              <div className="flex items-center gap-2">
                {inv.qboSyncStatus === 'synced' || inv.qboSynced ? (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Synced
                    {inv.qboBillId && <span className="ml-1 opacity-70">#{inv.qboBillId}</span>}
                  </Badge>
                ) : inv.qboSyncStatus === 'failed' ? (
                  <Badge variant="secondary" className="bg-red-50 text-red-700 text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Failed
                  </Badge>
                ) : inv.qboSyncStatus === 'pending' ? (
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs animate-pulse">
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Syncing
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-slate-50 text-slate-600 text-xs">
                    <CloudOff className="h-3 w-3 mr-1" /> Not Synced
                  </Badge>
                )}
              </div>
              {inv.qboSyncError && (
                <p className="text-xs text-red-600 mt-1">{inv.qboSyncError}</p>
              )}
            </div>

            {/* Document Status */}
            <Separator />
            <div>
              <h4 className="text-sm font-semibold mb-2">Documents</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 text-center ${inv.fileUrl ? 'border-emerald-200 bg-emerald-50/50' : 'border-dashed border-muted-foreground/30'}`}>
                  <FileText className={`h-5 w-5 mx-auto mb-1 ${inv.fileUrl ? 'text-emerald-600' : 'text-muted-foreground/50'}`} />
                  <p className="text-xs font-medium">{inv.fileUrl ? 'Invoice PDF' : 'No Invoice PDF'}</p>
                  <p className="text-[10px] text-muted-foreground">{inv.fileUrl ? 'Uploaded' : 'Not uploaded'}</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${inv.deliveryNoteUrl ? 'border-emerald-200 bg-emerald-50/50' : 'border-dashed border-muted-foreground/30'}`}>
                  <Truck className={`h-5 w-5 mx-auto mb-1 ${inv.deliveryNoteUrl ? 'text-emerald-600' : 'text-muted-foreground/50'}`} />
                  <p className="text-xs font-medium">{inv.deliveryNoteUrl ? 'Delivery Note' : 'No Delivery Note'}</p>
                  <p className="text-[10px] text-muted-foreground">{inv.deliveryNoteUrl ? 'Uploaded' : 'Not uploaded'}</p>
                </div>
              </div>
              {inv.status === 'pending' && !inv.fileUrl && !inv.deliveryNoteUrl && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Upload both invoice PDF and delivery note to auto-approve
                </p>
              )}
            </div>
          </TabsContent>

          {/* Invoice PDF Tab */}
          <TabsContent value="invoice-pdf" className="p-6">
            {inv.fileUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-600" /> Invoice PDF
                  </h4>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => window.open(inv.fileUrl!, '_blank')}>
                      <Download className="h-3 w-3 mr-1" /> Download
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeFile.mutate({ invoiceId: inv.id, fileType: 'invoice' })}
                      disabled={removeFile.isPending}>
                      <Trash2 className="h-3 w-3 mr-1" /> Remove
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden bg-white" style={{ height: '60vh' }}>
                  <iframe src={inv.fileUrl} className="w-full h-full" title="Invoice PDF" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <FileUp className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <h4 className="text-sm font-semibold mb-1">No Invoice PDF Uploaded</h4>
                <p className="text-xs text-muted-foreground mb-4 max-w-xs">
                  Upload the original invoice PDF to review before approving. Supports PDF, JPG, PNG (max 10MB).
                </p>
                <input
                  ref={invoiceInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'invoice');
                    e.target.value = '';
                  }}
                />
                <Button size="sm" onClick={() => invoiceInputRef.current?.click()} disabled={uploadFile.isPending}>
                  {uploadFile.isPending ? (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5 mr-1.5" /> Upload Invoice PDF</>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Delivery Note Tab */}
          <TabsContent value="delivery-note" className="p-6">
            {inv.deliveryNoteUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-emerald-600" /> Delivery Note
                  </h4>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => window.open(inv.deliveryNoteUrl!, '_blank')}>
                      <Download className="h-3 w-3 mr-1" /> Download
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => removeFile.mutate({ invoiceId: inv.id, fileType: 'deliveryNote' })}
                      disabled={removeFile.isPending}>
                      <Trash2 className="h-3 w-3 mr-1" /> Remove
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden bg-white" style={{ height: '60vh' }}>
                  <iframe src={inv.deliveryNoteUrl} className="w-full h-full" title="Delivery Note" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <Truck className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <h4 className="text-sm font-semibold mb-1">No Delivery Note Uploaded</h4>
                <p className="text-xs text-muted-foreground mb-4 max-w-xs">
                  Upload the delivery note or receiving slip to match against the invoice. Supports PDF, JPG, PNG (max 10MB).
                </p>
                <input
                  ref={deliveryInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, 'deliveryNote');
                    e.target.value = '';
                  }}
                />
                <Button size="sm" onClick={() => deliveryInputRef.current?.click()} disabled={uploadFile.isPending}>
                  {uploadFile.isPending ? (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5 mr-1.5" /> Upload Delivery Note</>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer Actions */}
      <div className="border-t p-4 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          {inv.fileUrl && (
            <Badge variant="outline" className="text-xs gap-1"><Paperclip className="h-3 w-3" /> Invoice</Badge>
          )}
          {inv.deliveryNoteUrl && (
            <Badge variant="outline" className="text-xs gap-1"><Truck className="h-3 w-3" /> Delivery</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {inv.status === 'pending' && (
            <>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => updateStatus.mutate({ id: inv.id, status: 'rejected' })}
                disabled={updateStatus.isPending}>
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => updateStatus.mutate({ id: inv.id, status: 'approved' })}
                disabled={updateStatus.isPending}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
              </Button>
            </>
          )}
          {inv.status === 'approved' && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => updateStatus.mutate({ id: inv.id, status: 'paid' })}
              disabled={updateStatus.isPending}>
              <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Mark Paid
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Inline Location Picker (for table rows) ─── */
function InlineLocationPicker({ invoiceId, locations, onUpdated }: {
  invoiceId: number;
  locations: { id: number; name: string }[];
  onUpdated: () => void;
}) {
  const updateLocation = trpc.invoices.updateLocation.useMutation({
    onSuccess: () => {
      onUpdated();
      toast.success('Location assigned');
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  return (
    <Select
      onValueChange={(v) => {
        updateLocation.mutate({ id: invoiceId, locationId: parseInt(v) });
      }}
    >
      <SelectTrigger className="h-7 w-[140px] text-xs border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
        <MapPin className="h-3 w-3 mr-1 shrink-0" />
        <SelectValue placeholder="Assign..." />
      </SelectTrigger>
      <SelectContent>
        {locations.map((l) => (
          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ─── Main Invoices Page ─── */
export default function Invoices() {
  const [filter, setFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ done: 0, total: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [newInv, setNewInv] = useState({ invoiceNumber: '', supplierId: '', locationId: '', invoiceDate: '', dueDate: '', subtotal: '', glAccount: '', notes: '' });

  const { data: invoices, isLoading, refetch } = trpc.invoices.list.useQuery(
    filter === "all" ? undefined : { status: filter }
  );
  const { data: qboStatus } = trpc.qbo.status.useQuery();
  const { data: suppliersList } = trpc.suppliers.list.useQuery();
  const { data: locationsList } = trpc.locations.list.useQuery();

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => { refetch(); setCreateOpen(false); setNewInv({ invoiceNumber: '', supplierId: '', locationId: '', invoiceDate: '', dueDate: '', subtotal: '', glAccount: '', notes: '' }); toast.success("Invoice created"); },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const handleCreateInvoice = () => {
    const sub = parseFloat(newInv.subtotal) || 0;
    const gst = +(sub * 0.05).toFixed(2);
    const qst = +(sub * 0.09975).toFixed(2);
    const total = +(sub + gst + qst).toFixed(2);
    createInvoice.mutate({
      invoiceNumber: newInv.invoiceNumber || undefined,
      supplierId: newInv.supplierId ? parseInt(newInv.supplierId) : undefined,
      locationId: newInv.locationId ? parseInt(newInv.locationId) : undefined,
      invoiceDate: newInv.invoiceDate || undefined,
      dueDate: newInv.dueDate || undefined,
      subtotal: sub.toFixed(2),
      gst: gst.toFixed(2),
      qst: qst.toFixed(2),
      total: total.toFixed(2),
      glAccount: newInv.glAccount || undefined,
      notes: newInv.notes || undefined,
    });
  };

  const updateStatus = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success("Invoice status updated"); },
  });

  const syncInvoice = trpc.qbo.syncInvoice.useMutation({
    onSuccess: (data, variables) => {
      setSyncingIds(prev => { const n = new Set(prev); n.delete(variables.invoiceId); return n; });
      refetch();
      toast.success(`Invoice synced to QBO (Bill ID: ${data.qboBillId})`);
    },
    onError: (err, variables) => {
      setSyncingIds(prev => { const n = new Set(prev); n.delete(variables.invoiceId); return n; });
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const handleSyncOne = (invoiceId: number) => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    setSyncingIds(prev => new Set(prev).add(invoiceId));
    syncInvoice.mutate({ invoiceId });
  };

  const handleBulkSync = async () => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    const unsyncedApproved = invoices?.filter(i => !i.qboSynced && (i as any).qboSyncStatus !== 'synced' && (i as any).qboSyncStatus !== 'failed' && (i.status === 'approved' || i.status === 'paid')) || [];
    if (unsyncedApproved.length === 0) {
      toast.info("No unsynced approved/paid invoices to push.");
      return;
    }
    setBulkSyncing(true);
    let success = 0;
    let failed = 0;
    for (const inv of unsyncedApproved) {
      try {
        await syncInvoice.mutateAsync({ invoiceId: inv.id });
        success++;
      } catch {
        failed++;
      }
    }
    setBulkSyncing(false);
    refetch();
    toast.success(`Bulk sync complete: ${success} synced, ${failed} failed`);
  };

  const handleRetryAllFailed = async () => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    const failedInvoices = invoices?.filter(i => (i as any).qboSyncStatus === 'failed') || [];
    if (failedInvoices.length === 0) {
      toast.info("No failed syncs to retry.");
      return;
    }
    setRetryingFailed(true);
    setRetryProgress({ done: 0, total: failedInvoices.length });
    let success = 0;
    let stillFailed = 0;
    for (let idx = 0; idx < failedInvoices.length; idx++) {
      const inv = failedInvoices[idx];
      setSyncingIds(prev => new Set(prev).add(inv.id));
      try {
        await syncInvoice.mutateAsync({ invoiceId: inv.id });
        success++;
      } catch {
        stillFailed++;
      }
      setSyncingIds(prev => { const n = new Set(prev); n.delete(inv.id); return n; });
      setRetryProgress({ done: idx + 1, total: failedInvoices.length });
    }
    setRetryingFailed(false);
    refetch();
    if (stillFailed === 0) {
      toast.success(`All ${success} previously failed invoices synced successfully!`);
    } else {
      toast.warning(`Retry complete: ${success} synced, ${stillFailed} still failing`);
    }
  };

  const unknownCount = useMemo(() => {
    if (!invoices) return 0;
    return invoices.filter(i => i.locationName === 'Unknown').length;
  }, [invoices]);

  const filtered = useMemo(() => {
    if (!invoices) return [];
    let result = invoices;
    if (locationFilter === 'unknown') {
      result = result.filter(inv => inv.locationName === 'Unknown');
    } else if (locationFilter !== 'all') {
      result = result.filter(inv => inv.locationName === locationFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(inv =>
        inv.invoiceNumber?.toLowerCase().includes(q) ||
        inv.supplierName?.toLowerCase().includes(q) ||
        inv.locationName?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [invoices, search, locationFilter]);

  const totals = useMemo(() => {
    if (!invoices) return { pending: 0, approved: 0, paid: 0, total: 0, synced: 0, unsynced: 0, failed: 0 };
    return {
      pending: invoices.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.total), 0),
      approved: invoices.filter(i => i.status === 'approved').reduce((s, i) => s + Number(i.total), 0),
      paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0),
      total: invoices.reduce((s, i) => s + Number(i.total), 0),
      synced: invoices.filter(i => i.qboSynced || (i as any).qboSyncStatus === 'synced').length,
      unsynced: invoices.filter(i => !i.qboSynced && (i as any).qboSyncStatus !== 'synced' && (i as any).qboSyncStatus !== 'failed' && (i.status === 'approved' || i.status === 'paid')).length,
      failed: invoices.filter(i => (i as any).qboSyncStatus === 'failed').length,
    };
  }, [invoices]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices & Accounts Payable</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage supplier bills, approvals, and QuickBooks sync. Click any invoice to review PDF and delivery note.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1.5" /> New Invoice</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Invoice #</Label><Input value={newInv.invoiceNumber} onChange={e => setNewInv(p => ({...p, invoiceNumber: e.target.value}))} placeholder="INV-001" /></div>
                <div><Label className="text-xs">Supplier</Label>
                  <Select value={newInv.supplierId} onValueChange={v => setNewInv(p => ({...p, supplierId: v}))}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>{suppliersList?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Location</Label>
                  <Select value={newInv.locationId} onValueChange={v => setNewInv(p => ({...p, locationId: v}))}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>{locationsList?.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Invoice Date</Label><Input type="date" value={newInv.invoiceDate} onChange={e => setNewInv(p => ({...p, invoiceDate: e.target.value}))} /></div>
                <div><Label className="text-xs">Due Date</Label><Input type="date" value={newInv.dueDate} onChange={e => setNewInv(p => ({...p, dueDate: e.target.value}))} /></div>
                <div><Label className="text-xs">Subtotal (before tax)</Label><Input type="number" step="0.01" value={newInv.subtotal} onChange={e => setNewInv(p => ({...p, subtotal: e.target.value}))} placeholder="0.00" /></div>
                <div><Label className="text-xs">GL Account</Label><Input value={newInv.glAccount} onChange={e => setNewInv(p => ({...p, glAccount: e.target.value}))} placeholder="5100 - COGS" /></div>
                <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={newInv.notes} onChange={e => setNewInv(p => ({...p, notes: e.target.value}))} placeholder="Optional notes" /></div>
                {newInv.subtotal && <div className="col-span-2 bg-muted/50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(parseFloat(newInv.subtotal) || 0)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>GST (5%):</span><span>{formatCurrency((parseFloat(newInv.subtotal) || 0) * 0.05)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>QST (9.975%):</span><span>{formatCurrency((parseFloat(newInv.subtotal) || 0) * 0.09975)}</span></div>
                  <div className="flex justify-between font-bold border-t mt-1 pt-1"><span>Total:</span><span>{formatCurrency((parseFloat(newInv.subtotal) || 0) * 1.14975)}</span></div>
                </div>}
                <div className="col-span-2 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateInvoice} disabled={createInvoice.isPending}>{createInvoice.isPending ? 'Creating...' : 'Create Invoice'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {qboStatus?.connected ? (
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 mr-1" /> QBO Connected
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-red-50 text-red-700">
              <XCircle className="h-3 w-3 mr-1" /> QBO Disconnected
            </Badge>
          )}
          {totals.unsynced > 0 && qboStatus?.connected && (
            <Button size="sm" onClick={handleBulkSync} disabled={bulkSyncing || retryingFailed}>
              {bulkSyncing ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing...</>
              ) : (
                <><CloudUpload className="h-3.5 w-3.5 mr-1.5" /> Sync All to QBO ({totals.unsynced})</>
              )}
            </Button>
          )}
          {totals.failed > 0 && qboStatus?.connected && (
            <Button size="sm" variant="destructive" onClick={handleRetryAllFailed} disabled={retryingFailed || bulkSyncing}>
              {retryingFailed ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Retrying {retryProgress.done}/{retryProgress.total}...</>
              ) : (
                <><AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> Retry All Failed ({totals.failed})</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold">{formatCurrency(totals.pending)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Approved</p>
                <p className="text-lg font-bold">{formatCurrency(totals.approved)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-lg font-bold">{formatCurrency(totals.paid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-50 flex items-center justify-center">
                <FileText className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total ({invoices?.length || 0})</p>
                <p className="text-lg font-bold">{formatCurrency(totals.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-50 flex items-center justify-center">
                <Upload className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">QBO Synced</p>
                <p className="text-lg font-bold">{totals.synced} / {invoices?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className={`w-[180px] ${locationFilter === 'unknown' ? 'border-amber-300 bg-amber-50' : ''}`}>
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            <SelectItem value="unknown">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-amber-600" /> Unknown ({unknownCount})
              </span>
            </SelectItem>
            {(locationsList as any[] || []).map((l: any) => (
              <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Supplier</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Docs</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">QBO</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">Loading invoices...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No invoices found</td></tr>
                ) : filtered.map(inv => {
                  const sc = statusConfig[inv.status || 'pending'] || statusConfig.pending;
                  const isSyncing = syncingIds.has(inv.id);
                  const hasInvoicePdf = !!(inv as any).fileUrl;
                  const hasDeliveryNote = !!(inv as any).deliveryNoteUrl;
                  return (
                    <tr key={inv.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedInvoiceId(inv.id)}>
                      <td className="py-3 px-4 font-medium font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="py-3 px-4">{inv.supplierName}</td>
                      <td className="py-3 px-4" onClick={inv.locationName === 'Unknown' ? (e) => { e.stopPropagation(); } : undefined}>
                        {inv.locationName === 'Unknown' ? (
                          <InlineLocationPicker
                            invoiceId={inv.id}
                            locations={locationsList as any[] || []}
                            onUpdated={refetch}
                          />
                        ) : (
                          <span className="text-muted-foreground">{inv.locationName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{inv.invoiceDate ? new Date(String(inv.invoiceDate)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(inv.total))}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={hasInvoicePdf ? 'text-emerald-600' : 'text-muted-foreground/30'}>
                                  <FileText className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {hasInvoicePdf ? 'Invoice PDF attached' : 'No invoice PDF'}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={hasDeliveryNote ? 'text-emerald-600' : 'text-muted-foreground/30'}>
                                  <Truck className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {hasDeliveryNote ? 'Delivery note attached' : 'No delivery note'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="secondary" className={`${sc.bg} ${sc.color} text-xs`}>
                          {sc.label}
                          {(inv as any).autoApproved && <ShieldCheck className="h-3 w-3 ml-1" />}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <TooltipProvider delayDuration={200}>
                          {(inv as any).qboSyncStatus === 'synced' || inv.qboSynced ? (
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> Synced
                            </Badge>
                          ) : (inv as any).qboSyncStatus === 'failed' ? (
                            <Badge variant="secondary" className="bg-red-50 text-red-700 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-0.5" /> Failed
                            </Badge>
                          ) : (inv as any).qboSyncStatus === 'pending' || isSyncing ? (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs animate-pulse">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            </Badge>
                          ) : (inv.status === 'approved' || inv.status === 'paid') && qboStatus?.connected ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-6 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-2"
                                  onClick={(e) => { e.stopPropagation(); handleSyncOne(inv.id); }}>
                                  <Upload className="h-3 w-3 mr-1" /> Push
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">Push to QuickBooks</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground/30"><CloudOff className="h-3.5 w-3.5 inline" /></span>
                          )}
                        </TooltipProvider>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => setSelectedInvoiceId(inv.id)}>
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                          {inv.status === 'pending' && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => updateStatus.mutate({ id: inv.id, status: 'approved' })}>
                                Approve
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => updateStatus.mutate({ id: inv.id, status: 'rejected' })}>
                                Reject
                              </Button>
                            </>
                          )}
                          {inv.status === 'approved' && (
                            <Button size="sm" variant="ghost" className="h-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              onClick={() => updateStatus.mutate({ id: inv.id, status: 'paid' })}>
                              Mark Paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Side Panel */}
      <Sheet open={!!selectedInvoiceId} onOpenChange={(open) => { if (!open) setSelectedInvoiceId(null); }}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 overflow-hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Invoice Details</SheetTitle>
          </SheetHeader>
          {selectedInvoiceId && (
            <InvoiceDetailPanel
              invoiceId={selectedInvoiceId}
              onClose={() => setSelectedInvoiceId(null)}
              onStatusChange={() => refetch()}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
