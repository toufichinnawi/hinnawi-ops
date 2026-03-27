import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Share2, Plus, Pencil, Trash2, Calculator, Eye, FileText,
  Calendar as CalendarIcon, DollarSign, Building2, ArrowRight,
  CheckCircle2, Clock, AlertCircle, Filter,
} from "lucide-react";
import { format } from "date-fns";

const EXPENSE_CATEGORIES = [
  "Credit Card Statements", "Central Admin Costs", "Professional Fees",
  "Software Subscriptions", "Insurance", "Marketing", "Utilities",
  "Office Supplies", "Vehicle / Delivery", "Other",
];

const STATEMENT_CATEGORIES = [
  "Payroll", "Rent / Occupancy", "Utilities", "Repairs & Maintenance",
  "Professional Fees", "Marketing", "Delivery / Vehicle", "Office / Admin",
  "Merchant Fees", "Interest", "Depreciation", "Other Expenses",
];

const SOURCE_TYPES = [
  { value: "manual", label: "Manual Entry" },
  { value: "credit_card", label: "Credit Card" },
  { value: "journal_entry", label: "Journal Entry" },
  { value: "import", label: "Import" },
];

const APPROVAL_STATUSES = [
  { value: "draft", label: "Draft", color: "bg-yellow-100 text-yellow-800" },
  { value: "approved", label: "Approved", color: "bg-green-100 text-green-800" },
  { value: "posted", label: "Posted", color: "bg-blue-100 text-blue-800" },
];

function fmt(val: number | string | null | undefined) {
  if (val == null) return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(num);
}

function fmtPct(val: number | string | null | undefined) {
  if (val == null) return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  return `${num.toFixed(2)}%`;
}

interface ExpenseForm {
  id?: number;
  expenseDate: string;
  vendor: string;
  description: string;
  amount: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  expenseCategory: string;
  statementCategory: string;
  statementSubcategory: string;
  customLabel: string;
  allocationBasis: "revenue" | "fixed_pct" | "equal" | "manual" | "payroll" | "sqft";
  sourceType: "manual" | "credit_card" | "journal_entry" | "import";
  approvalStatus: "draft" | "approved" | "posted";
  notes: string;
}

const emptyForm: ExpenseForm = {
  expenseDate: format(new Date(), "yyyy-MM-dd"),
  vendor: "",
  description: "",
  amount: "",
  reportingPeriodStart: "",
  reportingPeriodEnd: "",
  expenseCategory: "",
  statementCategory: "",
  statementSubcategory: "",
  customLabel: "",
  allocationBasis: "revenue",
  sourceType: "manual",
  approvalStatus: "draft",
  notes: "",
};

