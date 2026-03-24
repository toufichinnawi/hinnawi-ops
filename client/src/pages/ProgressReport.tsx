import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Code2, Database,
  LayoutDashboard, FileText, Package, ShoppingCart, Users, BarChart3,
  ChefHat, Upload, Plug, Shield, Server, Monitor, Layers, GitBranch,
  Mail, HardDrive, Lock, ArrowRight, ExternalLink, Boxes, TestTube2,
  Building2, Globe, RefreshCw, UtensilsCrossed, ListChecks
} from "lucide-react";

/* ─── Static Data ─── */

const PROJECT_META = {
  name: "Hinnawi Ops OS",
  description: "Centralized back-office operations platform for Hinnawi Bros Bagel & Cafe across all five Montreal locations.",
  domain: "hinnawiops-h46y7gag.manus.space",
  status: "Active Development — Core Platform Delivered",
  date: "March 15, 2026",
  linesOfCode: 22000,
  pageComponents: 14,
  testSuites: 6,
  passingTests: 114,
  dbTables: 22,
};

const TECH_STACK = [
  { name: "React 19", category: "Frontend" },
  { name: "Tailwind CSS 4", category: "Frontend" },
  { name: "shadcn/ui", category: "Frontend" },
  { name: "Recharts", category: "Frontend" },
  { name: "Express 4", category: "Backend" },
  { name: "tRPC 11", category: "Backend" },
  { name: "Drizzle ORM", category: "Backend" },
  { name: "MySQL / TiDB", category: "Database" },
  { name: "Manus OAuth", category: "Auth" },
  { name: "S3 Storage", category: "Storage" },
  { name: "QuickBooks Online API", category: "Integration" },
];

interface Phase {
  id: number;
  title: string;
  status: "completed" | "in_progress" | "blocked" | "not_started";
  items: { text: string; done: boolean }[];
}

