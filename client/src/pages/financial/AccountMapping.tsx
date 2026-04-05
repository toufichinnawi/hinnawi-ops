import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Settings2, Save, Pencil, Search, RefreshCw,
  AlertCircle, CheckCircle2, ArrowUpDown, FolderTree,
  FileText, BarChart3, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";

interface Props {
  entityId: number;
}

// P&L standard categories (matching the report builder)
const PL_CATEGORIES = [
  "Revenue", "COGS", "Operating Expenses", "Other Income", "Other Expenses", "Uncategorized",
];

const PL_SUBCATEGORIES: Record<string, string[]> = {
  "Revenue": [""],
  "COGS": [""],
  "Operating Expenses": [
    "", "Payroll", "Rent / Occupancy", "Utilities", "Repairs & Maintenance",
    "Professional Fees", "Marketing", "Delivery / Vehicle", "Office / Admin",
    "Merchant Fees", "Interest", "Depreciation", "Royalties", "Management Fees",
  ],
  "Other Income": [""],
  "Other Expenses": [""],
  "Uncategorized": [""],
};

// BS standard categories
const BS_CATEGORIES = [
  "Assets", "Liabilities", "Equity", "Uncategorized",
];

const BS_SUBCATEGORIES: Record<string, string[]> = {
  "Assets": [
    "", "Cash", "Accounts Receivable", "Inventory", "Prepaids",
    "Fixed Assets", "Accumulated Depreciation",
  ],
  "Liabilities": [
    "", "Accounts Payable", "Credit Cards", "Sales Taxes",
    "Payroll Liabilities", "Shareholder Loans", "Debt",
  ],
  "Equity": ["", "Equity", "Retained Earnings"],
  "Uncategorized": [""],
};

type SortField = "accountName" | "amount" | "category" | "qboSection";
type SortDir = "asc" | "desc";

interface ClassifiedAccount {
  accountId: string | null;
  accountName: string;
  amount: number;
  statementType: "profit_loss" | "balance_sheet";
  qboSection: string | null;
  qboSubSection: string | null;
  autoCategory: string;
  autoSubcategory: string | null;
  manualCategory: string | null;
  manualSubcategory: string | null;
  manualLabel: string | null;
  isHidden: boolean;
  mappingId: number | null;
}

