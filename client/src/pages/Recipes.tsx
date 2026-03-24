import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChefHat, DollarSign, TrendingUp, Search, Plus, Pencil, Trash2, RefreshCw,
  ChevronDown, ChevronRight, AlertTriangle, Package, X, Copy, Upload,
  FileSpreadsheet, Link2, Unlink, Eye, ArrowUpDown, Check, Percent
} from "lucide-react";
import { useState, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(val);
}

const CATEGORIES = ["Sandwiches", "Breakfast", "Salads", "Cream Cheese", "Beverages", "Pastries", "Sides", "Bagels", "Sauces", "Other"];
const UNITS = ["Kg", "g", "L", "mL", "Unit", "Slice", "Portion", "Tbsp", "Tsp", "Cup", "oz"];

type IngredientLine = {
  ingredientName: string;
  quantity: string;
  unit: string;
  inventoryItemId?: number | null;
  estimatedCost?: number;
};

type ParsedRecipe = {
  name: string;
  category: string;
  sellingPrice: string;
  ingredients: { ingredientName: string; quantity: string; unit: string }[];
  selected: boolean;
};

export default function Recipes() {
  const { data: recipesData, isLoading } = trpc.recipes.list.useQuery();
  const { data: ingredients } = trpc.inventory.items.useQuery();
  const { data: menuItems } = trpc.menuItems.list.useQuery();
  const recalculate = trpc.recipes.recalculateCosts.useMutation();
  const createRecipe = trpc.recipes.create.useMutation();
  const updateRecipe = trpc.recipes.update.useMutation();
  const deleteRecipe = trpc.recipes.delete.useMutation();
  const duplicateRecipe = trpc.recipes.duplicate.useMutation();
  const bulkImport = trpc.recipes.bulkImport.useMutation();
  const linkMenuItem = trpc.menuItems.linkRecipe.useMutation();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [expandedRecipe, setExpandedRecipe] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState<number | null>(null);
  const [sortField, setSortField] = useState<"name" | "foodCost" | "category">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [parsedUpload, setParsedUpload] = useState<ParsedRecipe[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("Sandwiches");
  const [formPrice, setFormPrice] = useState("");
  const [formIsSubRecipe, setFormIsSubRecipe] = useState(false);
  const [formIngredients, setFormIngredients] = useState<IngredientLine[]>([]);
  const [linkMenuItemId, setLinkMenuItemId] = useState<string>("");

  const recipes = useMemo(() => {
    if (!recipesData) return [];
    return recipesData.filter(r => !r.isSubRecipe);
  }, [recipesData]);

  const subRecipes = useMemo(() => {
    if (!recipesData) return [];
    return recipesData.filter(r => r.isSubRecipe);
  }, [recipesData]);

  const filtered = useMemo(() => {
    let list = recipes;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q) ||
        r.ingredients.some(ing => ing.ingredientName.toLowerCase().includes(q))
      );
    }
    if (categoryFilter !== "all") {
      list = list.filter(r => r.category === categoryFilter);
    }
    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "foodCost") cmp = Number(a.foodCostPct || 0) - Number(b.foodCostPct || 0);
      else if (sortField === "category") cmp = (a.category || "").localeCompare(b.category || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [recipes, search, categoryFilter, sortField, sortDir]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    recipes.forEach(r => cats.add(r.category || "Uncategorized"));
    return Array.from(cats).sort();
  }, [recipes]);

  const avgFoodCost = useMemo(() => {
    if (recipes.length === 0) return 0;
    const validRecipes = recipes.filter(r => Number(r.foodCostPct || 0) > 0);
    if (validRecipes.length === 0) return 0;
    return validRecipes.reduce((s, r) => s + Number(r.foodCostPct || 0), 0) / validRecipes.length;
  }, [recipes]);

  const highCostCount = useMemo(() => {
    return recipes.filter(r => Number(r.foodCostPct || 0) > 30).length;
  }, [recipes]);

  // Unlinked menu items (for linking)
  const unlinkedMenuItems = useMemo(() => {
    if (!menuItems) return [];
    return menuItems.filter(mi => !mi.hasRecipe);
  }, [menuItems]);

  // Compute ingredient cost estimate
  const getIngredientCost = useCallback((name: string, qty: string, unit: string) => {
    if (!ingredients) return 0;
    const match = ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!match) return 0;
    const costPerUnit = Number(match.costPerUsableUnit || match.avgCost || 0);
    const quantity = Number(qty) || 0;
    // Unit conversion
    let multiplier = 1;
    const matchUnit = (match.unit || "Kg").toLowerCase();
    const lineUnit = unit.toLowerCase();
    if (matchUnit === "kg" && lineUnit === "g") multiplier = 0.001;
    else if (matchUnit === "l" && lineUnit === "ml") multiplier = 0.001;
    else if (matchUnit === "g" && lineUnit === "kg") multiplier = 1000;
    else if (matchUnit === "ml" && lineUnit === "l") multiplier = 1000;
    return costPerUnit * quantity * multiplier;
  }, [ingredients]);

  const formTotalCost = useMemo(() => {
    return formIngredients.reduce((sum, ing) => sum + getIngredientCost(ing.ingredientName, ing.quantity, ing.unit), 0);
  }, [formIngredients, getIngredientCost]);

  const formFoodCostPct = useMemo(() => {
    const price = Number(formPrice) || 0;
    if (price === 0) return 0;
    return (formTotalCost / price) * 100;
  }, [formTotalCost, formPrice]);

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      const result = await recalculate.mutateAsync();
      await utils.recipes.list.invalidate();
      toast.success(`Recalculated costs for ${result.updated} recipes`);
    } catch {
      toast.error("Failed to recalculate costs");
    }
    setIsRecalculating(false);
  };

  const resetForm = () => {
    setFormName("");
    setFormCategory("Sandwiches");
    setFormPrice("");
    setFormIsSubRecipe(false);
    setFormIngredients([]);
    setLinkMenuItemId("");
  };

  const openCreateDialog = () => {
    resetForm();
    setShowCreateDialog(true);
  };

  const openEditDialog = (recipeId: number) => {
    const recipe = recipesData?.find(r => r.id === recipeId);
    if (!recipe) return;
    setFormName(recipe.name);
    setFormCategory(recipe.category || "Sandwiches");
    setFormPrice(recipe.sellingPrice || "");
    setFormIsSubRecipe(recipe.isSubRecipe || false);
    setFormIngredients(recipe.ingredients.map(ing => ({
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit || "Kg",
      inventoryItemId: ing.inventoryItemId,
    })));
    setEditingRecipe(recipeId);
  };

  const addIngredientLine = () => {
    setFormIngredients([...formIngredients, { ingredientName: "", quantity: "", unit: "Kg" }]);
  };

  const removeIngredientLine = (index: number) => {
    setFormIngredients(formIngredients.filter((_, i) => i !== index));
  };

  const updateIngredientLine = (index: number, field: keyof IngredientLine, value: string | number | null) => {
    const updated = [...formIngredients];
    (updated[index] as any)[field] = value;
    if (field === "ingredientName" && ingredients) {
      const match = ingredients.find(i => i.name.toLowerCase() === (value as string).toLowerCase());
      if (match) {
        updated[index].unit = match.unit || "Kg";
        updated[index].inventoryItemId = match.id;
      }
    }
    setFormIngredients(updated);
  };

  const handleSaveRecipe = async () => {
    if (!formName.trim()) { toast.error("Recipe name is required"); return; }
    if (formIngredients.length === 0) { toast.error("Add at least one ingredient"); return; }
    const validIngredients = formIngredients.filter(ing => ing.ingredientName.trim() && ing.quantity);

    try {
      if (editingRecipe) {
        await updateRecipe.mutateAsync({
          id: editingRecipe,
          name: formName,
          category: formCategory,
          sellingPrice: formPrice,
          ingredients: validIngredients,
        });
        toast.success("Recipe updated");
        setEditingRecipe(null);
      } else {
        const result = await createRecipe.mutateAsync({
          name: formName,
          category: formCategory,
          sellingPrice: formPrice,
          isSubRecipe: formIsSubRecipe,
          ingredients: validIngredients,
        });
        // Link to menu item if selected
        if (linkMenuItemId && linkMenuItemId !== "none" && result) {
          await linkMenuItem.mutateAsync({ menuItemId: Number(linkMenuItemId), recipeId: result.id });
          await utils.menuItems.list.invalidate();
        }
        toast.success("Recipe created");
        setShowCreateDialog(false);
      }
      await utils.recipes.list.invalidate();
      resetForm();
    } catch {
      toast.error("Failed to save recipe");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteRecipe.mutateAsync({ id });
      await utils.recipes.list.invalidate();
      toast.success("Recipe deleted");
      setDeleteConfirm(null);
    } catch {
      toast.error("Failed to delete recipe");
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      await duplicateRecipe.mutateAsync({ id });
      await utils.recipes.list.invalidate();
      toast.success("Recipe duplicated");
    } catch {
      toast.error("Failed to duplicate recipe");
    }
  };

  const handleSort = (field: "name" | "foodCost" | "category") => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Excel upload parsing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));

      // Try to detect recipe rows: look for name, category, price pattern
      const parsed: ParsedRecipe[] = [];
      let currentRecipe: ParsedRecipe | null = null;

      for (const row of lines) {
        if (!row[0]) {
          if (currentRecipe && currentRecipe.ingredients.length > 0) {
            parsed.push(currentRecipe);
            currentRecipe = null;
          }
          continue;
        }

        // Check if this looks like a recipe header (has a price-like value)
        const possiblePrice = row.find(c => /^\d+\.\d{2}$/.test(c));
        const isIngredientRow = row[0] && !possiblePrice && currentRecipe;

        if (possiblePrice && !isIngredientRow) {
          if (currentRecipe && currentRecipe.ingredients.length > 0) {
            parsed.push(currentRecipe);
          }
          currentRecipe = {
            name: row[0],
            category: row[1] || "Other",
            sellingPrice: possiblePrice,
            ingredients: [],
            selected: true,
          };
        } else if (currentRecipe && row[0]) {
          const qty = row.find(c => /^\d+\.?\d*$/.test(c) && c !== currentRecipe!.sellingPrice);
          const unit = row.find(c => UNITS.some(u => u.toLowerCase() === c.toLowerCase()));
          currentRecipe.ingredients.push({
            ingredientName: row[0],
            quantity: qty || "1",
            unit: unit || "Kg",
          });
        }
      }
      if (currentRecipe && currentRecipe.ingredients.length > 0) {
        parsed.push(currentRecipe);
      }

      if (parsed.length === 0) {
        toast.error("Could not parse any recipes from the file. Please use CSV format with recipe name, category, and ingredients.");
        return;
      }

      setParsedUpload(parsed);
      setShowUploadDialog(true);
    } catch {
      toast.error("Failed to read file");
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleBulkImport = async () => {
    const selected = parsedUpload.filter(r => r.selected);
    if (selected.length === 0) { toast.error("Select at least one recipe to import"); return; }
    setIsImporting(true);
    try {
      const result = await bulkImport.mutateAsync({
        recipes: selected.map(r => ({
          name: r.name,
          category: r.category,
          sellingPrice: r.sellingPrice,
          ingredients: r.ingredients,
        })),
      });
      await utils.recipes.list.invalidate();
      toast.success(`Imported ${result.created} recipes (${result.skipped} duplicates skipped)`);
      setShowUploadDialog(false);
      setParsedUpload([]);
    } catch {
      toast.error("Failed to import recipes");
    }
    setIsImporting(false);
  };

  const toggleUploadRecipe = (index: number) => {
    setParsedUpload(prev => prev.map((r, i) => i === index ? { ...r, selected: !r.selected } : r));
  };

  // Detail view recipe
  const detailRecipe = useMemo(() => {
    if (showDetailDialog === null) return null;
    return recipesData?.find(r => r.id === showDetailDialog) || null;
  }, [showDetailDialog, recipesData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recipe Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Create, edit, and manage recipes with ingredient costing</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />
            Upload Recipes
          </Button>
          <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={isRecalculating}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRecalculating ? 'animate-spin' : ''}`} />
            Recalculate Costs
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Recipe
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-purple-50 flex items-center justify-center">
                <ChefHat className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Menu Recipes</p>
                <p className="text-lg font-bold">{recipes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <Package className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sub-Recipes</p>
                <p className="text-lg font-bold">{subRecipes.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Food Cost %</p>
                <p className="text-lg font-bold">{avgFoodCost.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">High Cost (&gt;30%)</p>
                <p className="text-lg font-bold text-amber-600">{highCostCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-50 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ingredients</p>
                <p className="text-lg font-bold">{ingredients?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="recipes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recipes">
            <ChefHat className="h-4 w-4 mr-1.5" /> Recipes ({recipes.length})
          </TabsTrigger>
          <TabsTrigger value="subrecipes">
            <Package className="h-4 w-4 mr-1.5" /> Sub-Recipes ({subRecipes.length})
          </TabsTrigger>
          <TabsTrigger value="ingredients">
            <DollarSign className="h-4 w-4 mr-1.5" /> Master Ingredients ({ingredients?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* ── Recipes Tab ── */}
        <TabsContent value="recipes" className="mt-4">
          {/* Search & Filter Bar */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recipes or ingredients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("name")}>
                        <span className="flex items-center gap-1">Recipe <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("category")}>
                        <span className="flex items-center gap-1">Category <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Ingredients</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Selling Price</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Recipe Cost</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("foodCost")}>
                        <span className="flex items-center gap-1 justify-end">Food Cost % <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Profit</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Loading recipes...</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No recipes found</td></tr>
                    ) : filtered.map(recipe => {
                      const foodCost = Number(recipe.foodCostPct || 0);
                      const costColor = foodCost > 35 ? "text-red-600" : foodCost > 30 ? "text-amber-600" : "text-emerald-600";
                      const isExpanded = expandedRecipe === recipe.id;
                      return (
                        <TooltipProvider key={recipe.id}>
                          <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setExpandedRecipe(isExpanded ? null : recipe.id)}>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                                <span className="font-medium">{recipe.name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="text-xs font-normal">{recipe.category || 'Uncategorized'}</Badge>
                            </td>
                            <td className="py-3 px-4 text-center text-muted-foreground">{recipe.ingredients.length}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(Number(recipe.sellingPrice || 0))}</td>
                            <td className="py-3 px-4 text-right">{formatCurrency(Number(recipe.totalCost || 0))}</td>
                            <td className="py-3 px-4 text-right">
                              <span className={`font-bold ${costColor}`}>{foodCost.toFixed(1)}%</span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {formatCurrency(Number(recipe.sellingPrice || 0) - Number(recipe.totalCost || 0))}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDetailDialog(recipe.id)}>
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View details</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditDialog(recipe.id)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDuplicate(recipe.id)}>
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Duplicate</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => setDeleteConfirm(recipe.id)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                          {/* Expanded ingredient breakdown */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="bg-muted/20 px-12 py-3">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Ingredient Breakdown</div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="text-left py-1 font-medium">Ingredient</th>
                                      <th className="text-right py-1 font-medium">Quantity</th>
                                      <th className="text-left py-1 pl-2 font-medium">Unit</th>
                                      <th className="text-right py-1 font-medium">Line Cost</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {recipe.ingredients.map((ing, i) => (
                                      <tr key={i} className="border-t border-muted/50">
                                        <td className="py-1.5">{ing.ingredientName}</td>
                                        <td className="py-1.5 text-right">{Number(ing.quantity).toFixed(3)}</td>
                                        <td className="py-1.5 pl-2 text-muted-foreground">{ing.unit}</td>
                                        <td className="py-1.5 text-right font-medium">{formatCurrency(Number(ing.lineCost || 0))}</td>
                                      </tr>
                                    ))}
                                    <tr className="border-t-2 border-muted font-bold">
                                      <td className="py-1.5" colSpan={3}>Total</td>
                                      <td className="py-1.5 text-right">{formatCurrency(Number(recipe.totalCost || 0))}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </TooltipProvider>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sub-Recipes Tab ── */}
        <TabsContent value="subrecipes" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">In-House Compound Ingredients</CardTitle>
                <Button size="sm" variant="outline" onClick={() => { resetForm(); setFormIsSubRecipe(true); setShowCreateDialog(true); }}>
                  <Plus className="h-4 w-4 mr-1.5" /> New Sub-Recipe
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Sauces, dressings, and preparations made in-house that are used as ingredients in menu recipes.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Name</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Ingredients</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Cost</th>
                      <th className="text-center py-3 px-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subRecipes.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">No sub-recipes</td></tr>
                    ) : subRecipes.map(sr => (
                      <tr key={sr.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">{sr.name}</td>
                        <td className="py-3 px-4 text-center text-muted-foreground">{sr.ingredients.length}</td>
                        <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(sr.totalCost || 0))}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditDialog(sr.id)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => setDeleteConfirm(sr.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Master Ingredients Tab ── */}
        <TabsContent value="ingredients" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Master Ingredient List</CardTitle>
              <p className="text-xs text-muted-foreground">Prices auto-update from supplier invoices. Yield % accounts for waste/trim.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Ingredient</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Supplier</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Purchase</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Cost/Unit</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Yield %</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Usable Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!ingredients ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Loading...</td></tr>
                    ) : ingredients.map(item => (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-medium">{item.name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{item.supplierName || '—'}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-xs font-normal">{item.category || 'Uncategorized'}</Badge>
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">
                          {Number(item.purchaseAmount || 0).toFixed(1)} {item.unit} / {formatCurrency(Number(item.purchaseCost || 0))}
                        </td>
                        <td className="py-3 px-4 text-right">{formatCurrency(Number(item.avgCost || 0))}/{item.unit}</td>
                        <td className="py-3 px-4 text-right">{Number(item.yieldPct || 100).toFixed(0)}%</td>
                        <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(item.costPerUsableUnit || 0))}/{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create/Edit Recipe Dialog ── */}
      <Dialog open={showCreateDialog || editingRecipe !== null} onOpenChange={(open) => {
        if (!open) { setShowCreateDialog(false); setEditingRecipe(null); resetForm(); }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              {editingRecipe ? "Edit Recipe" : "New Recipe"}
            </DialogTitle>
            <DialogDescription>
              {editingRecipe ? "Update recipe details, ingredients, and costing" : "Create a new recipe with ingredients and link to a menu item"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Basic Info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Recipe Name</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., New York Bagel" />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Selling Price ($)</Label>
                <Input type="number" step="0.01" value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder="0.00" />
              </div>
            </div>

            {/* Sub-recipe toggle & Menu item link */}
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsSubRecipe}
                  onChange={e => setFormIsSubRecipe(e.target.checked)}
                  className="rounded border-gray-300"
                />
                This is a sub-recipe (sauce, dressing, etc.)
              </label>
              {!editingRecipe && !formIsSubRecipe && unlinkedMenuItems.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <Label className="text-xs whitespace-nowrap">Link to menu item:</Label>
                  <Select value={linkMenuItemId} onValueChange={setLinkMenuItemId}>
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue placeholder="Select item..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Don't link</SelectItem>
                      {unlinkedMenuItems.map(mi => (
                        <SelectItem key={mi.id} value={String(mi.id)}>{mi.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator />

            {/* Ingredients Builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs uppercase tracking-wider font-semibold">Ingredients</Label>
                <Button variant="outline" size="sm" onClick={addIngredientLine} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Ingredient
                </Button>
              </div>

              {formIngredients.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                  <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No ingredients added yet</p>
                  <Button variant="link" size="sm" onClick={addIngredientLine} className="mt-1">
                    <Plus className="h-3 w-3 mr-1" /> Add your first ingredient
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_80px_90px_80px_32px] gap-2 px-1 text-xs text-muted-foreground font-medium">
                    <span>Ingredient</span>
                    <span className="text-right">Qty</span>
                    <span>Unit</span>
                    <span className="text-right">Est. Cost</span>
                    <span></span>
                  </div>
                  {formIngredients.map((ing, i) => {
                    const lineCost = getIngredientCost(ing.ingredientName, ing.quantity, ing.unit);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_80px_90px_80px_32px] gap-2 items-center">
                        <Input
                          value={ing.ingredientName}
                          onChange={e => updateIngredientLine(i, "ingredientName", e.target.value)}
                          placeholder="Ingredient name"
                          list="ingredient-options"
                          className="text-sm h-8"
                        />
                        <Input
                          type="number"
                          step="0.001"
                          value={ing.quantity}
                          onChange={e => updateIngredientLine(i, "quantity", e.target.value)}
                          placeholder="Qty"
                          className="text-sm h-8 text-right"
                        />
                        <Select value={ing.unit} onValueChange={v => updateIngredientLine(i, "unit", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UNITS.map(u => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-right font-medium text-muted-foreground">
                          {lineCost > 0 ? formatCurrency(lineCost) : '—'}
                        </span>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-600" onClick={() => removeIngredientLine(i)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}

                  {/* Cost Summary */}
                  <Separator className="my-2" />
                  <div className="flex justify-between items-center px-1 py-2 bg-muted/30 rounded-lg">
                    <div className="flex gap-6 text-sm">
                      <span>Total Cost: <strong>{formatCurrency(formTotalCost)}</strong></span>
                      {Number(formPrice) > 0 && (
                        <>
                          <span>Food Cost: <strong className={formFoodCostPct > 30 ? "text-amber-600" : "text-emerald-600"}>{formFoodCostPct.toFixed(1)}%</strong></span>
                          <span>Profit: <strong>{formatCurrency(Number(formPrice) - formTotalCost)}</strong></span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Datalist for ingredient autocomplete */}
              <datalist id="ingredient-options">
                {ingredients?.map(item => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingRecipe(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSaveRecipe} disabled={createRecipe.isPending || updateRecipe.isPending}>
              {(createRecipe.isPending || updateRecipe.isPending) ? "Saving..." : editingRecipe ? "Update Recipe" : "Create Recipe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Recipe Detail Dialog ── */}
      <Dialog open={showDetailDialog !== null} onOpenChange={(open) => { if (!open) setShowDetailDialog(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailRecipe && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ChefHat className="h-5 w-5" /> {detailRecipe.name}
                </DialogTitle>
                <DialogDescription>
                  {detailRecipe.category} {detailRecipe.isSubRecipe ? '(Sub-Recipe)' : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-xs text-muted-foreground">Selling Price</p>
                    <p className="text-lg font-bold">{formatCurrency(Number(detailRecipe.sellingPrice || 0))}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-xs text-muted-foreground">Recipe Cost</p>
                    <p className="text-lg font-bold">{formatCurrency(Number(detailRecipe.totalCost || 0))}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-xs text-muted-foreground">Food Cost %</p>
                    <p className={`text-lg font-bold ${Number(detailRecipe.foodCostPct || 0) > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {Number(detailRecipe.foodCostPct || 0).toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <p className="text-xs text-muted-foreground">Gross Profit</p>
                    <p className="text-lg font-bold text-emerald-600">
                      {formatCurrency(Number(detailRecipe.sellingPrice || 0) - Number(detailRecipe.totalCost || 0))}
                    </p>
                  </div>
                </div>

                {/* Ingredients Table */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Ingredients ({detailRecipe.ingredients.length})</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Ingredient</th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Quantity</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Unit</th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">Line Cost</th>
                        <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailRecipe.ingredients.map((ing, i) => {
                        const lineCost = Number(ing.lineCost || 0);
                        const totalCost = Number(detailRecipe.totalCost || 1);
                        const pctOfTotal = totalCost > 0 ? (lineCost / totalCost) * 100 : 0;
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 px-3 font-medium">{ing.ingredientName}</td>
                            <td className="py-2 px-3 text-right">{Number(ing.quantity).toFixed(3)}</td>
                            <td className="py-2 px-3 text-muted-foreground">{ing.unit}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(lineCost)}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">{pctOfTotal.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 font-bold">
                        <td className="py-2 px-3" colSpan={3}>Total</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(Number(detailRecipe.totalCost || 0))}</td>
                        <td className="py-2 px-3 text-right">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDetailDialog(null)}>Close</Button>
                <Button onClick={() => { setShowDetailDialog(null); openEditDialog(detailRecipe.id); }}>
                  <Pencil className="h-4 w-4 mr-1.5" /> Edit Recipe
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Upload / Import Dialog ── */}
      <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!open) { setShowUploadDialog(false); setParsedUpload([]); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Import Recipes from File
            </DialogTitle>
            <DialogDescription>
              {parsedUpload.length} recipes detected. Select which ones to import. Duplicates (by name) will be skipped.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2">
              {parsedUpload.map((recipe, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${recipe.selected ? 'border-primary bg-primary/5' : 'border-muted bg-muted/20 opacity-60'}`}
                  onClick={() => toggleUploadRecipe(i)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-5 w-5 rounded border flex items-center justify-center ${recipe.selected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                        {recipe.selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{recipe.name}</p>
                        <p className="text-xs text-muted-foreground">{recipe.category} · {recipe.ingredients.length} ingredients · ${recipe.sellingPrice}</p>
                      </div>
                    </div>
                  </div>
                  {recipe.selected && (
                    <div className="mt-2 ml-8 text-xs text-muted-foreground">
                      {recipe.ingredients.map(ing => ing.ingredientName).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
              {parsedUpload.filter(r => r.selected).length} of {parsedUpload.length} selected
            </div>
            <Button variant="outline" onClick={() => { setShowUploadDialog(false); setParsedUpload([]); }}>Cancel</Button>
            <Button onClick={handleBulkImport} disabled={isImporting || parsedUpload.filter(r => r.selected).length === 0}>
              {isImporting ? "Importing..." : `Import ${parsedUpload.filter(r => r.selected).length} Recipes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Recipe</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this recipe? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
