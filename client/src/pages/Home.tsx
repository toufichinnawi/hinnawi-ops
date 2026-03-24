import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign, TrendingUp, FileText, AlertTriangle, ArrowUpRight,
  ArrowDownRight, Clock, CheckCircle2, XCircle, ChevronRight, UtensilsCrossed, ChefHat,
  RefreshCw, Wifi, WifiOff, ShoppingBag, Users
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import DataExportPanel from "@/components/DataExportPanel";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, LineChart, Line, ComposedChart, Area,
  Cell, PieChart, Pie
} from "recharts";

const LOCATION_COLORS: Record<string, string> = {
  PK: '#3b82f6', MK: '#10b981', ONT: '#f59e0b', CT: '#8b5cf6', FAC: '#ef4444',
};

const STORE_NAMES: Record<string, string> = {
  PK: 'President Kennedy', MK: 'Mackay', ONT: 'Ontario', CT: 'Cathcart/Tunnel', FAC: 'Factory',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function formatCurrencyFull(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

function formatPct(val: number) {
  return `${val.toFixed(1)}%`;
}

function formatNum(val: number) {
  return new Intl.NumberFormat('en-CA').format(Math.round(val));
}

// ─── Koomi Sync Status Widget ───
function KoomiSyncStatus() {
  const { data: integrations } = trpc.integrations.list.useQuery();
  const { data: schedulerStatus } = trpc.koomi.schedulerStatus.useQuery();

  const koomiIntegration = integrations?.find((i: any) => i.name === 'Koomi POS');
  const isConnected = koomiIntegration?.status === 'live';
  const lastSync = koomiIntegration?.lastSyncAt;
  const autoSyncEnabled = schedulerStatus?.enabled ?? false;

  const timeSince = useMemo(() => {
    if (!lastSync) return 'Never synced';
    const diff = Date.now() - new Date(lastSync).getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
    if (hours > 0) return `${hours}h ${mins}m ago`;
    return `${mins}m ago`;
  }, [lastSync]);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isConnected ? 'bg-emerald-100' : 'bg-red-100'}`}>
        {isConnected ? <Wifi className="h-4 w-4 text-emerald-600" /> : <WifiOff className="h-4 w-4 text-red-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Koomi POS</p>
        <p className="text-xs text-muted-foreground">
          {isConnected ? `Synced ${timeSince}` : 'Disconnected'}
          {autoSyncEnabled && <span className="ml-1 text-emerald-600">&middot; Auto-sync on</span>}
        </p>
      </div>
      <Badge variant={isConnected ? "secondary" : "destructive"} className={isConnected ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : ""}>
        {isConnected ? 'Live' : 'Offline'}
      </Badge>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const today = useMemo(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }, []);

  const [startDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });

  const [monthStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });

  const { data: kpis, isLoading: kpisLoading } = trpc.dashboard.kpis.useQuery({ date: today });
  const { data: perf } = trpc.dashboard.storePerformance.useQuery({ startDate: monthStart, endDate: today });
  const { data: trend } = trpc.dashboard.salesTrend.useQuery({ startDate, endDate: today });
  const { data: alertsData } = trpc.alerts.active.useQuery();
  const { data: invoicesData } = trpc.invoices.list.useQuery({ status: 'pending' });
  const { data: menuSummary } = trpc.menuItems.summary.useQuery();

  const primeCostPct = useMemo(() => {
    if (!perf || perf.length === 0) return 0;
    const totalRev = perf.reduce((s, p) => s + p.revenue, 0);
    const totalLabor = perf.reduce((s, p) => s + p.laborCost, 0);
    const totalCogs = totalRev * 0.29;
    return totalRev > 0 ? ((totalLabor + totalCogs) / totalRev) * 100 : 0;
  }, [perf]);

  const hasActualLabor = useMemo(() => {
    if (!perf) return false;
    return perf.some(p => p.laborCost > 0);
  }, [perf]);

  // ─── Chart Data: Daily Revenue by Store ───
  const chartData = useMemo(() => {
    if (!trend) return [];
    return trend.slice(-30).map(t => ({
      date: new Date(t.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
      rawDate: t.date,
      total: Math.round(t.total),
      PK: Math.round(Number((t as any).PK) || 0),
      MK: Math.round(Number((t as any).MK) || 0),
      ONT: Math.round(Number((t as any).ONT) || 0),
      CT: Math.round(Number((t as any).CT) || 0),
      orders: (t as any).orders || 0,
      labor: Number((t as any).labor) || 0,
    }));
  }, [trend]);

  const trendStats = useMemo(() => {
    if (chartData.length < 14) return { avg: 0, trend: 0, best: '', bestVal: 0 };
    const last7 = chartData.slice(-7);
    const prev7 = chartData.slice(-14, -7);
    const avgLast = last7.reduce((s, d) => s + d.total, 0) / 7;
    const avgPrev = prev7.reduce((s, d) => s + d.total, 0) / 7;
    const trendPct = avgPrev > 0 ? ((avgLast - avgPrev) / avgPrev) * 100 : 0;
    const best = chartData.reduce((a, b) => b.total > a.total ? b : a, chartData[0]);
    return { avg: avgLast, trend: trendPct, best: best.date, bestVal: best.total };
  }, [chartData]);

  // ─── Chart Data: Revenue vs Labor ───
  const revLaborData = useMemo(() => {
    if (!chartData.length) return [];
    return chartData.map(d => ({
      date: d.date,
      revenue: d.total,
      labor: d.labor,
      laborPct: d.total > 0 ? (d.labor / d.total) * 100 : 0,
    }));
  }, [chartData]);

  // ─── Chart Data: Order Volume & Avg Ticket ───
  const orderData = useMemo(() => {
    if (!chartData.length) return [];
    return chartData.map(d => ({
      date: d.date,
      orders: d.orders,
      avgTicket: d.orders > 0 ? d.total / d.orders : 0,
      revenue: d.total,
    }));
  }, [chartData]);

  // ─── Chart Data: Day-of-Week Heatmap ───
  const dayOfWeekData = useMemo(() => {
    if (!chartData.length) return [];
    const byDay: Record<number, { revenue: number[]; orders: number[]; labor: number[] }> = {};
    for (let i = 0; i < 7; i++) byDay[i] = { revenue: [], orders: [], labor: [] };

    for (const d of chartData) {
      const dayNum = new Date(d.rawDate + 'T12:00:00').getDay();
      byDay[dayNum].revenue.push(d.total);
      byDay[dayNum].orders.push(d.orders);
      byDay[dayNum].labor.push(d.labor);
    }

    return DAY_NAMES.map((name, i) => {
      const rev = byDay[i].revenue;
      const ord = byDay[i].orders;
      const lab = byDay[i].labor;
      const avgRev = rev.length > 0 ? rev.reduce((a, b) => a + b, 0) / rev.length : 0;
      const avgOrd = ord.length > 0 ? ord.reduce((a, b) => a + b, 0) / ord.length : 0;
      const avgLab = lab.length > 0 ? lab.reduce((a, b) => a + b, 0) / lab.length : 0;
      return {
        day: name,
        avgRevenue: Math.round(avgRev),
        avgOrders: Math.round(avgOrd),
        avgLabor: Math.round(avgLab),
        laborPct: avgRev > 0 ? (avgLab / avgRev) * 100 : 0,
        avgTicket: avgOrd > 0 ? avgRev / avgOrd : 0,
        count: rev.length,
      };
    });
  }, [chartData]);

  // ─── Chart Data: Store Revenue Pie ───
  const storePieData = useMemo(() => {
    if (!perf) return [];
    return perf
      .filter(p => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map(p => ({
        name: p.code,
        fullName: p.name,
        value: Math.round(p.revenue),
        color: LOCATION_COLORS[p.code] || '#94a3b8',
      }));
  }, [perf]);

  // ─── Summary Stats ───
  const summaryStats = useMemo(() => {
    if (!chartData.length) return { totalRev: 0, totalOrders: 0, totalLabor: 0, avgDaily: 0, avgTicket: 0, laborPct: 0, daysWithData: 0 };
    const totalRev = chartData.reduce((s, d) => s + d.total, 0);
    const totalOrders = chartData.reduce((s, d) => s + d.orders, 0);
    const totalLabor = chartData.reduce((s, d) => s + d.labor, 0);
    const daysWithData = chartData.filter(d => d.total > 0).length;
    return {
      totalRev,
      totalOrders,
      totalLabor,
      avgDaily: daysWithData > 0 ? totalRev / daysWithData : 0,
      avgTicket: totalOrders > 0 ? totalRev / totalOrders : 0,
      laborPct: totalRev > 0 ? (totalLabor / totalRev) * 100 : 0,
      daysWithData,
    };
  }, [chartData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation('/cfo')}>
          CFO Intelligence <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* KPI Cards — 6 cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Today's Sales</p>
            <p className="text-xl font-bold mt-0.5">
              {kpisLoading ? '...' : formatCurrency(kpis?.totalSales || 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">30-Day Avg/Day</p>
            <p className="text-xl font-bold mt-0.5">{formatCurrency(summaryStats.avgDaily)}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-violet-50 flex items-center justify-center">
                <ShoppingBag className="h-4 w-4 text-violet-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Avg Ticket</p>
            <p className="text-xl font-bold mt-0.5">{formatCurrencyFull(summaryStats.avgTicket)}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <Users className="h-4 w-4 text-amber-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Labor %</p>
            <p className={`text-xl font-bold mt-0.5 ${summaryStats.laborPct > 35 ? 'text-red-600' : summaryStats.laborPct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {formatPct(summaryStats.laborPct)}
            </p>
            {hasActualLabor && <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-emerald-300 text-emerald-700 mt-1">actual</Badge>}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-rose-50 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-rose-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Prime Cost %</p>
            <p className={`text-xl font-bold mt-0.5 ${primeCostPct > 65 ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatPct(primeCostPct)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="h-9 w-9 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Alerts</p>
            <p className="text-xl font-bold mt-0.5">{kpis?.alertCount || 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {alertsData?.filter(a => a.severity === 'urgent').length || 0} urgent
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts Section — Tabbed */}
      <Card className="border-0 shadow-sm">
        <Tabs defaultValue="revenue" className="w-full">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base font-semibold">Sales Analytics</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Last 30 days — data from Koomi POS &amp; Lightspeed</p>
                <div className="mt-2">
                  <DataExportPanel compact types={['dailySales', 'combined']} />
                </div>
              </div>
              <TabsList className="h-8">
                <TabsTrigger value="revenue" className="text-xs h-7 px-3">Revenue</TabsTrigger>
                <TabsTrigger value="labor" className="text-xs h-7 px-3">Rev vs Labor</TabsTrigger>
                <TabsTrigger value="orders" className="text-xs h-7 px-3">Orders</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs h-7 px-3">Day of Week</TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>

          {/* Tab 1: Revenue by Store (existing stacked bar) */}
          <TabsContent value="revenue">
            <CardContent>
              <div className="flex items-center gap-4 text-xs mb-4">
                <div className="text-right">
                  <p className="text-muted-foreground">7-Day Avg</p>
                  <p className="font-semibold text-sm">{formatCurrency(trendStats.avg)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">WoW Trend</p>
                  <p className={`font-semibold text-sm flex items-center justify-end gap-0.5 ${trendStats.trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {trendStats.trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(trendStats.trend).toFixed(1)}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Best Day</p>
                  <p className="font-semibold text-sm">{trendStats.best} ({formatCurrency(trendStats.bestVal)})</p>
                </div>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={chartData.length > 20 ? 2 : 1} />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v: number, name: string) => [formatCurrency(v), name]}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="PK" stackId="stores" fill="#3b82f6" radius={[0, 0, 0, 0]} name="PK" />
                    <Bar dataKey="MK" stackId="stores" fill="#10b981" radius={[0, 0, 0, 0]} name="MK" />
                    <Bar dataKey="ONT" stackId="stores" fill="#f59e0b" radius={[0, 0, 0, 0]} name="ONT" />
                    <Bar dataKey="CT" stackId="stores" fill="#8b5cf6" radius={[2, 2, 0, 0]} name="CT" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </TabsContent>

          {/* Tab 2: Revenue vs Labor Cost */}
          <TabsContent value="labor">
            <CardContent>
              <div className="flex items-center gap-4 text-xs mb-4">
                <div className="text-right">
                  <p className="text-muted-foreground">30-Day Revenue</p>
                  <p className="font-semibold text-sm">{formatCurrency(summaryStats.totalRev)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">30-Day Labor</p>
                  <p className="font-semibold text-sm">{formatCurrency(summaryStats.totalLabor)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Avg Labor %</p>
                  <p className={`font-semibold text-sm ${summaryStats.laborPct > 35 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatPct(summaryStats.laborPct)}
                  </p>
                </div>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={revLaborData}>
                    <defs>
                      <linearGradient id="revGradHome" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={revLaborData.length > 20 ? 2 : 1} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `${v}%`} domain={[0, 60]} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v: number, name: string) => [name === 'Labor %' ? `${v.toFixed(1)}%` : formatCurrency(v), name]}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Area yAxisId="left" type="monotone" dataKey="revenue" fill="url(#revGradHome)" stroke="#3b82f6" strokeWidth={2} name="Revenue" />
                    <Bar yAxisId="left" dataKey="labor" fill="#ef4444" opacity={0.7} radius={[2, 2, 0, 0]} name="Labor Cost" />
                    <Line yAxisId="right" type="monotone" dataKey="laborPct" stroke="#f59e0b" strokeWidth={2} dot={false} name="Labor %" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </TabsContent>

          {/* Tab 3: Order Volume & Avg Ticket */}
          <TabsContent value="orders">
            <CardContent>
              <div className="flex items-center gap-4 text-xs mb-4">
                <div className="text-right">
                  <p className="text-muted-foreground">Total Orders (30d)</p>
                  <p className="font-semibold text-sm">{formatNum(summaryStats.totalOrders)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Avg Orders/Day</p>
                  <p className="font-semibold text-sm">{formatNum(summaryStats.daysWithData > 0 ? summaryStats.totalOrders / summaryStats.daysWithData : 0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Avg Ticket</p>
                  <p className="font-semibold text-sm">{formatCurrencyFull(summaryStats.avgTicket)}</p>
                </div>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={orderData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={orderData.length > 20 ? 2 : 1} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `$${v.toFixed(0)}`} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v: number, name: string) => [name === 'Avg Ticket' ? formatCurrencyFull(v) : formatNum(v), name]}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar yAxisId="left" dataKey="orders" fill="#8b5cf6" opacity={0.8} radius={[2, 2, 0, 0]} name="Orders" />
                    <Line yAxisId="right" type="monotone" dataKey="avgTicket" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} name="Avg Ticket" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </TabsContent>

          {/* Tab 4: Day-of-Week Performance */}
          <TabsContent value="weekly">
            <CardContent>
              <p className="text-xs text-muted-foreground mb-4">Average performance by day of week (last 30 days)</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Bar chart */}
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dayOfWeekData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        formatter={(v: number, name: string) => [name === 'Avg Revenue' ? formatCurrency(v) : formatNum(v), name]}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="avgRevenue" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Avg Revenue" />
                      <Line yAxisId="right" type="monotone" dataKey="avgOrders" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Avg Orders" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Heatmap Table */}
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium text-muted-foreground">Day</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Avg Rev</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Orders</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Ticket</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">Labor %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayOfWeekData.map(d => {
                        const maxRev = Math.max(...dayOfWeekData.map(x => x.avgRevenue));
                        const intensity = maxRev > 0 ? d.avgRevenue / maxRev : 0;
                        return (
                          <tr key={d.day} className="border-b last:border-0">
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(59, 130, 246, ${0.15 + intensity * 0.85})` }} />
                                <span className="font-medium">{d.day}</span>
                              </div>
                            </td>
                            <td className="text-right py-2.5 font-medium">{formatCurrency(d.avgRevenue)}</td>
                            <td className="text-right py-2.5">{formatNum(d.avgOrders)}</td>
                            <td className="text-right py-2.5">{formatCurrencyFull(d.avgTicket)}</td>
                            <td className="text-right py-2.5">
                              <span className={d.laborPct > 35 ? 'text-red-600' : d.laborPct > 30 ? 'text-amber-600' : 'text-emerald-600'}>
                                {formatPct(d.laborPct)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>

      {/* Store Performance + Alerts + Sync Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store Performance Table */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Store Performance (MTD){hasActualLabor && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-emerald-300 text-emerald-700 ml-2">actual labor data</Badge>}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setLocation('/reports')}>
                View Reports <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Table */}
              <div className="lg:col-span-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 font-medium text-muted-foreground">Location</th>
                      <th className="text-right py-3 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right py-3 font-medium text-muted-foreground">Labor %</th>
                      <th className="text-right py-3 font-medium text-muted-foreground">Target</th>
                      <th className="text-right py-3 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perf?.filter(p => p.revenue > 0).map(p => {
                      const laborOk = p.laborPct <= p.laborTarget + 2;
                      return (
                        <tr key={p.locationId} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LOCATION_COLORS[p.code] || '#94a3b8' }} />
                              <span className="font-medium">{p.name}</span>
                            </div>
                          </td>
                          <td className="text-right py-3 font-medium">{formatCurrency(p.revenue)}</td>
                          <td className="text-right py-3">
                            <span className={laborOk ? 'text-emerald-600' : 'text-red-600'}>{formatPct(p.laborPct)}</span>
                          </td>
                          <td className="text-right py-3 text-muted-foreground">{formatPct(p.laborTarget)}</td>
                          <td className="text-right py-3">
                            {laborOk ? (
                              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">On Track</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-red-50 text-red-700 hover:bg-red-50">Over</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pie Chart */}
              <div className="flex flex-col items-center justify-center">
                <p className="text-xs font-medium text-muted-foreground mb-2">Revenue Share (MTD)</p>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={storePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {storePieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        formatter={(v: number, name: string) => [formatCurrency(v), name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-1">
                  {storePieData.map(s => (
                    <div key={s.name} className="flex items-center gap-1 text-xs">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span>{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Alerts + Koomi Sync + Operations */}
        <div className="space-y-4">
          {/* Koomi Sync Status */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Data Sources</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLocation('/integrations')}>
                  Manage <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <KoomiSyncStatus />
            </CardContent>
          </Card>

          {/* Alerts Panel */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Alerts & Exceptions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[200px]">
                <div className="px-6 space-y-2 pb-4">
                  {alertsData?.map(alert => (
                    <div key={alert.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                      <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                        alert.severity === 'urgent' ? 'bg-red-500' : alert.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium leading-tight">{alert.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{alert.description}</p>
                      </div>
                    </div>
                  ))}
                  {(!alertsData || alertsData.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                      <CheckCircle2 className="h-6 w-6 mb-1 text-emerald-500" />
                      <p className="text-xs">All clear</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Operations Queue + Recipe Coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Operations Queue */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Operations Queue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[220px]">
              <div className="px-6 space-y-2 pb-4">
                {invoicesData?.slice(0, 5).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer" onClick={() => setLocation('/invoices')}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{inv.supplierName}</p>
                      <p className="text-xs text-muted-foreground">{inv.invoiceNumber} · {inv.locationName}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-medium">{formatCurrency(Number(inv.total))}</p>
                      <Badge variant="outline" className="text-xs mt-1">Pending</Badge>
                    </div>
                  </div>
                ))}
                <Separator className="my-2" />
                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setLocation('/inventory')}>
                  <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Weekly inventory count due</p>
                    <p className="text-xs text-muted-foreground">Factory — last count 5 days ago</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setLocation('/purchasing')}>
                  <Clock className="h-4 w-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Review production quantities</p>
                    <p className="text-xs text-muted-foreground">Tomorrow's prep for PK & MK</p>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recipe Coverage Widget */}
        {menuSummary && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ChefHat className="h-4 w-4" /> Menu Item COGS Coverage
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setLocation('/menu-items')}>
                  Manage <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Coverage</span>
                    <span className="font-bold">{menuSummary.coveragePercent}%</span>
                  </div>
                  <Progress value={menuSummary.coveragePercent} className="h-2" />
                  <p className="text-xs text-muted-foreground">{menuSummary.withRecipe} of {menuSummary.totalItems} items</p>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">{menuSummary.withRecipe} Costed</p>
                    <p className="text-[10px] text-emerald-600">Actual COGS</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => setLocation('/menu-items')}>
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">{menuSummary.withoutRecipe} Uncosted</p>
                    <p className="text-[10px] text-amber-600">Default %</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50">
                  <UtensilsCrossed className="h-4 w-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">{menuSummary.totalItems} Total</p>
                    <p className="text-[10px] text-blue-600">{menuSummary.byCategory ? Object.keys(menuSummary.byCategory).length : 0} categories</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