const PHASES: Phase[] = [
  {
    id: 1, title: "Foundation", status: "completed",
    items: [
      { text: "Database schema (locations, suppliers, invoices, line items, daily sales, payroll, recipes, inventory, purchase orders)", done: true },
      { text: "Seed real data from extracted CSVs (254 supplier bills, POS revenue, inventory items)", done: true },
      { text: "Global theming and design tokens (slate-based executive dashboard)", done: true },
      { text: "DashboardLayout with resizable sidebar navigation", done: true },
    ],
  },
  {
    id: 2, title: "Executive Dashboard", status: "completed",
    items: [
      { text: "Top KPI cards (Net Sales Today, Prime Cost, Open Invoices, Active Alerts)", done: true },
      { text: "Store performance comparison table (all 5 locations)", done: true },
      { text: "Operations queue (daily tasks)", done: true },
      { text: "Alerts & exceptions panel", done: true },
      { text: "Revenue trend chart (last 14 days)", done: true },
      { text: "Labor targets by store", done: true },
      { text: "Recipe coverage widget (40% coverage, 22/55 items linked)", done: true },
    ],
  },
  {
    id: 3, title: "Module Pages", status: "completed",
    items: [
      { text: "Invoices & AP — supplier bill list, approval workflow, summary cards, search/filter", done: true },
      { text: "Inventory — ingredient tracking, COGS accounts, category breakdown, search", done: true },
      { text: "Purchasing — vendor catalog, PO list, status tracking", done: true },
      { text: "Workforce — labor targets, payroll performance by location", done: true },
      { text: "Recipe Costing — food cost %, gross margin, category performance", done: true },
    ],
  },
  {
    id: 4, title: "Reporting & Integrations", status: "completed",
    items: [
      { text: "Reporting Center (Daily P&L by location, monthly revenue summary, year selector)", done: true },
      { text: "Connected Systems panel (QBO, ADP, Koomi, Bank status)", done: true },
      { text: "Suppliers directory page", done: true },
    ],
  },
  {
    id: 5, title: "Data Import Pipeline", status: "completed",
    items: [
      { text: "Backend: CSV/Excel parser for POS, Payroll, Bank Statements via tRPC", done: true },
      { text: "Backend: Import history tracking (importLogs + bankTransactions tables)", done: true },
      { text: "Backend: Duplicate detection (upsert by location + date)", done: true },
      { text: "UI: Three-zone import wizard with column mapping and data preview", done: true },
      { text: "UI: Import progress, success/failure summary, and history log", done: true },
      { text: "Bank transaction auto-categorization (intercompany, payroll, deposits)", done: true },
    ],
  },
  {
    id: 6, title: "QuickBooks Online Integration", status: "completed",
    items: [
      { text: "OAuth2 connection flow with token management and auto-refresh", done: true },
      { text: "Sync invoices as Bills to QBO sandbox (24 Bills synced)", done: true },
      { text: "Create payroll Journal Entries in QBO (20 JEs synced)", done: true },
      { text: "Vendor auto-creation in QBO (Portebleue, UniFirst Canada)", done: true },
      { text: "Auto-retry scheduler: retries failed syncs every 5 min during business hours (7AM-8PM)", done: true },
      { text: "Sync log viewer with history and manual 'Run Now' trigger", done: true },
      { text: "Connected to Sandbox Company US 4575 (Realm 9341456522572832)", done: true },
    ],
  },
  {
    id: 7, title: "Real POS Data Import", status: "completed",
    items: [
      { text: "Parsed Koomi POS Net Onsite Consolidated reports (2025 + 2026)", done: true },
      { text: "Imported 1,172 daily sales records across 3 locations (PK, MK, CT)", done: true },
      { text: "2025: $2,000,820 total ($1.12M PK + $644K MK + $237K CT)", done: true },
      { text: "2026 (Jan-Mar): $319,627 total ($166K PK + $103K MK + $50K CT)", done: true },
      { text: "Fixed Reporting Center to auto-detect latest date with data", done: true },
    ],
  },
  {
    id: 8, title: "Recipe Catalog & Menu Items", status: "completed",
    items: [
      { text: "Imported real recipe catalog from HinnawiBrosRecipeCatalogCosting.xlsx", done: true },
      { text: "22 menu recipes + 3 sub-recipes (Spicy Mayo, Honey Mustard, Bacon Jam)", done: true },
      { text: "33 master ingredients with supplier, yield %, and usable unit costs", done: true },
      { text: "158 recipe ingredient lines with cost breakdown", done: true },
      { text: "Full Recipe Management page with 3 tabs (Recipes, Sub-Recipes, Master Ingredients)", done: true },
      { text: "Recipe CRUD with dynamic ingredient builder and live cost preview", done: true },
      { text: "CSV upload for bulk recipe import with preview dialog", done: true },
      { text: "Recipe duplication feature (one-click clone)", done: true },
      { text: "Auto-cost recalculation from latest supplier invoice prices", done: true },
    ],
  },
  {
    id: 9, title: "Menu Items & COGS Management", status: "completed",
    items: [
      { text: "55 menu items seeded (22 with recipes, 33 without)", done: true },
      { text: "Category-appropriate default COGS % for items without recipes", done: true },
      { text: "Dedicated Menu Items page with inline COGS editing and search/filter", done: true },
      { text: "Bulk update COGS by category", done: true },
      { text: "Recipe link/unlink from menu items", done: true },
      { text: "Recipe coverage widget on Command Center dashboard", done: true },
    ],
  },
  {
    id: 10, title: "Lightspeed POS Integration (Ontario)", status: "not_started",
    items: [
      { text: "Register on Lightspeed Developer Portal and obtain API Client credentials", done: false },
      { text: "Build OAuth2 connection flow (financial-api + staff-api scopes)", done: false },
      { text: "Pull daily sales from Financial API (/f/finance/{locationId}/dailyFinancials)", done: false },
      { text: "Pull labour/shift data from Staff API (/staff/v1/businessLocations/{locationId}/shift)", done: false },
      { text: "Map Lightspeed data to existing dailySales and payrollRecords schema", done: false },
      { text: "Add Lightspeed card to Integrations page", done: false },
    ],
  },
  {
    id: 11, title: "Email & OneDrive Pipeline", status: "blocked",
    items: [
      { text: "Access accounting@bagelandcafe.com mailbox (logged in via browser)", done: true },
      { text: "OneDrive folder structure verified (5 entities, 11 sub-folders each)", done: true },
      { text: "Filter and categorize invoices/bills from email", done: false },
      { text: "Archive email attachments to OneDrive", done: false },
    ],
  },
];

interface Module {
  icon: React.ReactNode;
  name: string;
  route: string;
  description: string;
  status: "live" | "ready" | "planned";
}

