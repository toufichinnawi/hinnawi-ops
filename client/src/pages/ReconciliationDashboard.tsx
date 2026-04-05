import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";

type TabId = "overview" | "transactions" | "classify" | "creditcard";

export default function ReconciliationDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedAccount, setSelectedAccount] = useState<number | undefined>();
  const [filterType, setFilterType] = useState<string>("");
  const [selectedTxns, setSelectedTxns] = useState<Set<number>>(new Set());
  const [classifyCategory, setClassifyCategory] = useState("");
  const [classifyLocation, setClassifyLocation] = useState<number | undefined>();
  const [classifyType, setClassifyType] = useState("supplier_payment");
  const queryClient = useQueryClient();

  const bankAccounts = trpc.bankAccounts.list.useQuery();
  const locations = trpc.locations.list.useQuery();
  const summary = trpc.reconciliation.summary.useQuery(
    selectedAccount ? { bankAccountId: selectedAccount } : undefined
  );
  const transactions = trpc.reconciliation.transactions.useQuery({
    bankAccountId: selectedAccount,
    matchedType: filterType || undefined,
    limit: 500,
  });
  const categories = trpc.reconciliation.expenseCategories.useQuery();
  const creditCardBreakdown = trpc.reconciliation.creditCardByLocation.useQuery(
    { bankAccountId: selectedAccount || 0 },
    { enabled: activeTab === "creditcard" && !!selectedAccount }
  );

  const autoMatchMutation = trpc.reconciliation.autoMatch.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
  const applyMatchesMutation = trpc.reconciliation.applyMatches.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
  const classifyMutation = trpc.reconciliation.classify.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedTxns(new Set());
    },
  });
  const bulkClassifyMutation = trpc.reconciliation.bulkClassify.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSelectedTxns(new Set());
    },
  });
  const pushToQBOMutation = trpc.reconciliation.pushToQBO.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "transactions", label: "Transactions" },
    { id: "classify", label: "Classify" },
    { id: "creditcard", label: "Credit Card" },
  ];

  const toggleTxn = (id: number) => {
    const next = new Set(selectedTxns);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedTxns(next);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Reconciliation Dashboard</h1>
          <p className="text-gray-500">Bank & credit card transaction matching and classification</p>
        </div>
        <select
          className="border rounded px-3 py-2"
          value={selectedAccount || ""}
          onChange={(e) => setSelectedAccount(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">All Accounts</option>
          {bankAccounts.data?.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.bankName || a.accountType})
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-medium rounded-t ${
              activeTab === tab.id
                ? "bg-white border border-b-white -mb-px text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === "overview" && (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Total Transactions</div>
              <div className="text-2xl font-bold">{summary.data?.totalTransactions || 0}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Matched</div>
              <div className="text-2xl font-bold text-green-600">{summary.data?.matched || 0}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Unmatched</div>
              <div className="text-2xl font-bold text-red-600">{summary.data?.unmatched || 0}</div>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <div className="text-sm text-gray-500">Match Rate</div>
              <div className="text-2xl font-bold">
                {summary.data?.totalTransactions
                  ? `${((summary.data.matched / summary.data.totalTransactions) * 100).toFixed(1)}%`
                  : "—"}
              </div>
            </div>
          </div>

          {/* Match by Type */}
          {summary.data?.matchedByType && Object.keys(summary.data.matchedByType).length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h3 className="font-semibold mb-3">Matched by Type</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(summary.data.matchedByType).map(([type, count]) => (
                  <div key={type} className="bg-gray-50 rounded p-3">
                    <div className="text-xs text-gray-500 uppercase">{type.replace(/_/g, " ")}</div>
                    <div className="text-lg font-semibold">{count as number}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-Match Button */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Auto-Match Engine</h3>
            <p className="text-sm text-gray-500 mb-3">
              Run the auto-matching engine to match unmatched transactions against daily sales, invoices, and payroll records.
            </p>
            <button
              onClick={() => autoMatchMutation.mutate({ bankAccountId: selectedAccount })}
              disabled={autoMatchMutation.isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {autoMatchMutation.isPending ? "Matching..." : "Run Auto-Match"}
            </button>
            {autoMatchMutation.data && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                <p className="text-green-800">
                  Found {autoMatchMutation.data.matches.length} matches.{" "}
                  <button
                    onClick={() => applyMatchesMutation.mutate({
                      matches: autoMatchMutation.data!.matches,
                      minConfidence: 70,
                    })}
                    className="underline font-semibold"
                  >
                    Apply matches (confidence &gt; 70%)
                  </button>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TRANSACTIONS TAB */}
      {activeTab === "transactions" && (
        <div>
          <div className="flex gap-2 mb-4">
            <select
              className="border rounded px-3 py-1.5 text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="unmatched">Unmatched</option>
              <option value="sales_deposit">Sales Deposit</option>
              <option value="payroll">Payroll</option>
              <option value="supplier_payment">Supplier Payment</option>
              <option value="tax_payment">Tax Payment</option>
              <option value="intercompany">Inter-company</option>
              <option value="loan">Loan</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.data?.map((txn: any) => (
                  <tr key={txn.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{txn.transactionDate ? new Date(txn.transactionDate).toLocaleDateString() : ""}</td>
                    <td className="px-3 py-2 max-w-xs truncate">{txn.description}</td>
                    <td className="px-3 py-2 text-right text-red-600">
                      {Number(txn.debit || 0) > 0 ? `$${Number(txn.debit).toFixed(2)}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right text-green-600">
                      {Number(txn.credit || 0) > 0 ? `$${Number(txn.credit).toFixed(2)}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        txn.matchedType === "unmatched" ? "bg-red-100 text-red-700" :
                        txn.matchedType === "sales_deposit" ? "bg-green-100 text-green-700" :
                        txn.matchedType === "payroll" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {(txn.matchedType || "unmatched").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{txn.category || "—"}</td>
                  </tr>
                ))}
                {(!transactions.data || transactions.data.length === 0) && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No transactions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CLASSIFY TAB */}
      {activeTab === "classify" && (
        <div>
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-semibold mb-3">Classify Unmatched Transactions</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select
                className="border rounded px-3 py-1.5 text-sm"
                value={classifyType}
                onChange={(e) => setClassifyType(e.target.value)}
              >
                <option value="supplier_payment">Supplier Payment</option>
                <option value="tax_payment">Tax Payment</option>
                <option value="payroll">Payroll</option>
                <option value="intercompany">Inter-company</option>
                <option value="loan">Loan</option>
                <option value="other">Other</option>
              </select>
              <select
                className="border rounded px-3 py-1.5 text-sm"
                value={classifyCategory}
                onChange={(e) => setClassifyCategory(e.target.value)}
              >
                <option value="">Select Category</option>
                {categories.data?.map((c: any) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <select
                className="border rounded px-3 py-1.5 text-sm"
                value={classifyLocation || ""}
                onChange={(e) => setClassifyLocation(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Select Location</option>
                {locations.data?.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (selectedTxns.size === 0) return alert("Select transactions first");
                  bulkClassifyMutation.mutate({
                    txnIds: Array.from(selectedTxns),
                    matchedType: classifyType,
                    category: classifyCategory || undefined,
                    locationId: classifyLocation,
                  });
                }}
                disabled={selectedTxns.size === 0 || bulkClassifyMutation.isPending}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                Classify {selectedTxns.size} Selected
              </button>
            </div>
            {selectedTxns.size > 0 && classifyLocation && classifyCategory && (
              <button
                onClick={() => {
                  if (!confirm("Push selected transactions to QuickBooks?")) return;
                  for (const txnId of selectedTxns) {
                    pushToQBOMutation.mutate({
                      txnId,
                      locationId: classifyLocation!,
                      category: classifyCategory,
                    });
                  }
                }}
                className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700 mt-2"
              >
                Push to QuickBooks ({selectedTxns.size})
              </button>
            )}
          </div>

          {/* Unmatched transactions for classification */}
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const unmatchedIds = (transactions.data || [])
                            .filter((t: any) => t.matchedType === "unmatched")
                            .map((t: any) => t.id);
                          setSelectedTxns(new Set(unmatchedIds));
                        } else {
                          setSelectedTxns(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Account</th>
                </tr>
              </thead>
              <tbody>
                {(transactions.data || [])
                  .filter((t: any) => t.matchedType === "unmatched")
                  .map((txn: any) => (
                    <tr key={txn.id} className={`border-t hover:bg-gray-50 ${selectedTxns.has(txn.id) ? "bg-blue-50" : ""}`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedTxns.has(txn.id)}
                          onChange={() => toggleTxn(txn.id)}
                        />
                      </td>
                      <td className="px-3 py-2">{txn.transactionDate ? new Date(txn.transactionDate).toLocaleDateString() : ""}</td>
                      <td className="px-3 py-2 max-w-sm truncate">{txn.description}</td>
                      <td className="px-3 py-2 text-right">
                        {Number(txn.debit || 0) > 0
                          ? <span className="text-red-600">-${Number(txn.debit).toFixed(2)}</span>
                          : <span className="text-green-600">+${Number(txn.credit).toFixed(2)}</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-gray-500">{txn.accountName || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREDIT CARD TAB */}
      {activeTab === "creditcard" && (
        <div>
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-semibold mb-2">Credit Card Spending by Location</h3>
            <p className="text-sm text-gray-500 mb-4">
              Shows how the shared credit card spending is distributed across locations for inter-company settlement.
            </p>
            {!selectedAccount ? (
              <p className="text-gray-400">Select a credit card account above to view breakdown.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-right">Total Spent</th>
                    <th className="px-3 py-2 text-right">Transactions</th>
                    <th className="px-3 py-2 text-right">Unclassified</th>
                    <th className="px-3 py-2 text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {creditCardBreakdown.data?.map((row: any) => {
                    const total = creditCardBreakdown.data?.reduce((s: number, r: any) => s + r.totalSpent, 0) || 1;
                    return (
                      <tr key={row.locationId || "unassigned"} className="border-t">
                        <td className="px-3 py-2 font-medium">{row.locationName}</td>
                        <td className="px-3 py-2 text-right">${row.totalSpent.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{row.txnCount}</td>
                        <td className="px-3 py-2 text-right">
                          {row.unclassified > 0 ? (
                            <span className="text-red-600">{row.unclassified}</span>
                          ) : (
                            <span className="text-green-600">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{((row.totalSpent / total) * 100).toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