export default function SharedExpenses() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
  const [showAllocations, setShowAllocations] = useState(false);

  // Fetch
  const { data: expenses, refetch } = trpc.financialStatements.sharedExpenses.list.useQuery({
    status: filterStatus !== "all" ? filterStatus : undefined,
    category: filterCategory !== "all" ? filterCategory : undefined,
  });
  const { data: entities } = trpc.financialStatements.entities.list.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();
  const { data: allocations } = trpc.financialStatements.sharedExpenses.allocationsForExpense.useQuery(
    { sharedExpenseId: selectedExpenseId! },
    { enabled: !!selectedExpenseId && showAllocations }
  );

  // Mutations
  const createMutation = trpc.financialStatements.sharedExpenses.create.useMutation({
    onSuccess: () => { refetch(); setShowForm(false); setForm(emptyForm); },
  });
  const updateMutation = trpc.financialStatements.sharedExpenses.update.useMutation({
    onSuccess: () => { refetch(); setShowForm(false); setForm(emptyForm); },
  });
  const deleteMutation = trpc.financialStatements.sharedExpenses.delete.useMutation({
    onSuccess: () => refetch(),
  });
  const allocateMutation = trpc.financialStatements.sharedExpenses.computeAllocation.useMutation({
    onSuccess: () => refetch(),
  });

  const handleSubmit = () => {
    if (form.id) {
      updateMutation.mutate({ id: form.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleEdit = (expense: any) => {
    setForm({
      id: expense.id,
      expenseDate: expense.expenseDate ? format(new Date(expense.expenseDate), "yyyy-MM-dd") : "",
      vendor: expense.vendor || "",
      description: expense.description || "",
      amount: expense.amount?.toString() || "",
      reportingPeriodStart: expense.reportingPeriodStart ? format(new Date(expense.reportingPeriodStart), "yyyy-MM-dd") : "",
      reportingPeriodEnd: expense.reportingPeriodEnd ? format(new Date(expense.reportingPeriodEnd), "yyyy-MM-dd") : "",
      expenseCategory: expense.expenseCategory || "",
      statementCategory: expense.statementCategory || "",
      statementSubcategory: expense.statementSubcategory || "",
      customLabel: expense.customLabel || "",
      allocationBasis: expense.allocationBasis || "revenue",
      sourceType: expense.sourceType || "manual",
      approvalStatus: expense.approvalStatus || "draft",
      notes: expense.notes || "",
    });
    setShowForm(true);
  };

  const handleAllocate = (expenseId: number) => {
    if (!entities || entities.length === 0) return;
    const locationIds = entities.map(e => e.locationId);
    // Use the expense's reporting period or default to current month
    const now = new Date();
    const periodStart = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
    const periodEnd = format(now, "yyyy-MM-dd");
    allocateMutation.mutate({
      sharedExpenseId: expenseId,
      periodStart,
      periodEnd,
      entityLocationIds: locationIds,
    });
  };

  const getStatusBadge = (status: string) => {
    const s = APPROVAL_STATUSES.find(a => a.value === status);
    return s ? (
      <Badge className={`${s.color} border-0`}>{s.label}</Badge>
    ) : (
      <Badge variant="outline">{status}</Badge>
    );
  };

  const getLocationName = (locationId: number) => {
    return locations?.find(l => l.id === locationId)?.name || `Location ${locationId}`;
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <Share2 className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Shared Expenses</span>

            <Separator orientation="vertical" className="h-8" />

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {APPROVAL_STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto">
              <Button onClick={() => { setForm(emptyForm); setShowForm(true); }}>
                <Plus className="h-4 w-4 mr-1" />
                Add Expense
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expenses Table */}
      <Card>
        <CardContent className="pt-4">
          {!expenses || expenses.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No shared expenses recorded yet.</p>
              <p className="text-sm mt-1">Add shared expenses that should be allocated across entities.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-2 px-3 font-semibold">Date</th>
                    <th className="text-left py-2 px-3 font-semibold">Vendor</th>
                    <th className="text-left py-2 px-3 font-semibold">Description</th>
                    <th className="text-left py-2 px-3 font-semibold">Category</th>
                    <th className="text-right py-2 px-3 font-semibold">Amount</th>
                    <th className="text-center py-2 px-3 font-semibold">Source</th>
                    <th className="text-center py-2 px-3 font-semibold">Status</th>
                    <th className="text-center py-2 px-3 font-semibold">Allocated</th>
                    <th className="text-right py-2 px-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp: any) => (
                    <tr key={exp.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-3">
                        {exp.expenseDate ? format(new Date(exp.expenseDate), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="py-2 px-3 font-medium">{exp.vendor || "—"}</td>
                      <td className="py-2 px-3 max-w-[200px] truncate">{exp.description || "—"}</td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className="text-xs">{exp.expenseCategory || "Uncategorized"}</Badge>
                      </td>
                      <td className="text-right py-2 px-3 font-medium">{fmt(exp.amount)}</td>
                      <td className="text-center py-2 px-3">
                        <Badge variant="secondary" className="text-xs">
                          {SOURCE_TYPES.find(s => s.value === exp.sourceType)?.label || exp.sourceType}
                        </Badge>
                      </td>
                      <td className="text-center py-2 px-3">{getStatusBadge(exp.approvalStatus)}</td>
                      <td className="text-center py-2 px-3">
                        {exp.isAllocated ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500 mx-auto" />
                        )}
                      </td>
                      <td className="text-right py-2 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0"
                            onClick={() => {
                              setSelectedExpenseId(exp.id);
                              setShowAllocations(true);
                            }}
                            title="View Allocations"
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0"
                            onClick={() => handleAllocate(exp.id)}
                            title="Compute Allocation"
                            disabled={allocateMutation.isPending}
                          >
                            <Calculator className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0"
                            onClick={() => handleEdit(exp)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Delete this shared expense and its allocations?")) {
                                deleteMutation.mutate({ id: exp.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Expense Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Shared Expense" : "Add Shared Expense"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="text-sm font-medium">Expense Date *</label>
              <Input
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Amount *</label>
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Vendor</label>
              <Input
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="e.g., Bell Canada"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Expense Category</label>
              <Select value={form.expenseCategory} onValueChange={(v) => setForm({ ...form, expenseCategory: v })}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description of the shared expense"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reporting Period Start</label>
              <Input
                type="date"
                value={form.reportingPeriodStart}
                onChange={(e) => setForm({ ...form, reportingPeriodStart: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reporting Period End</label>
              <Input
                type="date"
                value={form.reportingPeriodEnd}
                onChange={(e) => setForm({ ...form, reportingPeriodEnd: e.target.value })}
              />
            </div>

            <Separator className="col-span-2" />

            <div>
              <label className="text-sm font-medium">Statement Category</label>
              <Select value={form.statementCategory} onValueChange={(v) => setForm({ ...form, statementCategory: v })}>
                <SelectTrigger><SelectValue placeholder="Map to statement..." /></SelectTrigger>
                <SelectContent>
                  {STATEMENT_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Subcategory</label>
              <Input
                value={form.statementSubcategory}
                onChange={(e) => setForm({ ...form, statementSubcategory: e.target.value })}
                placeholder="Optional subcategory"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Custom Label</label>
              <Input
                value={form.customLabel}
                onChange={(e) => setForm({ ...form, customLabel: e.target.value })}
                placeholder="Custom line label"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Allocation Basis</label>
              <Select value={form.allocationBasis} onValueChange={(v) => setForm({ ...form, allocationBasis: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="revenue">Revenue-Based</SelectItem>
                  <SelectItem value="fixed_pct" disabled>Fixed % (Phase 2)</SelectItem>
                  <SelectItem value="equal" disabled>Equal Split (Phase 2)</SelectItem>
                  <SelectItem value="manual" disabled>Manual Split (Phase 2)</SelectItem>
                  <SelectItem value="payroll" disabled>Payroll-Based (Phase 2)</SelectItem>
                  <SelectItem value="sqft" disabled>Square Footage (Phase 2)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator className="col-span-2" />

            <div>
              <label className="text-sm font-medium">Source Type</label>
              <Select value={form.sourceType} onValueChange={(v) => setForm({ ...form, sourceType: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Approval Status</label>
              <Select value={form.approvalStatus} onValueChange={(v) => setForm({ ...form, approvalStatus: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {APPROVAL_STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Additional notes..."
                rows={3}
              />
            </div>
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!form.expenseDate || !form.amount || createMutation.isPending || updateMutation.isPending}
              >
                {form.id ? "Update" : "Create"} Expense
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Allocation Detail Dialog */}
      <Dialog open={showAllocations && !!selectedExpenseId} onOpenChange={(open) => {
        if (!open) { setShowAllocations(false); setSelectedExpenseId(null); }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Allocation Detail
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">
            {!allocations || allocations.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No allocations computed yet.</p>
                <p className="text-sm mt-1">Click the calculator icon on the expense to compute allocations.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-3 font-semibold">Entity</th>
                        <th className="text-right py-2 px-3 font-semibold">Revenue</th>
                        <th className="text-right py-2 px-3 font-semibold">% of Total</th>
                        <th className="text-right py-2 px-3 font-semibold">Allocated Amount</th>
                        <th className="text-right py-2 px-3 font-semibold">Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((alloc: any, idx: number) => (
                        <tr key={idx} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              {getLocationName(alloc.locationId)}
                            </div>
                          </td>
                          <td className="text-right py-2 px-3">{fmt(alloc.revenueUsed)}</td>
                          <td className="text-right py-2 px-3">{fmtPct(alloc.allocationPct)}</td>
                          <td className="text-right py-2 px-3 font-medium">{fmt(alloc.allocatedAmount)}</td>
                          <td className="text-right py-2 px-3 text-muted-foreground">{fmt(alloc.totalRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/50 font-semibold">
                        <td className="py-2 px-3">Total</td>
                        <td className="text-right py-2 px-3">
                          {fmt(allocations.reduce((s: number, a: any) => s + parseFloat(a.revenueUsed || 0), 0))}
                        </td>
                        <td className="text-right py-2 px-3">100.00%</td>
                        <td className="text-right py-2 px-3">
                          {fmt(allocations.reduce((s: number, a: any) => s + parseFloat(a.allocatedAmount || 0), 0))}
                        </td>
                        <td className="text-right py-2 px-3 text-muted-foreground">
                          {allocations[0] ? fmt(allocations[0].totalRevenue) : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {allocations[0]?.computedBy && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Computed by {allocations[0].computedBy} at{" "}
                    {allocations[0].computedAt ? new Date(allocations[0].computedAt).toLocaleString("en-CA") : "—"}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