const MODULES: Module[] = [
  { icon: <LayoutDashboard className="h-4 w-4" />, name: "Command Center", route: "/", description: "Executive KPI dashboard with daily sales, prime cost %, pending invoices, active alerts, revenue trend chart, store performance table, recipe coverage widget", status: "live" },
  { icon: <FileText className="h-4 w-4" />, name: "Invoices & AP", route: "/invoices", description: "Accounts payable management with 24 synced Bills, search/filter, approve/reject workflow, QBO sync status per invoice", status: "live" },
  { icon: <Package className="h-4 w-4" />, name: "Inventory", route: "/inventory", description: "Ingredient catalog with COGS account mapping, category breakdown, par level tracking, supplier assignment", status: "live" },
  { icon: <ShoppingCart className="h-4 w-4" />, name: "Purchasing", route: "/purchasing", description: "Purchase order management with vendor catalog, PO status tracking (draft, submitted, received, cancelled)", status: "live" },
  { icon: <Users className="h-4 w-4" />, name: "Workforce", route: "/workforce", description: "Labor cost dashboard with payroll performance by location, labor % vs target comparison, headcount and hours", status: "live" },
  { icon: <BarChart3 className="h-4 w-4" />, name: "Reports", route: "/reports", description: "Daily P&L by location with date navigation, monthly revenue summary with year selector (2025/2026)", status: "live" },
  { icon: <ChefHat className="h-4 w-4" />, name: "Recipe Catalog", route: "/recipes", description: "Full recipe management with 3 tabs (Recipes, Sub-Recipes, Master Ingredients), CRUD, CSV upload, cost recalculation", status: "live" },
  { icon: <UtensilsCrossed className="h-4 w-4" />, name: "Menu Items", route: "/menu-items", description: "55 menu items with COGS management, recipe linkage, category filtering, bulk COGS update", status: "live" },
  { icon: <Upload className="h-4 w-4" />, name: "Data Import", route: "/data-import", description: "Three-zone import pipeline for POS Sales, Payroll, and Bank Statements with column mapping wizard", status: "live" },
  { icon: <Plug className="h-4 w-4" />, name: "Integrations", route: "/integrations", description: "QBO connected (Sandbox Company US 4575), auto-retry scheduler, sync logs, Koomi POS status", status: "live" },
  { icon: <ListChecks className="h-4 w-4" />, name: "Progress Report", route: "/progress", description: "This page — full system status, phase timeline, database schema, test coverage", status: "live" },
];

interface DbTable {
  name: string;
  records: number;
  purpose: string;
  status: "seeded" | "ready" | "schema_only";
}

const DB_TABLES: DbTable[] = [
  { name: "users", records: 2, purpose: "Authentication and role management (admin/user)", status: "seeded" },
  { name: "locations", records: 5, purpose: "Mackay, President-Kennedy, Cote-des-Neiges, Ontario, Factory", status: "seeded" },
  { name: "suppliers", records: 11, purpose: "GFS, Farinex, Dube Loiselle, JG Rive-Sud, and others", status: "seeded" },
  { name: "invoices", records: 24, purpose: "Supplier bills synced to QBO as Bills (#1521-#1544)", status: "seeded" },
  { name: "invoiceLineItems", records: 0, purpose: "Line-item detail for invoices", status: "schema_only" },
  { name: "dailySales", records: 1172, purpose: "Real Koomi POS data: Jan 2025 – Mar 2026, 3 locations", status: "seeded" },
  { name: "payrollRecords", records: 25, purpose: "Biweekly payroll with gross wages, employer contributions, hours (5 locations)", status: "seeded" },
  { name: "inventoryItems", records: 33, purpose: "Master ingredient catalog with supplier, yield %, usable unit costs", status: "seeded" },
  { name: "recipes", records: 25, purpose: "22 menu recipes + 3 sub-recipes with full ingredient costing", status: "seeded" },
  { name: "recipeIngredients", records: 158, purpose: "Recipe ingredient lines with quantity, unit, cost breakdown", status: "seeded" },
  { name: "menuItems", records: 55, purpose: "All menu items with recipe linkage and default COGS %", status: "seeded" },
  { name: "purchaseOrders", records: 4, purpose: "PO tracking with supplier and location assignment", status: "seeded" },
  { name: "poLineItems", records: 0, purpose: "PO line items", status: "schema_only" },
  { name: "alerts", records: 6, purpose: "Operational alerts (inventory, labor, receiving, system)", status: "seeded" },
  { name: "integrations", records: 4, purpose: "External system connection status", status: "seeded" },
  { name: "qboTokens", records: 1, purpose: "QBO OAuth tokens with auto-refresh (Realm 9341456522572832)", status: "seeded" },
  { name: "syncLogs", records: 44, purpose: "QBO sync audit trail (24 Bills + 20 Journal Entries)", status: "seeded" },
  { name: "importLogs", records: 0, purpose: "Data import audit trail", status: "ready" },
  { name: "bankTransactions", records: 0, purpose: "Bank statement records with auto-categorization", status: "ready" },
];

