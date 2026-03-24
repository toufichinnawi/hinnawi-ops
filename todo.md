# Hinnawi Ops OS - Project TODO

## Phase 1: Foundation
- [x] Database schema (locations, suppliers, invoices, line_items, daily_sales, payroll, recipes, inventory, purchase_orders)
- [x] Seed real data from extracted CSVs (254 supplier bills, POS revenue, inventory items)
- [x] Global theming and design tokens (slate-based executive dashboard)
- [x] DashboardLayout with sidebar navigation

## Phase 2: Executive Dashboard
- [x] Top KPI cards (Net Sales Today, Prime Cost, Open Invoices, Inventory Alerts)
- [x] Store performance comparison table (all 5 locations)
- [x] Operations queue (daily tasks)
- [x] Alerts & exceptions panel
- [x] Revenue trend chart (last 14 days)
- [x] Labor targets by store

## Phase 3: Module Pages
- [x] Accounting / Invoices & AP page (supplier bill list, approval workflow, summary cards, search/filter)
- [x] Inventory management page (ingredient tracking, COGS accounts, search)
- [x] Purchasing page (vendor catalog, PO list, status tracking)
- [x] Workforce page (labor targets, payroll performance by location)
- [x] Recipe Costing page (food cost %, gross margin, category performance)

## Phase 4: Reporting & Integrations
- [x] Reporting Center (Daily P&L by location, monthly revenue summary)
- [x] Connected Systems / Integrations panel (QBO, ADP, Koomi, Bank status)
- [x] Suppliers directory page

## Phase 5: Polish & Delivery
- [x] Fix date formatting issues across pages
- [x] Vitest tests for key server procedures (19 tests passing)
- [x] Final checkpoint and delivery

## Phase 6: Data Import Pipeline
- [x] Backend: File upload endpoint for CSV/Excel files via tRPC
- [x] Backend: Koomi POS CSV parser with field mapping and validation
- [x] Backend: ADP Payroll Excel parser with field mapping and validation
- [x] Backend: Batch insert parsed data into dailySales and payrollRecords
- [x] Backend: Import history tracking (importLogs table + bankTransactions table)
- [x] Backend: Duplicate detection (same date + location - upsert logic)
- [x] UI: Data Import page with three upload zones (POS, Payroll, Bank Statement)
- [x] UI: File preview with parsed data table before import
- [x] UI: Column mapping wizard with auto-detection
- [x] UI: Import progress and success/failure summary
- [x] UI: Import history log with past uploads
- [x] Route: Add /data-import to sidebar and App.tsx
- [x] Tests: Vitest specs for import procedures (25 tests passing)

## Phase 7: Email, OneDrive & Data Pipeline
- [x] Access accounting@bagelandcafe.com mailbox (logged in via browser)
- [ ] Filter and categorize invoices/bills from email (blocked by API auth - needs Azure App Registration)
- [ ] Archive email attachments to OneDrive (blocked by API auth)
- [x] OneDrive folder structure verified (already exists with entity sub-folders)
- [x] Build web Data Import page (POS, Payroll, Bank Statement)
- [x] Bank reconciliation with inter-entity transfer auto-detection

## Phase 8: Progress Report Page
- [x] UI: Progress Report page with executive summary, phase timeline, module status, DB stats
- [x] UI: Blocked items and next steps sections
- [x] UI: Architecture diagram and checkpoint history
- [x] Route: Add /progress to sidebar and App.tsx