export default function AccountMapping({ entityId }: Props) {
  const [statementType, setStatementType] = useState<"profit_loss" | "balance_sheet">("profit_loss");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("category");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingAccount, setEditingAccount] = useState<ClassifiedAccount | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editSubcategory, setEditSubcategory] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editHidden, setEditHidden] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Get current fiscal dates (Sep 1 - Aug 31)
  const dateRange = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const fiscalYear = month >= 9 ? year : year - 1;
    return {
      startDate: `${fiscalYear}-09-01`,
      endDate: `${fiscalYear + 1}-08-31`,
      asOfDate: now.toISOString().split("T")[0],
    };
  }, []);

  // Fetch classified accounts from the new endpoint
  const { data, isLoading, refetch } = trpc.financialStatements.classifiedAccounts.get.useQuery({
    entityId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    asOfDate: dateRange.asOfDate,
  });

  // Fetch mapping version for saving
  const { data: version } = trpc.financialStatements.mappings.getActiveVersion.useQuery({ entityId });

  // Upsert mutation
  const upsertMutation = trpc.financialStatements.mappings.upsert.useMutation({
    onSuccess: () => {
      toast.success("Mapping saved successfully");
      refetch();
    },
    onError: (err) => {
      toast.error(`Failed to save mapping: ${err.message}`);
    },
  });

  // Create version mutation (auto-create if none exists)
  const createVersionMutation = trpc.financialStatements.mappings.createVersion.useMutation({
    onSuccess: () => {
      toast.success("Mapping version created");
      refetch();
    },
  });

  // Filter and sort accounts
  const filteredAccounts = useMemo(() => {
    if (!data?.accounts) return [];
    let accounts = data.accounts.filter((a: ClassifiedAccount) => a.statementType === statementType);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      accounts = accounts.filter((a: ClassifiedAccount) =>
        a.accountName.toLowerCase().includes(q) ||
        (a.manualCategory || a.autoCategory).toLowerCase().includes(q) ||
        (a.manualSubcategory || a.autoSubcategory || "").toLowerCase().includes(q) ||
        (a.qboSection || "").toLowerCase().includes(q)
      );
    }

    accounts.sort((a: ClassifiedAccount, b: ClassifiedAccount) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      switch (sortField) {
        case "accountName":
          aVal = a.accountName.toLowerCase();
          bVal = b.accountName.toLowerCase();
          break;
        case "amount":
          aVal = Math.abs(a.amount);
          bVal = Math.abs(b.amount);
          break;
        case "category":
          aVal = (a.manualCategory || a.autoCategory).toLowerCase();
          bVal = (b.manualCategory || b.autoCategory).toLowerCase();
          break;
        case "qboSection":
          aVal = (a.qboSection || "").toLowerCase();
          bVal = (b.qboSection || "").toLowerCase();
          break;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return accounts;
  }, [data, statementType, searchQuery, sortField, sortDir]);

  // Group by effective category
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, ClassifiedAccount[]> = {};
    for (const a of filteredAccounts) {
      const cat = a.manualCategory || a.autoCategory;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(a);
    }
    return groups;
  }, [filteredAccounts]);

  // Stats
  const stats = useMemo(() => {
    if (!filteredAccounts.length) return { total: 0, manual: 0, auto: 0, uncategorized: 0 };
    return {
      total: filteredAccounts.length,
      manual: filteredAccounts.filter((a: ClassifiedAccount) => a.manualCategory).length,
      auto: filteredAccounts.filter((a: ClassifiedAccount) => !a.manualCategory && a.autoCategory !== "Uncategorized").length,
      uncategorized: filteredAccounts.filter((a: ClassifiedAccount) => !a.manualCategory && a.autoCategory === "Uncategorized").length,
    };
  }, [filteredAccounts]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const toggleGroup = (cat: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const openEdit = (account: ClassifiedAccount) => {
    setEditingAccount(account);
    setEditCategory(account.manualCategory || account.autoCategory);
    setEditSubcategory(account.manualSubcategory || account.autoSubcategory || "");
    setEditLabel(account.manualLabel || "");
    setEditHidden(account.isHidden);
  };

  const handleSave = async () => {
    if (!editingAccount || !editCategory) return;

    // Auto-create version if none exists
    if (!version) {
      createVersionMutation.mutate({
        qboEntityId: entityId,
        label: "Auto-created",
        effectiveFrom: new Date().toISOString().split("T")[0],
      });
      toast.info("Creating mapping version first... Please try saving again in a moment.");
      return;
    }

    upsertMutation.mutate({
      versionId: version.id,
      qboEntityId: entityId,
      qboAccountId: editingAccount.accountId || "",
      qboAccountName: editingAccount.accountName,
      statementType,
      category: editCategory,
      subcategory: editSubcategory || undefined,
      customLabel: editLabel || undefined,
      sortOrder: 0,
      isHidden: editHidden,
    });
    setEditingAccount(null);
  };

  const categories = statementType === "profit_loss" ? PL_CATEGORIES : BS_CATEGORIES;
  const subcategories = statementType === "profit_loss" ? PL_SUBCATEGORIES : BS_SUBCATEGORIES;

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(amount);
  };

  const getCategoryColor = (cat: string, isManual: boolean) => {
    if (cat === "Uncategorized") return "bg-red-100 text-red-800 border-red-200";
    if (isManual) return "bg-blue-100 text-blue-800 border-blue-200";
    return "bg-green-100 text-green-800 border-green-200";
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Account Classification Review</span>
            </div>

            {/* Statement Type Toggle */}
            <div className="flex items-center gap-2">
              <Select value={statementType} onValueChange={(v) => setStatementType(v as any)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profit_loss">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Profit & Loss
                    </div>
                  </SelectItem>
                  <SelectItem value="balance_sheet">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Balance Sheet
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-4 mt-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Total:</span>
              <Badge variant="secondary">{stats.total}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Auto-classified:</span>
              <Badge variant="secondary">{stats.auto}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Manual override:</span>
              <Badge variant="secondary">{stats.manual}</Badge>
            </div>
            {stats.uncategorized > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                <span className="text-red-600 font-medium">Uncategorized:</span>
                <Badge variant="destructive">{stats.uncategorized}</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Accounts Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
              <p>Loading accounts from QuickBooks...</p>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <FolderTree className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>No accounts found. Sync data from QuickBooks first.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead
                      className="cursor-pointer select-none w-[250px]"
                      onClick={() => toggleSort("accountName")}
                    >
                      <div className="flex items-center gap-1">
                        QBO Account Name
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none w-[120px]"
                      onClick={() => toggleSort("qboSection")}
                    >
                      <div className="flex items-center gap-1">
                        QBO Section
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right w-[120px]"
                      onClick={() => toggleSort("amount")}
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Amount
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none w-[180px]"
                      onClick={() => toggleSort("category")}
                    >
                      <div className="flex items-center gap-1">
                        Mapped Category
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </TableHead>
                    <TableHead className="w-[160px]">Subcategory</TableHead>
                    <TableHead className="w-[80px]">Source</TableHead>
                    <TableHead className="w-[60px] text-center">Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(groupedAccounts).map(([category, accounts]) => {
                    const isCollapsed = collapsedGroups.has(category);
                    const groupTotal = accounts.reduce((sum: number, a: ClassifiedAccount) => sum + a.amount, 0);
                    return (
                      <>
                        {/* Group Header */}
                        <TableRow
                          key={`group-${category}`}
                          className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleGroup(category)}
                        >
                          <TableCell colSpan={2} className="font-semibold text-sm">
                            <div className="flex items-center gap-2">
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                              <FolderTree className="h-4 w-4 text-muted-foreground" />
                              {category}
                              <Badge variant="secondary" className="text-xs ml-1">
                                {accounts.length}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-sm">
                            {formatAmount(groupTotal)}
                          </TableCell>
                          <TableCell colSpan={4} />
                        </TableRow>

                        {/* Account Rows */}
                        {!isCollapsed && accounts.map((account: ClassifiedAccount, idx: number) => {
                          const effectiveCategory = account.manualCategory || account.autoCategory;
                          const effectiveSubcategory = account.manualSubcategory || account.autoSubcategory;
                          const isManual = !!account.manualCategory;
                          const isUncategorized = effectiveCategory === "Uncategorized";

                          return (
                            <TableRow
                              key={`${account.accountId || account.accountName}-${idx}`}
                              className={`${isUncategorized ? "bg-red-50/50" : ""} ${account.isHidden ? "opacity-50" : ""}`}
                            >
                              <TableCell className="font-medium text-sm">
                                <div className="flex items-center gap-2">
                                  {account.accountName}
                                  {account.isHidden && (
                                    <Badge variant="outline" className="text-xs">Hidden</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                <div>
                                  {account.qboSection || "—"}
                                  {account.qboSubSection && (
                                    <span className="block text-xs opacity-70">{account.qboSubSection}</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className={`text-right text-sm tabular-nums ${account.amount < 0 ? "text-red-600" : ""}`}>
                                {formatAmount(account.amount)}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${getCategoryColor(effectiveCategory, isManual)}`}
                                >
                                  {effectiveCategory}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {effectiveSubcategory || "—"}
                              </TableCell>
                              <TableCell>
                                {isManual ? (
                                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                                    Manual
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs bg-green-50 border-green-200">
                                    Auto
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEdit(account)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Mapping Dialog */}
      {editingAccount && (
        <Dialog open={!!editingAccount} onOpenChange={() => setEditingAccount(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Account Mapping</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {/* Account Info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{editingAccount.accountName}</span>
                  <Badge variant="secondary" className="text-xs">
                    {editingAccount.statementType === "profit_loss" ? "P&L" : "BS"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  QBO Section: {editingAccount.qboSection || "None"} {editingAccount.qboSubSection ? `> ${editingAccount.qboSubSection}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Auto-classified as: <span className="font-medium">{editingAccount.autoCategory}</span>
                  {editingAccount.autoSubcategory && <span> / {editingAccount.autoSubcategory}</span>}
                </div>
                <div className="text-sm font-medium">
                  Amount: {formatAmount(editingAccount.amount)}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select value={editCategory} onValueChange={(v) => {
                  setEditCategory(v);
                  setEditSubcategory(""); // Reset subcategory when category changes
                }}>
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

              {/* Subcategory */}
              {editCategory && subcategories[editCategory] && subcategories[editCategory].length > 1 && (
                <div>
                  <label className="text-sm font-medium">Subcategory</label>
                  <Select value={editSubcategory} onValueChange={setEditSubcategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select subcategory..." />
                    </SelectTrigger>
                    <SelectContent>
                      {subcategories[editCategory].map(s => (
                        <SelectItem key={s || "__none__"} value={s || "__none__"}>
                          {s || "(General)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Custom Label */}
              <div>
                <label className="text-sm font-medium">Custom Label (optional)</label>
                <Input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="Override the display name on statements"
                />
              </div>

              {/* Hidden Toggle */}
              <div className="flex items-center gap-2">
                <Switch checked={editHidden} onCheckedChange={setEditHidden} />
                <span className="text-sm">Hide from financial statements</span>
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center pt-2">
                <div className="text-xs text-muted-foreground">
                  {editingAccount.manualCategory ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-blue-500" />
                      Currently has manual override
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      Using auto-classification
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
                  <Button
                    onClick={handleSave}
                    disabled={!editCategory || upsertMutation.isPending}
                  >
                    {upsertMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save Override
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
