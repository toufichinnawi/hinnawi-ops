import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw, DollarSign, AlertTriangle, Clock, ChevronDown, ChevronRight,
  Building2, Users, FileText, Calendar
} from "lucide-react";
import { useState } from "react";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(val);
}

function AgingBar({ current, d1to30, d31to60, d61to90, over90, total }: {
  current: number; d1to30: number; d31to60: number; d61to90: number; over90: number; total: number;
}) {
  if (total === 0) return <div className="h-3 bg-muted rounded-full" />;
  const pct = (v: number) => Math.max((v / total) * 100, v > 0 ? 2 : 0);
  return (
    <div className="h-3 rounded-full overflow-hidden flex bg-muted">
      {current > 0 && <div className="bg-green-500 h-full" style={{ width: `${pct(current)}%` }} title={`Current: ${formatCurrency(current)}`} />}
      {d1to30 > 0 && <div className="bg-yellow-500 h-full" style={{ width: `${pct(d1to30)}%` }} title={`1-30: ${formatCurrency(d1to30)}`} />}
      {d31to60 > 0 && <div className="bg-orange-500 h-full" style={{ width: `${pct(d31to60)}%` }} title={`31-60: ${formatCurrency(d31to60)}`} />}
      {d61to90 > 0 && <div className="bg-red-400 h-full" style={{ width: `${pct(d61to90)}%` }} title={`61-90: ${formatCurrency(d61to90)}`} />}
      {over90 > 0 && <div className="bg-red-700 h-full" style={{ width: `${pct(over90)}%` }} title={`90+: ${formatCurrency(over90)}`} />}
    </div>
  );
}

function AgingLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Current</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500 inline-block" /> 1-30 days</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 inline-block" /> 31-60 days</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block" /> 61-90 days</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-700 inline-block" /> 90+ days</span>
    </div>
  );
}

