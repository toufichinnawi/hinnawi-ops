import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  UtensilsCrossed, ChefHat, AlertCircle, CheckCircle2, Search,
  Save, Plus, Trash2, Link2, Unlink, Percent, DollarSign, PieChart
} from "lucide-react";
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function MenuItems() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "with" | "without">("without");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", category: "Beverages", sellingPrice: "", defaultCogsPct: "30" });
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCogs, setBulkCogs] = useState("");

  const { data: summary, isLoading } = trpc.menuItems.summary.useQuery();
  const { data: allItems } = trpc.menuItems.list.useQuery();
  const { data: recipes } = trpc.recipes.list.useQuery();
  const utils = trpc.useUtils();

  const updateCogs = trpc.menuItems.updateCogs.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      setEditingId(null);
      toast.success("COGS % updated");
    },
  });

  const bulkUpdateCogs = trpc.menuItems.bulkUpdateCogs.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      setBulkCategory("");
      setBulkCogs("");
      toast.success("Bulk COGS % updated");
    },
  });

  const createItem = trpc.menuItems.create.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      setShowAddDialog(false);
      setNewItem({ name: "", category: "Beverages", sellingPrice: "", defaultCogsPct: "30" });
      toast.success("Menu item added");
    },
  });

  const deleteItem = trpc.menuItems.delete.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      toast.success("Menu item removed");
    },
  });

  const linkRecipe = trpc.menuItems.linkRecipe.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      toast.success("Recipe linked");
    },
  });

  const unlinkRecipe = trpc.menuItems.unlinkRecipe.useMutation({
    onSuccess: () => {
      utils.menuItems.invalidate();
      toast.success("Recipe unlinked");
    },
  });

  // Filter and search
  const filteredItems = useMemo(() => {
    if (!allItems) return [];
    return allItems.filter(item => {
      const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = filterCategory === "all" || item.category === filterCategory;
      const matchesStatus = filterStatus === "all" ||
        (filterStatus === "with" && item.hasRecipe) ||
        (filterStatus === "without" && !item.hasRecipe);
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [allItems, search, filterCategory, filterStatus]);

  // Get unique categories
  const categories = useMemo(() => {
    if (!allItems) return [];
    const cats = new Set(allItems.map(i => i.category).filter(Boolean));
    return Array.from(cats).sort() as string[];
  }, [allItems]);

  // Group filtered items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, typeof filteredItems> = {};
    for (const item of filteredItems) {
      const cat = item.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [filteredItems]);

  // Calculate weighted average COGS for items without recipes
  const avgCogsWithoutRecipe = useMemo(() => {
    if (!summary?.itemsWithoutRecipe || summary.itemsWithoutRecipe.length === 0) return 0;
    const total = summary.itemsWithoutRecipe.reduce((s, i) => s + Number(i.defaultCogsPct || 0), 0);
    return total / summary.itemsWithoutRecipe.length;
  }, [summary]);

  const handleSaveCogs = (id: number) => {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error("COGS must be between 0 and 100");
      return;
    }
    updateCogs.mutate({ id, cogsPct: val.toFixed(2) });
  };

  const handleBulkUpdate = () => {
    if (!bulkCategory || !bulkCogs) return;
    const val = parseFloat(bulkCogs);
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error("COGS must be between 0 and 100");
      return;
    }
    const itemsInCategory = allItems?.filter(i => i.category === bulkCategory && !i.hasRecipe) || [];
    if (itemsInCategory.length === 0) {
      toast.error("No items without recipes in this category");
      return;
    }
    bulkUpdateCogs.mutate({
      updates: itemsInCategory.map(i => ({ id: i.id, cogsPct: val.toFixed(2) })),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu Items & COGS</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track all sold items, link recipes, and assign default COGS percentages
          </p>
        </div>
        {user && (
          <div className="flex gap-2">
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Menu Item</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Item Name</label>
                    <Input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g., Iced Matcha" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <Select value={newItem.category} onValueChange={v => setNewItem({ ...newItem, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Selling Price ($)</label>
                      <Input type="number" step="0.01" value={newItem.sellingPrice} onChange={e => setNewItem({ ...newItem, sellingPrice: e.target.value })} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Default COGS %</label>
                      <Input type="number" step="0.5" value={newItem.defaultCogsPct} onChange={e => setNewItem({ ...newItem, defaultCogsPct: e.target.value })} placeholder="30" />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                  <Button onClick={() => createItem.mutate(newItem)} disabled={!newItem.name}>Add Item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Menu Items</p>
                <p className="text-2xl font-bold mt-1">{summary?.totalItems || 0}</p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
                <UtensilsCrossed className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">With Recipe</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{summary?.withRecipe || 0}</p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                <ChefHat className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Actual food cost from recipe</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Without Recipe</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{summary?.withoutRecipe || 0}</p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Using default COGS %</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Recipe Coverage</p>
                <p className="text-2xl font-bold mt-1">{summary?.coveragePercent || 0}%</p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-violet-50 flex items-center justify-center">
                <PieChart className="h-6 w-6 text-violet-600" />
              </div>
            </div>
            <Progress value={summary?.coveragePercent || 0} className="mt-3 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Bulk Update + Avg COGS Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Percent className="h-4 w-4" /> Bulk Update COGS by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <Select value={bulkCategory} onValueChange={setBulkCategory}>
                  <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent>
                    {categories.filter(c => {
                      const items = allItems?.filter(i => i.category === c && !i.hasRecipe);
                      return items && items.length > 0;
                    }).map(c => {
                      const count = allItems?.filter(i => i.category === c && !i.hasRecipe).length || 0;
                      return <SelectItem key={c} value={c}>{c} ({count} items)</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <label className="text-sm font-medium text-muted-foreground">COGS %</label>
                <Input type="number" step="0.5" min="0" max="100" value={bulkCogs} onChange={e => setBulkCogs(e.target.value)} placeholder="e.g., 25" />
              </div>
              <Button onClick={handleBulkUpdate} disabled={!bulkCategory || !bulkCogs || bulkUpdateCogs.isPending} size="sm">
                <Save className="h-4 w-4 mr-1" /> Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> COGS Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Avg Default COGS (no recipe)</p>
                <p className="text-lg font-bold mt-1">{avgCogsWithoutRecipe.toFixed(1)}%</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Categories w/o Recipes</p>
                <p className="text-lg font-bold mt-1">
                  {summary?.byCategory ? Object.keys(summary.byCategory).length : 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v: "all" | "with" | "without") => setFilterStatus(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Items</SelectItem>
            <SelectItem value="without">Without Recipe</SelectItem>
            <SelectItem value="with">With Recipe</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-sm py-1.5">
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Items List by Category */}
      <ScrollArea className="h-[calc(100vh-520px)] min-h-[400px]">
        <div className="space-y-6">
          {Object.entries(groupedItems).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => (
            <Card key={category} className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">{category}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{items.length} items</Badge>
                    <Badge variant={items.every(i => i.hasRecipe) ? "default" : "outline"} className={items.every(i => i.hasRecipe) ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>
                      {items.filter(i => i.hasRecipe).length}/{items.length} costed
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-2.5 px-6 font-medium text-muted-foreground">Item</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Price</th>
                        <th className="text-center py-2.5 px-4 font-medium text-muted-foreground">Status</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">COGS %</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Est. Cost</th>
                        <th className="text-right py-2.5 px-6 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const cogsPct = Number(item.defaultCogsPct || 0);
                        const price = Number(item.sellingPrice || 0);
                        const estCost = price * (cogsPct / 100);
                        const isEditing = editingId === item.id;

                        return (
                          <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-6">
                              <span className="font-medium">{item.name}</span>
                            </td>
                            <td className="text-right py-3 px-4 font-medium">
                              ${Number(item.sellingPrice || 0).toFixed(2)}
                            </td>
                            <td className="text-center py-3 px-4">
                              {item.hasRecipe ? (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-0">
                                      <CheckCircle2 className="h-3 w-3 mr-1" /> Recipe
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>COGS from actual recipe costing</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
                                      <AlertCircle className="h-3 w-3 mr-1" /> Default
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>Using assigned default COGS %</TooltipContent>
                                </Tooltip>
                              )}
                            </td>
                            <td className="text-right py-3 px-4">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    max="100"
                                    className="w-20 h-8 text-right text-sm"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleSaveCogs(item.id);
                                      if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    autoFocus
                                  />
                                  <span className="text-muted-foreground">%</span>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleSaveCogs(item.id)}>
                                    <Save className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <span
                                  className={`cursor-pointer hover:underline ${item.hasRecipe ? 'text-emerald-600' : 'text-amber-600 font-medium'}`}
                                  onClick={() => {
                                    if (!item.hasRecipe && user) {
                                      setEditingId(item.id);
                                      setEditValue(String(cogsPct));
                                    }
                                  }}
                                >
                                  {cogsPct.toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className="text-right py-3 px-4 text-muted-foreground">
                              ${estCost.toFixed(2)}
                            </td>
                            <td className="text-right py-3 px-6">
                              <div className="flex items-center justify-end gap-1">
                                {!item.hasRecipe && recipes && recipes.length > 0 && user && (
                                  <Select onValueChange={(recipeId) => linkRecipe.mutate({ menuItemId: item.id, recipeId: Number(recipeId) })}>
                                    <SelectTrigger className="h-8 w-8 p-0 border-0 [&>svg]:hidden">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="flex items-center justify-center w-full h-full">
                                            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>Link to recipe</TooltipContent>
                                      </Tooltip>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {recipes.filter(r => !r.isSubRecipe).map(r => (
                                        <SelectItem key={r.id} value={String(r.id)}>
                                          {r.name} ({Number(r.foodCostPct || 0).toFixed(1)}%)
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {item.hasRecipe && user && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => unlinkRecipe.mutate({ menuItemId: item.id })}>
                                        <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Unlink recipe</TooltipContent>
                                  </Tooltip>
                                )}
                                {user && !item.hasRecipe && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400 hover:text-red-600" onClick={() => deleteItem.mutate({ id: item.id })}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove item</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <UtensilsCrossed className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-lg font-medium">No items found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
