import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, BarChart3, Settings2, Share2, RefreshCw, Building2, Clock,
  AlertCircle, CheckCircle2, Loader2, Zap, Database, Link2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import ProfitAndLoss from "./financial/ProfitAndLoss";
import BalanceSheet from "./financial/BalanceSheet";
import AccountMapping from "./financial/AccountMapping";
import SharedExpenses from "./financial/SharedExpenses";
import ConsolidatedPL from "./financial/ConsolidatedPL";
import ConsolidatedBS from "./financial/ConsolidatedBS";

// Production realm ID mapping
const PROD_REALM_MAP: Record<string, string> = {
  "9130346671806126": "9427-0659 Quebec Inc (PK + MK)",
  "123146517406139": "9287-8982 Quebec Inc (ONT)",
  "123146517409489": "9364-1009 Quebec Inc (CT)",
  "193514694951044": "Hinnawi Bros Bagel & Cafe (Factory)",
};

export default function FinancialStatements() {
  const [activeTab, setActiveTab] = useState("profit-loss");
  const [viewMode, setViewMode] = useState<"entity" | "consolidated">("entity");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  const { data: entities, isLoading: entitiesLoading, refetch: refetchEntities } = trpc.financialStatements.entities.list.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  // Check URL params for QBO production connection callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("qbo") === "connected") {
      const company = params.get("company") || "QuickBooks";
      const realm = params.get("realm") || "";
      toast.success(`Connected to ${company} (Production)`, {
        description: realm ? `Realm ID: ${realm}` : undefined,
      });
      refetchEntities();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const autoSetup = trpc.financialStatements.entities.autoSetup.useMutation({
    onSuccess: (result) => {
      toast.success(`Setup complete! ${result.entitiesCreated} entities created with production realm IDs.`);
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Setup failed: ${err.message}`);
    },
  });

  const syncAccounts = trpc.financialStatements.entities.syncAccounts.useMutation({
    onSuccess: (result) => {
      toast.success(`Synced ${result.accountCount} accounts from QuickBooks Production`);
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const reclassify = trpc.financialStatements.entities.reclassifyTransactions.useMutation({
    onSuccess: (result) => {
      toast.success(`Reclassification complete! ${result.classified} transactions classified (${result.skipped} skipped, ${result.errors} errors)`, {
        description: `PK Dept ID: ${result.departmentsPK.Id}, MK Dept ID: ${result.departmentsMK.Id}`,
        duration: 10000,
      });
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Reclassification failed: ${err.message}`);
    },
  });

  const reclassifyAccounts = trpc.financialStatements.entities.reclassifyAccounts.useMutation({
    onSuccess: (result) => {
      toast.success(`Account reclassification complete! ${result.reclassified} accounts updated, ${result.alreadyCorrect} already correct`, {
        description: `Analyzed: ${result.analyzed} | Errors: ${result.errors} | No rule: ${result.noRuleMatch}`,
        duration: 10000,
      });
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Account reclassification failed: ${err.message}`);
    },
  });

  const selectedEntity = entities?.find((e: any) => e.id === selectedEntityId) || null;
  const selectedLocation = selectedEntity
    ? locations?.find((l: any) => l.id === selectedEntity.locationId)
    : null;

  const hasEntities = entities && entities.length > 0;

  // Check if an entity has a valid production realm ID (not sandbox/pending)
  const isProductionConnected = (entity: any) => {
    return entity?.realmId && entity.realmId !== "pending" && entity.realmId !== "9341456522572832";
  };

  // Initiate production OAuth for an entity
  const connectEntity = (entityId: number) => {
    const origin = window.location.origin;
    window.location.href = `/api/qbo/prod/connect?entityId=${entityId}&origin=${encodeURIComponent(origin)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Financial Statements
          </h1>
          <p className="text-muted-foreground mt-1">
            Production QuickBooks-connected financial reporting with account mapping and shared expense allocation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 border-green-300 text-green-700 bg-green-50">
            <CheckCircle2 className="h-3 w-3" />
            Production QBO
          </Badge>
          {selectedEntity?.lastSyncAt && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              Last sync: {new Date(selectedEntity.lastSyncAt).toLocaleString("en-CA")}
            </Badge>
          )}
          {selectedEntity?.syncStatus === "syncing" && (
            <Badge className="gap-1 bg-blue-100 text-blue-700">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Syncing...
            </Badge>
          )}
          {selectedEntity?.syncStatus === "error" && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              Sync Error
            </Badge>
          )}
        </div>
      </div>

      {/* Setup Banner — shown when no entities exist */}
      {!entitiesLoading && !hasEntities && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-8">
            <div className="text-center max-w-lg mx-auto">
              <div className="h-16 w-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Database className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Set Up Financial Entities</h3>
              <p className="text-muted-foreground mb-2">
                Your QuickBooks production companies need to be linked to your cafe locations before you can generate financial statements.
              </p>
              <div className="text-sm text-muted-foreground mb-6 space-y-1">
                <p>This will create entities for:</p>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {[
                    { name: "PK Cafe", legal: "9427-0659 Quebec Inc", realm: "9130346671806126" },
                    { name: "MK Cafe", legal: "9427-0659 Quebec Inc", realm: "9130346671806126" },
                    { name: "ONT Cafe", legal: "9287-8982 Quebec Inc", realm: "123146517406139" },
                    { name: "CT Cafe", legal: "9364-1009 Quebec Inc", realm: "123146517409489" },
                    { name: "Factory & Central Kitchen", legal: "Hinnawi Bros Bagel & Cafe", realm: "193514694951044" },
                  ].map((e) => (
                    <Badge key={e.name} variant="outline" className="text-xs">
                      {e.name} <span className="text-muted-foreground ml-1">→ {e.legal}</span>
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                size="lg"
                onClick={() => autoSetup.mutate()}
                disabled={autoSetup.isPending}
                className="gap-2"
              >
                {autoSetup.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {autoSetup.isPending ? "Setting up..." : "Auto-Setup All Entities"}
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Fiscal year: September 1 — August 31 | Production QuickBooks API
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* View Mode Toggle + Entity Selector — shown when entities exist */}
      {hasEntities && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-4">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              {/* View Mode Toggle */}
              <div className="flex border rounded-md overflow-hidden">
                <button
                  onClick={() => { setViewMode("entity"); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === "entity" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  }`}
                >
                  Single Entity
                </button>
                <button
                  onClick={() => { setViewMode("consolidated"); setActiveTab("consolidated-pl"); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === "consolidated" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  }`}
                >
                  Consolidated
                </button>
              </div>
              {viewMode === "entity" && (
              <div className="flex-1">
                <Select
                  value={selectedEntityId?.toString() || ""}
                  onValueChange={(val) => setSelectedEntityId(Number(val))}
                >
                  <SelectTrigger className="w-[350px]">
                    <SelectValue placeholder="Select an entity..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(entities || []).map((entity: any) => {
                      const loc = locations?.find((l: any) => l.id === entity.locationId);
                      const connected = isProductionConnected(entity);
                      return (
                        <SelectItem key={entity.id} value={entity.id.toString()}>
                          <div className="flex items-center gap-2">
                            {connected ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                            )}
                            <span className="font-medium">{loc?.name || entity.companyName || `Entity ${entity.id}`}</span>
                            {entity.legalName && (
                              <span className="text-muted-foreground text-xs">({entity.legalName})</span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              )}
              {viewMode === "entity" && selectedEntity && (
                <div className="flex items-center gap-2">
                  {isProductionConnected(selectedEntity) ? (
                    <>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-green-700 font-medium">Production</span>
                        <span className="mx-1">|</span>
                        <span>Realm: {selectedEntity.realmId}</span>
                        <span className="mx-1">|</span>
                        <span>FY: Sep 1 — Aug 31</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncAccounts.mutate({ entityId: selectedEntityId! })}
                        disabled={syncAccounts.isPending}
                        className="gap-1 ml-2"
                      >
                        {syncAccounts.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Sync Accounts
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 bg-amber-50">
                        <AlertCircle className="h-3 w-3" />
                        Not Connected to Production QBO
                      </Badge>
                      <Button
                        size="sm"
                        onClick={() => connectEntity(selectedEntityId!)}
                        className="gap-1 bg-green-600 hover:bg-green-700"
                      >
                        <Link2 className="h-3 w-3" />
                        Connect to QuickBooks
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {viewMode === "consolidated" && (
                <div className="flex-1">
                  <Badge variant="outline" className="gap-1 border-blue-300 text-blue-700 bg-blue-50">
                    <Building2 className="h-3 w-3" />
                    All entities combined with intercompany elimination
                  </Badge>
                </div>
              )}
            </div>

            {/* Re-setup and Reclassify buttons */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => autoSetup.mutate()}
                disabled={autoSetup.isPending}
                className="gap-1 text-xs text-muted-foreground"
              >
                {autoSetup.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                Re-run Auto-Setup (update realm IDs)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reclassify.mutate()}
                disabled={reclassify.isPending}
                className="gap-1 text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50"
              >
                {reclassify.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Settings2 className="h-3 w-3" />
                )}
                {reclassify.isPending ? "Reclassifying..." : "Reclassify MK/PK Transactions"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reclassifyAccounts.mutate({ dryRun: false })}
                disabled={reclassifyAccounts.isPending}
                className="gap-1 text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-50"
              >
                {reclassifyAccounts.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {reclassifyAccounts.isPending ? "Reclassifying Accounts..." : "Reclassify P&L Accounts in QBO"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No entity selected state — only in entity mode */}
      {hasEntities && viewMode === "entity" && !selectedEntityId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Select an Entity</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose a business entity above to view its financial statements. Each entity is connected to a production QuickBooks company.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Connection required warning — only in entity mode */}
      {viewMode === "entity" && selectedEntityId && selectedEntity && !isProductionConnected(selectedEntity) && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-8 text-center">
            <Link2 className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Connect to Production QuickBooks</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-4">
              This entity needs to be connected to its production QuickBooks company before financial data can be fetched.
              Click the button below to start the OAuth flow with Intuit.
            </p>
            <Button
              size="lg"
              onClick={() => connectEntity(selectedEntityId!)}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              <Link2 className="h-4 w-4" />
              Connect to QuickBooks Production
              <ExternalLink className="h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Expected company: {selectedEntity.legalName || "Unknown"} | Realm: {selectedEntity.realmId || "pending"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Consolidated Tabs — shown when consolidated mode is selected */}
      {viewMode === "consolidated" && hasEntities && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="consolidated-pl" className="gap-1">
              <BarChart3 className="h-4 w-4" />
              Consolidated P&L
            </TabsTrigger>
            <TabsTrigger value="consolidated-bs" className="gap-1">
              <FileText className="h-4 w-4" />
              Consolidated Balance Sheet
            </TabsTrigger>
          </TabsList>

          <TabsContent value="consolidated-pl" className="mt-4">
            <ConsolidatedPL />
          </TabsContent>

          <TabsContent value="consolidated-bs" className="mt-4">
            <ConsolidatedBS />
          </TabsContent>
        </Tabs>
      )}

      {/* Single Entity Tabs — only show when entity is production-connected */}
      {viewMode === "entity" && selectedEntityId && selectedEntity && isProductionConnected(selectedEntity) && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profit-loss" className="gap-1">
              <BarChart3 className="h-4 w-4" />
              Profit & Loss
            </TabsTrigger>
            <TabsTrigger value="balance-sheet" className="gap-1">
              <FileText className="h-4 w-4" />
              Balance Sheet
            </TabsTrigger>
            <TabsTrigger value="account-mapping" className="gap-1">
              <Settings2 className="h-4 w-4" />
              Account Mapping
            </TabsTrigger>
            <TabsTrigger value="shared-expenses" className="gap-1">
              <Share2 className="h-4 w-4" />
              Shared Expenses
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profit-loss" className="mt-4">
            <ProfitAndLoss
              entityId={selectedEntityId}
              locationId={selectedEntity?.locationId || 0}
              entityName={selectedLocation?.name || selectedEntity?.companyName || ""}
            />
          </TabsContent>

          <TabsContent value="balance-sheet" className="mt-4">
            <BalanceSheet
              entityId={selectedEntityId}
              locationId={selectedEntity?.locationId || 0}
              entityName={selectedLocation?.name || selectedEntity?.companyName || ""}
            />
          </TabsContent>

          <TabsContent value="account-mapping" className="mt-4">
            <AccountMapping entityId={selectedEntityId} />
          </TabsContent>

          <TabsContent value="shared-expenses" className="mt-4">
            <SharedExpenses />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
