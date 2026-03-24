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
import { Switch } from "@/components/ui/switch";
import {
  FileText, CheckCircle2, Clock, XCircle, DollarSign, Filter,
  Plus, Eye, ArrowRight, CreditCard, AlertCircle, FileUp, Trash2,
  Banknote, Receipt, CalendarClock, Building2
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

const quotStatusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft: { label: 'Draft', color: 'text-slate-700', bg: 'bg-slate-50', icon: FileText },
  pending_advance: { label: 'Pending Advance', color: 'text-amber-700', bg: 'bg-amber-50', icon: CreditCard },
  advance_paid: { label: 'Advance Paid', color: 'text-blue-700', bg: 'bg-blue-50', icon: CheckCircle2 },
  accepted: { label: 'Accepted', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  converted: { label: 'Converted to Invoice', color: 'text-violet-700', bg: 'bg-violet-50', icon: ArrowRight },
  expired: { label: 'Expired', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
};

const advanceStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
  not_required: { label: 'Not Required', color: 'text-slate-500', bg: 'bg-slate-50' },
  unpaid: { label: 'Unpaid', color: 'text-red-700', bg: 'bg-red-50' },
  paid: { label: 'Paid', color: 'text-emerald-700', bg: 'bg-emerald-50' },
};

/* ─── Quotation Detail Side Panel ─── */
function QuotationDetailPanel({ quotationId, onClose, onStatusChange }: {
  quotationId: number;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const { data: quot, isLoading, refetch } = trpc.quotations.get.useQuery({ id: quotationId });
  const updateStatus = trpc.quotations.updateStatus.useMutation({
    onSuccess: () => { refetch(); onStatusChange(); toast.success('Status updated'); },
  });
  const markAdvancePaid = trpc.quotations.markAdvancePaid.useMutation({
    onSuccess: () => { refetch(); onStatusChange(); toast.success('Advance marked as paid'); },
  });
  const markAdvanceUnpaid = trpc.quotations.markAdvanceUnpaid.useMutation({
    onSuccess: () => { refetch(); onStatusChange(); toast.success('Advance marked as unpaid'); },
  });
  const convertToInvoice = trpc.quotations.convertToInvoice.useMutation({
    onSuccess: (data) => {
      refetch();
      onStatusChange();
      toast.success(`Converted to Invoice #${data.invoiceId}`);
    },
    onError: (err) => toast.error(`Conversion failed: ${err.message}`),
  });
  const uploadFile = trpc.quotations.uploadFile.useMutation({
    onSuccess: () => { refetch(); toast.success('Quotation PDF uploaded'); },
    onError: (err) => toast.error(`Upload failed: ${err.message}`),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [paymentRef, setPaymentRef] = useState('');

  const handleFileUpload = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Max 10MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      uploadFile.mutate({
        quotationId,
        fileData: base64,
        fileName: file.name,
        contentType: file.type || 'application/pdf',
      });
    };
    reader.readAsDataURL(file);
  }, [quotationId, uploadFile]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-muted/50 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-muted/50 rounded animate-pulse w-1/2" />
        <div className="h-64 bg-muted/50 rounded animate-pulse" />
      </div>
    );
  }

  if (!quot) {
    return <div className="p-6 text-muted-foreground">Quotation not found</div>;
  }

  const sc = quotStatusConfig[quot.status || 'draft'] || quotStatusConfig.draft;
  const advSc = advanceStatusConfig[quot.advancePaidStatus || 'not_required'] || advanceStatusConfig.not_required;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold font-mono">{quot.quotationNumber || 'No Quotation #'}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{quot.supplierName} — {quot.locationName}</p>
          </div>
          <Badge variant="secondary" className={`${sc.bg} ${sc.color} text-xs`}>{sc.label}</Badge>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="details" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-6 pt-2">
            <TabsTrigger value="details" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">Details</TabsTrigger>
            <TabsTrigger value="advance" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
              Advance Payment
              {quot.advanceRequired && (
                <span className={`ml-1.5 h-2 w-2 rounded-full inline-block ${quot.advancePaidStatus === 'paid' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              )}
            </TabsTrigger>
            <TabsTrigger value="document" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
              Document
              {quot.fileUrl && <span className="ml-1.5 h-2 w-2 rounded-full inline-block bg-emerald-500" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Quotation Date</p>
                <p className="text-sm font-medium">{quot.quotationDate ? new Date(String(quot.quotationDate)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Expiry Date</p>
                <p className="text-sm font-medium">{quot.expiryDate ? new Date(String(quot.expiryDate)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">GL Account</p>
                <p className="text-sm font-medium">{quot.glAccount || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Advance Required</p>
                <p className="text-sm font-medium">{quot.advanceRequired ? 'Yes' : 'No'}</p>
              </div>
            </div>

            <Separator />

            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(Number(quot.subtotal))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">GST (5%)</span><span>{formatCurrency(Number(quot.gst))}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">QST (9.975%)</span><span>{formatCurrency(Number(quot.qst))}</span></div>
              <Separator />
              <div className="flex justify-between text-sm font-bold"><span>Total</span><span>{formatCurrency(Number(quot.total))}</span></div>
              {quot.advanceRequired && (
                <div className="flex justify-between text-sm font-medium text-amber-700 pt-1 border-t">
                  <span>Advance Amount</span>
                  <span>{formatCurrency(Number(quot.advanceAmount))}</span>
                </div>
              )}
            </div>

            {quot.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{quot.notes}</p>
                </div>
              </>
            )}

            {quot.convertedInvoiceId && (
              <>
                <Separator />
                <div className="bg-violet-50 rounded-lg p-4 flex items-center gap-3">
                  <ArrowRight className="h-5 w-5 text-violet-600" />
                  <div>
                    <p className="text-sm font-medium text-violet-700">Converted to Invoice</p>
                    <p className="text-xs text-violet-600">Invoice ID: #{quot.convertedInvoiceId}</p>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="advance" className="p-6 space-y-4">
            {!quot.advanceRequired ? (
              <div className="text-center py-12 text-muted-foreground">
                <Banknote className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No advance payment required for this quotation.</p>
              </div>
            ) : (
              <>
                <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Advance Amount</span>
                    <span className="text-lg font-bold">{formatCurrency(Number(quot.advanceAmount))}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Payment Status</span>
                    <Badge variant="secondary" className={`${advSc.bg} ${advSc.color} text-xs`}>{advSc.label}</Badge>
                  </div>
                  {quot.advancePaidAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Paid On</span>
                      <span className="text-sm">{new Date(quot.advancePaidAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  )}
                  {quot.advancePaymentRef && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Payment Reference</span>
                      <span className="text-sm font-mono">{quot.advancePaymentRef}</span>
                    </div>
                  )}
                </div>

                <Separator />

                {quot.advancePaidStatus === 'unpaid' ? (
                  <div className="space-y-3">
                    <Label className="text-xs">Payment Reference (optional)</Label>
                    <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="e.g., CHQ-1234, E-Transfer #567" />
                    <Button className="w-full" onClick={() => markAdvancePaid.mutate({ id: quotationId, paymentRef: paymentRef || undefined })}
                      disabled={markAdvancePaid.isPending}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {markAdvancePaid.isPending ? 'Updating...' : 'Mark Advance as Paid'}
                    </Button>
                  </div>
                ) : quot.advancePaidStatus === 'paid' ? (
                  <Button variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => markAdvanceUnpaid.mutate({ id: quotationId })}
                    disabled={markAdvanceUnpaid.isPending}>
                    <XCircle className="h-4 w-4 mr-2" />
                    {markAdvanceUnpaid.isPending ? 'Updating...' : 'Revert to Unpaid'}
                  </Button>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="document" className="p-6 space-y-4">
            {quot.fileUrl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Quotation Document</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <a href={quot.fileUrl} target="_blank" rel="noopener noreferrer">
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> Open
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="border rounded-lg overflow-hidden bg-muted/20" style={{ height: '500px' }}>
                  <iframe src={quot.fileUrl} className="w-full h-full" title="Quotation PDF" />
                </div>
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed rounded-lg">
                <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground mb-3">No document attached</p>
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}
                  disabled={uploadFile.isPending}>
                  <FileUp className="h-3.5 w-3.5 mr-1.5" />
                  {uploadFile.isPending ? 'Uploading...' : 'Upload Quotation PDF'}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t bg-muted/10 flex items-center gap-2 flex-wrap">
        {quot.status === 'draft' && (
          <>
            <Button size="sm" onClick={() => updateStatus.mutate({ id: quotationId, status: 'accepted' })}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Accept
            </Button>
            <Button size="sm" variant="destructive" onClick={() => updateStatus.mutate({ id: quotationId, status: 'cancelled' })}>
              <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancel
            </Button>
          </>
        )}
        {quot.status === 'pending_advance' && quot.advancePaidStatus === 'paid' && (
          <Button size="sm" onClick={() => updateStatus.mutate({ id: quotationId, status: 'advance_paid' })}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm Advance Paid
          </Button>
        )}
        {(quot.status === 'accepted' || quot.status === 'advance_paid') && !quot.convertedInvoiceId && (
          <Button size="sm" className="bg-violet-600 hover:bg-violet-700"
            onClick={() => convertToInvoice.mutate({ id: quotationId })}
            disabled={convertToInvoice.isPending}>
            <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
            {convertToInvoice.isPending ? 'Converting...' : 'Convert to Invoice'}
          </Button>
        )}
        {quot.status === 'pending_advance' && quot.advancePaidStatus === 'unpaid' && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> Advance payment must be marked as paid before proceeding.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Main Quotations Page ─── */
export default function Quotations() {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQuotId, setSelectedQuotId] = useState<number | null>(null);
  const [newQuot, setNewQuot] = useState({
    quotationNumber: '', supplierId: '', locationId: '', quotationDate: '', expiryDate: '',
    subtotal: '', advanceRequired: false, advanceAmount: '', glAccount: '', notes: ''
  });

  const { data: quotations, isLoading, refetch } = trpc.quotations.list.useQuery(
    filter === "all" ? undefined : { status: filter }
  );
  const { data: suppliersList } = trpc.suppliers.list.useQuery();
  const { data: locationsList } = trpc.locations.list.useQuery();
  const { data: counts } = trpc.quotations.counts.useQuery();

  const createQuotation = trpc.quotations.create.useMutation({
    onSuccess: () => {
      refetch();
      setCreateOpen(false);
      setNewQuot({ quotationNumber: '', supplierId: '', locationId: '', quotationDate: '', expiryDate: '', subtotal: '', advanceRequired: false, advanceAmount: '', glAccount: '', notes: '' });
      toast.success("Quotation created");
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  });

  const handleCreate = () => {
    const sub = parseFloat(newQuot.subtotal) || 0;
    const gst = +(sub * 0.05).toFixed(2);
    const qst = +(sub * 0.09975).toFixed(2);
    const total = +(sub + gst + qst).toFixed(2);
    createQuotation.mutate({
      quotationNumber: newQuot.quotationNumber || undefined,
      supplierId: newQuot.supplierId ? parseInt(newQuot.supplierId) : undefined,
      locationId: newQuot.locationId ? parseInt(newQuot.locationId) : undefined,
      quotationDate: newQuot.quotationDate || undefined,
      expiryDate: newQuot.expiryDate || undefined,
      subtotal: sub.toFixed(2),
      gst: gst.toFixed(2),
      qst: qst.toFixed(2),
      total: total.toFixed(2),
      advanceRequired: newQuot.advanceRequired,
      advanceAmount: newQuot.advanceRequired ? (parseFloat(newQuot.advanceAmount) || 0).toFixed(2) : undefined,
      glAccount: newQuot.glAccount || undefined,
      notes: newQuot.notes || undefined,
    });
  };

  const filtered = useMemo(() => {
    if (!quotations) return [];
    if (!search) return quotations;
    const q = search.toLowerCase();
    return quotations.filter(quot =>
      quot.quotationNumber?.toLowerCase().includes(q) ||
      quot.supplierName?.toLowerCase().includes(q) ||
      quot.locationName?.toLowerCase().includes(q)
    );
  }, [quotations, search]);

  const totals = useMemo(() => {
    if (!quotations) return { draft: 0, pendingAdvance: 0, accepted: 0, converted: 0, total: 0, unpaidAdvances: 0 };
    return {
      draft: quotations.filter(q => q.status === 'draft').length,
      pendingAdvance: quotations.filter(q => q.status === 'pending_advance').length,
      accepted: quotations.filter(q => q.status === 'accepted' || q.status === 'advance_paid').length,
      converted: quotations.filter(q => q.status === 'converted').length,
      total: quotations.reduce((s, q) => s + Number(q.total), 0),
      unpaidAdvances: quotations.filter(q => q.advanceRequired && q.advancePaidStatus === 'unpaid').reduce((s, q) => s + Number(q.advanceAmount), 0),
    };
  }, [quotations]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotations & Proformas</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage supplier quotations, track advance payments, and convert to invoices when ready.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1.5" /> New Quotation</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Quotation</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Quotation #</Label><Input value={newQuot.quotationNumber} onChange={e => setNewQuot(p => ({...p, quotationNumber: e.target.value}))} placeholder="QUO-001" /></div>
              <div><Label className="text-xs">Supplier</Label>
                <Select value={newQuot.supplierId} onValueChange={v => setNewQuot(p => ({...p, supplierId: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>{suppliersList?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Location</Label>
                <Select value={newQuot.locationId} onValueChange={v => setNewQuot(p => ({...p, locationId: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>{locationsList?.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Quotation Date</Label><Input type="date" value={newQuot.quotationDate} onChange={e => setNewQuot(p => ({...p, quotationDate: e.target.value}))} /></div>
              <div><Label className="text-xs">Expiry Date</Label><Input type="date" value={newQuot.expiryDate} onChange={e => setNewQuot(p => ({...p, expiryDate: e.target.value}))} /></div>
              <div><Label className="text-xs">Subtotal (before tax)</Label><Input type="number" step="0.01" value={newQuot.subtotal} onChange={e => setNewQuot(p => ({...p, subtotal: e.target.value}))} placeholder="0.00" /></div>
              <div><Label className="text-xs">GL Account</Label><Input value={newQuot.glAccount} onChange={e => setNewQuot(p => ({...p, glAccount: e.target.value}))} placeholder="5100 - COGS" /></div>

              {/* Advance Payment Toggle */}
              <div className="col-span-2 bg-amber-50/50 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Requires Advance Payment</Label>
                    <p className="text-xs text-muted-foreground">Toggle if supplier requires upfront payment before delivery</p>
                  </div>
                  <Switch checked={newQuot.advanceRequired} onCheckedChange={v => setNewQuot(p => ({...p, advanceRequired: v}))} />
                </div>
                {newQuot.advanceRequired && (
                  <div>
                    <Label className="text-xs">Advance Amount</Label>
                    <Input type="number" step="0.01" value={newQuot.advanceAmount} onChange={e => setNewQuot(p => ({...p, advanceAmount: e.target.value}))} placeholder="0.00" />
                  </div>
                )}
              </div>

              <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={newQuot.notes} onChange={e => setNewQuot(p => ({...p, notes: e.target.value}))} placeholder="Optional notes" /></div>

              {newQuot.subtotal && <div className="col-span-2 bg-muted/50 rounded-lg p-3 text-sm">
                <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(parseFloat(newQuot.subtotal) || 0)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>GST (5%):</span><span>{formatCurrency((parseFloat(newQuot.subtotal) || 0) * 0.05)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>QST (9.975%):</span><span>{formatCurrency((parseFloat(newQuot.subtotal) || 0) * 0.09975)}</span></div>
                <div className="flex justify-between font-bold border-t mt-1 pt-1"><span>Total:</span><span>{formatCurrency((parseFloat(newQuot.subtotal) || 0) * 1.14975)}</span></div>
                {newQuot.advanceRequired && newQuot.advanceAmount && (
                  <div className="flex justify-between text-amber-700 border-t mt-1 pt-1"><span>Advance Due:</span><span>{formatCurrency(parseFloat(newQuot.advanceAmount) || 0)}</span></div>
                )}
              </div>}

              <div className="col-span-2 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createQuotation.isPending}>{createQuotation.isPending ? 'Creating...' : 'Create Quotation'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-50 flex items-center justify-center">
                <FileText className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Draft</p>
                <p className="text-lg font-bold">{totals.draft}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Advance</p>
                <p className="text-lg font-bold">{totals.pendingAdvance}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Accepted</p>
                <p className="text-lg font-bold">{totals.accepted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-50 flex items-center justify-center">
                <ArrowRight className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Converted</p>
                <p className="text-lg font-bold">{totals.converted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-red-50 flex items-center justify-center">
                <Banknote className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unpaid Advances</p>
                <p className="text-lg font-bold">{formatCurrency(totals.unpaidAdvances)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Input placeholder="Search quotations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending_advance">Pending Advance</SelectItem>
            <SelectItem value="advance_paid">Advance Paid</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Quotation #</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Supplier</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Advance</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Loading quotations...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Receipt className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>No quotations found</p>
                    <p className="text-xs mt-1">Create a new quotation to get started</p>
                  </td></tr>
                ) : filtered.map(quot => {
                  const sc = quotStatusConfig[quot.status || 'draft'] || quotStatusConfig.draft;
                  const advSc = advanceStatusConfig[quot.advancePaidStatus || 'not_required'] || advanceStatusConfig.not_required;
                  const StatusIcon = sc.icon;
                  return (
                    <tr key={quot.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedQuotId(quot.id)}>
                      <td className="py-3 px-4 font-medium font-mono text-xs">{quot.quotationNumber || '—'}</td>
                      <td className="py-3 px-4">{quot.supplierName}</td>
                      <td className="py-3 px-4 text-muted-foreground">{quot.locationName}</td>
                      <td className="py-3 px-4 text-muted-foreground">{quot.quotationDate ? new Date(String(quot.quotationDate)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(quot.total))}</td>
                      <td className="py-3 px-4 text-center">
                        {quot.advanceRequired ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className={`${advSc.bg} ${advSc.color} text-xs`}>
                                  {quot.advancePaidStatus === 'paid' ? (
                                    <><CheckCircle2 className="h-3 w-3 mr-0.5" /> {formatCurrency(Number(quot.advanceAmount))}</>
                                  ) : (
                                    <><AlertCircle className="h-3 w-3 mr-0.5" /> {formatCurrency(Number(quot.advanceAmount))}</>
                                  )}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                Advance: {advSc.label}
                                {quot.advancePaymentRef && ` — Ref: ${quot.advancePaymentRef}`}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="secondary" className={`${sc.bg} ${sc.color} text-xs`}>
                          <StatusIcon className="h-3 w-3 mr-0.5" /> {sc.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => setSelectedQuotId(quot.id)}>
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Quotation Detail Side Panel */}
      <Sheet open={!!selectedQuotId} onOpenChange={(open) => { if (!open) setSelectedQuotId(null); }}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl p-0 overflow-hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Quotation Details</SheetTitle>
          </SheetHeader>
          {selectedQuotId && (
            <QuotationDetailPanel
              quotationId={selectedQuotId}
              onClose={() => setSelectedQuotId(null)}
              onStatusChange={() => refetch()}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