const EXTERNAL_SYSTEMS = [
  {
    name: "QuickBooks Online (Sandbox)",
    account: "Sandbox Company US 4575",
    actions: [
      { action: "OAuth2 connection", status: "completed" as const, note: "Connected via Intuit Developer Portal, tokens stored and auto-refreshing" },
      { action: "Invoice sync (Bills)", status: "completed" as const, note: "24 invoices synced as Bills (#1521-#1544)" },
      { action: "Payroll sync (Journal Entries)", status: "completed" as const, note: "20 payroll records synced as JEs (#1545-#1564)" },
      { action: "Vendor creation", status: "completed" as const, note: "2 new vendors created: Portebleue (#69), UniFirst Canada (#70)" },
      { action: "Auto-retry scheduler", status: "completed" as const, note: "Retries failed syncs every 5 min during business hours (7AM-8PM)" },
    ],
  },
  {
    name: "Koomi POS",
    account: "3 locations (PK, MK, CT)",
    actions: [
      { action: "2025 data import", status: "completed" as const, note: "982 daily records, $2,000,820 total revenue" },
      { action: "2026 data import (Jan-Mar)", status: "completed" as const, note: "190 daily records, $319,627 total revenue" },
      { action: "Ontario & Factory locations", status: "blocked" as const, note: "Not in Koomi POS — Ontario uses Lightspeed, Factory TBD" },
    ],
  },
  {
    name: "Lightspeed POS (Ontario)",
    account: "Pending API credentials",
    actions: [
      { action: "API research", status: "completed" as const, note: "OAuth2 flow documented, Financial API + Staff API endpoints identified" },
      { action: "Developer Portal registration", status: "blocked" as const, note: "Requires merchant request via Account Manager or partner application" },
      { action: "Daily sales sync", status: "blocked" as const, note: "Waiting for API Client ID and Secret" },
      { action: "Labour/shift data sync", status: "blocked" as const, note: "Waiting for API Client ID and Secret" },
    ],
  },
  {
    name: "Microsoft 365 — Outlook",
    account: "accounting@bagelandcafe.com",
    actions: [
      { action: "Browser login", status: "completed" as const, note: "Logged in via Microsoft 365 portal" },
      { action: "Mailbox survey", status: "completed" as const, note: "17,968 emails (3,436 unread), folder structure documented" },
      { action: "Programmatic API access", status: "blocked" as const, note: "IMAP, Graph API (ROPC), EWS all blocked by Security Defaults" },
    ],
  },
  {
    name: "OneDrive",
    account: "accounting@bagelandcafe.com",
    actions: [
      { action: "Access and survey", status: "completed" as const, note: "Logged in, full structure documented" },
      { action: "Folder structure", status: "completed" as const, note: "5 entities (HB, BLD, ONT, QC1, QC2), each with 11 sub-folders" },
      { action: "Document archiving", status: "blocked" as const, note: "Blocked by same API auth issue as email" },
    ],
  },
];

const CHECKPOINTS = [
  { version: "8ae8612e", date: "Mar 14, 2026", description: "Initial project scaffold" },
  { version: "039a6453", date: "Mar 14, 2026", description: "Full cafe back office with 9 modules, dashboard, and 19 tests" },
  { version: "8c8d8265", date: "Mar 15, 2026", description: "Data Import Pipeline with 3 upload zones, bank reconciliation, 44 tests" },
  { version: "3f008f74", date: "Mar 15, 2026", description: "QBO auto-retry scheduler, sync logs, and toggle controls" },
  { version: "e2ae27ed", date: "Mar 15, 2026", description: "QBO sandbox sync (44 entries), real Koomi data (1,172 records), recipe catalog import" },
  { version: "b85120d4", date: "Mar 15, 2026", description: "Menu Items COGS widget, dashboard recipe coverage, 106 tests" },
  { version: "f4fee166", date: "Mar 15, 2026", description: "Full Recipe Management page with CRUD, CSV upload, duplicate, 114 tests" },
];

