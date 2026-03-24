import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DollarSign, TrendingUp, TrendingDown, Users, BarChart3, Target,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2, Lightbulb, Wallet,
  Calendar as CalendarIcon, GitCompareArrows
} from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import DataExportPanel from "@/components/DataExportPanel";
import { format, subDays, subMonths, subYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line, ComposedChart, Area
} from "recharts";

const STORE_COLORS: Record<string, string> = {
  PK: '#3b82f6', MK: '#10b981', ONT: '#f59e0b', CT: '#8b5cf6', FAC: '#ef4444',
};

function fmt(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

function fmtShort(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function fmtPct(val: number) { return `${val.toFixed(1)}%`; }

function getDateRange(period: string, customFrom?: Date, customTo?: Date) {
  const now = new Date();
  let start: Date;
  let end: Date = now;
  if (period === 'custom' && customFrom && customTo) {
    return { startDate: format(customFrom, 'yyyy-MM-dd'), endDate: format(customTo, 'yyyy-MM-dd') };
  } else if (period === 'today') {
    return { startDate: format(now, 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
  } else if (period === 'this_week') {
    start = startOfWeek(now, { weekStartsOn: 1 });
    return { startDate: format(start, 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
  } else if (period === 'last_week') {
    const lastWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const lastWeekEnd = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    return { startDate: format(lastWeekStart, 'yyyy-MM-dd'), endDate: format(lastWeekEnd, 'yyyy-MM-dd') };
  } else if (period === 'mtd') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'qtd') {
    const q = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), q, 1);
  } else if (period === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1);
  } else if (period === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: format(start, 'yyyy-MM-dd'), endDate: format(end, 'yyyy-MM-dd') };
  } else if (period === 'last_quarter') {
    const q = Math.floor(now.getMonth() / 3) * 3 - 3;
    start = new Date(now.getFullYear(), q, 1);
    end = new Date(now.getFullYear(), q + 3, 0);
    return { startDate: format(start, 'yyyy-MM-dd'), endDate: format(end, 'yyyy-MM-dd') };
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return { startDate: format(start, 'yyyy-MM-dd'), endDate: format(end, 'yyyy-MM-dd') };
}

type CompareMode = 'none' | 'prev_period' | 'prev_year' | 'prev_week' | 'custom';

function getComparisonRange(startDate: string, endDate: string, mode: CompareMode, customCompFrom?: Date, customCompTo?: Date) {
  if (mode === 'none') return null;
  if (mode === 'custom' && customCompFrom && customCompTo) {
    return { startDate: format(customCompFrom, 'yyyy-MM-dd'), endDate: format(customCompTo, 'yyyy-MM-dd') };
  }
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const daySpan = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (mode === 'prev_year') {
    const compStart = subYears(start, 1);
    const compEnd = subYears(end, 1);
    return { startDate: format(compStart, 'yyyy-MM-dd'), endDate: format(compEnd, 'yyyy-MM-dd') };
  }
  if (mode === 'prev_week') {
    const compStart = subDays(start, 7);
    const compEnd = subDays(end, 7);
    return { startDate: format(compStart, 'yyyy-MM-dd'), endDate: format(compEnd, 'yyyy-MM-dd') };
  }
  // prev_period: shift back by the same number of days
  const compStart = subDays(start, daySpan + 1);
  const compEnd = subDays(start, 1);
  return { startDate: format(compStart, 'yyyy-MM-dd'), endDate: format(compEnd, 'yyyy-MM-dd') };
}

function DeltaBadge({ current, previous, isPercent = false }: { current: number; previous: number; isPercent?: boolean }) {
  if (previous === 0) return null;
  const delta = isPercent ? current - previous : ((current - previous) / previous) * 100;
  const isPositive = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
      {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isPercent ? `${Math.abs(delta).toFixed(1)}pp` : `${Math.abs(delta).toFixed(1)}%`}
    </span>
  );
}

// ─── Cash Flow Forecast Section ───
function CashFlowForecastSection({ forecast, isLoading }: { forecast: any; isLoading: boolean }) {
  const [viewMode, setViewMode] = useState<'summary' | 'stores' | 'chart'>('summary');

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  if (!forecast) return (
    <Card className="border-0 shadow-sm">
      <CardContent className="py-12 text-center">
        <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Not enough historical data to generate a forecast. At least 14 days of sales data per store is required.</p>
      </CardContent>
    </Card>
  );

  const { totals, storeForecasts } = forecast;

  // Build chart data from the first store's daily projections aggregated
  const chartData = useMemo(() => {
    if (!storeForecasts || storeForecasts.length === 0) return [];
    // Aggregate daily projections across all stores
    const byDate = new Map<string, { projected: number; optimistic: number; pessimistic: number }>();
    for (const sf of storeForecasts) {
      for (const dp of sf.dailyProjections) {
        if (!byDate.has(dp.date)) byDate.set(dp.date, { projected: 0, optimistic: 0, pessimistic: 0 });
        const entry = byDate.get(dp.date)!;
        entry.projected += dp.projected;
        entry.optimistic += dp.optimistic;
        entry.pessimistic += dp.pessimistic;
      }
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date: new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
        rawDate: date,
        projected: Math.round(vals.projected),
        optimistic: Math.round(vals.optimistic),
        pessimistic: Math.round(vals.pessimistic),
      }));
  }, [storeForecasts]);

  return (
    <div className="space-y-4">
      {/* Forecast KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: '30-Day Forecast', val: totals.forecast30, opt: totals.optimistic30, pess: totals.pessimistic30, labor: totals.laborForecast30 },
          { label: '60-Day Forecast', val: totals.forecast60, opt: totals.optimistic60, pess: totals.pessimistic60, labor: totals.laborForecast60 },
          { label: '90-Day Forecast', val: totals.forecast90, opt: totals.optimistic90, pess: totals.pessimistic90, labor: totals.laborForecast90 },
        ].map((item) => (
          <Card key={item.label} className="border-0 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
              </div>
              <p className="text-2xl font-bold">{fmt(item.val)}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span className="text-emerald-600">High: {fmt(item.opt)}</span>
                <span className="text-red-500">Low: {fmt(item.pess)}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Est. Labor: {fmt(item.labor)} ({item.val > 0 ? fmtPct((item.labor / item.val) * 100) : '0%'})
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View Mode Toggle */}
      <div className="flex gap-2">
        {(['summary', 'stores', 'chart'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === mode ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {mode === 'summary' ? 'Summary' : mode === 'stores' ? 'By Store' : 'Projection Chart'}
          </button>
        ))}
      </div>

      {/* Summary View */}
      {viewMode === 'summary' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Forecast Methodology</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Projections use a <strong>weighted moving average</strong> with exponential decay (recent days weighted higher),
                adjusted for <strong>day-of-week seasonality</strong> and <strong>linear trend</strong> from the last 30 vs prior 30 days.
                Confidence intervals use ~80% bounds based on recent revenue volatility.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {storeForecasts.map((sf: any) => (
                  <div key={sf.locationId} className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STORE_COLORS[sf.locationCode] || '#6b7280' }} />
                      <span className="text-xs font-medium">{sf.locationCode}</span>
                    </div>
                    <p className="text-sm font-bold">{fmt(sf.avgDailyRevenue)}<span className="text-xs font-normal text-muted-foreground">/day</span></p>
                    <p className={`text-xs mt-1 ${sf.recentTrend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {sf.recentTrend >= 0 ? '\u2197' : '\u2198'} {sf.recentTrend.toFixed(1)}% trend
                    </p>
                    <p className="text-xs text-muted-foreground">{sf.historicalDays} days data</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* By Store View */}
      {viewMode === 'stores' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Store-Level Forecast Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Store</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Avg Daily</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Trend</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">30-Day</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">60-Day</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">90-Day</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Est. Labor (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {storeForecasts.sort((a: any, b: any) => b.forecast30 - a.forecast30).map((sf: any) => (
                    <tr key={sf.locationId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-3 font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STORE_COLORS[sf.locationCode] || '#6b7280' }} />
                          {sf.locationCode} - {sf.locationName}
                        </div>
                      </td>
                      <td className="text-right py-3 px-3">{fmt(sf.avgDailyRevenue)}</td>
                      <td className="text-right py-3 px-3">
                        <span className={sf.recentTrend >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                          {sf.recentTrend >= 0 ? '+' : ''}{sf.recentTrend.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right py-3 px-3 font-medium">{fmt(sf.forecast30)}</td>
                      <td className="text-right py-3 px-3">{fmt(sf.forecast60)}</td>
                      <td className="text-right py-3 px-3">{fmt(sf.forecast90)}</td>
                      <td className="text-right py-3 px-3 text-muted-foreground">{fmt(sf.laborForecast30)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold bg-muted/20">
                    <td className="py-3 px-3">Total (All Stores)</td>
                    <td className="text-right py-3 px-3">{fmt(storeForecasts.reduce((s: number, f: any) => s + f.avgDailyRevenue, 0))}</td>
                    <td className="text-right py-3 px-3">—</td>
                    <td className="text-right py-3 px-3">{fmt(totals.forecast30)}</td>
                    <td className="text-right py-3 px-3">{fmt(totals.forecast60)}</td>
                    <td className="text-right py-3 px-3">{fmt(totals.forecast90)}</td>
                    <td className="text-right py-3 px-3 text-muted-foreground">{fmt(totals.laborForecast30)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projection Chart View */}
      {viewMode === 'chart' && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">90-Day Revenue Projection</CardTitle>
            <p className="text-xs text-muted-foreground">Shaded area shows 80% confidence interval</p>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="#94a3b8" interval={6} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    formatter={(v: number, name: string) => [fmt(v), name === 'projected' ? 'Projected' : name === 'optimistic' ? 'High Estimate' : 'Low Estimate']}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="optimistic" fill="#dbeafe" stroke="none" name="High Estimate" fillOpacity={0.4} />
                  <Area type="monotone" dataKey="pessimistic" fill="#ffffff" stroke="none" name="Low Estimate" fillOpacity={1} />
                  <Line type="monotone" dataKey="projected" stroke="#3b82f6" strokeWidth={2} dot={false} name="Projected" />
                  <Line type="monotone" dataKey="optimistic" stroke="#10b981" strokeWidth={1} strokeDasharray="4 4" dot={false} name="High Estimate" />
                  <Line type="monotone" dataKey="pessimistic" stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Low Estimate" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* 30/60/90 day markers */}
            <div className="flex justify-between mt-3 text-xs text-muted-foreground px-2">
              <span>Day 1</span>
              <span className="border-l pl-2">Day 30 — {fmt(totals.forecast30)}</span>
              <span className="border-l pl-2">Day 60 — {fmt(totals.forecast60)}</span>
              <span className="border-l pl-2">Day 90 — {fmt(totals.forecast90)}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function CFODashboard() {
  const [period, setPeriod] = useState('today');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [compCustomFrom, setCompCustomFrom] = useState<Date | undefined>(undefined);
  const [compCustomTo, setCompCustomTo] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [compFromOpen, setCompFromOpen] = useState(false);
  const [compToOpen, setCompToOpen] = useState(false);

  const { startDate, endDate } = useMemo(() => getDateRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const compRange = useMemo(() => getComparisonRange(startDate, endDate, compareMode, compCustomFrom, compCustomTo), [startDate, endDate, compareMode, compCustomFrom, compCustomTo]);

  const { data: profitability, isLoading: profLoading } = trpc.cfo.profitability.useQuery({ startDate, endDate });
  const { data: compProfitability } = trpc.cfo.profitability.useQuery(
    compRange ? { startDate: compRange.startDate, endDate: compRange.endDate } : { startDate: '', endDate: '' },
    { enabled: !!compRange }
  );
  const { data: trends } = trpc.cfo.revenueTrends.useQuery(
    storeFilter !== 'all' ? { locationId: parseInt(storeFilter) } : undefined
  );
  const { data: labor } = trpc.cfo.laborEfficiency.useQuery({ startDate, endDate });
  const { data: compLabor } = trpc.cfo.laborEfficiency.useQuery(
    compRange ? { startDate: compRange.startDate, endDate: compRange.endDate } : { startDate: '', endDate: '' },
    { enabled: !!compRange }
  );
  const { data: forecast, isLoading: forecastLoading } = trpc.cfo.cashFlowForecast.useQuery();

  // Aggregate KPIs
  const kpis = useMemo(() => {
    if (!profitability) return null;
    const stores = storeFilter === 'all' ? profitability : profitability.filter(p => p.locationId === parseInt(storeFilter));
    const totalRevenue = stores.reduce((s, p) => s + p.revenue, 0);
    const totalLabor = stores.reduce((s, p) => s + p.laborCost, 0);
    const totalCOGS = stores.reduce((s, p) => s + p.estimatedCOGS, 0);
    const totalGross = stores.reduce((s, p) => s + p.grossProfit, 0);
    const totalNet = stores.reduce((s, p) => s + p.netAfterLabor, 0);
    const totalOrders = stores.reduce((s, p) => s + p.orders, 0);
    const totalDays = Math.max(...stores.map(s => s.days), 1);
    const primeCost = totalRevenue > 0 ? ((totalLabor + totalCOGS) / totalRevenue) * 100 : 0;
    return {
      totalRevenue, totalLabor, totalCOGS, totalGross, totalNet, totalOrders, totalDays,
      grossMargin: totalRevenue > 0 ? (totalGross / totalRevenue) * 100 : 0,
      netMargin: totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0,
      laborPct: totalRevenue > 0 ? (totalLabor / totalRevenue) * 100 : 0,
      primeCost,
      avgDaily: totalRevenue / totalDays,
      avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    };
  }, [profitability, storeFilter]);

  // Comparison KPIs
  const compKpis = useMemo(() => {
    if (!compProfitability || !compRange) return null;
    const stores = storeFilter === 'all' ? compProfitability : compProfitability.filter(p => p.locationId === parseInt(storeFilter));
    const totalRevenue = stores.reduce((s, p) => s + p.revenue, 0);
    const totalLabor = stores.reduce((s, p) => s + p.laborCost, 0);
    const totalCOGS = stores.reduce((s, p) => s + p.estimatedCOGS, 0);
    const totalGross = stores.reduce((s, p) => s + p.grossProfit, 0);
    const totalNet = stores.reduce((s, p) => s + p.netAfterLabor, 0);
    const totalOrders = stores.reduce((s, p) => s + p.orders, 0);
    const totalDays = Math.max(...stores.map(s => s.days), 1);
    const primeCost = totalRevenue > 0 ? ((totalLabor + totalCOGS) / totalRevenue) * 100 : 0;
    return {
      totalRevenue, totalLabor, totalCOGS, totalGross, totalNet, totalOrders, totalDays,
      grossMargin: totalRevenue > 0 ? (totalGross / totalRevenue) * 100 : 0,
      netMargin: totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0,
      laborPct: totalRevenue > 0 ? (totalLabor / totalRevenue) * 100 : 0,
      primeCost,
      avgDaily: totalRevenue / totalDays,
      avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    };
  }, [compProfitability, storeFilter, compRange]);

  // Revenue trend chart data
  const trendChart = useMemo(() => {
    if (!trends) return [];
    return trends.map((t, i) => {
      const prev = i > 0 ? trends[i - 1] : null;
      const growth = prev && prev.revenue > 0 ? ((t.revenue - prev.revenue) / prev.revenue) * 100 : 0;
      return {
        month: t.month,
        revenue: Math.round(t.revenue),
        labor: Math.round(t.laborCost),
        avgDaily: Math.round(t.avgDaily),
        avgTicket: parseFloat(t.avgTicket.toFixed(2)),
        growth: parseFloat(growth.toFixed(1)),
      };
    });
  }, [trends]);

  // Store comparison chart
  const storeComparison = useMemo(() => {
    if (!profitability) return [];
    return profitability
      .filter(p => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map(p => ({
        name: p.code,
        revenue: Math.round(p.revenue),
        labor: Math.round(p.laborCost),
        cogs: Math.round(p.estimatedCOGS),
        net: Math.round(p.netAfterLabor),
        laborPct: parseFloat(p.laborPct.toFixed(1)),
        grossMargin: parseFloat(p.grossMarginPct.toFixed(1)),
      }));
  }, [profitability]);

  // Strategic insights
  const insights = useMemo(() => {
    if (!profitability || !labor) return [];
    const items: { type: 'success' | 'warning' | 'insight'; text: string }[] = [];

    for (const p of profitability) {
      if (p.laborPct > p.laborTarget + 3) {
        items.push({
          type: 'warning',
          text: `${p.code} labor cost at ${fmtPct(p.laborPct)} — ${fmtPct(p.laborPct - p.laborTarget)} above target. Potential savings: ${fmtShort(p.revenue * (p.laborPct - p.laborTarget) / 100)}/period.`
        });
      }
      if (p.laborPct <= p.laborTarget && p.revenue > 0) {
        items.push({
          type: 'success',
          text: `${p.code} labor cost at ${fmtPct(p.laborPct)} — within target of ${fmtPct(p.laborTarget)}.`
        });
      }
    }

    // Revenue per labor hour comparison
    const laborData = labor.filter(l => l.hours > 0);
    if (laborData.length > 1) {
      const best = laborData.reduce((a, b) => a.revenuePerHour > b.revenuePerHour ? a : b);
      const worst = laborData.reduce((a, b) => a.revenuePerHour < b.revenuePerHour ? a : b);
      if (best.revenuePerHour > worst.revenuePerHour * 1.3) {
        items.push({
          type: 'insight',
          text: `${best.code} generates ${fmtShort(best.revenuePerHour)}/labor hour vs ${worst.code} at ${fmtShort(worst.revenuePerHour)}/hour. Review staffing model at ${worst.code}.`
        });
      }
    }

    // Prime cost check
    if (kpis && kpis.primeCost > 65) {
      items.push({
        type: 'warning',
        text: `Prime cost at ${fmtPct(kpis.primeCost)} — above the 65% industry benchmark. Focus on labor scheduling and portion control.`
      });
    } else if (kpis && kpis.primeCost <= 60) {
      items.push({
        type: 'success',
        text: `Prime cost at ${fmtPct(kpis.primeCost)} — excellent, well below the 65% benchmark.`
      });
    }

    // Average ticket insight
    if (profitability.length > 1) {
      const tickets = profitability.filter(p => p.orders > 0).map(p => ({ code: p.code, ticket: p.avgTicket }));
      const best = tickets.reduce((a, b) => a.ticket > b.ticket ? a : b);
      const worst = tickets.reduce((a, b) => a.ticket < b.ticket ? a : b);
      if (best.ticket > worst.ticket * 1.2) {
        items.push({
          type: 'insight',
          text: `Average ticket at ${best.code} is ${fmt(best.ticket)} vs ${fmt(worst.ticket)} at ${worst.code}. Consider upselling strategies at ${worst.code}.`
        });
      }
    }

    return items;
  }, [profitability, labor, kpis]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CFO Intelligence</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {startDate === endDate ? format(new Date(startDate + 'T00:00:00'), 'MMM d, yyyy') : `${format(new Date(startDate + 'T00:00:00'), 'MMM d, yyyy')} — ${format(new Date(endDate + 'T00:00:00'), 'MMM d, yyyy')}`}
              {compRange && <span className="ml-2 text-xs text-blue-600">vs {format(new Date(compRange.startDate + 'T00:00:00'), 'MMM d')} — {format(new Date(compRange.endDate + 'T00:00:00'), 'MMM d, yyyy')}</span>}
            </p>
          </div>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {profitability?.filter(p => p.revenue > 0).map(p => (
                <SelectItem key={p.locationId} value={String(p.locationId)}>{p.code} - {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date Range Controls */}
        <div className="flex flex-wrap items-center gap-2 bg-card rounded-lg border p-2">
          {/* Period Presets */}
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { key: 'today', label: 'Today' },
              { key: 'this_week', label: 'This Week' },
              { key: 'last_week', label: 'Last Week' },
              { key: 'mtd', label: 'MTD' },
              { key: 'last_month', label: 'Last Month' },
              { key: 'qtd', label: 'QTD' },
              { key: 'last_quarter', label: 'Last Qtr' },
              { key: 'ytd', label: 'YTD' },
            ].map(p => (
              <Button
                key={p.key}
                variant={period === p.key ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => { setPeriod(p.key); setCustomFrom(undefined); setCustomTo(undefined); }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="h-5 w-px bg-border mx-1" />

          {/* Custom From/To */}
          <div className="flex items-center gap-1">
            <Popover open={fromOpen} onOpenChange={setFromOpen}>
              <PopoverTrigger asChild>
                <Button variant={period === 'custom' ? 'outline' : 'ghost'} size="sm" className="h-7 text-xs gap-1 px-2">
                  <CalendarIcon className="h-3 w-3" />
                  {customFrom ? format(customFrom, 'MMM d, yy') : 'From'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customFrom}
                  onSelect={(d) => { setCustomFrom(d); if (d && customTo) { setPeriod('custom'); } setFromOpen(false); }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">to</span>
            <Popover open={toOpen} onOpenChange={setToOpen}>
              <PopoverTrigger asChild>
                <Button variant={period === 'custom' ? 'outline' : 'ghost'} size="sm" className="h-7 text-xs gap-1 px-2">
                  <CalendarIcon className="h-3 w-3" />
                  {customTo ? format(customTo, 'MMM d, yy') : 'To'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customTo}
                  onSelect={(d) => { setCustomTo(d); if (d && customFrom) { setPeriod('custom'); } setToOpen(false); }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="h-5 w-px bg-border mx-1" />

          {/* Comparison Mode */}
          <div className="flex items-center gap-1">
            <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={compareMode} onValueChange={(v) => setCompareMode(v as CompareMode)}>
              <SelectTrigger className="h-7 w-[130px] text-xs border-0 bg-transparent shadow-none">
                <SelectValue placeholder="Compare" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Comparison</SelectItem>
                <SelectItem value="prev_period">vs Previous Period</SelectItem>
                <SelectItem value="prev_year">vs Same Period Last Year</SelectItem>
                <SelectItem value="prev_week">vs Previous Week</SelectItem>
                <SelectItem value="custom">vs Custom Range</SelectItem>
              </SelectContent>
            </Select>
            {compareMode === 'custom' && (
              <div className="flex items-center gap-1">
                <Popover open={compFromOpen} onOpenChange={setCompFromOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2">
                      <CalendarIcon className="h-3 w-3" />
                      {compCustomFrom ? format(compCustomFrom, 'MMM d') : 'From'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={compCustomFrom} onSelect={(d) => { setCompCustomFrom(d); setCompFromOpen(false); }} initialFocus />
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-muted-foreground">—</span>
                <Popover open={compToOpen} onOpenChange={setCompToOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1 px-2">
                      <CalendarIcon className="h-3 w-3" />
                      {compCustomTo ? format(compCustomTo, 'MMM d') : 'To'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={compCustomTo} onSelect={(d) => { setCompCustomTo(d); setCompToOpen(false); }} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Buttons */}
      <DataExportPanel compact types={['dailySales', 'payroll', 'combined']} defaultStartDate={startDate} defaultEndDate={endDate} />

      {/* Executive KPI Strip */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Revenue</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-lg font-bold">{fmt(kpis.totalRevenue)}</p>
                {compKpis && <DeltaBadge current={kpis.totalRevenue} previous={compKpis.totalRevenue} />}
              </div>
              <p className="text-xs text-muted-foreground">{fmt(kpis.avgDaily)}/day avg</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gross Profit</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-lg font-bold text-emerald-600">{fmt(kpis.totalGross)}</p>
                {compKpis && <DeltaBadge current={kpis.totalGross} previous={compKpis.totalGross} />}
              </div>
              <p className="text-xs text-muted-foreground">{fmtPct(kpis.grossMargin)} margin {compKpis ? <DeltaBadge current={kpis.grossMargin} previous={compKpis.grossMargin} isPercent /> : null}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net After Labor</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className={`text-lg font-bold ${kpis.totalNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(kpis.totalNet)}</p>
                {compKpis && <DeltaBadge current={kpis.totalNet} previous={compKpis.totalNet} />}
              </div>
              <p className="text-xs text-muted-foreground">{fmtPct(kpis.netMargin)} margin {compKpis ? <DeltaBadge current={kpis.netMargin} previous={compKpis.netMargin} isPercent /> : null}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prime Cost</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className={`text-lg font-bold ${kpis.primeCost <= 65 ? 'text-emerald-600' : 'text-amber-600'}`}>{fmtPct(kpis.primeCost)}</p>
                {compKpis && <DeltaBadge current={kpis.primeCost} previous={compKpis.primeCost} isPercent />}
              </div>
              <p className="text-xs text-muted-foreground">Target: 60%</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Labor %</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className={`text-lg font-bold ${kpis.laborPct <= 25 ? 'text-emerald-600' : 'text-amber-600'}`}>{fmtPct(kpis.laborPct)}</p>
                {compKpis && <DeltaBadge current={kpis.laborPct} previous={compKpis.laborPct} isPercent />}
              </div>
              <p className="text-xs text-muted-foreground">{fmt(kpis.totalLabor)} total</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avg Ticket</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-lg font-bold">{fmt(kpis.avgTicket)}</p>
                {compKpis && <DeltaBadge current={kpis.avgTicket} previous={compKpis.avgTicket} />}
              </div>
              <p className="text-xs text-muted-foreground">{kpis.totalOrders.toLocaleString()} orders {compKpis ? <DeltaBadge current={kpis.totalOrders} previous={compKpis.totalOrders} /> : null}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="profitability" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
          <TabsTrigger value="trends">Revenue Trends</TabsTrigger>
          <TabsTrigger value="forecast">Cash Flow Forecast</TabsTrigger>
          <TabsTrigger value="labor">Labor Efficiency</TabsTrigger>
          <TabsTrigger value="insights">Strategic Insights</TabsTrigger>
        </TabsList>

        {/* ─── Profitability Tab ─── */}
        <TabsContent value="profitability" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue vs Cost by Store */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Revenue vs Cost by Store</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={storeComparison} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [fmtShort(v)]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="cogs" fill="#f59e0b" name="Est. COGS" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="labor" fill="#ef4444" name="Labor" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Margin Comparison */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Margin & Labor % by Store</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={storeComparison}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [`${v}%`, name]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="grossMargin" fill="#10b981" name="Gross Margin %" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="laborPct" fill="#ef4444" name="Labor %" radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="grossMargin" stroke="#10b981" strokeWidth={0} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed P&L Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Store P&L Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Store</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Est. COGS</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Gross Profit</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Gross %</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Labor</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Labor %</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Target</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Net After Labor</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Prime Cost %</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Avg Ticket</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitability?.filter(p => p.revenue > 0).sort((a, b) => b.revenue - a.revenue).map(p => {
                      const cp = compProfitability?.find(c => c.locationId === p.locationId);
                      return (
                      <tr key={p.locationId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STORE_COLORS[p.code] || '#6b7280' }} />
                            {p.code}
                          </div>
                        </td>
                        <td className="text-right py-3 px-3 font-medium">
                          <span>{fmt(p.revenue)}</span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.revenue} previous={cp.revenue} /></span>}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{fmt(p.estimatedCOGS)}</td>
                        <td className="text-right py-3 px-3 text-emerald-600 font-medium">
                          <span>{fmt(p.grossProfit)}</span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.grossProfit} previous={cp.grossProfit} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          {fmtPct(p.grossMarginPct)}
                          {cp && <span className="ml-1"><DeltaBadge current={p.grossMarginPct} previous={cp.grossMarginPct} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{fmt(p.laborCost)}</td>
                        <td className="text-right py-3 px-3">
                          <span className={p.laborPct <= p.laborTarget + 2 ? 'text-emerald-600' : 'text-red-600'}>
                            {fmtPct(p.laborPct)}
                          </span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.laborPct} previous={cp.laborPct} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{fmtPct(p.laborTarget)}</td>
                        <td className={`text-right py-3 px-3 font-medium ${p.netAfterLabor >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          <span>{fmt(p.netAfterLabor)}</span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.netAfterLabor} previous={cp.netAfterLabor} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          <span className={p.primeCostPct <= 65 ? 'text-emerald-600' : 'text-amber-600'}>
                            {fmtPct(p.primeCostPct)}
                          </span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.primeCostPct} previous={cp.primeCostPct} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          <span>{fmt(p.avgTicket)}</span>
                          {cp && <span className="ml-1"><DeltaBadge current={p.avgTicket} previous={cp.avgTicket} /></span>}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{p.days}</td>
                      </tr>
                      );
                    })}
                    {/* Totals row */}
                    {kpis && (
                      <tr className="border-t-2 bg-muted/30 font-semibold">
                        <td className="py-3 px-3">TOTAL</td>
                        <td className="text-right py-3 px-3">
                          {fmt(kpis.totalRevenue)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.totalRevenue} previous={compKpis.totalRevenue} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">{fmt(kpis.totalCOGS)}</td>
                        <td className="text-right py-3 px-3 text-emerald-600">
                          {fmt(kpis.totalGross)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.totalGross} previous={compKpis.totalGross} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          {fmtPct(kpis.grossMargin)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.grossMargin} previous={compKpis.grossMargin} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3">{fmt(kpis.totalLabor)}</td>
                        <td className="text-right py-3 px-3">
                          {fmtPct(kpis.laborPct)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.laborPct} previous={compKpis.laborPct} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3">—</td>
                        <td className={`text-right py-3 px-3 ${kpis.totalNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(kpis.totalNet)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.totalNet} previous={compKpis.totalNet} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          {fmtPct(kpis.primeCost)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.primeCost} previous={compKpis.primeCost} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          {fmt(kpis.avgTicket)}
                          {compKpis && <span className="ml-1"><DeltaBadge current={kpis.avgTicket} previous={compKpis.avgTicket} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">{kpis.totalDays}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                * COGS is estimated using each store's food cost target %. Upload Breakdown CSVs for actual product-level margins.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Revenue Trends Tab ─── */}
        <TabsContent value="trends" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Monthly Revenue Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendChart}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [name.includes('%') ? `${v}%` : fmtShort(v), name]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Area yAxisId="left" type="monotone" dataKey="revenue" fill="url(#revGrad)" stroke="#3b82f6" strokeWidth={2} name="Revenue" />
                      <Line yAxisId="right" type="monotone" dataKey="growth" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="MoM Growth %" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Average Daily Revenue & Ticket</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [name.includes('Ticket') ? fmt(v) : fmtShort(v), name]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="avgDaily" fill="#10b981" name="Avg Daily Revenue" radius={[2, 2, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="avgTicket" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} name="Avg Ticket" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Monthly Detail Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Monthly Performance Detail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Month</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Labor Cost</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Orders</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Avg Daily</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Avg Ticket</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">MoM Growth</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendChart.map((t, i) => (
                      <tr key={t.month} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-medium">{t.month}</td>
                        <td className="text-right py-3 px-3 font-medium">{fmtShort(t.revenue)}</td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{fmtShort(t.labor)}</td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{trends?.[i]?.orders?.toLocaleString()}</td>
                        <td className="text-right py-3 px-3">{fmtShort(t.avgDaily)}</td>
                        <td className="text-right py-3 px-3">{fmt(t.avgTicket)}</td>
                        <td className="text-right py-3 px-3">
                          {i > 0 ? (
                            <span className={`flex items-center justify-end gap-0.5 ${t.growth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {t.growth >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {Math.abs(t.growth).toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{trends?.[i]?.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Cash Flow Forecast Tab ─── */}
        <TabsContent value="forecast" className="space-y-4">
          <CashFlowForecastSection forecast={forecast} isLoading={forecastLoading} />
        </TabsContent>

        {/* ─── Labor Efficiency Tab ─── */}
        <TabsContent value="labor" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Labor Cost % vs Target</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={labor?.filter(l => l.revenue > 0).sort((a, b) => a.laborPct - b.laborPct)} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="laborPct" fill="#ef4444" name="Actual Labor %" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="laborTarget" fill="#d1d5db" name="Target %" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Revenue per Labor Hour</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={labor?.filter(l => l.hours > 0).sort((a, b) => b.revenuePerHour - a.revenuePerHour)} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [fmt(v)]} />
                      <Bar dataKey="revenuePerHour" fill="#10b981" name="$/Hour" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Labor Detail Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Labor Efficiency Detail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-3 font-medium text-muted-foreground">Store</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Labor Cost</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Labor %</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Target</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Variance</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Hours</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Rev/Hour</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Cost/Hour</th>
                      <th className="text-right py-3 px-3 font-medium text-muted-foreground">Headcount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {labor?.filter(l => l.revenue > 0).sort((a, b) => b.revenue - a.revenue).map(l => {
                      const cl = compLabor?.find(c => c.locationId === l.locationId);
                      return (
                      <tr key={l.locationId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-medium">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STORE_COLORS[l.code] || '#6b7280' }} />
                            {l.code} - {l.name}
                          </div>
                        </td>
                        <td className="text-right py-3 px-3 font-medium">
                          {fmt(l.revenue)}
                          {cl && <span className="ml-1"><DeltaBadge current={l.revenue} previous={cl.revenue} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          {fmt(l.laborCost)}
                          {cl && <span className="ml-1"><DeltaBadge current={l.laborCost} previous={cl.laborCost} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">
                          <span className={l.laborPct <= l.laborTarget + 2 ? 'text-emerald-600' : 'text-red-600'}>
                            {fmtPct(l.laborPct)}
                          </span>
                          {cl && <span className="ml-1"><DeltaBadge current={l.laborPct} previous={cl.laborPct} isPercent /></span>}
                        </td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{fmtPct(l.laborTarget)}</td>
                        <td className="text-right py-3 px-3">
                          <span className={l.laborVariance <= 0 ? 'text-emerald-600' : 'text-red-600'}>
                            {l.laborVariance > 0 ? '+' : ''}{fmtPct(l.laborVariance)}
                          </span>
                        </td>
                        <td className="text-right py-3 px-3">{l.hours > 0 ? l.hours.toLocaleString() : '—'}</td>
                        <td className="text-right py-3 px-3 font-medium">
                          {l.hours > 0 ? fmt(l.revenuePerHour) : '—'}
                          {cl && cl.hours > 0 && l.hours > 0 && <span className="ml-1"><DeltaBadge current={l.revenuePerHour} previous={cl.revenuePerHour} /></span>}
                        </td>
                        <td className="text-right py-3 px-3">{l.hours > 0 ? fmt(l.costPerHour) : '—'}</td>
                        <td className="text-right py-3 px-3 text-muted-foreground">{l.headcount || '—'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                * Hours and headcount from ADP payroll records. Revenue per hour uses payroll hours where available.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Strategic Insights Tab ─── */}
        <TabsContent value="insights" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Data-Driven Recommendations
              </CardTitle>
              <p className="text-xs text-muted-foreground">Based on {period === 'ytd' ? 'year-to-date' : period === 'mtd' ? 'month-to-date' : period} performance data</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {insights.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Loading insights...</p>
                )}
                {insights.map((insight, i) => (
                  <div key={i} className={`flex items-start gap-3 p-4 rounded-lg border ${
                    insight.type === 'warning' ? 'bg-amber-50/50 border-amber-200' :
                    insight.type === 'success' ? 'bg-emerald-50/50 border-emerald-200' :
                    'bg-blue-50/50 border-blue-200'
                  }`}>
                    {insight.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
                    {insight.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />}
                    {insight.type === 'insight' && <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />}
                    <p className="text-sm leading-relaxed">{insight.text}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Metrics Summary */}
          {kpis && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <Target className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Prime Cost Health</p>
                      <p className={`text-lg font-bold ${kpis.primeCost <= 60 ? 'text-emerald-600' : kpis.primeCost <= 65 ? 'text-amber-600' : 'text-red-600'}`}>
                        {kpis.primeCost <= 60 ? 'Excellent' : kpis.primeCost <= 65 ? 'Acceptable' : 'Needs Attention'}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmtPct(kpis.primeCost)} vs 60% target</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <BarChart3 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Revenue Run Rate</p>
                      <p className="text-lg font-bold">{fmtShort(kpis.avgDaily * 365)}</p>
                      <p className="text-xs text-muted-foreground">Annualized from {fmt(kpis.avgDaily)}/day</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Users className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Customer Volume</p>
                      <p className="text-lg font-bold">{kpis.totalOrders.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(kpis.totalOrders / kpis.totalDays).toLocaleString()} orders/day avg</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