export default function APAgingSummary() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0]);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = trpc.apAging.summary.useQuery({ asOfDate });

  const toggleCompany = (realmId: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      next.has(realmId) ? next.delete(realmId) : next.add(realmId);
      return next;
    });
  };

  const toggleVendor = (key: string) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const grandTotal = data?.grandTotal || { total: 0, current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  const overdue = grandTotal.days1to30 + grandTotal.days31to60 + grandTotal.days61to90 + grandTotal.over90;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AP Aging Summary</h1>
          <p className="text-muted-foreground">Accounts Payable aging across all QuickBooks companies</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Grand Total Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total AP</p>
            <p className="text-xl font-bold">{formatCurrency(grandTotal.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(grandTotal.current)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">1-30 Days</p>
            <p className="text-xl font-bold text-yellow-600">{formatCurrency(grandTotal.days1to30)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">31-60 Days</p>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(grandTotal.days31to60)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">61-90 Days</p>
            <p className="text-xl font-bold text-red-500">{formatCurrency(grandTotal.days61to90)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">90+ Days</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(grandTotal.over90)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Grand Total Aging Bar */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Overall Aging Distribution</h3>
            <AgingLegend />
          </div>
          <AgingBar
            current={grandTotal.current}
            d1to30={grandTotal.days1to30}
            d31to60={grandTotal.days31to60}
            d61to90={grandTotal.days61to90}
            over90={grandTotal.over90}
            total={grandTotal.total}
          />
          {overdue > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertTriangle className="w-4 h-4" />
              <span>{formatCurrency(overdue)} overdue ({((overdue / grandTotal.total) * 100).toFixed(1)}% of total AP)</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Fetching AP aging data from QuickBooks...
          </CardContent>
        </Card>
      )}

      {/* Company Sections */}
      {data?.companies?.map((company) => (
        <Card key={company.realmId}>
          <CardHeader className="pb-3 cursor-pointer" onClick={() => toggleCompany(company.realmId)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {expandedCompanies.has(company.realmId) ? (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                )}
                <Building2 className="w-5 h-5 text-blue-500" />
                <div>
                  <CardTitle className="text-base">{company.companyName}</CardTitle>
                  <CardDescription className="text-xs">
                    {company.locationNames.join(", ")} | Realm: {company.realmId}
                  </CardDescription>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold">{formatCurrency(company.totalAP)}</p>
                {company.error && (
                  <Badge variant="destructive" className="text-xs">{company.error}</Badge>
                )}
              </div>
            </div>
            {!expandedCompanies.has(company.realmId) && (
              <div className="mt-2 ml-8">
                <AgingBar
                  current={company.current}
                  d1to30={company.days1to30}
                  d31to60={company.days31to60}
                  d61to90={company.days61to90}
                  over90={company.over90}
                  total={company.totalAP}
                />
              </div>
            )}
          </CardHeader>

          {expandedCompanies.has(company.realmId) && (
            <CardContent className="pt-0">
              {/* Company aging breakdown */}
              <div className="grid grid-cols-6 gap-2 mb-4 text-center text-xs">
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">Current</p>
                  <p className="font-semibold text-green-600">{formatCurrency(company.current)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">1-30</p>
                  <p className="font-semibold text-yellow-600">{formatCurrency(company.days1to30)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">31-60</p>
                  <p className="font-semibold text-orange-600">{formatCurrency(company.days31to60)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">61-90</p>
                  <p className="font-semibold text-red-500">{formatCurrency(company.days61to90)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">90+</p>
                  <p className="font-semibold text-red-700">{formatCurrency(company.over90)}</p>
                </div>
                <div className="p-2 bg-muted/50 rounded">
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-bold">{formatCurrency(company.totalAP)}</p>
                </div>
              </div>

              <AgingBar
                current={company.current}
                d1to30={company.days1to30}
                d31to60={company.days31to60}
                d61to90={company.days61to90}
                over90={company.over90}
                total={company.totalAP}
              />

              <Separator className="my-4" />

              {/* Vendor List */}
              {company.vendors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No outstanding payables</p>
              ) : (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4" /> Vendors ({company.vendors.length})
                  </h4>
                  {company.vendors.map((vendor) => {
                    const vendorKey = `${company.realmId}-${vendor.vendorName}`;
                    const isExpanded = expandedVendors.has(vendorKey);
                    return (
                      <div key={vendorKey} className="border rounded-lg">
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => toggleVendor(vendorKey)}
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <span className="font-medium text-sm">{vendor.vendorName}</span>
                            <Badge variant="outline" className="text-xs">{vendor.transactions.length} txns</Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs">
                            {vendor.current > 0 && <span className="text-green-600">{formatCurrency(vendor.current)}</span>}
                            {vendor.days1to30 > 0 && <span className="text-yellow-600">{formatCurrency(vendor.days1to30)}</span>}
                            {vendor.days31to60 > 0 && <span className="text-orange-600">{formatCurrency(vendor.days31to60)}</span>}
                            {vendor.days61to90 > 0 && <span className="text-red-500">{formatCurrency(vendor.days61to90)}</span>}
                            {vendor.over90 > 0 && <span className="text-red-700">{formatCurrency(vendor.over90)}</span>}
                            <span className="font-bold ml-2">{formatCurrency(vendor.total)}</span>
                          </div>
                        </div>

                        {isExpanded && vendor.transactions.length > 0 && (
                          <div className="border-t">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/30">
                                <tr>
                                  <th className="text-left p-2 font-medium">Type</th>
                                  <th className="text-left p-2 font-medium">Date</th>
                                  <th className="text-left p-2 font-medium">Due Date</th>
                                  <th className="text-right p-2 font-medium">Amount</th>
                                  <th className="text-right p-2 font-medium">Open Balance</th>
                                  <th className="text-center p-2 font-medium">Aging</th>
                                </tr>
                              </thead>
                              <tbody>
                                {vendor.transactions.map((txn, idx) => (
                                  <tr key={idx} className="border-t hover:bg-muted/20">
                                    <td className="p-2">
                                      <Badge variant="outline" className="text-xs">{txn.txnType}</Badge>
                                    </td>
                                    <td className="p-2 font-mono">{txn.txnDate}</td>
                                    <td className="p-2 font-mono">{txn.dueDate || "—"}</td>
                                    <td className="p-2 text-right font-mono">{formatCurrency(txn.amount)}</td>
                                    <td className="p-2 text-right font-mono font-semibold">{formatCurrency(txn.openBalance)}</td>
                                    <td className="p-2 text-center">
                                      <Badge className={
                                        txn.aging === "current" ? "bg-green-100 text-green-800" :
                                        txn.aging === "1-30" ? "bg-yellow-100 text-yellow-800" :
                                        txn.aging === "31-60" ? "bg-orange-100 text-orange-800" :
                                        txn.aging === "61-90" ? "bg-red-100 text-red-800" :
                                        "bg-red-200 text-red-900"
                                      }>
                                        {txn.aging}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      ))}

      {/* No data state */}
      {!isLoading && (!data?.companies || data.companies.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No AP aging data available. Make sure QBO companies are connected.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
