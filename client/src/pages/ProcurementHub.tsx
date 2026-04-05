import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShoppingCart, Package, AlertTriangle, Trash2, Clock, Plus, Check, X,
  RefreshCw, Send, Eye, ChevronRight, Lightbulb, KeyRound, ClipboardList,
  TrendingDown, Boxes, ArrowUpDown
} from "lucide-react";
import { useState, useMemo } from "react";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  submitted: 'bg-indigo-50 text-indigo-700',
  partially_received: 'bg-orange-50 text-orange-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const urgencyColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

type Tab = "orders" | "inventory" | "waste" | "leftovers" | "recommendations" | "pins";

// ─── PIN Entry Dialog ───
function PinDialog({ open, onClose, onVerified, locationId }: {
  open: boolean;
  onClose: () => void;
  onVerified: (pinId: number, role: string) => void;
  locationId?: number;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const verifyMut = trpc.procurement.pins.verify.useMutation();

  if (!open) return null;

  const handleVerify = async () => {
    setError("");
    const result = await verifyMut.mutateAsync({ pin, locationId });
    if (result.valid && result.pinId && result.role) {
      onVerified(result.pinId, result.role);
      setPin("");
      onClose();
    } else {
      setError("Invalid PIN. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <Card className="w-80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Enter PIN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="password"
            placeholder="Enter your PIN..."
            value={pin}
            onChange={e => { setPin(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleVerify()}
            maxLength={8}
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setPin(""); onClose(); }}>Cancel</Button>
            <Button className="flex-1" onClick={handleVerify} disabled={pin.length < 4 || verifyMut.isPending}>
              {verifyMut.isPending ? "Verifying..." : "Verify"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Create PO Dialog ───
function CreatePODialog({ open, onClose, locationId }: {
  open: boolean;
  onClose: () => void;
  locationId: number;
}) {
  const { data: suppliers } = trpc.suppliers.list.useQuery();
  const { data: items } = trpc.inventory.items.useQuery();
  const createMut = trpc.procurement.orders.create.useMutation();
  const utils = trpc.useUtils();

  const [supplierId, setSupplierId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{
    inventoryItemId?: number;
    description: string;
    quantity: string;
    unitPrice: string;
  }>>([{ description: "", quantity: "1", unitPrice: "0" }]);

  if (!open) return null;

  const addLine = () => setLines([...lines, { description: "", quantity: "1", unitPrice: "0" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lines];
    (updated[i] as any)[field] = value;
    setLines(updated);
  };

  const subtotal = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  const handleCreate = async () => {
    if (!supplierId) return;
    await createMut.mutateAsync({
      supplierId: Number(supplierId),
      locationId,
      notes: notes || undefined,
      items: lines.filter(l => l.description),
    });
    utils.procurement.orders.list.invalidate();
    onClose();
  };

  const selectItem = (i: number, itemId: string) => {
    const item = items?.find(it => it.id === Number(itemId));
    if (item) {
      updateLine(i, "inventoryItemId", item.id);
      updateLine(i, "description", item.name);
      updateLine(i, "unitPrice", String(item.lastCost || item.avgCost || "0"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Create Purchase Order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Supplier</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Line Items</label>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Item</Button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <Select onValueChange={v => selectItem(i, v)}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="Select item..." /></SelectTrigger>
                    <SelectContent>
                      {items?.map(it => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input value={line.description} onChange={e => updateLine(i, "description", e.target.value)} placeholder="Description" className="text-xs" />
                </div>
                <div className="col-span-1">
                  <Input value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} placeholder="Qty" className="text-xs text-right" />
                </div>
                <div className="col-span-2">
                  <Input value={line.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)} placeholder="Price" className="text-xs text-right" />
                </div>
                <div className="col-span-1">
                  <Button variant="ghost" size="sm" onClick={() => removeLine(i)} className="text-red-500 h-8 w-8 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="text-right text-sm font-medium">Subtotal: {formatCurrency(subtotal)}</div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!supplierId || lines.length === 0 || createMut.isPending}>
              {createMut.isPending ? "Creating..." : "Create PO"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Waste Report Dialog ───
function WasteReportDialog({ open, onClose, locationId }: {
  open: boolean;
  onClose: () => void;
  locationId: number;
}) {
  const { data: items } = trpc.inventory.items.useQuery();
  const createMut = trpc.procurement.waste.create.useMutation();
  const utils = trpc.useUtils();

  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Array<{
    inventoryItemId: number;
    quantity: string;
    reason: "expired" | "spoiled" | "overproduction" | "damaged" | "quality_issue" | "prep_waste" | "customer_return" | "other";
    notes?: string;
  }>>([]);

  if (!open) return null;

  const addLine = () => setLines([...lines, { inventoryItemId: 0, quantity: "0", reason: "other" }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lines];
    (updated[i] as any)[field] = value;
    setLines(updated);
  };

  const handleSubmit = async () => {
    const validLines = lines.filter(l => l.inventoryItemId > 0 && Number(l.quantity) > 0);
    if (validLines.length === 0) return;
    await createMut.mutateAsync({
      locationId,
      reportDate,
      items: validLines,
    });
    utils.procurement.waste.list.invalidate();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-500" /> Report Waste
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Date</label>
            <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Waste Items</label>
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Item</Button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <Select value={String(line.inventoryItemId || "")} onValueChange={v => updateLine(i, "inventoryItemId", Number(v))}>
                    <SelectTrigger className="text-xs"><SelectValue placeholder="Select item..." /></SelectTrigger>
                    <SelectContent>
                      {items?.map(it => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} placeholder="Qty" className="text-xs text-right" />
                </div>
                <div className="col-span-4">
                  <Select value={line.reason} onValueChange={v => updateLine(i, "reason", v)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["expired", "spoiled", "overproduction", "damaged", "quality_issue", "prep_waste", "customer_return", "other"].map(r => (
                        <SelectItem key={r} value={r}>{r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Button variant="ghost" size="sm" onClick={() => removeLine(i)} className="text-red-500 h-8 w-8 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Click "Add Item" to start logging waste</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={lines.length === 0 || createMut.isPending} className="bg-red-600 hover:bg-red-700">
              {createMut.isPending ? "Submitting..." : "Submit Waste Report"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PROCUREMENT HUB
// ═══════════════════════════════════════════════════════════════════════════════

export default function ProcurementHub() {
  const [tab, setTab] = useState<Tab>("orders");
  const [locationId, setLocationId] = useState<number>(0);
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [showWasteReport, setShowWasteReport] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinAction, setPinAction] = useState<{ type: string; poId?: number } | null>(null);

  const { data: locs } = trpc.locations.list.useQuery();
  const { data: orders } = trpc.procurement.orders.list.useQuery();
  const { data: invLevels } = trpc.procurement.inventory.levels.useQuery(
    { locationId },
    { enabled: locationId > 0 }
  );
  const { data: wasteList } = trpc.procurement.waste.list.useQuery();
  const { data: leftoverList } = trpc.procurement.leftovers.list.useQuery();
  const { data: recos } = trpc.procurement.recommendations.list.useQuery(
    { locationId },
    { enabled: locationId > 0 }
  );
  const { data: pins } = trpc.procurement.pins.list.useQuery();

  const generateRecos = trpc.procurement.recommendations.generate.useMutation();
  const approveMut = trpc.procurement.orders.approve.useMutation();
  const submitMut = trpc.procurement.orders.submitForApproval.useMutation();
  const utils = trpc.useUtils();

  // Set default location
  if (locationId === 0 && locs && locs.length > 0) {
    setLocationId(locs[0].id);
  }

  const pendingApproval = orders?.filter(o => o.status === "pending_approval").length || 0;
  const openOrders = orders?.filter(o => !["received", "cancelled"].includes(o.status || "")).length || 0;
  const lowStockItems = invLevels?.filter(l => {
    const current = Number(l.currentQty);
    const par = Number(l.parLevel || 0);
    return par > 0 && current < par * 0.5;
  }).length || 0;

  const handlePinVerified = async (pinId: number, role: string) => {
    if (!pinAction) return;
    if (pinAction.type === "approve" && pinAction.poId) {
      if (role !== "ops_manager" && role !== "admin") {
        alert("Only Operations Manager or Admin can approve orders.");
        return;
      }
      await approveMut.mutateAsync({ poId: pinAction.poId, pinId });
      utils.procurement.orders.list.invalidate();
    } else if (pinAction.type === "submit" && pinAction.poId) {
      await submitMut.mutateAsync({ poId: pinAction.poId, pinId });
      utils.procurement.orders.list.invalidate();
    }
    setPinAction(null);
  };

  const tabs: Array<{ id: Tab; label: string; icon: any; badge?: number }> = [
    { id: "orders", label: "Purchase Orders", icon: ShoppingCart, badge: pendingApproval },
    { id: "inventory", label: "Stock Levels", icon: Boxes },
    { id: "waste", label: "Waste", icon: Trash2 },
    { id: "leftovers", label: "Leftovers", icon: TrendingDown },
    { id: "recommendations", label: "Smart Order", icon: Lightbulb },
    { id: "pins", label: "PIN Management", icon: KeyRound },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Procurement Hub</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {openOrders} open orders · {pendingApproval} pending approval · {lowStockItems} low stock items
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(locationId)} onValueChange={v => setLocationId(Number(v))}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select location..." />
            </SelectTrigger>
            <SelectContent>
              {locs?.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {t.badge ? (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs ml-1">{t.badge}</Badge>
            ) : null}
          </button>
        ))}
      </div>

      {/* ─── Purchase Orders Tab ─── */}
      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowCreatePO(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Purchase Order
            </Button>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">PO #</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Supplier</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!orders || orders.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No purchase orders yet</td></tr>
                    ) : orders.map(order => (
                      <tr key={order.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">{order.poNumber}</td>
                        <td className="py-3 px-4">{order.supplierName}</td>
                        <td className="py-3 px-4">{order.locationName}</td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {order.orderDate ? new Date(String(order.orderDate)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(order.total || order.subtotal))}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="secondary" className={statusColors[order.status || 'draft'] || statusColors.draft}>
                            {(order.status || 'draft').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex gap-1 justify-center">
                            {order.status === "draft" && (
                              <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => {
                                setPinAction({ type: "submit", poId: order.id });
                                setShowPinDialog(true);
                              }}>
                                <Send className="h-3 w-3 mr-1" /> Submit
                              </Button>
                            )}
                            {order.status === "pending_approval" && (
                              <Button variant="outline" size="sm" className="text-xs h-7 text-emerald-700" onClick={() => {
                                setPinAction({ type: "approve", poId: order.id });
                                setShowPinDialog(true);
                              }}>
                                <Check className="h-3 w-3 mr-1" /> Approve
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Stock Levels Tab ─── */}
      {tab === "inventory" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tracked Items</p>
                    <p className="text-xl font-bold">{invLevels?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-red-50 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Below Par Level</p>
                    <p className="text-xl font-bold">{lowStockItems}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <Boxes className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="text-xl font-bold">
                      {formatCurrency(invLevels?.reduce((s, l) => s + Number(l.currentQty) * Number(l.avgCost || 0), 0) || 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Item</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">On Hand</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Par Level</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg Daily Use</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Days Left</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!invLevels || invLevels.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                        No inventory levels tracked for this location. Set up par levels to start tracking.
                      </td></tr>
                    ) : invLevels.map(level => {
                      const current = Number(level.currentQty);
                      const par = Number(level.parLevel || 0);
                      const usage = Number(level.avgDailyUsage || 0);
                      const daysLeft = usage > 0 ? Math.floor(current / usage) : 999;
                      const pctOfPar = par > 0 ? (current / par) * 100 : 100;
                      let statusBadge = { label: "OK", color: "bg-emerald-50 text-emerald-700" };
                      if (pctOfPar < 25) statusBadge = { label: "Critical", color: "bg-red-100 text-red-800" };
                      else if (pctOfPar < 50) statusBadge = { label: "Low", color: "bg-amber-100 text-amber-800" };

                      return (
                        <tr key={level.levelId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium">{level.itemName}</p>
                              <p className="text-xs text-muted-foreground">{level.itemUnit}</p>
                            </div>
                          </td>
                          <td className="py-3 px-4"><Badge variant="outline" className="text-xs">{level.itemCategory}</Badge></td>
                          <td className="py-3 px-4 text-right font-medium">{current.toFixed(1)}</td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{par > 0 ? par.toFixed(1) : '—'}</td>
                          <td className="py-3 px-4 text-right text-muted-foreground">{usage > 0 ? usage.toFixed(1) : '—'}</td>
                          <td className="py-3 px-4 text-right">
                            {daysLeft < 999 ? (
                              <span className={daysLeft <= 2 ? "text-red-600 font-medium" : ""}>{daysLeft}d</span>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge variant="secondary" className={statusBadge.color}>{statusBadge.label}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Waste Tab ─── */}
      {tab === "waste" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowWasteReport(true)} className="bg-red-600 hover:bg-red-700">
              <Trash2 className="h-4 w-4 mr-2" /> Report Waste
            </Button>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Waste Cost</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!wasteList || wasteList.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">No waste reports yet</td></tr>
                    ) : wasteList.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">
                          {r.reportDate ? new Date(String(r.reportDate)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td className="py-3 px-4">{r.locationName}</td>
                        <td className="py-3 px-4 text-right font-medium text-red-600">{formatCurrency(Number(r.totalWasteCost))}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="secondary" className={r.status === "reviewed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>
                            {(r.status || "draft").charAt(0).toUpperCase() + (r.status || "draft").slice(1)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Leftovers Tab ─── */}
      {tab === "leftovers" && (
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!leftoverList || leftoverList.length === 0 ? (
                      <tr><td colSpan={3} className="text-center py-12 text-muted-foreground">No leftover reports yet</td></tr>
                    ) : leftoverList.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">
                          {r.reportDate ? new Date(String(r.reportDate)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td className="py-3 px-4">{r.locationName}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                            {(r.status || "draft").charAt(0).toUpperCase() + (r.status || "draft").slice(1)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Smart Ordering Recommendations Tab ─── */}
      {tab === "recommendations" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => generateRecos.mutateAsync({ locationId }).then(() => utils.procurement.recommendations.list.invalidate())}
              disabled={generateRecos.isPending || locationId === 0}>
              <RefreshCw className={`h-4 w-4 mr-2 ${generateRecos.isPending ? "animate-spin" : ""}`} />
              {generateRecos.isPending ? "Analyzing..." : "Generate Recommendations"}
            </Button>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Item</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">On Hand</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Par Level</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Daily Use</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Days Left</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Order Qty</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Est. Cost</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Urgency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!recos || recos.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                        Click "Generate Recommendations" to analyze stock levels and suggest orders
                      </td></tr>
                    ) : recos.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium">{r.itemName}</p>
                            <p className="text-xs text-muted-foreground">{r.supplierName || "No supplier"}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">{Number(r.currentQty).toFixed(1)}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{Number(r.parLevel).toFixed(1)}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{Number(r.avgDailyUsage).toFixed(1)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={Number(r.daysUntilStockout) <= 2 ? "text-red-600 font-medium" : ""}>
                            {r.daysUntilStockout}d
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-medium">{Number(r.recommendedQty).toFixed(1)} {r.itemUnit}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(Number(r.estimatedCost))}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="secondary" className={urgencyColors[r.urgency || "medium"]}>
                            {(r.urgency || "medium").charAt(0).toUpperCase() + (r.urgency || "medium").slice(1)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── PIN Management Tab ─── */}
      {tab === "pins" && <PinManagement pins={pins} />}

      {/* Dialogs */}
      <PinDialog
        open={showPinDialog}
        onClose={() => { setShowPinDialog(false); setPinAction(null); }}
        onVerified={handlePinVerified}
        locationId={locationId > 0 ? locationId : undefined}
      />
      <CreatePODialog open={showCreatePO} onClose={() => setShowCreatePO(false)} locationId={locationId} />
      <WasteReportDialog open={showWasteReport} onClose={() => setShowWasteReport(false)} locationId={locationId} />
    </div>
  );
}

// ─── PIN Management Sub-component ───
function PinManagement({ pins }: { pins: any[] | undefined }) {
  const [newPin, setNewPin] = useState({ locationId: "", pin: "", label: "", role: "manager" as const });
  const { data: locs } = trpc.locations.list.useQuery();
  const createMut = trpc.procurement.pins.create.useMutation();
  const deactivateMut = trpc.procurement.pins.deactivate.useMutation();
  const utils = trpc.useUtils();

  const handleCreate = async () => {
    if (!newPin.locationId || !newPin.pin || !newPin.label) return;
    await createMut.mutateAsync({
      locationId: Number(newPin.locationId),
      pin: newPin.pin,
      label: newPin.label,
      role: newPin.role,
    });
    setNewPin({ locationId: "", pin: "", label: "", role: "manager" });
    utils.procurement.pins.list.invalidate();
  };

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Create New PIN</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-3">
            <Select value={newPin.locationId} onValueChange={v => setNewPin({ ...newPin, locationId: v })}>
              <SelectTrigger><SelectValue placeholder="Location..." /></SelectTrigger>
              <SelectContent>
                {locs?.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={newPin.label} onChange={e => setNewPin({ ...newPin, label: e.target.value })} placeholder="Label (e.g., John)" />
            <Input type="password" value={newPin.pin} onChange={e => setNewPin({ ...newPin, pin: e.target.value })} placeholder="PIN (4-8 digits)" maxLength={8} />
            <Select value={newPin.role} onValueChange={v => setNewPin({ ...newPin, role: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="ops_manager">Ops Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleCreate} disabled={createMut.isPending}>
              <Plus className="h-4 w-4 mr-1" /> Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active PINs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Label</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Role</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Last Used</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!pins || pins.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No PINs configured yet</td></tr>
                ) : pins.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium">{p.label}</td>
                    <td className="py-3 px-4">{p.locationName}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant="secondary" className={
                        p.role === "admin" ? "bg-purple-50 text-purple-700" :
                        p.role === "ops_manager" ? "bg-blue-50 text-blue-700" :
                        "bg-slate-100 text-slate-700"
                      }>
                        {p.role === "ops_manager" ? "Ops Manager" : p.role.charAt(0).toUpperCase() + p.role.slice(1)}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {p.lastUsedAt ? new Date(p.lastUsedAt).toLocaleDateString('en-CA') : 'Never'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant="secondary" className={p.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}>
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {p.isActive && (
                        <Button variant="ghost" size="sm" className="text-red-500 text-xs h-7" onClick={async () => {
                          await deactivateMut.mutateAsync({ pinId: p.id });
                          utils.procurement.pins.list.invalidate();
                        }}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
