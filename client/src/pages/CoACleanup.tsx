import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function CoACleanupPage() {
  const [auditReport, setAuditReport] = useState<any>(null);
  const [standardizeResults, setStandardizeResults] = useState<any>(null);

  const auditMutation = trpc.coaCleanup.audit.useMutation({
    onSuccess: (data) => setAuditReport(data),
  });
  const dryRunMutation = trpc.coaCleanup.standardizeDryRun.useMutation({
    onSuccess: (data) => setStandardizeResults(data),
  });
  const applyMutation = trpc.coaCleanup.standardizeApply.useMutation({
    onSuccess: (data) => setStandardizeResults(data),
  });
  const renameMutation = trpc.coaCleanup.renameAccount.useMutation();
  const deactivateMutation = trpc.coaCleanup.deactivateAccount.useMutation();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Chart of Accounts Cleanup</h1>
        <p className="text-gray-500">Audit, standardize, and clean up CoA across all QBO companies</p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => auditMutation.mutate()}
          disabled={auditMutation.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {auditMutation.isPending ? "Auditing..." : "Run Full Audit"}
        </button>
        <button
          onClick={() => dryRunMutation.mutate()}
          disabled={dryRunMutation.isPending}
          className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700 disabled:opacity-50"
        >
          {dryRunMutation.isPending ? "Checking..." : "Preview Standardization"}
        </button>
        <button
          onClick={() => {
            if (!confirm("This will rename accounts in production QBO. Are you sure?")) return;
            applyMutation.mutate();
          }}
          disabled={applyMutation.isPending}
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
        >
          {applyMutation.isPending ? "Applying..." : "Apply Standardization (LIVE)"}
        </button>
      </div>

      {/* Audit Report */}
      {auditReport && (
        <div className="space-y-6">
          {auditReport.companies?.map((company: any) => (
            <div key={company.realmId} className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-lg mb-3">{company.companyName}</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-500">Total</div>
                  <div className="text-xl font-bold">{company.totalAccounts}</div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-500">Active</div>
                  <div className="text-xl font-bold text-green-600">{company.activeAccounts}</div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-500">Inactive</div>
                  <div className="text-xl font-bold text-gray-400">{company.inactiveAccounts}</div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-500">Zero Balance</div>
                  <div className="text-xl font-bold text-yellow-600">{company.zeroBalanceAccounts}</div>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-500">Issues</div>
                  <div className="text-xl font-bold text-red-600">{company.issues?.length || 0}</div>
                </div>
              </div>

              {company.issues?.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Issues</th>
                      <th className="px-3 py-2 text-left">Action</th>
                      <th className="px-3 py-2 text-center">Execute</th>
                    </tr>
                  </thead>
                  <tbody>
                    {company.issues.map((issue: any, i: number) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{issue.account.Name}</td>
                        <td className="px-3 py-2 text-gray-500">{issue.account.AccountType}</td>
                        <td className="px-3 py-2 text-sm">{issue.issues.join("; ")}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            issue.action === "rename" ? "bg-blue-100 text-blue-700" :
                            issue.action === "deactivate" ? "bg-red-100 text-red-700" :
                            "bg-yellow-100 text-yellow-700"
                          }`}>
                            {issue.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {issue.action === "rename" && issue.suggestedName && (
                            <button
                              onClick={() => renameMutation.mutate({
                                realmId: issue.realmId,
                                accountId: issue.account.Id,
                                newName: issue.suggestedName,
                              })}
                              className="text-blue-600 hover:underline text-xs"
                            >
                              Rename to "{issue.suggestedName}"
                            </button>
                          )}
                          {issue.action === "deactivate" && (
                            <button
                              onClick={() => {
                                if (!confirm(`Deactivate "${issue.account.Name}"?`)) return;
                                deactivateMutation.mutate({
                                  realmId: issue.realmId,
                                  accountId: issue.account.Id,
                                });
                              }}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Deactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {/* Cross-Company Issues */}
          {auditReport.crossCompanyIssues?.length > 0 && (
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold text-lg mb-3">Cross-Company Consistency Issues</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Issue</th>
                    <th className="px-3 py-2 text-left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditReport.crossCompanyIssues.map((issue: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{issue.issue}</td>
                      <td className="px-3 py-2 text-gray-600">{issue.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Standardization Results */}
      {standardizeResults && (
        <div className="bg-white border rounded-lg p-4 mt-6">
          <h3 className="font-semibold text-lg mb-3">
            Standardization Results ({standardizeResults.length} accounts)
          </h3>
          {standardizeResults.length === 0 ? (
            <p className="text-green-600">All account names already follow the standard convention.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Realm</th>
                  <th className="px-3 py-2 text-left">Current Name</th>
                  <th className="px-3 py-2 text-left">Standard Name</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {standardizeResults.map((r: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">...{r.realmId.slice(-6)}</td>
                    <td className="px-3 py-2">{r.oldName}</td>
                    <td className="px-3 py-2 font-medium text-blue-600">{r.newName}</td>
                    <td className="px-3 py-2">
                      {r.success === true ? (
                        <span className="text-green-600">Done</span>
                      ) : r.success === false ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : (
                        <span className="text-yellow-600">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Empty State */}
      {!auditReport && !standardizeResults && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">Click "Run Full Audit" to analyze your Chart of Accounts</p>
          <p className="text-sm">The audit will check all production QBO companies for unused accounts, naming inconsistencies, and cross-company mismatches.</p>
        </div>
      )}
    </div>
  );
}
