import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, BarChart3, Settings2, Share2, RefreshCw, Building2, Clock,
  AlertCircle, CheckCircle2, Loader2, Zap, Database,
} from "lucide-react";
import { toast } from "sonner";
import ProfitAndLoss from "./financial/ProfitAndLoss";
import BalanceSheet from "./financial/BalanceSheet";
import AccountMapping from "./financial/AccountMapping";
import SharedExpenses from "./financial/SharedExpenses";

export default function FinancialStatements() {
  const [activeTab, setActiveTab] = useState("profit-loss");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  const { data: entities, isLoading: entitiesLoading, refetch: refetchEntities } = trpc.financialStatements.entities.list.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  const autoSetup = trpc.financialStatements.entities.autoSetup.useMutation({
    onSuccess: (result) => {
      toast.success(`Setup complete! ${result.entitiesCreated} entities created.`);
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Setup failed: ${err.message}`);
    },
  });

  const syncAccounts = trpc.financialStatements.entities.syncAccounts.useMutation({
    onSuccess: (result) => {
      toast.success(`Synced ${result.accountCount} accounts from QuickBooks`);
      refetchEntities();
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const selectedEntity = entities?.find((e: any) => e.id === selectedEntityId) || null;
  const selectedLocation = selectedEntity
    ? locations?.find((l: any) => l.id === selectedEntity.locationId)
    : null;

  const hasEntities = entities && entities.length > 0;

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
            QuickBooks-connected financial reporting with account mapping and shared expense allocation
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                Your QuickBooks companies need to be linked to your cafe locations before you can generate financial statements.
              </p>
              <div className="text-sm text-muted-foreground mb-6 space-y-1">
                <p>This will create entities for:</p>
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {[
                    { name: "PK Cafe", legal: "9427-0659 Quebec Inc" },
                    { name: "MK Cafe", legal: "9427-0659 Quebec Inc" },
                    { name: "ONT Cafe", legal: "9287-8982 Quebec Inc" },
                    { name: "CT Cafe", legal: "9364-1009 Quebec Inc" },
                    { name: "Factory & Central Kitchen", legal: "Hinnawi Bros Bagel & Cafe" },
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
                Fiscal year: September 1 — August 31 | Line definitions will be seeded automatically
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entity Selector — shown when entities exist */}
      {hasEntities && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-4">
              <Building2 className="h-5 w-5 text-muted-foreground" />
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
                      return (
                        <SelectItem key={entity.id} value={entity.id.toString()}>
                          <div className="flex items-center gap-2">
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
              {selectedEntity && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
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
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No entity selected state */}
      {hasEntities && !selectedEntityId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Select an Entity</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose a business entity above to view its financial statements. Each entity is connected to a QuickBooks company.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      {selectedEntityId && (
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
