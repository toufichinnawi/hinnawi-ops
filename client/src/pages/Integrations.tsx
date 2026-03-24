import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plug, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Link2, Unlink,
  Building2, FileText, BookOpen, Clock, Shield, Play, Pause, Zap,
  Timer, RotateCcw, ArrowRight, Activity, CalendarClock, Store, Wifi
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";

const statusIcons: Record<string, { icon: any; color: string; bg: string }> = {
  live: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  disconnected: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  error: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  syncing: { icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-50' },
};

function QboConnectionCard() {
  const { data: qboStatus, isLoading, refetch } = trpc.qbo.status.useQuery();
  const getAuthUrl = trpc.qbo.getAuthUrl.useMutation();
  const disconnect = trpc.qbo.disconnect.useMutation();
  const [connecting, setConnecting] = useState(false);
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("qbo") === "connected") {
      toast.success(`Connected to QuickBooks: ${params.get("company") || "Company"}`);
      refetch();
      window.history.replaceState({}, "", "/integrations");
    }
  }, [search, refetch]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await getAuthUrl.mutateAsync({ origin: window.location.origin });
      window.location.href = result.url;
    } catch (err: any) {
      toast.error(`Failed to start QBO connection: ${err.message}`);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success("Disconnected from QuickBooks");
      refetch();
    } catch (err: any) {
      toast.error(`Failed to disconnect: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = qboStatus?.connected;

  return (
    <Card className={`border-0 shadow-sm ${isConnected ? 'ring-1 ring-emerald-200' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`h-14 w-14 rounded-xl ${isConnected ? 'bg-emerald-50' : 'bg-slate-100'} flex items-center justify-center`}>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
                <circle cx="12" cy="12" r="10" fill={isConnected ? "#2CA01C" : "#9CA3AF"} />
                <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">QuickBooks Online</h3>
                <Badge variant="secondary" className={isConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>
                  {isConnected ? (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> Disconnected</>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Accounting & Bookkeeping Platform</p>
              {isConnected && qboStatus?.companyName && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{qboStatus.companyName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-3 w-3" />
                    Realm ID: {qboStatus.realmId}
                  </p>
                  {qboStatus.refreshTokenExpiresAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Token expires: {new Date(qboStatus.refreshTokenExpiresAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          {isConnected ? (
            <>
              <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleDisconnect}>
                <Unlink className="h-3.5 w-3.5 mr-1.5" /> Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { refetch(); toast.info("Connection status refreshed"); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Connecting...</>
              ) : (
                <><Link2 className="h-3.5 w-3.5 mr-1.5" /> Connect to QuickBooks</>
              )}
            </Button>
          )}
        </div>

        {isConnected && (
          <div className="mt-5 pt-4 border-t grid grid-cols-3 gap-3">
            <QuickAction icon={FileText} label="Sync Bills" description="Push invoices to QBO" onClick={() => toast.info("Navigate to Invoices page to sync individual bills")} />
            <QuickAction icon={BookOpen} label="Journal Entries" description="Create payroll JEs" onClick={() => toast.info("Navigate to Workforce page for payroll sync")} />
            <QuickAction icon={Building2} label="Chart of Accounts" description="View QBO accounts" onClick={() => window.location.href = "/chart-of-accounts"} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickAction({ icon: Icon, label, description, onClick }: { icon: any; label: string; description: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left p-3 rounded-lg border border-dashed hover:border-primary/30 hover:bg-accent/50 transition-colors group"
    >
      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary mb-1.5" />
      <p className="text-xs font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

// ─── Auto-Retry Scheduler Card ───

function AutoRetrySchedulerCard() {
  const { data: schedulerStatus, isLoading, refetch } = trpc.scheduler.status.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30 seconds
  });
  const { data: syncLogs, refetch: refetchLogs } = trpc.scheduler.syncLogs.useQuery({ limit: 20 });
  const toggleMutation = trpc.scheduler.toggle.useMutation();
  const runNowMutation = trpc.scheduler.runNow.useMutation();
  const [showLogs, setShowLogs] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    try {
      await toggleMutation.mutateAsync({ enabled });
      toast.success(enabled ? "Auto-retry scheduler enabled" : "Auto-retry scheduler disabled");
      refetch();
    } catch (err: any) {
      toast.error(`Failed to toggle scheduler: ${err.message}`);
    }
  };

  const handleRunNow = async () => {
    try {
      const result = await runNowMutation.mutateAsync();
      if (result.attempted === 0) {
        toast.info("No failed invoices to retry");
      } else {
        toast.success(`Retry complete: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.attempted}`);
      }
      refetch();
      refetchLogs();
    } catch (err: any) {
      toast.error(`Manual retry failed: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isEnabled = schedulerStatus?.enabled ?? false;
  const isRunning = schedulerStatus?.running ?? false;
  const lastRun = schedulerStatus?.lastRun ? new Date(schedulerStatus.lastRun) : null;
  const lastResult = schedulerStatus?.lastResult;

  return (
    <Card className={`border-0 shadow-sm ${isEnabled ? 'ring-1 ring-blue-200' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`h-14 w-14 rounded-xl ${isEnabled ? 'bg-blue-50' : 'bg-slate-100'} flex items-center justify-center`}>
              <Timer className={`h-7 w-7 ${isEnabled ? 'text-blue-600' : 'text-slate-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Auto-Retry Scheduler</h3>
                <Badge variant="secondary" className={isEnabled ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}>
                  {isEnabled ? (
                    <><Activity className="h-3 w-3 mr-1" /> Active</>
                  ) : (
                    <><Pause className="h-3 w-3 mr-1" /> Paused</>
                  )}
                </Badge>
                {isRunning && (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                    <Play className="h-3 w-3 mr-1" /> Running
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Automatically retries failed QBO syncs every 5 minutes during business hours
              </p>
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CalendarClock className="h-3 w-3" />
                  Schedule: Every 5 min, 7 AM – 8 PM ET (plus 9 PM & 12 AM)
                </p>
                {lastRun && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Last run: {lastRun.toLocaleString()}
                  </p>
                )}
                {lastResult && (
                  <p className="text-xs flex items-center gap-1.5">
                    <RotateCcw className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Last result:</span>
                    <span className="text-emerald-600 font-medium">{lastResult.succeeded} synced</span>
                    {lastResult.failed > 0 && (
                      <span className="text-red-600 font-medium">{lastResult.failed} failed</span>
                    )}
                    <span className="text-muted-foreground">of {lastResult.attempted}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{isEnabled ? 'On' : 'Off'}</span>
            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={toggleMutation.isPending}
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            disabled={runNowMutation.isPending}
          >
            {runNowMutation.isPending ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Retrying...</>
            ) : (
              <><Zap className="h-3.5 w-3.5 mr-1.5" /> Run Now</>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowLogs(!showLogs)}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {showLogs ? 'Hide' : 'View'} Sync Logs
          </Button>
        </div>

        {/* Sync Logs Table */}
        {showLogs && (
          <div className="mt-5 pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Recent Sync Logs</h4>
              <Button size="sm" variant="ghost" onClick={() => refetchLogs()} className="h-7 px-2">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            {!syncLogs || syncLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sync logs yet. Enable the scheduler or run a manual retry.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Time</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Type</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Invoice</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {syncLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {log.syncType.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {log.invoiceId ? `#${log.invoiceId}` : '—'}
                        </td>
                        <td className="py-2 px-3">
                          {log.status === 'success' ? (
                            <span className="text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Success
                            </span>
                          ) : log.status === 'failed' ? (
                            <span className="text-red-600 flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> Failed
                            </span>
                          ) : (
                            <span className="text-amber-600 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> Skipped
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground max-w-[200px] truncate" title={log.errorMessage || log.qboBillId || ''}>
                          {log.status === 'success' && log.qboBillId
                            ? `Bill #${log.qboBillId}`
                            : log.errorMessage || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Koomi Auto-Sync Toggle ───

function KoomiAutoSyncToggle() {
  const { data: schedulerStatus, isLoading, refetch } = trpc.koomi.schedulerStatus.useQuery();
  const toggleMutation = trpc.koomi.toggleScheduler.useMutation();

  const handleToggle = async (enabled: boolean) => {
    try {
      await toggleMutation.mutateAsync({ enabled });
      toast.success(enabled ? "Koomi daily auto-sync enabled (runs at 6 AM ET)" : "Koomi daily auto-sync disabled");
      refetch();
    } catch (err: any) {
      toast.error(`Failed to toggle: ${err.message}`);
    }
  };

  if (isLoading) return null;

  const isEnabled = schedulerStatus?.enabled ?? false;

  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
      <div className="flex items-center gap-3">
        <CalendarClock className={`h-5 w-5 ${isEnabled ? 'text-violet-600' : 'text-muted-foreground'}`} />
        <div>
          <p className="text-sm font-medium">Daily Auto-Sync</p>
          <p className="text-xs text-muted-foreground">Automatically syncs yesterday's data at 6 AM ET</p>
        </div>
      </div>
      <Switch
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={toggleMutation.isPending}
      />
    </div>
  );
}

// ─── Koomi POS Integration Card ───

function KoomiPosCard() {
  const { data: status, isLoading, refetch } = trpc.koomi.status.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const syncSalesMutation = trpc.koomi.syncSales.useMutation();
  const syncBreakdownMutation = trpc.koomi.syncBreakdown.useMutation();
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);
  const [syncType, setSyncType] = useState<'sales' | 'breakdown' | null>(null);
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      from: weekAgo.toISOString().split('T')[0],
      to: today.toISOString().split('T')[0],
    };
  });

  const handleSyncSales = async () => {
    setSyncType('sales');
    try {
      const result = await syncSalesMutation.mutateAsync({ fromDate: dateRange.from, toDate: dateRange.to });
      setLastSyncResult({ ...result, type: 'sales' });
      toast.success(
        `Net Onsite Sales synced: ${result.recordsProcessed} records (${result.inserted} new, ${result.updated} updated) across ${result.stores} stores`
      );
      refetch();
    } catch (err: any) {
      toast.error(`Sales sync failed: ${err.message}`);
    } finally {
      setSyncType(null);
    }
  };

  const handleSyncBreakdown = async () => {
    setSyncType('breakdown');
    try {
      const result = await syncBreakdownMutation.mutateAsync({ fromDate: dateRange.from, toDate: dateRange.to });
      setLastSyncResult({ ...result, type: 'breakdown' });
      toast.success(
        `Breakdown synced: ${result.totalItems} items across ${result.storesProcessed} stores`
      );
      refetch();
    } catch (err: any) {
      toast.error(`Breakdown sync failed: ${err.message}`);
    } finally {
      setSyncType(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = status?.connected;

  return (
    <Card className={`border-0 shadow-sm ${isConnected ? 'ring-1 ring-violet-200' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`h-14 w-14 rounded-xl ${isConnected ? 'bg-violet-50' : 'bg-slate-100'} flex items-center justify-center`}>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
                <circle cx="12" cy="12" r="10" fill={isConnected ? '#7C3AED' : '#9CA3AF'} />
                <text x="12" y="16" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">MYR</text>
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Koomi POS (MYR)</h3>
                <Badge variant="secondary" className={isConnected ? 'bg-violet-50 text-violet-700' : 'bg-red-50 text-red-700'}>
                  {isConnected ? (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> Disconnected</>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">admin.koomi.com — Net Onsite Sales & Breakdown Reports</p>
              {isConnected && status?.accountName && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{status.accountName}</span>
                  </p>
                  {status.stores && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {status.stores.map((s: any) => (
                        <span key={s.koomiId} className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">
                          <Store className="h-3 w-3" />
                          {s.name} ({s.code})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {isConnected && (
          <div className="mt-5 space-y-4">
            {/* Date Range Selector */}
            <div className="flex items-end gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1">From Date</label>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border rounded-md bg-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1">To Date</label>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border rounded-md bg-white"
                />
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    const today = new Date();
                    setDateRange({ from: today.toISOString().split('T')[0], to: today.toISOString().split('T')[0] });
                  }}
                >
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    const today = new Date();
                    const weekAgo = new Date(today);
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    setDateRange({ from: weekAgo.toISOString().split('T')[0], to: today.toISOString().split('T')[0] });
                  }}
                >
                  Last 7d
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    const today = new Date();
                    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    setDateRange({ from: monthStart.toISOString().split('T')[0], to: today.toISOString().split('T')[0] });
                  }}
                >
                  MTD
                </Button>
              </div>
            </div>

            {/* Sync Buttons */}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSyncSales}
                disabled={syncType !== null}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {syncType === 'sales' ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing Sales...</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync Net Sales</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncBreakdown}
                disabled={syncType !== null}
                className="border-violet-200 text-violet-700 hover:bg-violet-50"
              >
                {syncType === 'breakdown' ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing Breakdown...</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync Breakdown</>
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { refetch(); toast.info("Connection status refreshed"); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            </div>
          </div>
        )}

        {!isConnected && status?.error && (
          <div className="mt-4 p-3 bg-red-50 rounded-lg">
            <p className="text-xs text-red-700"><strong>Error:</strong> {status.error}</p>
          </div>
        )}

        {lastSyncResult && (
          <div className="mt-5 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Last Sync Result — {lastSyncResult.type === 'sales' ? 'Net Onsite Sales' : 'Breakdown Onsite'}</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {lastSyncResult.type === 'sales' ? (
                <>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-violet-600">{lastSyncResult.recordsProcessed}</p>
                    <p className="text-xs text-muted-foreground">Records</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-emerald-600">{lastSyncResult.inserted}</p>
                    <p className="text-xs text-muted-foreground">New</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{lastSyncResult.updated}</p>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-orange-600">{lastSyncResult.stores}</p>
                    <p className="text-xs text-muted-foreground">Stores</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-violet-600">{lastSyncResult.totalItems}</p>
                    <p className="text-xs text-muted-foreground">Items</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-emerald-600">{lastSyncResult.imported}</p>
                    <p className="text-xs text-muted-foreground">New</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{lastSyncResult.updated}</p>
                    <p className="text-xs text-muted-foreground">Updated</p>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded-lg">
                    <p className="text-lg font-bold text-orange-600">{lastSyncResult.storesProcessed}</p>
                    <p className="text-xs text-muted-foreground">Stores</p>
                  </div>
                </>
              )}
            </div>
            {lastSyncResult.dateRange && (
              <p className="text-xs text-muted-foreground mt-2">
                Date range: {lastSyncResult.dateRange.from} to {lastSyncResult.dateRange.to}
              </p>
            )}
          </div>
        )}

        {isConnected && (
          <div className="mt-5 pt-4 border-t space-y-4">
            <KoomiAutoSyncToggle />
            <div className="bg-violet-50 rounded-lg p-3">
              <p className="text-xs text-violet-800">
                <strong>How it works:</strong> Connects to admin.koomi.com to scrape Net Onsite Sales (daily revenue, taxes, tips, salaries)
                and Breakdown Onsite (product-level sales by category). Data is imported into the same database used by the CFO Dashboard.
                Stores: Mackay (MK), Cathcart/Tunnel (CT), President Kennedy (PK).
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 7shifts Integration Card ───

function SevenShiftsAutoSyncToggle() {
  const { data: schedulerStatus, refetch } = trpc.sevenShifts.schedulerStatus.useQuery();
  const toggleMutation = trpc.sevenShifts.toggleScheduler.useMutation();

  const handleToggle = async () => {
    const newEnabled = !schedulerStatus?.enabled;
    try {
      await toggleMutation.mutateAsync({ enabled: newEnabled });
      toast.success(newEnabled ? "7shifts auto-sync enabled (daily at 6 AM ET)" : "7shifts auto-sync disabled");
      refetch();
    } catch (err: any) {
      toast.error(`Failed to toggle: ${err.message}`);
    }
  };

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-orange-50/50 rounded-lg">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-orange-600" />
        <div>
          <p className="text-sm font-medium">Daily Auto-Sync</p>
          <p className="text-xs text-muted-foreground">Runs daily at 6 AM ET</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {schedulerStatus?.running && (
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-xs">
            <Activity className="h-3 w-3 mr-1" /> Active
          </Badge>
        )}
        {schedulerStatus?.lastSync && (
          <span className="text-xs text-muted-foreground">
            Last: {new Date(schedulerStatus.lastSync).toLocaleString()}
          </span>
        )}
        <button
          onClick={handleToggle}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            schedulerStatus?.enabled ? 'bg-orange-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            schedulerStatus?.enabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>
    </div>
  );
}

function SevenShiftsCard() {
  const { data: status, isLoading, refetch } = trpc.sevenShifts.status.useQuery();
  const syncMutation = trpc.sevenShifts.sync.useMutation();
  const [lastSyncResult, setLastSyncResult] = useState<any>(null);

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync();
      setLastSyncResult(result);
      toast.success(
        `Ontario sync complete: ${result.daysProcessed} days processed (${result.inserted} new, ${result.updated} updated). Sales: $${result.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      );
      refetch();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConnected = status?.connected;

  return (
    <Card className={`border-0 shadow-sm ${isConnected ? 'ring-1 ring-orange-200' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`h-14 w-14 rounded-xl ${isConnected ? 'bg-orange-50' : 'bg-slate-100'} flex items-center justify-center`}>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
                <circle cx="12" cy="12" r="10" fill={isConnected ? '#F97316' : '#9CA3AF'} />
                <text x="12" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">7</text>
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">7shifts — Ontario</h3>
                <Badge variant="secondary" className={isConnected ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}>
                  {isConnected ? (
                    <><Wifi className="h-3 w-3 mr-1" /> Connected</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> Disconnected</>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Lightspeed POS via 7shifts — Sales & Labour Data</p>
              {isConnected && status?.companyName && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{status.companyName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-3 w-3" />
                    Company ID: {status.companyId} · Location ID: {status.locationId}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          {isConnected && (
            <Button
              size="sm"
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {syncMutation.isPending ? (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Syncing...</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sync Ontario Data</>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => { refetch(); toast.info("Connection status refreshed"); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        {lastSyncResult && (
          <div className="mt-5 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Last Sync Result</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-orange-600">{lastSyncResult.daysProcessed}</p>
                <p className="text-xs text-muted-foreground">Days</p>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-emerald-600">${lastSyncResult.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">Total Sales</p>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-blue-600">${lastSyncResult.totalLabour.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground">Labour Cost</p>
              </div>
              <div className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-purple-600">{lastSyncResult.totalOrders.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Orders</p>
              </div>
            </div>
            {lastSyncResult.dateRange && (
              <p className="text-xs text-muted-foreground mt-2">
                Date range: {lastSyncResult.dateRange.from} to {lastSyncResult.dateRange.to}
              </p>
            )}
          </div>
        )}

        {isConnected && (
          <div className="mt-5 pt-4 border-t space-y-3">
            <SevenShiftsAutoSyncToggle />
            <div className="bg-orange-50 rounded-lg p-3">
              <p className="text-xs text-orange-800">
                <strong>How it works:</strong> 7shifts connects to your Lightspeed POS and pulls both sales receipts and employee time punches.
                Click "Sync Ontario Data" to fetch the latest data, or enable auto-sync for daily updates at 6 AM ET.
                Sales data is available from Dec 17, 2025 (when Lightspeed was connected to 7shifts).
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Integrations() {
  const { data: integrations, isLoading } = trpc.integrations.list.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connected Systems</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage integrations with external platforms</p>
      </div>

      {/* QuickBooks — Primary Integration */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Accounting</h2>
        <QboConnectionCard />
      </div>

      {/* Koomi POS — Quebec Stores */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">POS — Quebec (Koomi/MYR)</h2>
        <KoomiPosCard />
      </div>

      {/* 7shifts — Ontario POS & Labour */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">POS — Ontario (7shifts/Lightspeed)</h2>
        <SevenShiftsCard />
      </div>

      {/* Auto-Retry Scheduler */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sync Automation</h2>
        <AutoRetrySchedulerCard />
      </div>

      {/* Other Integrations */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Other Systems</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading ? (
            <div className="col-span-2 text-center py-12 text-muted-foreground">Loading integrations...</div>
          ) : integrations?.filter(i => i.name !== 'QuickBooks Online').map(int => {
            const st = statusIcons[int.status || 'disconnected'] || statusIcons.disconnected;
            const Icon = st.icon;
            return (
              <Card key={int.id} className="border-0 shadow-sm">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className={`h-12 w-12 rounded-lg ${st.bg} flex items-center justify-center`}>
                        <Plug className={`h-6 w-6 ${st.color}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold">{int.name}</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">{int.type}</p>
                        {int.lastSyncAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last sync: {new Date(int.lastSyncAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className={`${st.bg} ${st.color}`}>
                      <Icon className="h-3 w-3 mr-1" />
                      {(int.status || 'disconnected').charAt(0).toUpperCase() + (int.status || 'disconnected').slice(1)}
                    </Badge>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toast.info("Feature coming soon")}>
                      Configure
                    </Button>
                    {int.status === 'live' && (
                      <Button size="sm" variant="ghost" onClick={() => toast.info("Sync triggered")}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync Now
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Integration Guide */}
      <Card className="border-0 shadow-sm bg-slate-50">
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">How the QBO Integration Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</div>
              <div>
                <p className="font-medium">Connect</p>
                <p className="text-muted-foreground text-xs">Click "Connect to QuickBooks" and authorize access</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</div>
              <div>
                <p className="font-medium">Auto-Refresh</p>
                <p className="text-muted-foreground text-xs">Tokens refresh automatically — no manual management</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</div>
              <div>
                <p className="font-medium">Sync Bills</p>
                <p className="text-muted-foreground text-xs">Push approved invoices as Bills to QBO</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">4</div>
              <div>
                <p className="font-medium">Auto-Retry</p>
                <p className="text-muted-foreground text-xs">Failed syncs auto-retry every 5 min during business hours</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
