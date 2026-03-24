import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Clock, DollarSign, TrendingDown, Upload, RefreshCw, BookOpen, CalendarDays, CloudUpload, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(val);
}

export default function Workforce() {
  const { data: targets } = trpc.workforce.laborTargets.useQuery();
  const { data: qboStatus } = trpc.qbo.status.useQuery();
  const [generatingJE, setGeneratingJE] = useState<Record<string, boolean>>({});
  const [generatingRevJE, setGeneratingRevJE] = useState<Record<string, boolean>>({});
  const [bulkPayrollSyncing, setBulkPayrollSyncing] = useState(false);
  const [bulkRevenueSyncing, setBulkRevenueSyncing] = useState(false);

  const now = useMemo(() => new Date(), []);
  const startDate = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [now]);
  const endDate = useMemo(() => now.toISOString().slice(0, 10), [now]);

  const { data: payroll, refetch: refetchPayroll } = trpc.workforce.payroll.useQuery({ startDate, endDate });
  const { data: performance } = trpc.dashboard.storePerformance.useQuery({ startDate, endDate });
  // Use reporting.dailyPnl for daily sales data
  const recentDate = useMemo(() => now.toISOString().slice(0, 10), [now]);
  const { data: dailyPnl } = trpc.reporting.dailyPnl.useQuery({ date: recentDate });
  const { data: kpis } = trpc.dashboard.kpis.useQuery({ date: recentDate });

  const generatePayrollJE = trpc.qbo.generatePayrollJE.useMutation({
    onSuccess: (data, variables) => {
      const key = `${variables.locationId}-${variables.payDate}`;
      setGeneratingJE(prev => ({ ...prev, [key]: false }));
      toast.success(`Payroll JE created in QBO (ID: ${data.journalEntryId})`);
    },
    onError: (err, variables) => {
      const key = `${variables.locationId}-${variables.payDate}`;
      setGeneratingJE(prev => ({ ...prev, [key]: false }));
      toast.error(`Payroll JE failed: ${err.message}`);
    },
  });

  const generateRevenueJE = trpc.qbo.generateRevenueJE.useMutation({
    onSuccess: (data, variables) => {
      const key = `${variables.locationId}-${variables.date}`;
      setGeneratingRevJE(prev => ({ ...prev, [key]: false }));
      toast.success(`Revenue JE created in QBO (ID: ${data.journalEntryId})`);
    },
    onError: (err, variables) => {
      const key = `${variables.locationId}-${variables.date}`;
      setGeneratingRevJE(prev => ({ ...prev, [key]: false }));
      toast.error(`Revenue JE failed: ${err.message}`);
    },
  });

  const handlePayrollJE = (p: any) => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    const key = `${p.locationId}-${p.periodEnd || p.payDate}`;
    setGeneratingJE(prev => ({ ...prev, [key]: true }));
    generatePayrollJE.mutate({
      locationId: p.locationId,
      payDate: String(p.periodEnd || p.payDate),
      grossWages: Number(p.grossWages),
      employerContributions: Number(p.employerContributions),
      netPayroll: Number(p.netPayroll),
    });
  };

  const handleRevenueJE = (sale: any) => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    const key = `${sale.locationId}-${recentDate}`;
    setGeneratingRevJE(prev => ({ ...prev, [key]: true }));
    generateRevenueJE.mutate({
      date: recentDate,
      locationId: sale.locationId,
    });
  };

  const handleBulkPayrollSync = async () => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    if (!payroll?.length) { toast.info("No payroll records to sync."); return; }
    setBulkPayrollSyncing(true);
    let success = 0, failed = 0;
    for (const p of payroll) {
      try {
        await generatePayrollJE.mutateAsync({
          locationId: p.locationId,
          payDate: String(p.periodEnd || p.payDate),
          grossWages: Number(p.grossWages),
          employerContributions: Number(p.employerContributions),
          netPayroll: Number(p.netPayroll),
        });
        success++;
      } catch { failed++; }
    }
    setBulkPayrollSyncing(false);
    toast.success(`Bulk payroll sync: ${success} JEs created, ${failed} failed`);
  };

  const handleBulkRevenueSync = async () => {
    if (!qboStatus?.connected) {
      toast.error("QuickBooks is not connected. Go to Integrations to connect.");
      return;
    }
    if (!dailyPnl?.length) { toast.info("No daily sales to sync."); return; }
    setBulkRevenueSyncing(true);
    let success = 0, failed = 0;
    for (const s of dailyPnl) {
      try {
        await generateRevenueJE.mutateAsync({
          date: recentDate,
          locationId: s.locationId,
        });
        success++;
      } catch { failed++; }
    }
    setBulkRevenueSyncing(false);
    toast.success(`Bulk revenue sync: ${success} JEs created, ${failed} failed`);
  };

  const totalLabor = payroll?.reduce((s, p) => s + Number(p.grossWages) + Number(p.employerContributions), 0) || 0;
  const totalHours = payroll?.reduce((s, p) => s + Number(p.totalHours), 0) || 0;
  const totalHeadcount = payroll?.reduce((s, p) => s + (p.headcount || 0), 0) || 0;
  const avgLaborPct = performance?.length ? performance.reduce((s, p) => s + p.laborPct, 0) / performance.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workforce & Labor</h1>
          <p className="text-muted-foreground text-sm mt-1">Labor targets, payroll performance, and QuickBooks journal entries</p>
        </div>
        <div className="flex items-center gap-2">
          {qboStatus?.connected ? (
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 mr-1" /> QBO Connected
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-red-50 text-red-700">QBO Disconnected</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Headcount</p>
                <p className="text-xl font-bold">{totalHeadcount || '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Labor Cost %</p>
                <p className="text-xl font-bold">{avgLaborPct.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <Clock className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Hours (30d)</p>
                <p className="text-xl font-bold">{totalHours.toFixed(0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Labor Cost (30d)</p>
                <p className="text-xl font-bold">{formatCurrency(totalLabor)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Labor Targets */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Labor Targets by Location</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Entity</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Labor Target %</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Food Cost Target %</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actual Labor %</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {targets?.map((loc: any) => {
                  const perf = performance?.find(p => p.name === loc.name);
                  const actualLabor = perf?.laborPct || 0;
                  const target = Number(loc.laborTarget);
                  const overTarget = actualLabor > target;
                  return (
                    <tr key={loc.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium">{loc.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{loc.entityName}</td>
                      <td className="py-3 px-4 text-right">{Number(loc.laborTarget).toFixed(1)}%</td>
                      <td className="py-3 px-4 text-right">{Number(loc.foodCostTarget).toFixed(1)}%</td>
                      <td className={`py-3 px-4 text-right font-medium ${overTarget ? 'text-red-600' : 'text-emerald-600'}`}>{actualLabor.toFixed(1)}%</td>
                      <td className="py-3 px-4 text-center">
                        {overTarget ? (
                          <Badge variant="secondary" className="bg-red-50 text-red-700">Over Target</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">On Track</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payroll Records with JE Generation */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Payroll Records — Journal Entry Generation
          </CardTitle>
          {qboStatus?.connected && payroll && payroll.length > 0 && (
            <Button size="sm" onClick={handleBulkPayrollSync} disabled={bulkPayrollSyncing}>
              {bulkPayrollSyncing ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing...</>
              ) : (
                <><CloudUpload className="h-3.5 w-3.5 mr-1.5" /> Push All Payroll JEs</>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Pay Period</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Gross Wages</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Employer Contrib.</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Net Payroll</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Headcount</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Hours</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">QBO JE</th>
                </tr>
              </thead>
              <tbody>
                {!payroll?.length ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No payroll records in the last 30 days</td></tr>
                ) : payroll.map((p: any) => {
                  const key = `${p.locationId}-${p.periodEnd || p.payDate}`;
                  const isGenerating = generatingJE[key];
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-medium">{p.locationName || `Loc ${p.locationId}`}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {p.periodStart ? new Date(String(p.periodStart)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—'}
                        {' — '}
                        {p.periodEnd ? new Date(String(p.periodEnd)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">{formatCurrency(Number(p.grossWages))}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(Number(p.employerContributions))}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(p.netPayroll))}</td>
                      <td className="py-3 px-4 text-right">{p.headcount || '—'}</td>
                      <td className="py-3 px-4 text-right">{Number(p.totalHours).toFixed(0)}</td>
                      <td className="py-3 px-4 text-center">
                        {qboStatus?.connected ? (
                          isGenerating ? (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                              <RefreshCw className="h-3 w-3 mr-0.5 animate-spin" /> Creating...
                            </Badge>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-2"
                              onClick={() => handlePayrollJE(p)}>
                              <Upload className="h-3 w-3 mr-1" /> Create JE
                            </Button>
                          )
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
        </CardContent>
      </Card>

      {/* Daily Revenue JE Generation */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Daily Revenue — Journal Entry Generation
          </CardTitle>
          {qboStatus?.connected && dailyPnl && dailyPnl.length > 0 && (
            <Button size="sm" onClick={handleBulkRevenueSync} disabled={bulkRevenueSyncing}>
              {bulkRevenueSyncing ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing...</>
              ) : (
                <><CloudUpload className="h-3.5 w-3.5 mr-1.5" /> Push All Revenue JEs</>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Sales</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">GST</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">QST</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Net Revenue</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">QBO JE</th>
                </tr>
              </thead>
              <tbody>
                {!dailyPnl?.length ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No daily sales data available</td></tr>
                ) : dailyPnl.map((s: any, idx: number) => {
                  const key = `${s.locationId}-${recentDate}`;
                  const isGenerating = generatingRevJE[key];
                  // Estimate GST/QST from revenue (5% GST, 9.975% QST on pre-tax)
                  const revenue = Number(s.revenue || 0);
                  const preTax = revenue / (1 + 0.05 + 0.09975);
                  const gst = preTax * 0.05;
                  const qst = preTax * 0.09975;
                  const net = preTax;
                  return (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 text-muted-foreground">{recentDate}</td>
                      <td className="py-3 px-4 font-medium">{s.locationName || `Loc ${s.locationId}`}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(revenue)}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(gst)}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(qst)}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(net)}</td>
                      <td className="py-3 px-4 text-center">
                        {qboStatus?.connected ? (
                          isGenerating ? (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                              <RefreshCw className="h-3 w-3 mr-0.5 animate-spin" /> Creating...
                            </Badge>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-2"
                              onClick={() => handleRevenueJE(s)}>
                              <Upload className="h-3 w-3 mr-1" /> Create JE
                            </Button>
                          )
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
        </CardContent>
      </Card>
    </div>
  );
}
