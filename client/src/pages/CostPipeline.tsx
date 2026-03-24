import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  XCircle, Search, RefreshCw, ArrowUpDown, ChevronRight, Package,
  FileText, Clock, Activity, Minus, ChefHat, Eye
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 4 }).format(val);
}

function formatPercent(val: number) {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CostPipeline() {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [priceHistoryDialogOpen, setPriceHistoryDialogOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data: costImpact, isLoading: loadingImpact } = trpc.costPipeline.costImpact.useQuery();
  const { data: recentChanges, isLoading: loadingChanges } = trpc.costPipeline.recentPriceChanges.useQuery();
  const { data: unmatchedItems, isLoading: loadingUnmatched } = trpc.costPipeline.unmatchedItems.useQuery();
  const { data: priceHistory } = trpc.costPipeline.priceHistory.useQuery(
    { inventoryItemId: selectedItemId!, limit: 30 },
    { enabled: !!selectedItemId }
  );
  const { data: inventoryItems } = trpc.inventory.items.useQuery();

  const recalculateAll = trpc.costPipeline.recalculateAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Recalculated costs for ${data.updated} recipes`);
      utils.costPipeline.costImpact.invalidate();
      utils.recipes.list.invalidate();
    },
    onError: () => toast.error("Failed to recalculate recipe costs"),
  });

  const updateMatch = trpc.costPipeline.updateMatch.useMutation({
    onSuccess: () => {
      toast.success("Match updated");
      utils.costPipeline.unmatchedItems.invalidate();
    },
    onError: () => toast.error("Failed to update match"),
  });

  // Summary stats
  const totalPriceChanges = recentChanges?.length || 0;
  const significantChanges = recentChanges?.filter(c => Math.abs(Number(c.changePercent || 0)) >= 10) || [];
  const highCostRecipes = costImpact?.affectedRecipes || [];
  const totalRecipes = costImpact?.totalRecipes || 0;

  // Filtered changes
  const filteredChanges = useMemo(() => {
    if (!recentChanges) return [];
    if (!searchTerm) return recentChanges;
    const lower = searchTerm.toLowerCase();
    return recentChanges.filter(c =>
      (c.itemName || "").toLowerCase().includes(lower)
    );
  }, [recentChanges, searchTerm]);

  const openPriceHistory = (itemId: number) => {
    setSelectedItemId(itemId);
    setPriceHistoryDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost Pipeline</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automated invoice → ingredient cost → recipe cost updates
          </p>
        </div>
        <Button
          onClick={() => recalculateAll.mutate()}
          disabled={recalculateAll.isPending}
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${recalculateAll.isPending ? 'animate-spin' : ''}`} />
          Recalculate All Costs
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Price Changes</p>
                <p className="text-2xl font-bold">{totalPriceChanges}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Significant (&gt;10%)</p>
                <p className="text-2xl font-bold">{significantChanges.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <ChefHat className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">High Cost Recipes (&gt;35%)</p>
                <p className="text-2xl font-bold">{highCostRecipes.length}<span className="text-sm text-muted-foreground font-normal">/{totalRecipes}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Search className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unmatched Items</p>
                <p className="text-2xl font-bold">{unmatchedItems?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Price Changes</TabsTrigger>
          <TabsTrigger value="matching">
            Matching Review
            {(unmatchedItems?.length || 0) > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">{unmatchedItems?.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recipes">Recipe Impact</TabsTrigger>
          <TabsTrigger value="how-it-works">How It Works</TabsTrigger>
        </TabsList>

        {/* Price Changes Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search ingredient..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {loadingChanges ? (
            <div className="text-center py-12 text-muted-foreground">Loading price changes...</div>
          ) : filteredChanges.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Activity className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No price changes recorded yet.</p>
                <p className="text-sm text-muted-foreground mt-1">Price changes will appear here automatically when invoices are approved.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Ingredient</th>
                        <th className="text-right p-3 font-medium">Previous Cost</th>
                        <th className="text-right p-3 font-medium">New Cost</th>
                        <th className="text-right p-3 font-medium">Change</th>
                        <th className="text-left p-3 font-medium">Source</th>
                        <th className="text-left p-3 font-medium">Date</th>
                        <th className="text-center p-3 font-medium">History</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredChanges.map((change: any) => {
                        const pct = Number(change.changePercent || 0);
                        const isUp = pct > 0;
                        const isSignificant = Math.abs(pct) >= 10;
                        return (
                          <tr key={change.id} className={`border-b hover:bg-muted/30 ${isSignificant ? 'bg-orange-50/50' : ''}`}>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{change.itemName}</span>
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono text-muted-foreground">
                              {formatCurrency(Number(change.previousCostPerUnit || 0))}
                            </td>
                            <td className="p-3 text-right font-mono font-medium">
                              {formatCurrency(Number(change.newCostPerUnit || 0))}
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isUp ? (
                                  <TrendingUp className="h-4 w-4 text-red-500" />
                                ) : pct < 0 ? (
                                  <TrendingDown className="h-4 w-4 text-green-500" />
                                ) : (
                                  <Minus className="h-4 w-4 text-muted-foreground" />
                                )}
                                <Badge variant={isSignificant ? "destructive" : isUp ? "outline" : "secondary"} className="font-mono">
                                  {formatPercent(pct)}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-xs">
                                {change.source === "invoice" ? "Invoice" : change.source === "email_extraction" ? "Email" : change.source}
                              </Badge>
                              {change.invoiceId && (
                                <span className="text-xs text-muted-foreground ml-1">#{change.invoiceId}</span>
                              )}
                            </td>
                            <td className="p-3 text-muted-foreground text-xs">
                              {formatDate(change.createdAt)}
                            </td>
                            <td className="p-3 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openPriceHistory(change.inventoryItemId)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Matching Review Tab */}
        <TabsContent value="matching" className="space-y-4">
          {loadingUnmatched ? (
            <div className="text-center py-12 text-muted-foreground">Loading unmatched items...</div>
          ) : (unmatchedItems?.length || 0) === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500/30 mb-3" />
                <p className="text-muted-foreground">All invoice line items are matched!</p>
                <p className="text-sm text-muted-foreground mt-1">When new invoices are approved, unmatched items will appear here for manual review.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Unmatched Invoice Line Items</CardTitle>
                <p className="text-sm text-muted-foreground">These items couldn't be automatically matched to inventory. Select the correct match or dismiss.</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Invoice Line Description</th>
                        <th className="text-right p-3 font-medium">Unit Price</th>
                        <th className="text-right p-3 font-medium">Qty</th>
                        <th className="text-left p-3 font-medium">Invoice #</th>
                        <th className="text-left p-3 font-medium">Match To</th>
                        <th className="text-center p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedItems?.map((item: any) => (
                        <UnmatchedRow
                          key={item.id}
                          item={item}
                          inventoryItems={inventoryItems || []}
                          onConfirm={(matchId, inventoryItemId) => {
                            updateMatch.mutate({ matchId, status: "confirmed", inventoryItemId });
                          }}
                          onReject={(matchId) => {
                            updateMatch.mutate({ matchId, status: "rejected" });
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Recipe Impact Tab */}
        <TabsContent value="recipes" className="space-y-4">
          {loadingImpact ? (
            <div className="text-center py-12 text-muted-foreground">Loading recipe impact...</div>
          ) : highCostRecipes.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ChefHat className="h-12 w-12 mx-auto text-green-500/30 mb-3" />
                <p className="text-muted-foreground">All recipes are within target food cost (&lt;35%).</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recipes Above 35% Food Cost Target</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {highCostRecipes.length} of {totalRecipes} recipes exceed the 35% food cost threshold.
                  Consider adjusting selling prices or finding alternative ingredients.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Recipe</th>
                        <th className="text-left p-3 font-medium">Category</th>
                        <th className="text-right p-3 font-medium">Total Cost</th>
                        <th className="text-right p-3 font-medium">Selling Price</th>
                        <th className="text-right p-3 font-medium">Food Cost %</th>
                        <th className="text-right p-3 font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {highCostRecipes
                        .sort((a: any, b: any) => Number(b.foodCostPct || 0) - Number(a.foodCostPct || 0))
                        .map((recipe: any) => {
                          const costPct = Number(recipe.foodCostPct || 0);
                          const totalCost = Number(recipe.totalCost || 0);
                          const sellingPrice = Number(recipe.sellingPrice || 0);
                          const margin = sellingPrice - totalCost;
                          return (
                            <tr key={recipe.id} className="border-b hover:bg-muted/30">
                              <td className="p-3 font-medium">{recipe.name}</td>
                              <td className="p-3 text-muted-foreground">{recipe.category || "—"}</td>
                              <td className="p-3 text-right font-mono">${totalCost.toFixed(2)}</td>
                              <td className="p-3 text-right font-mono">${sellingPrice.toFixed(2)}</td>
                              <td className="p-3 text-right">
                                <Badge variant={costPct >= 50 ? "destructive" : "outline"} className="font-mono">
                                  {costPct.toFixed(1)}%
                                </Badge>
                              </td>
                              <td className="p-3 text-right font-mono">
                                <span className={margin < 0 ? "text-red-500" : "text-green-600"}>
                                  ${margin.toFixed(2)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* How It Works Tab */}
        <TabsContent value="how-it-works" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Automated Cost Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <div>
                  <h4 className="font-semibold">Invoice Approved</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    When an invoice status changes to "approved" (manually or auto-approved when both invoice PDF and delivery note are uploaded),
                    the cost pipeline is triggered automatically.
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-4">
                <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <div>
                  <h4 className="font-semibold">AI Matching</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Each invoice line item is matched to an inventory item using a 3-phase approach:
                    exact name match, fuzzy token overlap, then AI-powered matching for remaining items.
                    Matches with confidence &lt;50% are flagged for manual review.
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-4">
                <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <div>
                  <h4 className="font-semibold">Ingredient Cost Update</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    For matched items, the inventory item's lastCost, avgCost, and costPerUsableUnit are updated
                    based on the invoice unit price. Yield percentage is factored in automatically.
                    All changes are logged to the price history table.
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-4">
                <div className="h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">4</div>
                <div>
                  <h4 className="font-semibold">Recipe Cost Recalculation</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    ALL recipe costs are recalculated using the latest ingredient prices.
                    Each recipe's totalCost, profit, and foodCostPct are updated automatically.
                    This directly affects your COGS calculations.
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-start gap-4">
                <div className="h-8 w-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold shrink-0">5</div>
                <div>
                  <h4 className="font-semibold">Price Change Alerts</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    If any ingredient price changes by more than 10%, an alert is created and you receive
                    a notification. Changes of 25%+ are marked as urgent. This helps you catch supplier
                    price increases early and adjust menu pricing accordingly.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Price History Dialog */}
      <Dialog open={priceHistoryDialogOpen} onOpenChange={setPriceHistoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Price History</DialogTitle>
            <DialogDescription>
              Historical cost changes for this ingredient
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {priceHistory && priceHistory.length > 0 ? (
              <div className="space-y-3">
                {priceHistory.map((entry: any) => {
                  const pct = Number(entry.changePercent || 0);
                  return (
                    <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <div className="flex items-center gap-2">
                          {pct > 0 ? (
                            <TrendingUp className="h-4 w-4 text-red-500" />
                          ) : pct < 0 ? (
                            <TrendingDown className="h-4 w-4 text-green-500" />
                          ) : (
                            <Minus className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-mono text-sm">
                            {formatCurrency(Number(entry.previousCostPerUnit || 0))} → {formatCurrency(Number(entry.newCostPerUnit || 0))}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(entry.createdAt)} · {entry.source}
                          {entry.invoiceId && ` · Invoice #${entry.invoiceId}`}
                        </p>
                      </div>
                      <Badge variant={Math.abs(pct) >= 10 ? "destructive" : "outline"} className="font-mono">
                        {formatPercent(pct)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No price history available.</p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Unmatched row component with inventory item selector
function UnmatchedRow({
  item,
  inventoryItems,
  onConfirm,
  onReject,
}: {
  item: any;
  inventoryItems: any[];
  onConfirm: (matchId: number, inventoryItemId: number) => void;
  onReject: (matchId: number) => void;
}) {
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("");

  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-3">
        <span className="font-medium">{item.lineDescription || "—"}</span>
      </td>
      <td className="p-3 text-right font-mono">${Number(item.unitPrice || 0).toFixed(4)}</td>
      <td className="p-3 text-right">{Number(item.quantity || 0).toFixed(2)}</td>
      <td className="p-3 text-muted-foreground">#{item.invoiceId}</td>
      <td className="p-3">
        <Select value={selectedInventoryId} onValueChange={setSelectedInventoryId}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder="Select inventory item..." />
          </SelectTrigger>
          <SelectContent>
            {inventoryItems.map((inv: any) => (
              <SelectItem key={inv.id} value={String(inv.id)}>
                {inv.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-3 text-center">
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-green-600 hover:text-green-700 hover:bg-green-50"
            disabled={!selectedInventoryId}
            onClick={() => onConfirm(item.id, Number(selectedInventoryId))}
          >
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={() => onReject(item.id)}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
