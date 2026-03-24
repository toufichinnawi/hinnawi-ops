import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Package, Search, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

export default function Inventory() {
  const { data: items, isLoading } = trpc.inventory.items.useQuery();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!items) return [];
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q) || (i.category?.toLowerCase().includes(q)) || (i.itemCode?.toLowerCase().includes(q)));
  }, [items, search]);

  const lowStock = items?.filter(i => Number(i.parLevel) > 0).length || 0;
  const totalValue = items?.reduce((s, i) => s + Number(i.avgCost), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {items?.length || 0} items · {formatCurrency(totalValue)} total value · {lowStock} low stock
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Items</p>
                <p className="text-xl font-bold">{items?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Package className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value</p>
                <p className="text-xl font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock Items</p>
                <p className="text-xl font-bold">{lowStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search items by name, category, or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Item</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Unit</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg Cost</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Last Cost</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Par Level</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">COGS Account</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                ) : filtered.map(item => {
                  const isLow = item.parLevel != null && Number(item.parLevel) > 0;
                  return (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          {item.itemCode && <p className="text-xs text-muted-foreground">{item.itemCode}</p>}
                        </div>
                      </td>
                      <td className="py-3 px-4"><Badge variant="outline">{item.category}</Badge></td>
                      <td className="py-3 px-4 text-muted-foreground">{item.unit}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(Number(item.avgCost))}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(item.lastCost))}</td>
                      <td className="py-3 px-4 text-right text-muted-foreground">{Number(item.parLevel || 0).toFixed(1)}</td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{item.cogsAccount || '—'}</td>
                      <td className="py-3 px-4 text-center">
                        {isLow ? (
                          <Badge variant="secondary" className="bg-red-50 text-red-700">Low Stock</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">In Stock</Badge>
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