const BLOCKED_ITEMS = [
  { title: "Lightspeed POS Integration (Ontario Cafe)", description: "Connect to Lightspeed Restaurant K-Series API to pull daily sales and labour/shift data for the Ontario location", blocker: "Need API Client ID and Secret — contact Lightspeed Account Manager or register at developer-portal.lsk-prod.app" },
  { title: "OneDrive document archiving", description: "Filing extracted invoices into the correct entity/supplier folders", blocker: "Azure App Registration with Files.ReadWrite permission" },
  { title: "Automated email-to-invoice pipeline", description: "Watching for new invoice emails and auto-creating invoice records", blocker: "Azure App Registration with Mail.Read permission" },
];

const NOT_STARTED = [
  { title: "Lightspeed POS daily sales sync", description: "Pull daily financials from Lightspeed API for Ontario cafe — API credentials needed from Lightspeed Account Manager" },
  { title: "Lightspeed labour/shift data sync", description: "Pull employee shift hours from Lightspeed Staff API for Ontario labour cost tracking" },
  { title: "Factory location POS integration", description: "Identify which POS system Factory uses and integrate sales data" },
  { title: "Invoice OCR", description: "PDF/image upload with LLM-based line item extraction for automatic invoice creation" },
  { title: "Manager Portal", description: "Store-level role-based view for daily reports, waste logs, and production tracking" },
  { title: "Automated alerts", description: "Daily summary notifications via the built-in notification system" },
  { title: "Ingredient price history tracking", description: "Chart showing how supplier costs change over time from invoice imports" },
  { title: "Production QBO migration", description: "Move from QBO Sandbox to production environment with real company data" },
];

const ONEDRIVE_FOLDERS = [
  "01 — Supplier Bills", "02 — Bank Statements", "03 — Payroll", "04 — POS Sales Data",
  "05 — Taxes", "06 — Contracts & Agreements", "07 — Recipes & COGS", "08 — Financial Reports",
  "09 — Journal Entries", "10 — Government & Compliance", "11 — Intercompany",
];

const TEST_SUITES = [
  { name: "auth.logout.test.ts", tests: 1, coverage: "Authentication logout flow" },
  { name: "routers.test.ts", tests: 42, coverage: "All tRPC procedures (locations, dashboard, invoices, suppliers, inventory, recipes, purchasing, alerts, integrations, payroll, reporting, menuItems)" },
  { name: "imports.test.ts", tests: 25, coverage: "Import pipeline (create/update logs, bulk inserts, date parsing, number parsing, bank transaction type detection)" },
  { name: "qbo.test.ts", tests: 19, coverage: "QBO connection, token management, invoice sync, vendor creation, journal entries" },
  { name: "autoRetry.test.ts", tests: 18, coverage: "Auto-retry scheduler (business hours check, interval management, failed sync retry logic)" },
  { name: "routers.test.ts (recipe)", tests: 9, coverage: "Recipe CRUD, duplicate, bulk import, recalculate costs" },
];

