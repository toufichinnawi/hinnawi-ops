import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, TrendingUp, FileText, DollarSign, Calendar, ChevronLeft, ChevronRight, Users, CheckCircle2, AlertCircle } from "lucide-react";
import DataExportPanel from "@/components/DataExportPanel";
import { useState, useMemo, useEffect } from "react";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

function formatNumber(val: number) {
  return new Intl.NumberFormat('en-CA').format(val);
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Reporting() {
  const { data: dateRange } = trpc.reporting.dateRange.useQuery();
  const { data: allLocations } = trpc.locations.list.useQuery();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState(2025);
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);

  // Auto-set date to latest available when dateRange loads
  useEffect(() => {
    if (dateRange && !selectedDate) {
      setSelectedDate(dateRange.maxDate);
      const year = parseInt(dateRange.maxDate.slice(0, 4));
      if (year) setSelectedYear(year);
    }
  }, [dateRange, selectedDate]);

  const { data: pnl, isLoading: pnlLoading } = trpc.reporting.dailyPnl.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate }
  );

  // Stabilize locationIds for query
  const locationIdsForQuery = useMemo(() => {
    return selectedLocationIds.length > 0 ? selectedLocationIds : undefined;
  }, [selectedLocationIds]);

  const { data: monthly, isLoading: monthlyLoading } = trpc.reporting.monthlyAggregated.useQuery({
    year: selectedYear,
    locationIds: locationIdsForQuery,
  });

  const totalRevenue = pnl?.reduce((s, p) => s + p.revenue, 0) || 0;
  const totalCogs = pnl?.reduce((s, p) => s + p.cogs, 0) || 0;
  const totalGross = pnl?.reduce((s, p) => s + p.grossProfit, 0) || 0;
  const totalLabor = pnl?.reduce((s, p) => s + p.labor, 0) || 0;
  const totalOp = pnl?.reduce((s, p) => s + p.operatingProfit, 0) || 0;
  const hasActualLabor = pnl?.some(p => (p as any).laborSource === 'actual') || false;

  const yearlyTotals = useMemo(() => {
    if (!monthly) return { sales: 0, gst: 0, qst: 0, labour: 0, orders: 0 };
    return {
      sales: monthly.reduce((s, m) => s + Number(m.totalSales || 0), 0),
      gst: monthly.reduce((s, m) => s + Number(m.totalGst || 0), 0),
      qst: monthly.reduce((s, m) => s + Number(m.totalQst || 0), 0),
      labour: monthly.reduce((s, m) => s + Number(m.totalLabourCost || 0), 0),
      orders: monthly.reduce((s, m) => s + Number(m.totalOrders || 0), 0),
    };
  }, [monthly]);

  const navigateDate = (direction: number) => {
    if (!selectedDate) return;
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + direction);
    const newDate = d.toISOString().slice(0, 10);
    if (dateRange) {
      if (newDate < dateRange.minDate || newDate > dateRange.maxDate) return;
    }
    setSelectedDate(newDate);
  };

  const availableYears = useMemo(() => {
    if (!dateRange) return [2025];
    const minYear = parseInt(dateRange.minDate.slice(0, 4));
    const maxYear = parseInt(dateRange.maxDate.slice(0, 4));
    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);
    return years;
  }, [dateRange]);

  // Location filter helpers
  const toggleLocation = (locId: number) => {
    setSelectedLocationIds(prev => {
      if (prev.includes(locId)) {
        return prev.filter(id => id !== locId);
      } else {
        return [...prev, locId];
      }
    });
  };

  const selectAllLocations = () => setSelectedLocationIds([]);
  const isAllSelected = selectedLocationIds.length === 0;

  // Dynamically detect which locations have sales data
  const { data: locationIdsWithData } = trpc.reporting.locationsWithData.useQuery();

  const locationsWithData = useMemo(() => {
    if (!allLocations || !locationIdsWithData) return [];
    return allLocations.filter(l => locationIdsWithData.includes(l.id));
  }, [allLocations, locationIdsWithData]);

  const locationsWithoutData = useMemo(() => {
    if (!allLocations || !locationIdsWithData) return allLocations || [];
    return allLocations.filter(l => !locationIdsWithData.includes(l.id));
  }, [allLocations, locationIdsWithData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reporting Center</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Daily P&L, Monthly Revenue, and Performance Reports
            {dateRange && (
              <span className="ml-2 text-xs">
                (Data: {dateRange.minDate} to {dateRange.maxDate}, {dateRange.totalDays} days)
              </span>
            )}
          </p>
        </div>
      </div>

      {/* ── Daily P&L Section ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Daily P&L</h2>
          <div className="flex items-center gap-1 ml-auto">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => navigateDate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              min={dateRange?.minDate}
              max={dateRange?.maxDate}
              className="w-[160px] h-8 text-sm"
            />
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => navigateDate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Revenue</p>
                  <p className="text-base font-bold">{formatCurrency(totalRevenue)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">COGS (est.)</p>
                  <p className="text-base font-bold">{formatCurrency(totalCogs)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Gross Profit</p>
                  <p className="text-base font-bold">{formatCurrency(totalGross)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Users className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    Labor
                    {hasActualLabor && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-emerald-300 text-emerald-700">actual</Badge>
                    )}
                  </p>
                  <p className="text-base font-bold">{formatCurrency(totalLabor)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Gross Margin</p>
                  <p className="text-base font-bold">{totalRevenue > 0 ? ((totalGross / totalRevenue) * 100).toFixed(1) : '0.0'}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Daily P&L Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              P&L by Location — {selectedDate || 'Select a date'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Location</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">COGS (est.)</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Gross Profit</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Gross %</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Labor</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Labor %</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Op Profit</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Op %</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {!selectedDate ? (
                    <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">Loading date range...</td></tr>
                  ) : pnlLoading ? (
                    <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                  ) : !pnl || pnl.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">No data for {selectedDate}. Try navigating to a different date.</td></tr>
                  ) : (
                    <>
                      {pnl.map(row => {
                        const laborSrc = (row as any).laborSource;
                        const orderCount = (row as any).orderCount || 0;
                        return (
                          <tr key={row.locationId} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-medium">{row.locationName}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(row.revenue)}</td>
                            <td className="py-3 px-4 text-right text-red-600">{formatCurrency(row.cogs)}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(row.grossProfit)}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={row.grossMargin >= 70 ? 'text-emerald-600 font-medium' : row.grossMargin >= 60 ? 'text-amber-600' : 'text-red-600 font-medium'}>
                                {row.grossMargin.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-amber-600">{formatCurrency(row.labor)}</span>
                              {laborSrc === 'actual' && (
                                <CheckCircle2 className="inline-block ml-1 h-3 w-3 text-emerald-500" />
                              )}
                              {laborSrc === 'estimated' && (
                                <AlertCircle className="inline-block ml-1 h-3 w-3 text-muted-foreground" />
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className={row.laborPct <= 25 ? 'text-emerald-600' : row.laborPct <= 30 ? 'text-amber-600' : 'text-red-600'}>
                                {row.laborPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-medium">{formatCurrency(row.operatingProfit)}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={row.operatingMargin >= 20 ? 'text-emerald-600' : row.operatingMargin >= 10 ? 'text-amber-600' : 'text-red-600'}>
                                {row.operatingMargin.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{formatNumber(orderCount)}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-muted/50 font-semibold">
                        <td className="py-3 px-4">TOTAL</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(totalRevenue)}</td>
                        <td className="py-3 px-4 text-right text-red-600">{formatCurrency(totalCogs)}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(totalGross)}</td>
                        <td className="py-3 px-4 text-right">{totalRevenue > 0 ? ((totalGross / totalRevenue) * 100).toFixed(1) : '0.0'}%</td>
                        <td className="py-3 px-4 text-right text-amber-600">{formatCurrency(totalLabor)}</td>
                        <td className="py-3 px-4 text-right">{totalRevenue > 0 ? ((totalLabor / totalRevenue) * 100).toFixed(1) : '0.0'}%</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(totalOp)}</td>
                        <td className="py-3 px-4 text-right">{totalRevenue > 0 ? ((totalOp / totalRevenue) * 100).toFixed(1) : '0.0'}%</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{formatNumber(pnl?.reduce((s, p) => s + ((p as any).orderCount || 0), 0) || 0)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Legend for labor source */}
        {pnl && pnl.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 px-1">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Actual labor (from Koomi POS)
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-muted-foreground" /> Estimated labor (target %)
            </span>
          </div>
        )}
      </div>

      {/* ── Monthly Revenue Summary ── */}
      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Monthly Revenue Summary</h2>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {/* Store filter buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant={isAllSelected ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={selectAllLocations}
              >
                All Stores
              </Button>
              {locationsWithData.map(loc => (
                <Button
                  key={loc.id}
                  variant={!isAllSelected && selectedLocationIds.includes(loc.id) ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => toggleLocation(loc.id)}
                >
                  {loc.code}
                </Button>
              ))}
              {locationsWithoutData.map(loc => (
                <Button
                  key={loc.id}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 opacity-40 cursor-not-allowed"
                  disabled
                  title={`${loc.name} — no POS data yet`}
                >
                  {loc.code}
                </Button>
              ))}
            </div>
            {/* Year selector */}
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[90px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Active filter indicator */}
        {!isAllSelected && selectedLocationIds.length > 0 && (
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <span>Showing:</span>
            {selectedLocationIds.map(id => {
              const loc = allLocations?.find(l => l.id === id);
              return loc ? (
                <Badge key={id} variant="secondary" className="text-xs">
                  {loc.name}
                </Badge>
              ) : null;
            })}
            <Button variant="ghost" size="sm" className="h-5 text-xs px-1 text-muted-foreground hover:text-foreground" onClick={selectAllLocations}>
              Clear filter
            </Button>
          </div>
        )}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Month</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Net Sales</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Labour Cost</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Labour %</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">GST</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">QST</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Orders</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Days</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyLoading ? (
                    <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                  ) : !monthly || monthly.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No data for {selectedYear}{!isAllSelected ? ' with selected stores' : ''}</td></tr>
                  ) : (
                    <>
                      {monthly.map((m) => {
                        const sales = Number(m.totalSales || 0);
                        const labour = Number(m.totalLabourCost || 0);
                        const orders = Number(m.totalOrders || 0);
                        const days = Number(m.daysCount || 1);
                        const labourPct = sales > 0 ? (labour / sales) * 100 : 0;
                        return (
                          <tr key={m.month} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-medium">{MONTH_NAMES[m.month]}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(sales)}</td>
                            <td className="py-3 px-4 text-right text-amber-600">{formatCurrency(labour)}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={labourPct <= 25 ? 'text-emerald-600' : labourPct <= 30 ? 'text-amber-600' : 'text-red-600'}>
                                {labourPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(Number(m.totalGst || 0))}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(Number(m.totalQst || 0))}</td>
                            <td className="py-3 px-4 text-right">{formatNumber(orders)}</td>
                            <td className="py-3 px-4 text-right">{m.daysCount}</td>
                            <td className="py-3 px-4 text-right font-medium">{formatCurrency(sales / days)}</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-muted/50 font-semibold">
                        <td className="py-3 px-4">TOTAL {selectedYear}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(yearlyTotals.sales)}</td>
                        <td className="py-3 px-4 text-right text-amber-600">{formatCurrency(yearlyTotals.labour)}</td>
                        <td className="py-3 px-4 text-right">
                          <span className={yearlyTotals.sales > 0 && (yearlyTotals.labour / yearlyTotals.sales) * 100 <= 25 ? 'text-emerald-600' : 'text-amber-600'}>
                            {yearlyTotals.sales > 0 ? ((yearlyTotals.labour / yearlyTotals.sales) * 100).toFixed(1) : '0.0'}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(yearlyTotals.gst)}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(yearlyTotals.qst)}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(yearlyTotals.orders)}</td>
                        <td className="py-3 px-4 text-right" colSpan={2}></td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Data Export Section ── */}
      <DataExportPanel />
    </div>
  );
}
