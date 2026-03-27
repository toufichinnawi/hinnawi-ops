import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, BarChart3, Settings2, Share2, RefreshCw, Building2, Clock,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import ProfitAndLoss from "./financial/ProfitAndLoss";
import BalanceSheet from "./financial/BalanceSheet";
import AccountMapping from "./financial/AccountMapping";
import SharedExpenses from "./financial/SharedExpenses";

// Entity mapping: location name → QBO company
const ENTITY_MAP: Record<string, { label: string; legalName: string }> = {
  "PK Cafe": { label: "PK Cafe", legalName: "9427-0659 Quebec Inc" },
  "MK Cafe": { label: "MK Cafe", legalName: "9427-0659 Quebec Inc" },
  "ONT Cafe": { label: "ONT Cafe", legalName: "9287-8982 Quebec Inc" },
  "CT Cafe": { label: "CT Cafe", legalName: "9364-1009 Quebec Inc" },
  "Factory": { label: "Factory & Central Kitchen", legalName: "Hinnawi Bros Bagel & Cafe" },
};

export default function FinancialStatements() {
  const [activeTab, setActiveTab] = useState("profit-loss");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  const { data: entities, isLoading: entitiesLoading } = trpc.financialStatements.entities.list.useQuery();
  const { data: locations } = trpc.locations.list.useQuery();

  const selectedEntity = entities?.find(e => e.id === selectedEntityId) || null;
  const selectedLocation = selectedEntity
    ? locations?.find(l => l.id === selectedEntity.locationId)
    : null;

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

      {/* Entity Selector */}
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
                  {entitiesLoading ? (
                    <SelectItem value="loading" disabled>Loading entities...</SelectItem>
                  ) : entities && entities.length > 0 ? (
                    entities.map(entity => {
                      const loc = locations?.find(l => l.id === entity.locationId);
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
                    })
                  ) : (
                    <SelectItem value="none" disabled>
                      No entities configured. Set up QBO connections first.
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {selectedEntity && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>QBO Realm: {selectedEntity.realmId}</span>
                <span className="mx-1">|</span>
                <span>Fiscal Year: Sep 1 - Aug 31</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* No entity selected state */}
      {!selectedEntityId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Select an Entity</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose a business entity above to view its financial statements. Each entity is connected to a QuickBooks company.
            </p>
            {(!entities || entities.length === 0) && !entitiesLoading && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">
                  No entities are configured yet. Go to Integrations to connect your QuickBooks companies.
                </p>
                <Button variant="outline" onClick={() => window.location.href = "/integrations"}>
                  Go to Integrations
                </Button>
              </div>
            )}
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