/* ─── Helper Components ─── */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    completed: { label: "Completed", variant: "default", className: "bg-emerald-600 hover:bg-emerald-700" },
    in_progress: { label: "In Progress", variant: "default", className: "bg-blue-600 hover:bg-blue-700" },
    blocked: { label: "Blocked", variant: "destructive", className: "" },
    not_started: { label: "Not Started", variant: "secondary", className: "" },
    live: { label: "Live", variant: "default", className: "bg-emerald-600 hover:bg-emerald-700" },
    ready: { label: "Ready", variant: "default", className: "bg-blue-600 hover:bg-blue-700" },
    planned: { label: "Planned", variant: "secondary", className: "" },
    seeded: { label: "Seeded", variant: "default", className: "bg-emerald-600 hover:bg-emerald-700" },
    schema_only: { label: "Schema Only", variant: "outline", className: "" },
  };
  const c = config[status] || config.not_started;
  return <Badge variant={c.variant} className={`text-xs ${c.className}`}>{c.label}</Badge>;
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-start gap-3">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function ProgressReport() {
  const totalRecords = useMemo(() => DB_TABLES.reduce((sum, t) => sum + t.records, 0), []);
  const completedPhases = PHASES.filter((p) => p.status === "completed").length;
  const totalItems = PHASES.reduce((sum, p) => sum + p.items.length, 0);
  const completedItems = PHASES.reduce((sum, p) => sum + p.items.filter((i) => i.done).length, 0);
  const completionPct = Math.round((completedItems / totalItems) * 100);

  return (
    <div className="space-y-8 pb-12">
      {/* ─── Header ─── */}
      <div className="border-b pb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">System Progress Report</h1>
            <p className="text-muted-foreground mt-1">
              Hinnawi Bros Bagel & Cafe — Back Office Operations Platform
            </p>
            <p className="text-xs text-muted-foreground mt-1">{PROJECT_META.date}</p>
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1 border-emerald-500 text-emerald-700">
            {PROJECT_META.status}
          </Badge>
        </div>
      </div>

      {/* ─── Executive Summary Stats ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">At a Glance</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={<Code2 className="h-5 w-5" />} label="Lines of Code" value={PROJECT_META.linesOfCode.toLocaleString()} sub="TypeScript / TSX" />
          <StatCard icon={<Monitor className="h-5 w-5" />} label="Page Components" value={PROJECT_META.pageComponents} sub="14 pages, 11 modules" />
          <StatCard icon={<Database className="h-5 w-5" />} label="Database Tables" value={PROJECT_META.dbTables} sub={`${totalRecords.toLocaleString()} total records`} />
          <StatCard icon={<TestTube2 className="h-5 w-5" />} label="Passing Tests" value={PROJECT_META.passingTests} sub={`${PROJECT_META.testSuites} test suites`} />
          <StatCard icon={<Layers className="h-5 w-5" />} label="Phases Complete" value={`${completedPhases}/${PHASES.length}`} sub={`${completionPct}% of all items`} />
          <StatCard icon={<GitBranch className="h-5 w-5" />} label="Checkpoints" value={CHECKPOINTS.length} sub="Versioned snapshots" />
        </div>
      </div>

      {/* ─── Executive Summary Paragraph ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executive Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {PROJECT_META.description} The system has been built over eleven development phases,
            delivering a 14-page platform with real-time KPIs, a complete data import pipeline for POS sales,
            payroll, and bank statements, full QuickBooks Online integration (44 entries synced to sandbox),
            a recipe catalog with 25 recipes and 33 master ingredients imported from the real recipe sheet,
            and a menu items COGS management system covering 55 items. Real Koomi POS data (1,172 daily records
            from Jan 2025 to Mar 2026) powers the Reporting Center across 3 locations. The Ontario cafe uses
            Lightspeed POS — API credentials are needed to connect and pull sales and labour data. The auto-retry
            scheduler automatically retries failed QBO syncs every 5 minutes during business hours.
          </p>
        </CardContent>
      </Card>

      {/* ─── Technology Stack ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Technology Stack</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {TECH_STACK.map((t) => (
              <div key={t.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-muted/30 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">({t.category})</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Phase Timeline ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Development Phases</h2>
        <div className="space-y-3">
          {PHASES.map((phase) => {
            const done = phase.items.filter((i) => i.done).length;
            const total = phase.items.length;
            const pct = Math.round((done / total) * 100);
            return (
              <Card key={phase.id} className={phase.status === "blocked" ? "border-destructive/30" : phase.status === "not_started" ? "border-muted" : ""}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        phase.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        phase.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                        phase.status === "blocked" ? "bg-red-100 text-red-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {phase.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : phase.id}
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Phase {phase.id}: {phase.title}</h3>
                        <p className="text-xs text-muted-foreground">{done}/{total} items completed</p>
                      </div>
                    </div>
                    <StatusBadge status={phase.status} />
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-muted rounded-full mb-3">
                    <div
                      className={`h-full rounded-full transition-all ${
                        phase.status === "completed" ? "bg-emerald-500" :
                        phase.status === "in_progress" ? "bg-blue-500" :
                        phase.status === "blocked" ? "bg-red-400" :
                        "bg-muted-foreground/30"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {phase.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        {item.done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <span className={item.done ? "text-muted-foreground" : ""}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ─── Dashboard Modules ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Dashboard Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {MODULES.map((mod) => (
            <Card key={mod.route} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      {mod.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{mod.name}</h3>
                      <code className="text-xs text-muted-foreground">{mod.route}</code>
                    </div>
                  </div>
                  <StatusBadge status={mod.status} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2">{mod.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ─── Database Schema ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Database Schema — {PROJECT_META.dbTables} Tables</h2>
        <Card>
          <CardContent className="py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Table</th>
                    <th className="text-right py-3 px-3 font-medium text-muted-foreground">Records</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Purpose</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {DB_TABLES.map((t) => (
                    <tr key={t.name} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 px-3 font-mono text-xs">{t.name}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">{t.records.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">{t.purpose}</td>
                      <td className="py-2.5 px-3"><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30">
                    <td className="py-2.5 px-3 font-semibold text-xs">Total</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold">{totalRecords.toLocaleString()}</td>
                    <td colSpan={2} className="py-2.5 px-3 text-xs text-muted-foreground">
                      {DB_TABLES.filter((t) => t.status === "seeded").length} seeded, {DB_TABLES.filter((t) => t.status === "ready").length} ready, {DB_TABLES.filter((t) => t.status === "schema_only").length} schema only
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Test Coverage ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Test Coverage — {PROJECT_META.passingTests} Passing Tests</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {TEST_SUITES.map((suite, i) => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <code className="text-xs font-mono">{suite.name}</code>
                  <Badge variant="outline" className="text-xs">{suite.tests} tests</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{suite.coverage}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ─── External Systems ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">External Systems</h2>
        <div className="space-y-3">
          {EXTERNAL_SYSTEMS.map((sys) => (
            <Card key={sys.name}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {sys.name.includes("QuickBooks") ? <FileText className="h-4 w-4 text-green-600" /> :
                   sys.name.includes("Koomi") ? <BarChart3 className="h-4 w-4 text-blue-600" /> :
                   sys.name.includes("Lightspeed") ? <Globe className="h-4 w-4 text-orange-600" /> :
                   sys.name.includes("Outlook") ? <Mail className="h-4 w-4 text-blue-600" /> :
                   <HardDrive className="h-4 w-4 text-blue-600" />}
                  <CardTitle className="text-sm">{sys.name}</CardTitle>
                  <code className="text-xs text-muted-foreground ml-auto">{sys.account}</code>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {sys.actions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {a.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <Lock className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground ml-2 text-xs">— {a.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ─── OneDrive Structure ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            OneDrive Folder Structure (per entity)
          </CardTitle>
          <CardDescription>5 entities: HB, BLD, ONT, QC1, QC2 — each with 11 standardized sub-folders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {ONEDRIVE_FOLDERS.map((folder) => (
              <div key={folder} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted/40">
                <Boxes className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs">{folder}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Blocked Items ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-destructive" />
          Blocked Items
        </h2>
        <div className="space-y-3">
          {BLOCKED_ITEMS.map((item, i) => (
            <Card key={i} className="border-destructive/20 bg-destructive/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-sm">{item.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Lock className="h-3 w-3 text-destructive" />
                      <span className="text-xs font-medium text-destructive">Blocker: {item.blocker}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ─── Not Yet Started ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          Upcoming Work
        </h2>
        <Card>
          <CardContent className="py-4">
            <div className="space-y-3">
              {NOT_STARTED.map((item, i) => (
                <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{item.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Architecture ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Monitor className="h-4 w-4 text-blue-600" />
                Client
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>14 page components + DashboardLayout</p>
                <p>tRPC hooks for all data fetching</p>
                <p>shadcn/ui component library</p>
                <p>Recharts for data visualization</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-emerald-600" />
                Server
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>12 tRPC router namespaces</p>
                <p>Drizzle ORM query helpers</p>
                <p>Manus OAuth + QBO OAuth2</p>
                <p>S3 storage + auto-retry scheduler</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4 text-violet-600" />
                Database
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>{PROJECT_META.dbTables} tables, {totalRecords.toLocaleString()} records</p>
                <p>5 locations, 11 suppliers, 25 recipes</p>
                <p>1,172 daily sales records (real Koomi data)</p>
                <p>Quebec tax model (GST 5% + QST 9.975%)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Checkpoint History ─── */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Checkpoint History</h2>
        <Card>
          <CardContent className="py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Version</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-3 px-3 font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {CHECKPOINTS.map((cp) => (
                    <tr key={cp.version} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 px-3">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{cp.version}</code>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">{cp.date}</td>
                      <td className="py-2.5 px-3 text-xs">{cp.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Footer ─── */}
      <div className="text-center text-xs text-muted-foreground pt-4 border-t">
        <p>Hinnawi Ops OS — Progress Report generated {PROJECT_META.date}</p>
        <p className="mt-1">Domain: {PROJECT_META.domain}</p>
      </div>
    </div>
  );
}
