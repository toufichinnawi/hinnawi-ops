import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Settings2, Plus, Save, GripVertical, Eye, EyeOff, Pencil, Trash2,
  History, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Search,
  ArrowUpDown, Tag, FolderTree, Clock,
} from "lucide-react";

interface Props {
  entityId: number;
}

// P&L categories from the spec
const PL_CATEGORIES = [
  "Revenue", "COGS", "Gross Profit",
  "Payroll", "Rent / Occupancy", "Utilities", "Repairs & Maintenance",
  "Professional Fees", "Marketing", "Delivery / Vehicle", "Office / Admin",
  "Merchant Fees", "Interest", "Depreciation",
  "Other Income", "Other Expenses", "Net Income",
];

// Balance Sheet categories
const BS_CATEGORIES = [
  "Cash", "Accounts Receivable", "Inventory", "Prepaids",
  "Fixed Assets", "Accumulated Depreciation",
  "Accounts Payable", "Credit Cards", "Sales Taxes",
  "Payroll Liabilities", "Shareholder Loans", "Debt",
  "Equity", "Retained Earnings",
];

export default function AccountMapping({ entityId }: Props) {
  const [statementType, setStatementType] = useState<"profit_loss" | "balance_sheet">("profit_loss");
  const [searchQuery, setSearchQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [editingMapping, setEditingMapping] = useState<any>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [draggedItem, setDraggedItem] = useState<number | null>(null);

  // Fetch data
  const { data: accounts } = trpc.financialStatements.entities.accountCache.useQuery({ entityId });
  const { data: mappings, refetch: refetchMappings } = trpc.financialStatements.mappings.getForEntity.useQuery({ entityId });
  const { data: version } = trpc.financialStatements.mappings.getActiveVersion.useQuery({ entityId });
  const { data: auditTrail } = trpc.financialStatements.mappings.auditTrail.useQuery(
    { entityId, limit: 50 },
    { enabled: showAudit }
  );

  // Mutations
  const upsertMutation = trpc.financialStatements.mappings.upsert.useMutation({
    onSuccess: () => refetchMappings(),
  });
  const deleteMutation = trpc.financialStatements.mappings.delete.useMutation({
    onSuccess: () => refetchMappings(),
  });
  const reorderMutation = trpc.financialStatements.mappings.reorder.useMutation({
    onSuccess: () => refetchMappings(),
  });
  const createVersionMutation = trpc.financialStatements.mappings.createVersion.useMutation({
    onSuccess: () => {
      refetchMappings();
      setShowNewVersion(false);
      setNewVersionLabel("");
    },
  });

  // Filter mappings
  const filteredMappings = useMemo(() => {
    if (!mappings) return [];
    return mappings.filter((m: any) => {
      if (m.statementType !== statementType) return false;
      if (!showHidden && m.isHidden) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          m.qboAccountName?.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q) ||
          m.customLabel?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [mappings, statementType, showHidden, searchQuery]);

  // Unmapped accounts
  const unmappedAccounts = useMemo(() => {
    if (!accounts || !mappings) return [];
    const mappedIds = new Set(mappings.map((m: any) => m.qboAccountId));
    return accounts.filter((a: any) => !mappedIds.has(a.qboAccountId));
  }, [accounts, mappings]);

  // Group by category
  const groupedMappings = useMemo(() => {
    const groups: Record<string, typeof filteredMappings> = {};
    for (const m of filteredMappings) {
      const key = m.category;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    // Sort within groups by sortOrder
    for (const key of Object.keys(groups)) {
      groups[key].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }
    return groups;
  }, [filteredMappings]);

  const categories = statementType === "profit_loss" ? PL_CATEGORIES : BS_CATEGORIES;

  const handleSaveMapping = (mapping: any) => {
    if (!version) return;
    upsertMutation.mutate({
      versionId: version.id,
      qboEntityId: entityId,
      qboAccountId: mapping.qboAccountId,
      qboAccountName: mapping.qboAccountName,
      statementType,
      category: mapping.category,
      subcategory: mapping.subcategory || undefined,
      customLabel: mapping.customLabel || undefined,
      sortOrder: mapping.sortOrder,
      isHidden: mapping.isHidden,
    });
    setEditingMapping(null);
  };

  const handleDragStart = (id: number) => setDraggedItem(id);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetId: number) => {
    if (draggedItem === null || draggedItem === targetId) return;
    const items = [...filteredMappings];
    const dragIdx = items.findIndex(m => m.id === draggedItem);
    const dropIdx = items.findIndex(m => m.id === targetId);
    if (dragIdx === -1 || dropIdx === -1) return;
    const [moved] = items.splice(dragIdx, 1);
    items.splice(dropIdx, 0, moved);
    const updates = items.map((m, i) => ({ id: m.id, sortOrder: i * 10 }));
    reorderMutation.mutate({ updates });
    setDraggedItem(null);
  };

  return (
    <div className="space-y-4">
      {/* Header & Version Info */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Mapping Version:</span>
              {version ? (
                <Badge variant="outline" className="gap-1">
                  {version.label} (v{version.versionNumber})
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  No version — create one to start mapping
                </Badge>
              )}
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Statement Type Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Statement:</span>
              <Select value={statementType} onValueChange={(v) => setStatementType(v as any)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profit_loss">Profit & Loss</SelectItem>
                  <SelectItem value="balance_sheet">Balance Sheet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={showHidden} onCheckedChange={setShowHidden} />
              <span className="text-sm">Show Hidden</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAudit(!showAudit)}>
                <History className="h-4 w-4 mr-1" />
                Audit Trail
              </Button>
              <Dialog open={showNewVersion} onOpenChange={setShowNewVersion}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Version
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Mapping Version</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div>
                      <label className="text-sm font-medium">Version Label</label>
                      <Input
                        value={newVersionLabel}
                        onChange={(e) => setNewVersionLabel(e.target.value)}
                        placeholder="e.g., FY 2025/26 Mapping"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Creating a new version will deactivate the current version. Historical reports will continue to use the version that was active at the time.
                    </p>
                    <Button
                      onClick={() => createVersionMutation.mutate({
                        qboEntityId: entityId,
                        label: newVersionLabel,
                        effectiveFrom: new Date().toISOString().split("T")[0],
                      })}
                      disabled={createVersionMutation.isPending}
                    >
                      Create Version
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Unmapped Accounts Alert */}
      {unmappedAccounts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">
                  {unmappedAccounts.length} Unmapped Account{unmappedAccounts.length > 1 ? "s" : ""}
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  These QuickBooks accounts are not mapped to any statement category. Click to map them.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {unmappedAccounts.slice(0, 10).map((a: any) => (
                    <Badge
                      key={a.qboAccountId}
                      variant="outline"
                      className="cursor-pointer hover:bg-amber-100 border-amber-300"
                      onClick={() => setEditingMapping({
                        qboAccountId: a.qboAccountId,
                        qboAccountName: a.name,
                        category: "",
                        subcategory: "",
                        customLabel: "",
                        sortOrder: 0,
                        isHidden: false,
                        isNew: true,
                      })}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {a.name}
                    </Badge>
                  ))}
                  {unmappedAccounts.length > 10 && (
                    <Badge variant="outline" className="border-amber-300">
                      +{unmappedAccounts.length - 10} more
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mapping Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FolderTree className="h-4 w-4" />
            {statementType === "profit_loss" ? "Profit & Loss" : "Balance Sheet"} Mappings
            <Badge variant="secondary" className="ml-2">{filteredMappings.length} accounts</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!version ? (
            <div className="py-12 text-center text-muted-foreground">
              <Settings2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No mapping version exists yet.</p>
              <p className="text-sm mt-1">Create a new version to start mapping QuickBooks accounts.</p>
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Tag className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No mappings found for this statement type.</p>
              <p className="text-sm mt-1">Map unmapped accounts above or create new mappings.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedMappings).map(([category, items]) => (
                <div key={category} className="border rounded-lg">
                  <div className="bg-muted/50 px-3 py-2 font-semibold text-sm flex items-center gap-2 rounded-t-lg">
                    <FolderTree className="h-4 w-4 text-muted-foreground" />
                    {category}
                    <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                  </div>
                  <div className="divide-y">
                    {items.map((mapping: any) => (
                      <div
                        key={mapping.id}
                        className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/30 ${mapping.isHidden ? "opacity-50" : ""}`}
                        draggable
                        onDragStart={() => handleDragStart(mapping.id)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(mapping.id)}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">
                              {mapping.customLabel || mapping.qboAccountName}
                            </span>
                            {mapping.customLabel && mapping.qboAccountName && (
                              <span className="text-xs text-muted-foreground truncate">
                                ({mapping.qboAccountName})
                              </span>
                            )}
                          </div>
                          {mapping.subcategory && (
                            <span className="text-xs text-muted-foreground">{mapping.subcategory}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {mapping.isHidden && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <EyeOff className="h-3 w-3" /> Hidden
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingMapping({ ...mapping, isNew: false })}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm("Delete this mapping?")) {
                                deleteMutation.mutate({ id: mapping.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Mapping Dialog */}
      {editingMapping && (
        <Dialog open={!!editingMapping} onOpenChange={() => setEditingMapping(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingMapping.isNew ? "Map Account" : "Edit Mapping"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium">QuickBooks Account</label>
                <Input value={editingMapping.qboAccountName || ""} disabled className="bg-muted" />
              </div>
              <div>
                <label className="text-sm font-medium">Statement Category</label>
                <Select
                  value={editingMapping.category}
                  onValueChange={(v) => setEditingMapping({ ...editingMapping, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Subcategory (optional)</label>
                <Input
                  value={editingMapping.subcategory || ""}
                  onChange={(e) => setEditingMapping({ ...editingMapping, subcategory: e.target.value })}
                  placeholder="e.g., Rent, Insurance..."
                />
              </div>
              <div>
                <label className="text-sm font-medium">Custom Label (optional)</label>
                <Input
                  value={editingMapping.customLabel || ""}
                  onChange={(e) => setEditingMapping({ ...editingMapping, customLabel: e.target.value })}
                  placeholder="Rename this line on the statement"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingMapping.isHidden}
                  onCheckedChange={(v) => setEditingMapping({ ...editingMapping, isHidden: v })}
                />
                <span className="text-sm">Hide from statements</span>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditingMapping(null)}>Cancel</Button>
                <Button
                  onClick={() => handleSaveMapping(editingMapping)}
                  disabled={!editingMapping.category || upsertMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save Mapping
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Audit Trail */}
      {showAudit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!auditTrail || auditTrail.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No audit records yet.</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {auditTrail.map((entry: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-3 text-sm border-b pb-2">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{entry.action}</Badge>
                        {entry.fieldChanged && (
                          <span className="text-muted-foreground">Field: {entry.fieldChanged}</span>
                        )}
                      </div>
                      {entry.oldValue && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Old: <code className="bg-muted px-1 rounded">{entry.oldValue}</code>
                        </p>
                      )}
                      {entry.newValue && (
                        <p className="text-xs text-muted-foreground">
                          New: <code className="bg-muted px-1 rounded">{entry.newValue}</code>
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                      <div>{entry.changedBy || "System"}</div>
                      <div>{new Date(entry.createdAt).toLocaleString("en-CA")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
