import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Building2, Link2, Unlink, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  Plus, Search, ArrowLeft, Zap, CreditCard, Landmark, PiggyBank, DollarSign,
  ArrowUpDown, ExternalLink, Filter
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type QboAccount = {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  FullyQualifiedName: string;
  Active: boolean;
  CurrentBalance: number;
  CurrencyRef?: { value: string; name: string };
  Classification: string;
  Description?: string;
  AcctNum?: string;
};

type LocalBankAccount = {
  id: number;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  locationId: number;
  accountType: string | null;
  currency: string | null;
  qboAccountId: string | null;
  isActive: boolean | null;
};

const ACCOUNT_TYPE_ICONS: Record<string, typeof Landmark> = {
  Bank: Landmark,
  "Credit Card": CreditCard,
  Expense: DollarSign,
  Income: PiggyBank,
  "Accounts Payable": Building2,
  "Accounts Receivable": Building2,
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  Bank: "bg-blue-50 text-blue-700 border-blue-200",
  "Credit Card": "bg-purple-50 text-purple-700 border-purple-200",
  Expense: "bg-red-50 text-red-700 border-red-200",
  "Other Expense": "bg-red-50 text-red-700 border-red-200",
  Income: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Other Income": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Cost of Goods Sold": "bg-amber-50 text-amber-700 border-amber-200",
  "Accounts Payable": "bg-orange-50 text-orange-700 border-orange-200",
  "Accounts Receivable": "bg-teal-50 text-teal-700 border-teal-200",
  Equity: "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Other Current Liability": "bg-orange-50 text-orange-700 border-orange-200",
  "Long Term Liability": "bg-orange-50 text-orange-700 border-orange-200",
  "Other Current Asset": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Fixed Asset": "bg-slate-50 text-slate-700 border-slate-200",
};

const LOCATION_NAMES: Record<number, string> = {
  1: "President Kennedy",
  2: "Mackay",
  3: "Ontario",
  4: "Tunnel",
  5: "CK",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(amount);
}