## Phase 9: QuickBooks Bookkeeping
- [ ] Log into QuickBooks Online
- [x] Extract invoice details from accounting email (supplier, amount, date, invoice #)
- [ ] Enter supplier invoices as Bills in QuickBooks
- [ ] Create daily revenue journal entries with GST/QST per location
- [ ] Enter ADP payroll journal entries in QuickBooks
- [ ] Update progress report page with completed items

## Phase 10: QuickBooks OAuth Integration (Permanent)
- [x] Store QBO Client ID and Client Secret as env secrets
- [x] Add qboTokens table to database schema for persistent token storage
- [x] Build OAuth connect endpoint (/api/qbo/connect)
- [x] Build OAuth callback endpoint (/api/qbo/callback)
- [x] Build automatic token refresh logic
- [x] Build QBO API helper (create bill, create journal entry, query)
- [x] Build tRPC procedures for QBO operations
- [x] Build QBO integration page in dashboard (connect button, sync status, create entries)
- [ ] Add redirect URI to Intuit Developer app settings
- [x] Test full OAuth flow end-to-end (52 tests passing across 4 suites)

## Phase 11: Four Follow-ups
- [ ] Add redirect URI to Intuit Developer Dashboard via browser
- [x] Build one-click "Sync to QBO" button on Invoices page for each invoice
- [x] Build bulk invoice sync (push all approved invoices to QBO at once)
- [x] Build payroll journal entry automation on Workforce page (auto-generate JEs with GST/QST per location)
- [x] Build daily revenue journal entry generator (Debit: Bank/AR, Credit: Revenue + GST + QST per cafe)
- [x] Extract invoices from accounting@bagelandcafe.com email (7 invoices identified and logged)
- [x] Log extracted invoices into the system database (7 invoices from Portebleue, UniFirst, JG Rive-Sud, Farinex, GFS)
- [x] Prepare extracted invoices for QBO sync (Create Invoice UI with auto GST/QST)
- [x] Write tests for new features (72 tests passing across 5 suites)
- [x] Checkpoint and deliver

## Phase 12: Invoice Sync Status Indicator
- [x] Add sync status indicator (synced/pending/failed) next to each invoice with visual badges
- [x] Track sync failure state in database schema (qboSyncStatus, qboSyncError, qboSyncedAt)
- [x] Update Invoices page UI with clear tri-state indicator (tooltips with details)

## Phase 13: Bulk Retry Failed Syncs
- [x] Add "Retry All Failed" button to Invoices page header
- [x] Implement sequential retry logic for all failed invoices
- [x] Show progress feedback during bulk retry (X/Y counter)

## Phase 14: Auto-Retry Failed Syncs
- [x] Build server-side scheduled job that retries failed QBO syncs every 5 minutes (7 AM–8 PM)
- [x] Add one-time syncs at 9 PM and 12 AM daily
- [x] Add auto-retry status/log to Integrations page (sync log viewer with table)
- [x] Add toggle to enable/disable auto-retry from the UI (Switch component)
- [x] Add "Run Now" manual trigger button for on-demand retry
- [x] Add appSettings and syncLogs database tables
- [x] Auto-start scheduler on server boot when enabled
- [x] Write tests for the scheduler logic (18 tests, 90 total across 6 suites)

## Phase 15: QBO Sandbox Integration - Sync All Entries
- [x] Connect to QuickBooks Sandbox via OAuth (Sandbox Company US 4575, Realm 9341456522572832)
- [x] Sync all 24 invoices as Bills to QBO sandbox (Bills #1521-#1544)
- [x] Create all 20 payroll Journal Entries in QBO sandbox (JE #1545-#1564)
- [x] Created 2 new vendors in QBO (Portebleue #69, UniFirst Canada #70)
- [x] Update invoice sync status in local DB (all 24 invoices marked as synced)
- [x] Add missing Ontario payroll records (5 records added)
- [x] Fix Reporting Center showing zero values (BUG) — was defaulting to today's date with no data
- [x] Verify all entries synced successfully (44 total: 24 Bills + 20 JEs)

## Phase 16: Recipe Catalog System (Real Data)
- [x] Parse HinnawiBrosRecipeCatalogCosting.xlsx (22 recipes, 33 ingredients, 3 sub-recipes)
- [x] Clear placeholder recipe data and replace with real data from Excel
- [x] Design enhanced recipe schema with unit normalization, yield %, supplier linkage
- [x] Build backend: recipe CRUD, ingredient price tracking from invoices, unit normalization
- [x] Build auto-cost calculation (recalculateAllRecipeCosts) from latest supplier invoice prices
- [x] Build Recipe Catalog UI with full CRUD (add/edit/delete recipes and ingredients)
- [x] Show cost breakdown per recipe with ingredient-level detail
- [x] List menu items sold that don't have recipes (for default COGS assignment)

## Phase 16b: Fix Reporting Center with Real Koomi Data
- [x] Replace old daily sales with real Koomi POS data (1172 records, 2025 + 2026)
- [x] Add reporting.dateRange endpoint for latest/earliest sale dates
- [x] Add reporting.monthlyAggregated endpoint for cross-location summaries
- [x] Add getDailyPnlForDate with actual payroll data integration
- [x] Fix Reporting Center UI to default to latest date with data (auto-detects max date)
- [x] Fix monthly summary display with year selector and aggregated totals
- [x] Update invoice sync status in DB (all 24 marked synced)
- [x] All 99 tests passing across 6 test suites

## Phase 17: Items Without Recipes Dashboard Widget
- [x] Create menuItems database table with recipe linkage and default COGS fields
- [x] Seed 55 menu items (22 with recipes, 33 without) across 6 categories
- [x] Build tRPC routes: list, withoutRecipes, withRecipes, summary, updateCogs, bulkUpdateCogs, create, delete, linkRecipe, unlinkRecipe
- [x] Build dedicated Menu Items page with category-grouped table, inline COGS editing, search/filter
- [x] Add bulk update COGS by category feature
- [x] Add recipe link/unlink functionality per item
- [x] Add recipe coverage widget to Command Center dashboard (progress bar + stats)
- [x] Add Menu Items to sidebar navigation
- [x] Write 7 new tests for menuItems routes (106 total passing across 6 suites)

## Phase 18: Recipe Management Page
- [x] Reviewed current recipe schema, routes, and UI — identified gaps in CRUD UX
- [x] Enhanced backend: added duplicate and bulkImport tRPC procedures
- [x] Added CSV recipe upload parser with preview and selective import dialog
- [x] Built full Recipe Management page with 3 tabs (Recipes, Sub-Recipes, Master Ingredients)
- [x] Built recipe create/edit dialog with dynamic ingredient builder and live cost preview
- [x] Added ingredient cost auto-calculation from inventory prices with unit conversion
- [x] Added recipe duplication feature (one-click clone with "(Copy)" suffix)
- [x] Added menu item linkage from recipe creation dialog (dropdown of unlinked items)
- [x] Added sort by name/category/food cost %, search, and category filter
- [x] Added recipe detail view with full cost breakdown and % of total per ingredient
- [x] Added summary cards (menu recipes, sub-recipes, avg food cost %, high cost count, ingredients)
- [x] Written 8 new tests for recipe CRUD/duplicate/bulk import (114 total passing across 6 suites)

## Phase 19: Lightspeed POS Integration (Ontario Cafe)
- [x] Research Lightspeed Restaurant K-Series API (auth flow, endpoints documented)
- [ ] Register on Lightspeed Developer Portal and obtain API Client credentials (BLOCKED: needs merchant request)
- [ ] Build OAuth2 connection flow with token management
- [ ] Pull daily sales from Financial API
- [ ] Pull labour/shift data from Staff API
- [ ] Map Lightspeed data to existing dailySales and payrollRecords schema
- [ ] Add Lightspeed card to Integrations page
- [ ] Write tests for Lightspeed sync procedures
- [x] Added Lightspeed as pending/blocked item in Progress Report page
- [x] Updated Progress Report with all current data (11 phases, 114 tests, 22 tables, 1,549 records)

## Phase 20: Real Labour Cost + Monthly Revenue Filters
- [x] Add labourCost and orderCount columns to dailySales table
- [x] Parse daily "Total Salaries Paid" from Koomi CSV (1,172 records updated)
- [x] Import real labour cost per location per day into database (PK: $300K, MK: $186K, CT: $103K)
- [x] Import order count per location per day (PK: 128K, MK: 62K, CT: 30K orders)
- [x] Update dashboard KPIs to use real labour cost instead of estimated
- [x] Update Reporting Center daily P&L to use real labour cost (with laborSource indicator)
- [x] Rename "2025 Monthly Revenue Summary" to "Monthly Revenue Summary" with year filter dropdown
- [x] Add multi-store selector buttons to Monthly Revenue Summary (All Stores, PK, MK, CT)
- [x] Add labour cost, labour %, and orders columns to monthly summary table
- [x] Add order count column to daily P&L table
- [x] Write 7 new tests for labour cost and location filtering (121 total passing)

## Phase 21: Ontario Sales & Labour Integration (from 000 MAIN APP)
- [ ] Review 000 MAIN APP project for Ontario POS integration (Clover/Lightspeed)
- [ ] Copy integration code and adapt to hinnawi-ops backend
- [ ] Import Ontario revenue and labour data into dailySales table
- [ ] Update UI to display Ontario data in dashboard, reporting, and store performance
- [ ] Write tests and verify

## Phase 21: Ontario Sales & Labour via 7shifts Integration
- [x] Ensure Ontario location exists in locations table (id=3)
- [x] Build import script to aggregate 7shifts receipts into daily sales
- [x] Build import script to aggregate 7shifts time punches into daily labour costs
- [x] Import all available Ontario data (Dec 17, 2025 → present) — 86 days, $38K sales, $4.4K labour
- [x] Build backend tRPC endpoint for 7shifts sync (on-demand)
- [x] Add 7shifts integration card to Integrations page (sync button, status)
- [x] Update dashboard/reporting to include Ontario data
- [x] Write vitest tests for 7shifts integration (125 total passing)
- [ ] Awaiting Lightspeed L-Series CSV for Jan-Nov 2025 historical data

## Phase 22: CSV Upload Area for Lightspeed Data
- [x] Add Lightspeed Day Reports import type to Data Import page
- [x] Add Lightspeed Payments import type to Data Import page
- [x] Build backend parseLightspeedDay procedure (date parsing, upsert to dailySales)
- [x] Build backend parseLightspeedPayments procedure (aggregate by date, upsert)
- [x] Frontend: location selector + column mapping for both report types
- [x] All 125 tests passing
- [ ] Awaiting user to upload Lightspeed CSV files for Ontario historical data

## Phase 23: Bank Accounts per Location
- [x] Create bankAccounts table in schema (name, accountNumber, bankName, locationId, accountType, currency, qboAccountId)
- [x] Seed 5 bank accounts (7553-CIBC PK, 720-BMO MK, Desjardins-Tunnel, 615-CIBC Ontario, 811-CIBC CK)
- [x] Add tRPC procedures for bank account CRUD and listing (list, byLocation, create, update)
- [x] Update bank statement import to require location + bank account selection (mandatory fields)
- [x] Bank account dropdown filters by selected location
- [x] Write 5 bank account tests (130 total passing)

## Bug Fix: Lightspeed CSV Upload Missing from Data Import
- [x] Verified Lightspeed Day Reports and Payments import types are in code (lines 80-108, 353-383)
- [x] Improved layout: grouped import types into "Koomi / ADP / Bank" and "Lightspeed POS (Ontario)" sections
- [x] Lightspeed cards now clearly visible in dedicated section with 2-column grid
- [x] All 130 tests passing

## Bug Fix: Select.Item Empty Value Error on Data Import
- [x] Fix Select.Item empty value prop error crashing Data Import page during CSV upload

## Bug Fix: Ontario Not in Monthly Revenue Summary
- [x] Ontario 7shifts data not appearing in Monthly Revenue Summary (should be automatic)
- [x] Add Ontario to store selector buttons in Monthly Revenue Summary
- [x] Ensure monthlyAggregated query includes Ontario location data

## Fix: Remove Manual Column Mapping from Data Import
- [x] Data Import page should auto-detect CSV format and import without manual column mapping
- [x] User uploads CSV as chat attachment, agent parses and imports directly (same as Koomi workflow)
- [x] Remove mapping wizard step — auto-detect columns based on known formats (Koomi, Lightspeed, ADP, bank)
- [x] Imported Lightspeed Ontario Jan 2025 data (31 days, $8,400.82, 731 orders)

## Feature: Bulk Multi-File Upload on Data Import
- [x] Select store first, then drag-and-drop many files at once
- [x] Auto-parse and import each file sequentially with progress tracking
- [x] Show per-file status (success/fail/skipped) during batch import
- [x] Support 200+ files in a single batch

## Bug Fix: Completed files not cleared when switching stores
- [x] When store is changed, auto-clear completed files from the list
- [x] Import button should only count pending files, not already-done ones
- [x] After a batch completes, clear the done files so new drops start fresh

## Feature: Product Sales Breakdown Import & Dashboard
- [x] Examine Koomi Breakdown Sales CSV format
- [x] Create productSales database table schema
- [x] Build backend import procedure for breakdown sales
- [x] Add breakdown sales to bulk import auto-detection
- [x] Build Product Sales Performance Dashboard page
- [x] Import sample Mackay Jan 2025 breakdown data (177 items, $43,854)

## Fix: Per-Unit Cost Calculation
- [x] Fix cost pipeline to divide bulk invoice prices by purchase quantity for true per-unit costs
- [x] Recalculate all inventory item costs (lastCost, avgCost, costPerUsableUnit)
- [x] Recalculate all recipe costs with corrected ingredient costs

## Feature: Product Sales Dashboard Enhancements
- [x] Month-over-month comparison view for seasonal item trends
- [x] Link recipe costs to product sales items for margin calculation
- [x] Menu Engineering quadrant analysis (Stars/Plowhorses/Puzzles/Dogs)
- [x] Update Gross Margin column in Top Items table with real cost data
- [x] Highest Margin KPI card with actual data

## Feature: Product Sales Dashboard - Round 3
- [x] Auto-link more recipes to menu items using French-to-English name mapping (64 products mapped)
- [x] Build seasonal heatmap showing monthly item popularity trends across the full year
- [x] Verify Breakdown CSV upload works for all stores (PK, MK, CT, ONT)

## Feature: CFO Intelligence Dashboard
- [x] Audit all existing data (dailySales, productSales, payroll, recipes, menuItems) for report design
- [x] Complete French-to-English product name mapping for accurate cost enrichment
- [x] Build backend analytics: profitability by store, revenue trends, labor efficiency, cost optimization
- [x] Build CFO Intelligence Dashboard page with executive-grade reports
- [x] Profitability Analysis: gross margin by store, COGS breakdown, margin trends
- [x] Revenue Intelligence: MoM/YoY trends, growth rate, revenue per store benchmarking
- [x] Labor Efficiency: labor cost % by store, revenue per labor hour, staffing optimization
- [x] Menu Optimization: top profit contributors, underperformers, pricing recommendations
- [x] Strategic Recommendations: AI-driven insights from data patterns
- [x] Seasonal heatmap for monthly item popularity trends
- [x] Replace Command Center Revenue Trend chart with professional multi-store stacked bar chart

## Feature: Cash Flow Forecast on CFO Dashboard
- [x] Build backend forecast logic using historical daily sales (weighted moving average + seasonality)
- [x] Project revenue for next 30, 60, and 90 days per store and total
- [x] Include confidence intervals (optimistic/pessimistic scenarios)
- [x] Build cash flow forecast UI section on CFO Dashboard with KPI cards and chart
- [x] Write tests for forecast endpoint
- [x] Fix Command Center Daily Revenue chart dates not in consecutive order (saleDate was Date object, String() produced non-sortable format)

## Bug Fix: Product Sales Top Items
- [x] Unit Cost shows total COGS instead of per-unit cost — fixed to totalCost/quantitySold
- [x] French characters display as garbled text — fixed existing DB data + changed CSV reader from readAsBinaryString to readAsText(UTF-8)

## Feature: CFO Dashboard Custom Date Range & Comparison Mode
- [x] Add custom date range picker (From/To) alongside existing period buttons
- [x] Add comparison mode: vs same period last year
- [x] Add comparison mode: vs previous period (same span)
- [x] Add comparison mode: vs previous week
- [x] Add comparison mode: vs custom range (custom From/To for comparison)
- [x] Show comparison delta (% change arrows) for all KPIs when comparison is active
- [x] Delta indicators on KPI strip (Revenue, Gross Profit, Net, Prime Cost, Labor %, Avg Ticket)
- [x] Delta indicators on Store P&L table (per-store and totals row)
- [x] Delta indicators on Labor Efficiency table (per-store revenue, labor cost, labor %, rev/hour)
- [x] Period presets: Today, This Week, Last Week, MTD, Last Month, QTD, Last Qtr, YTD
- [x] Date range subtitle shows active period and comparison range

## Feature: Koomi Admin Scraper Integration (from 000 MAIN APP)
- [x] Review existing Koomi scraper code from 000 MAIN APP project
- [x] Port Koomi admin login/session management to hinnawi-ops backend
- [x] Build server-side scraper for Net Onsite Sales Report (HTML table parsing)
- [x] Build server-side scraper for Breakdown Onsite Report (per-store product-level data)
- [x] Store mapping: PK (1037→1), MK (2207→2), Cathcart/Tunnel (1036→4)
- [x] Auto-parse scraped data and import into dailySales and productSales tables
- [x] Build Koomi Integration UI card on Integrations page (connection status, store badges, date range picker)
- [x] Add automated daily scheduling (6 AM ET) with toggle switch
- [x] Add manual sync buttons (Sync Net Sales + Sync Breakdown) with date range selector
- [x] Write 11 vitest tests for scraper (store mapping, date formatting, breakdown conversion)
- [x] Koomi credentials stored as secrets (KOOMI_ADMIN_EMAIL, KOOMI_ADMIN_PASSWORD)
- [x] All 155 tests passing

## Feature: Koomi Sales Data Visualizations on Dashboard
- [x] Review current Command Center dashboard layout and existing charts
- [x] Add tabbed Sales Analytics section with 4 chart views (Revenue, Rev vs Labor, Orders, Day-of-Week)
- [x] Revenue by Store: stacked BarChart with per-store colors, 7-day avg, WoW trend, best day stats
- [x] Revenue vs Labor: ComposedChart with Area (revenue), Bar (labor cost), Line (labor %)
- [x] Order Volume: ComposedChart with Bar (orders) and Line (avg ticket), dual Y-axes
- [x] Day-of-Week: ComposedChart + heatmap table with avg revenue, orders, ticket, labor % per weekday
- [x] Add Koomi sync status widget on dashboard (connection status, last sync time, auto-sync indicator)
- [x] Add store revenue share donut PieChart alongside store performance table
- [x] 6 compact KPI cards: Today's Sales, 30-Day Avg/Day, Avg Ticket, Labor %, Prime Cost %, Alerts
- [x] All values display as full numbers with formatCurrency/formatCurrencyFull (not abbreviated)
- [x] Updated ceo-dashboard-builder skill with new visualization patterns and Koomi scraper docs
- [x] All 155 tests passing

## Feature: CSV Data Export for Sales & Labor
- [x] Build backend tRPC endpoint to export raw dailySales data as CSV (date, store, sales, tax, tips, labor, orders)
- [x] Build backend tRPC endpoint to export raw payroll/labor data as CSV
- [x] Build backend tRPC endpoint to export product sales breakdown as CSV
- [x] Build backend tRPC endpoint to export combined sales+labor summary as CSV
- [x] Support date range filtering and store filtering on all exports
- [x] Add compact export buttons to Command Center (Sales Analytics section)
- [x] Add compact export buttons to CFO Intelligence Dashboard (uses active date range)
- [x] Add full Data Export panel on Reporting page (date picker, store filter, 4 export types)
- [x] Client-side CSV download with BOM for Excel compatibility (blob URL approach)
- [x] Reusable DataExportPanel component (compact + full modes)
- [x] Write 13 vitest tests for CSV generation logic (escaping, null handling, Date objects, multi-row)
- [x] All 168 tests passing

## Task: Sync Koomi Data from March 14, 2026
- [x] Login to Koomi admin (admin.koomi.com)
- [x] Fetch Net Onsite Sales for all stores from 2026-03-14 to 2026-03-17 (10 daily records: PK 4, MK 4, CT 2)
- [x] Fetch Breakdown Onsite for all stores (398 product items across 3 stores)
- [x] Import 13 daily sales records into dailySales table
- [x] Import 398 product sales records into productSales table (4 SQL batches)
- [x] Update Koomi POS integration status to live with lastSyncAt timestamp
- [x] Dashboard now shows refreshed data from March 14-17, 2026

## Feature: Ontario 7shifts Automated Daily Sync
- [ ] Review existing 7shifts sync endpoints and integration code
- [ ] Build server-side scheduler for 7shifts (matching Koomi scheduler pattern)
- [ ] Add auto-sync toggle to 7shifts integration card on Integrations page
- [ ] Sync latest Ontario data from last sync date to today
- [ ] Write tests for 7shifts scheduler
- [ ] Update ceo-dashboard-builder skill with 7shifts auto-sync pattern

## Bug Fix: Koomi Sync Must Use App DB Layer (Not Manual SQL)
- [x] Rewrite koomi sync route to scrape + import in one server-side call via db.ts upsert functions
- [x] Ensure product breakdown data is imported via importProductSales (upsert with duplicate detection)
- [x] Ensure daily sales data is imported via upsertDailySale (insert or update)
- [x] Run full sync from March 10-17 — 22 daily sales records updated, 480 product items imported
- [x] Auto-sync scheduler now runs 4x daily (6 AM, 12 PM, 6 PM, 9 PM ET) syncing yesterday+today
- [x] Added syncNow route for on-demand full sync (defaults to last 7 days)
- [x] Database verified: 4 stores, 1620 daily records, 530 recent product items
- [x] All 168 tests passing

## Bug Fix (SUPERSEDED): Koomi Data Not Showing for Today/Yesterday
- [ ] Sync Koomi Net Onsite Sales for March 14-17, 2026 (refresh)
- [ ] Sync Koomi Breakdown Onsite for March 14-17, 2026 (product sales)
- [ ] Verify Product Sales Performance page displays Koomi breakdown data
- [ ] Verify all dashboards (Command Center, CFO, Reporting) show fresh data
- [ ] Enable Koomi auto-sync so data stays current going forward

## Feature: Invoice PDF Preview & Auto-Approval with Delivery Notes
- [x] Add fileUrl, fileKey, deliveryNoteUrl, deliveryNoteKey, autoApproved columns to invoices table
- [x] Add file upload endpoint for invoice PDFs and delivery notes (S3 storage via storagePut)
- [x] Add click-to-preview: clicking invoice row opens side panel with PDF viewer (iframe)
- [x] Add delivery note upload alongside invoice PDF (separate tab in detail panel)
- [x] Build Invoices page with document status icons (FileText + Truck per row)
- [x] Add "View" button per invoice row + full detail panel with Details/Invoice PDF/Delivery Note tabs
- [x] Implement auto-approval rule: when both invoice PDF + delivery note are present, auto-approve
- [ ] Build email attachment extraction from accounting@bagelandcafe.com (bills + delivery notes)
- [ ] Auto-match email attachments to invoices by supplier name + invoice number
- [ ] Auto-create invoice records from email bill attachments (parse supplier, amount, date)
- [ ] Scheduled email check (every 30 min) to pull new bills and delivery notes
- [ ] Write tests for auto-approval logic and email matching
- [ ] Update ceo-dashboard-builder skill with invoice workflow patterns

## Feature: Quotation / Proforma Stage with Advance Payments
- [x] Design quotations table schema (22 columns: supplier, location, amount, advance tracking, status, file attachments)
- [x] Add quotation statuses: draft → pending_advance → accepted → converted → expired
- [x] Track advance payment: advanceRequired, advanceAmount, advancePaidStatus, advancePaidAt, advancePaymentRef
- [x] Build backend CRUD for quotations (create, list, get, update, updateStatus, convertToInvoice)
- [x] Build convert-to-invoice logic: copies quotation data into invoices table, links via quotationId
- [x] Add quotationId foreign key to invoices table
- [x] Build Quotations page with sidebar nav (Receipt icon)
- [x] Quotation detail panel with PDF viewer and advance payment controls
- [x] File upload for quotation PDFs (S3 storage via storagePut)
- [x] Mark advance as paid/unpaid with payment reference and date
- [x] "Convert to Invoice" button (only enabled when advance is paid or not required)
- [x] Summary cards: total, pending advance, advance paid, converted, expired
- [x] Write 12 vitest tests for quotation CRUD, advance payment, and convert-to-invoice
- [x] All 180 tests passing

## Feature: Email Integration for accounting@bagelandcafe.com
- [ ] Research email access method (IMAP vs Microsoft Graph API)
- [ ] Build email fetcher to pull new emails with PDF attachments from accounting inbox
- [ ] Parse email subject/sender to identify supplier name and document type (bill vs delivery note)
- [ ] Use LLM to extract invoice details from PDF (supplier, amount, date, invoice #)
- [ ] Auto-create invoice records from bill attachments
- [ ] Auto-match delivery notes to existing invoices by supplier + date/invoice number
- [ ] Upload extracted PDFs to S3 and link to invoice records (fileUrl, deliveryNoteUrl)
- [ ] Trigger auto-approval when both invoice PDF + delivery note are matched
- [ ] Scheduled email check (every 30 min) to pull new bills and delivery notes
- [ ] Archive processed emails and store in structured format
- [ ] Email processing log/history visible in Integrations page
- [ ] Write tests for email parsing and matching logic

## Feature: Supplier Portal (Public Submission Form)
- [ ] Create public-facing supplier submission page (no auth required)
- [ ] Form fields: supplier name, invoice/quotation number, amount, date, document type, PDF upload
- [ ] Duplicate prevention: warn if same supplier + invoice number already exists
- [ ] Submitter name is mandatory
- [ ] Auto-create invoice or quotation record from submission
- [ ] Upload submitted PDF to S3 and link to record
- [ ] Notify owner when new submission arrives
- [ ] Supplier submission history page (track submissions by token/email)
- [ ] Write tests for supplier portal submission logic

## Feature: Payment Scheduling & Cash Flow Forecasting
- [ ] Add dueDate, paymentScheduledDate, paymentMethod columns to invoices table
- [ ] Build upcoming payments view: list of approved invoices sorted by due date
- [ ] Add overdue invoice alerts (past due date, still unpaid)
- [ ] Build cash flow forecast chart on CFO Dashboard (projected outflows by week/month)
- [ ] Show payment calendar view with daily/weekly payment obligations
- [ ] Add payment reminders/notifications for upcoming due dates
- [ ] Write tests for payment scheduling logic

## Feature: QBO Chart of Accounts Integration (Bank Accounts)
- [x] Add createAccount function to qbo.ts (POST Account to QBO API)
- [x] Add queryAccounts function to fetch QBO Chart of Accounts with filtering
- [x] Add auto-create: push all 5 local bank accounts to QBO Sandbox as Bank accounts
- [x] Add linkAccount: store qboAccountId on local bankAccounts after creation
- [x] Add tRPC procedures for Chart of Accounts management (list QBO accounts, create, link, auto-sync)
- [x] Build Chart of Accounts management UI page (view QBO accounts, link local bank accounts, create new)
- [x] Update Bill/JE creation to use linked qboAccountId when posting transactions
- [x] Add Chart of Accounts link on Integrations page (replace "coming soon" toast)
- [x] Write vitest tests for QBO account creation and linking

## Feature: Microsoft Graph Email Integration (accounting@bagelandcafe.com)
- [x] Store Azure AD credentials (Client ID, Tenant ID, Client Secret)
- [x] Verify Microsoft Graph API access with vitest
- [x] Build Microsoft Graph email client module (auth, fetch emails, list attachments, download PDFs)
- [x] Build tRPC procedures for email fetching and invoice extraction
- [x] Build Email Integration UI page (inbox viewer, attachment preview, invoice extraction)
- [x] Write vitest tests for email integration

## Feature: Automated Invoice → Inventory → Recipe Cost Pipeline
- [x] Add priceHistory table to track ingredient price changes over time
- [x] Add invoiceLineItemMatch table to store AI-matched invoice lines to inventory items
- [x] Build AI-powered matching engine: invoice line item descriptions → inventory items (fuzzy + LLM)
- [x] Build auto-update ingredient costs when invoice is approved (lastCost, avgCost, costPerUsableUnit)
- [x] Auto-trigger recalculateAllRecipeCosts() after any ingredient price change (no manual button)
- [x] Add price change alerts: notify owner when ingredient price changes >10%
- [x] Wire triggers into invoice approval flow (updateStatus → approved triggers matching + cost update)
- [x] Wire triggers into email invoice extraction flow (extractInvoice → auto-match line items)
- [x] Build Price History UI: view ingredient cost trends over time
- [x] Build Invoice Line Item Matching review UI: confirm/correct AI matches
- [x] Build Cost Impact dashboard: show which recipes are affected by price changes
- [x] Write vitest tests for matching engine, auto-cost update, and recipe recalculation triggers

## BUG FIX (URGENT): Revenue totalSales showing incorrect values
- [x] Investigate root cause: totalSales = taxExemptSales instead of taxExemptSales + taxableSales
- [x] Fix Koomi scraper data mapping for totalSales (both buildDailySalesFromBlocks and buildDailySalesFromConsolidated)
- [x] Fix all existing dailySales records in database (recalculate totalSales for all stores)
- [x] Verify dashboard Command Center revenue display (uses totalSales from DB - correct after DB fix)
- [x] Verify CFO Intelligence revenue calculations (uses totalSales from DB - correct after DB fix)
- [x] Verify Reports page revenue figures (uses SUM(totalSales) from DB - correct after DB fix)
- [x] Verify Revenue JE generation uses correct totalSales (reads from DB totalSales field - correct after DB fix)
- [x] Verify fix across all stores (PK, Mackay, Tunnel all verified, 0 broken records)
- [x] All 215 tests passing

## Task: Verify Dashboard Revenue + Re-generate JEs + Create Invoice from Email
- [x] Verify dashboard revenue numbers are correct for PK, Mackay, Tunnel, Ontario (March 8-16) — 0 mismatches
- [x] Verify monthly summary aggregation is correct — all stores verified
- [x] Re-generate Revenue JEs for March 10-16 — VERIFIED: No JEs were synced to QBO yet, so no incorrect data exists. DB totalSales is now correct, future JEs will use correct amounts.
- [x] Build tRPC procedure: createInvoiceFromEmail (takes processedEmail ID, creates invoice + line items)
- [x] Build tRPC procedure: createInvoiceFromExtraction (takes extracted JSON, creates invoice + supplier match + line items)
- [x] Add "Create Invoice" button on Email Inbox page for extracted emails
- [x] Build Create Invoice from Email dialog/flow with pre-filled data from extraction
- [x] Auto-match supplier from extracted vendor name to existing suppliers
- [x] Upload extracted PDF attachment as invoice file (auto-linked from S3)
- [x] Write vitest tests for createInvoiceFromEmail flow (14 tests passing)
- [x] Enable Koomi auto-refresh every 5 minutes (7 AM - 8 PM daily, plus one-time syncs at 9 PM and 12 AM)

## Feature: Batch Invoice Processing (438 PDFs from ZIP)
- [ ] Extract and analyze 438 invoice PDFs from supplier ZIP
- [ ] Filter out payment receipts (4) and État de Comptes statements (28) — process ~406 actual invoices
- [ ] Build batch processing script: AI-parse each PDF for supplier, invoice #, date, amounts, line items
- [ ] Deduplicate against existing invoices in DB (by invoice number + supplier)
- [ ] Create new invoice records with line items for all unique invoices
- [ ] Upload all invoice PDFs to S3 and link to records
- [ ] Ensure all suppliers exist in DB (create missing ones: Costco, Hydro Quebec, Lightspeed, Pure Tea, Les Touriers, Nantel)
- [ ] Map invoices to correct locations from folder structure (PK, MK, Tunnel, Ontario, CK)
- [ ] Sync all new invoices to QBO as Bills
- [ ] Run cost pipeline: match line items to inventory, update ingredient costs, recalculate recipe costs
- [ ] Verify no duplicates and deliver summary

## Fix: Cajun Seasoning + Expand Inventory + Resume Invoice Uploads
- [x] Fix Cajun seasoning purchaseAmount from 0.65 to 2.27 kg
- [x] Add new inventory items for frequently purchased ingredients (flour, sugar, yeast, sesame seeds, cream, milk, etc.)
- [x] Re-run cost pipeline on all 120 batch invoices with expanded inventory for better match rate (83.8% match rate)
- [x] Resume remaining 278 invoice uploads (272 created, 6 duplicates, 0 errors)
- [x] Fix description-specific case sizes (Butter NZ 25kg, Milk 16L, Salmon per-kg, Yeast variants)

## Batch: Resume Invoice Uploads + QBO Bank Accounts + Revenue JEs
- [x] Resume remaining 278 invoice uploads (272 created, 6 duplicates, 0 errors)
- [x] Run cost pipeline on newly created invoices (886 matched, 48.4% rate, 48 items updated, false matches cleaned)
- [x] Link 5 bank accounts to QBO (all 5 already linked with correct QBO IDs)
- [x] Generate Revenue Journal Entries for March 10-16 (26 JEs created, $37,270.67 gross, QBO #1565-#1590)
- [x] Fix generateRevenueJE procedure to use correct QBO account IDs (Undeposited Funds #92, Sales #96, GST #149, QST #150)

## Feature: Data Coverage Visual Indicator
- [x] Audit current data in DB (bank statements empty, POS/payroll have data)
- [x] Build backend procedure returning date coverage per data type per location
- [x] Build visual coverage indicator on Data Import page (timeline bars showing covered vs missing dates)
- [x] Show coverage for: Bank Statements, POS Sales, Payroll, Invoices, Product Breakdown

## Feature: Edit Invoice Location
- [x] Add backend procedure to update invoice locationId
- [x] Add inline location dropdown in invoice list table for unknown-location invoices
- [x] Add location edit in invoice detail panel (Assign Location button)
- [x] Add location filter dropdown to quickly find all unknown-location invoices (shows 'Unknown (42)' count)
- [x] Location filter highlights in amber when filtering unknown invoices

## Feature: Edit Location for All Invoices in Detail View
- [x] Add prominent edit/change location button in invoice detail view for ALL invoices (not just unknown)
- [x] Show current location with pencil icon + 'Change' button, opening a dropdown to reassign
- [x] Ensure location can be changed before approving (Change button visible alongside Approve/Reject)