export default function ChartOfAccounts() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selectedLocalAccount, setSelectedLocalAccount] = useState<LocalBankAccount | null>(null);
  const [selectedQboAccountId, setSelectedQboAccountId] = useState<string>("");
  const [sortField, setSortField] = useState<"name" | "type" | "balance">("type");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // New account form
  const [newAccount, setNewAccount] = useState({
    name: "",
    accountType: "Bank",
    accountSubType: "Checking",
    acctNum: "",
    description: "",
    currencyCode: "CAD",
  });

  // Queries
  const { data: qboStatus } = trpc.qbo.status.useQuery();
  const { data: chartData, isLoading: loadingChart, refetch: refetchChart } = trpc.qbo.chartOfAccounts.useQuery(
    typeFilter !== "all" ? { accountType: typeFilter } : undefined,
    { enabled: !!qboStatus?.connected }
  );
  const { data: localBankAccounts, refetch: refetchLocal } = trpc.bankAccounts.list.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  // Mutations
  const createAccountMut = trpc.qbo.createAccountInQbo.useMutation();
  const linkMut = trpc.qbo.linkBankAccountToQbo.useMutation();
  const unlinkMut = trpc.qbo.unlinkBankAccountFromQbo.useMutation();
  const autoCreateMut = trpc.qbo.autoCreateBankAccounts.useMutation();

  const isConnected = qboStatus?.connected;
  const accounts: QboAccount[] = chartData?.accounts || [];

  // Get unique account types for filter
  const accountTypes = useMemo(() => {
    const types = new Set(accounts.map(a => a.AccountType));
    return Array.from(types).sort();
  }, [accounts]);

  // Filter and sort accounts
  const filteredAccounts = useMemo(() => {
    let filtered = accounts.filter(a => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          a.Name.toLowerCase().includes(q) ||
          a.AccountType.toLowerCase().includes(q) ||
          a.AccountSubType?.toLowerCase().includes(q) ||
          a.AcctNum?.toLowerCase().includes(q) ||
          a.Description?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.Name.localeCompare(b.Name);
      else if (sortField === "type") cmp = a.AccountType.localeCompare(b.AccountType) || a.Name.localeCompare(b.Name);
      else if (sortField === "balance") cmp = (a.CurrentBalance || 0) - (b.CurrentBalance || 0);
      return sortDir === "desc" ? -cmp : cmp;
    });

    return filtered;
  }, [accounts, searchQuery, sortField, sortDir]);

  // Group accounts by type
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, QboAccount[]> = {};
    for (const acct of filteredAccounts) {
      if (!groups[acct.AccountType]) groups[acct.AccountType] = [];
      groups[acct.AccountType].push(acct);
    }
    return groups;
  }, [filteredAccounts]);

  // Find which local bank accounts are linked to which QBO accounts
  const linkedMap = useMemo(() => {
    const map = new Map<string, LocalBankAccount>();
    if (localBankAccounts) {
      for (const la of localBankAccounts) {
        if (la.qboAccountId) {
          map.set(la.qboAccountId, la);
        }
      }
    }
    return map;
  }, [localBankAccounts]);

  const handleCreateAccount = async () => {
    if (!newAccount.name.trim()) {
      toast.error("Account name is required");
      return;
    }
    try {
      const result = await createAccountMut.mutateAsync({
        name: newAccount.name,
        accountType: newAccount.accountType,
        accountSubType: newAccount.accountSubType || undefined,
        acctNum: newAccount.acctNum || undefined,
        description: newAccount.description || undefined,
        currencyCode: newAccount.currencyCode || undefined,
      });
      toast.success(`Account "${result.account.Name}" created in QBO (ID: ${result.account.Id})`);
      setShowCreateDialog(false);
      setNewAccount({ name: "", accountType: "Bank", accountSubType: "Checking", acctNum: "", description: "", currencyCode: "CAD" });
      refetchChart();
    } catch (err: any) {
      toast.error(`Failed to create account: ${err.message}`);
    }
  };

  const handleLink = async () => {
    if (!selectedLocalAccount || !selectedQboAccountId) {
      toast.error("Select both a local account and a QBO account");
      return;
    }
    try {
      await linkMut.mutateAsync({
        localBankAccountId: selectedLocalAccount.id,
        qboAccountId: selectedQboAccountId,
      });
      toast.success(`Linked "${selectedLocalAccount.name}" to QBO Account #${selectedQboAccountId}`);
      setShowLinkDialog(false);
      setSelectedLocalAccount(null);
      setSelectedQboAccountId("");
      refetchLocal();
    } catch (err: any) {
      toast.error(`Failed to link: ${err.message}`);
    }
  };

  const handleUnlink = async (localId: number, name: string) => {
    try {
      await unlinkMut.mutateAsync({ localBankAccountId: localId });
      toast.success(`Unlinked "${name}" from QBO`);
      refetchLocal();
    } catch (err: any) {
      toast.error(`Failed to unlink: ${err.message}`);
    }
  };

  const handleAutoCreate = async () => {
    try {
      const result = await autoCreateMut.mutateAsync();
      const { summary } = result;
      const parts: string[] = [];
      if (summary.created > 0) parts.push(`${summary.created} created`);
      if (summary.linkedExisting > 0) parts.push(`${summary.linkedExisting} linked to existing`);
      if (summary.alreadyLinked > 0) parts.push(`${summary.alreadyLinked} already linked`);
      if (summary.errors > 0) parts.push(`${summary.errors} errors`);
      toast.success(`Auto-create complete: ${parts.join(", ")}`);

      // Show any errors
      for (const r of result.results) {
        if (r.status === "error") {
          toast.error(`Error for "${r.name}": ${r.error}`);
        }
      }

      refetchLocal();
      refetchChart();
    } catch (err: any) {
      toast.error(`Auto-create failed: ${err.message}`);
    }
  };

  const toggleSort = (field: "name" | "type" | "balance") => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/integrations")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chart of Accounts</h1>
            <p className="text-muted-foreground text-sm mt-1">QuickBooks Online Account Management</p>
          </div>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6 text-center py-16">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">QuickBooks Not Connected</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Connect to QuickBooks Online to view and manage your Chart of Accounts.
            </p>
            <Button onClick={() => navigate("/integrations")}>
              <Link2 className="h-4 w-4 mr-2" /> Go to Integrations
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/integrations")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chart of Accounts</h1>
            <p className="text-muted-foreground text-sm mt-1">
              QuickBooks Online — {qboStatus?.companyName || "Connected"}
              {qboStatus?.realmId && <span className="text-xs ml-2 font-mono">(Realm: {qboStatus.realmId})</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchChart(); toast.info("Refreshed"); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Account
          </Button>
        </div>
      </div>

      {/* Local Bank Accounts — Link Status */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-5 w-5 text-blue-600" />
              Bank Account Linking
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setSelectedLocalAccount(null); setSelectedQboAccountId(""); setShowLinkDialog(true); }}
              >
                <Link2 className="h-3.5 w-3.5 mr-1.5" /> Manual Link
              </Button>
              <Button
                size="sm"
                onClick={handleAutoCreate}
                disabled={autoCreateMut.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {autoCreateMut.isPending ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating...</>
                ) : (
                  <><Zap className="h-3.5 w-3.5 mr-1.5" /> Auto-Create All in QBO</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Local Account</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Bank</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Type</th>
                  <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">QBO Status</th>
                  <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {localBankAccounts?.map((ba) => {
                  const isLinked = !!ba.qboAccountId;
                  const qboAcct = isLinked ? accounts.find(a => a.Id === ba.qboAccountId) : null;
                  return (
                    <tr key={ba.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-4">
                        <div className="font-medium">{ba.name}</div>
                        {ba.accountNumber && (
                          <div className="text-xs text-muted-foreground font-mono">#{ba.accountNumber}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{ba.bankName || "—"}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant="secondary" className="text-xs">
                          {LOCATION_NAMES[ba.locationId] || `Location ${ba.locationId}`}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant="outline" className="text-xs capitalize">
                          {(ba.accountType || "checking").replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        {isLinked ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="text-emerald-700 text-xs font-medium">
                              Linked (#{ba.qboAccountId})
                            </span>
                            {qboAcct && (
                              <span className="text-xs text-muted-foreground ml-1">
                                — {qboAcct.Name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <XCircle className="h-4 w-4 text-slate-400" />
                            <span className="text-slate-500 text-xs">Not linked</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {isLinked ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                            onClick={() => handleUnlink(ba.id, ba.name)}
                            disabled={unlinkMut.isPending}
                          >
                            <Unlink className="h-3 w-3 mr-1" /> Unlink
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-7 px-2"
                            onClick={() => {
                              setSelectedLocalAccount(ba);
                              setSelectedQboAccountId("");
                              setShowLinkDialog(true);
                            }}
                          >
                            <Link2 className="h-3 w-3 mr-1" /> Link
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            <strong>Auto-Create</strong> will create matching Bank accounts in QBO for any unlinked local accounts, or link to existing ones if found by name/number.
          </p>
        </CardContent>
      </Card>

      {/* QBO Chart of Accounts */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-5 w-5 text-slate-600" />
              QBO Chart of Accounts
              {!loadingChart && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {filteredAccounts.length} account{filteredAccounts.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {accountTypes.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingChart ? (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3" />
              Loading Chart of Accounts from QBO...
            </div>
          ) : chartData?.error ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-2">Failed to load accounts</p>
              <p className="text-xs text-red-600">{chartData.error}</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => refetchChart()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">No accounts found</p>
              {searchQuery && <p className="text-xs mt-1">Try adjusting your search query</p>}
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground w-12">#</th>
                    <th
                      className="text-left py-2.5 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort("name")}
                    >
                      <span className="flex items-center gap-1">
                        Account Name
                        {sortField === "name" && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                    <th
                      className="text-left py-2.5 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort("type")}
                    >
                      <span className="flex items-center gap-1">
                        Type
                        {sortField === "type" && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Sub-Type</th>
                    <th
                      className="text-right py-2.5 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => toggleSort("balance")}
                    >
                      <span className="flex items-center gap-1 justify-end">
                        Balance
                        {sortField === "balance" && <ArrowUpDown className="h-3 w-3" />}
                      </span>
                    </th>
                    <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Linked</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAccounts.map((acct) => {
                    const linkedLocal = linkedMap.get(acct.Id);
                    const typeColor = ACCOUNT_TYPE_COLORS[acct.AccountType] || "bg-slate-50 text-slate-700 border-slate-200";
                    return (
                      <tr key={acct.Id} className="hover:bg-slate-50/50">
                        <td className="py-2 px-4 text-xs text-muted-foreground font-mono">{acct.AcctNum || acct.Id}</td>
                        <td className="py-2 px-4">
                          <div className="font-medium">{acct.Name}</div>
                          {acct.Description && (
                            <div className="text-xs text-muted-foreground truncate max-w-[300px]">{acct.Description}</div>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          <Badge variant="outline" className={`text-xs ${typeColor}`}>
                            {acct.AccountType}
                          </Badge>
                        </td>
                        <td className="py-2 px-4 text-xs text-muted-foreground">{acct.AccountSubType || "—"}</td>
                        <td className="py-2 px-4 text-right font-mono text-sm">
                          <span className={acct.CurrentBalance < 0 ? "text-red-600" : ""}>
                            {formatCurrency(acct.CurrentBalance || 0)}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          {linkedLocal ? (
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {linkedLocal.name}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary by type */}
          {!loadingChart && Object.keys(groupedAccounts).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(groupedAccounts).map(([type, accts]) => {
                const typeColor = ACCOUNT_TYPE_COLORS[type] || "bg-slate-50 text-slate-700";
                return (
                  <Badge key={type} variant="outline" className={`text-xs ${typeColor}`}>
                    {type}: {accts.length}
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Account Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New QBO Account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Account Name *</label>
              <Input
                value={newAccount.name}
                onChange={(e) => setNewAccount(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., 7553-CIBC PK"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Account Type *</label>
                <Select value={newAccount.accountType} onValueChange={(v) => setNewAccount(prev => ({ ...prev, accountType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bank">Bank</SelectItem>
                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                    <SelectItem value="Expense">Expense</SelectItem>
                    <SelectItem value="Other Expense">Other Expense</SelectItem>
                    <SelectItem value="Income">Income</SelectItem>
                    <SelectItem value="Other Income">Other Income</SelectItem>
                    <SelectItem value="Cost of Goods Sold">Cost of Goods Sold</SelectItem>
                    <SelectItem value="Accounts Payable">Accounts Payable</SelectItem>
                    <SelectItem value="Accounts Receivable">Accounts Receivable</SelectItem>
                    <SelectItem value="Other Current Liability">Other Current Liability</SelectItem>
                    <SelectItem value="Long Term Liability">Long Term Liability</SelectItem>
                    <SelectItem value="Equity">Equity</SelectItem>
                    <SelectItem value="Other Current Asset">Other Current Asset</SelectItem>
                    <SelectItem value="Fixed Asset">Fixed Asset</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Sub-Type</label>
                <Select value={newAccount.accountSubType} onValueChange={(v) => setNewAccount(prev => ({ ...prev, accountSubType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Checking">Checking</SelectItem>
                    <SelectItem value="Savings">Savings</SelectItem>
                    <SelectItem value="CreditCard">Credit Card</SelectItem>
                    <SelectItem value="MoneyMarket">Money Market</SelectItem>
                    <SelectItem value="CashOnHand">Cash on Hand</SelectItem>
                    <SelectItem value="OperatingExpenses">Operating Expenses</SelectItem>
                    <SelectItem value="CostOfLaborCos">Cost of Labor</SelectItem>
                    <SelectItem value="SuppliesMaterials">Supplies & Materials</SelectItem>
                    <SelectItem value="SalesOfProductIncome">Sales of Product Income</SelectItem>
                    <SelectItem value="ServiceFeeIncome">Service Fee Income</SelectItem>
                    <SelectItem value="PayrollExpenses">Payroll Expenses</SelectItem>
                    <SelectItem value="RentOrLeaseOfBuildings">Rent/Lease</SelectItem>
                    <SelectItem value="Utilities">Utilities</SelectItem>
                    <SelectItem value="Insurance">Insurance</SelectItem>
                    <SelectItem value="AccountsPayable">Accounts Payable</SelectItem>
                    <SelectItem value="AccountsReceivable">Accounts Receivable</SelectItem>
                    <SelectItem value="OtherCurrentLiabilities">Other Current Liabilities</SelectItem>
                    <SelectItem value="RetainedEarnings">Retained Earnings</SelectItem>
                    <SelectItem value="OpeningBalanceEquity">Opening Balance Equity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Account Number</label>
                <Input
                  value={newAccount.acctNum}
                  onChange={(e) => setNewAccount(prev => ({ ...prev, acctNum: e.target.value }))}
                  placeholder="e.g., 7553"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Currency</label>
                <Select value={newAccount.currencyCode} onValueChange={(v) => setNewAccount(prev => ({ ...prev, currencyCode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CAD">CAD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <Input
                value={newAccount.description}
                onChange={(e) => setNewAccount(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateAccount} disabled={createAccountMut.isPending}>
              {createAccountMut.isPending ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating...</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" /> Create Account</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Dialog */}
      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Link Local Account to QBO
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Local Bank Account</label>
              <Select
                value={selectedLocalAccount ? String(selectedLocalAccount.id) : ""}
                onValueChange={(v) => {
                  const acct = localBankAccounts?.find(a => a.id === Number(v));
                  setSelectedLocalAccount(acct || null);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select local account" /></SelectTrigger>
                <SelectContent>
                  {localBankAccounts?.filter(a => !a.qboAccountId).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} ({LOCATION_NAMES[a.locationId] || `Loc ${a.locationId}`})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">QBO Account</label>
              <Select value={selectedQboAccountId} onValueChange={setSelectedQboAccountId}>
                <SelectTrigger><SelectValue placeholder="Select QBO account" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.AccountType === "Bank" || a.AccountType === "Credit Card").map(a => (
                    <SelectItem key={a.Id} value={a.Id}>
                      {a.Name} ({a.AccountType}) — {formatCurrency(a.CurrentBalance || 0)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>Cancel</Button>
            <Button onClick={handleLink} disabled={linkMut.isPending || !selectedLocalAccount || !selectedQboAccountId}>
              {linkMut.isPending ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Linking...</>
              ) : (
                <><Link2 className="h-3.5 w-3.5 mr-1.5" /> Link Account</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
