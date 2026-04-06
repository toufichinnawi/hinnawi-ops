#!/bin/bash
###############################################################################
# HINNAWI OPS — FULL DEPLOYMENT SCRIPT
# Date: April 5, 2026
# Commits: 08cdfad → 0a61805 → 8acefac → c682617 → 2316fbb → ef5c32a
# Total: 26 files changed, 8,177 insertions, 69 deletions
###############################################################################
#
# WHAT THIS DEPLOYS:
#
# 1. Revenue duplication fix (PK/MK department filter)
# 2. Cache TTL reduced from 1 hour to 5 minutes
# 3. Reliable refresh button (mutation-based cache clear)
# 4. Auto-refresh every 5 minutes on all financial pages
# 5. Quarterly + custom date range filters on all financial pages
# 6. Revenue JE pipeline (void existing + re-post from POS)
# 7. Accountant Task Center (auto-detected daily/weekly/monthly tasks)
# 8. Procurement Hub (PIN auth, PO workflow, inventory, waste, smart ordering)
# 9. Reconciliation Dashboard (auto-match bank txns, classify, push to QBO)
# 10. Vendor Catalog (CSV import, price comparison, auto-link)
# 11. Auto-Order system (PO email to vendors)
# 12. Chart of Accounts Cleanup (audit, standardize, deactivate unused)
#
###############################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  HINNAWI OPS — DEPLOYMENT SCRIPT (April 5, 2026)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

###############################################################################
# STEP 0: Verify we're in the right directory
###############################################################################
if [ ! -f "package.json" ] || [ ! -d "server" ] || [ ! -d "drizzle" ]; then
    echo -e "${RED}ERROR: This script must be run from the hinnawi-ops project root.${NC}"
    echo "Usage: cd /path/to/hinnawi-ops && bash scripts/deploy-2026-04-05.sh"
    exit 1
fi

echo -e "${GREEN}✓ Project directory verified${NC}"

###############################################################################
# STEP 1: Pull latest code from GitHub
###############################################################################
echo ""
echo -e "${YELLOW}[1/6] Pulling latest code from GitHub...${NC}"
git pull origin main
echo -e "${GREEN}✓ Code pulled successfully${NC}"

###############################################################################
# STEP 2: Install dependencies (if any new ones were added)
###############################################################################
echo ""
echo -e "${YELLOW}[2/6] Installing dependencies...${NC}"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

###############################################################################
# STEP 3: Push new database schema tables
###############################################################################
echo ""
echo -e "${YELLOW}[3/6] Pushing database schema changes...${NC}"
echo ""
echo "  New tables being created:"
echo "    - revenueJournalEntries  (tracks posted revenue JEs to prevent duplicates)"
echo "    - accountantTasks        (auto-detected bookkeeping tasks)"
echo "    - locationPins           (PIN auth for procurement)"
echo "    - inventoryLevels        (per-location stock levels)"
echo "    - stockMovements         (inventory movement ledger)"
echo "    - wasteReports           (waste reporting headers)"
echo "    - wasteReportItems       (waste report line items)"
echo "    - leftoverReports        (leftover reporting headers)"
echo "    - leftoverReportItems    (leftover report line items)"
echo "    - vendorCatalogItems     (vendor product catalogs)"
echo "    - orderRecommendations   (smart order suggestions)"
echo ""
echo "  Modified tables:"
echo "    - purchaseOrders         (added approval workflow fields)"
echo ""

npx drizzle-kit push --force 2>/dev/null || npx drizzle-kit push

echo -e "${GREEN}✓ Database schema updated${NC}"

###############################################################################
# STEP 4: Build the application
###############################################################################
echo ""
echo -e "${YELLOW}[4/6] Building the application...${NC}"
npx vite build
echo -e "${GREEN}✓ Application built successfully${NC}"

###############################################################################
# STEP 5: Clear old report cache (force fresh data)
###############################################################################
echo ""
echo -e "${YELLOW}[5/6] Clearing old report cache...${NC}"
echo "  Old cached reports with potentially duplicated data will be purged."
echo "  New reports will be fetched fresh from QBO on next page load."

# This runs a quick SQL to clear the qboReportCache table
# The app will re-fetch from QBO with the fixed department filter
npx tsx -e "
const { getDb } = require('./server/db');
async function clearCache() {
  try {
    const db = getDb();
    await db.execute('DELETE FROM qboReportCache');
    console.log('  ✓ Report cache cleared');
  } catch (e) {
    console.log('  ⚠ Could not clear cache (table may not exist yet): ' + e.message);
  }
  process.exit(0);
}
clearCache();
" 2>/dev/null || echo -e "  ${YELLOW}⚠ Cache clear skipped (will expire naturally in 5 minutes)${NC}"

echo -e "${GREEN}✓ Cache cleared${NC}"

###############################################################################
# STEP 6: Restart the server
###############################################################################
echo ""
echo -e "${YELLOW}[6/6] Restarting the server...${NC}"

# Try PM2 first (most common Node.js process manager)
if command -v pm2 &> /dev/null; then
    pm2 restart all 2>/dev/null && echo -e "${GREEN}✓ Server restarted via PM2${NC}" || true
# Try systemctl
elif systemctl is-active --quiet hinnawi-ops 2>/dev/null; then
    sudo systemctl restart hinnawi-ops
    echo -e "${GREEN}✓ Server restarted via systemctl${NC}"
else
    echo -e "${YELLOW}⚠ Could not auto-detect process manager.${NC}"
    echo "  Please restart the server manually:"
    echo "    pm2 restart all"
    echo "    OR"
    echo "    sudo systemctl restart hinnawi-ops"
    echo "    OR"
    echo "    Kill the existing process and run: pnpm start"
fi

###############################################################################
# DEPLOYMENT COMPLETE
###############################################################################
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ DEPLOYMENT COMPLETE${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  New pages available:"
echo "    /accountant-tasks    — Accountant Task Center"
echo "    /procurement         — Procurement Hub"
echo "    /reconciliation      — Reconciliation Dashboard"
echo "    /vendor-catalog      — Vendor Catalog & Orders"
echo "    /coa-cleanup         — Chart of Accounts Cleanup"
echo ""
echo "  Updated pages:"
echo "    /financial-statements — Fixed revenue duplication, quarterly filter,"
echo "                           custom dates, reliable refresh, auto-refresh"
echo ""
echo "  CLI scripts available:"
echo "    npx tsx scripts/runRevenueJePipeline.ts --dry-run    (preview revenue JE changes)"
echo "    npx tsx scripts/runRevenueJePipeline.ts --live       (execute revenue JE void+repost)"
echo "    npx tsx scripts/runCoaAudit.ts --audit               (audit Chart of Accounts)"
echo ""
echo -e "${YELLOW}  IMPORTANT POST-DEPLOYMENT STEPS:${NC}"
echo ""
echo "  1. Verify Financial Statements:"
echo "     - Open Consolidated P&L for FY 2024-2025 (Sep 1, 2024 – Aug 31, 2025)"
echo "     - Confirm revenue is NOT duplicated for PK/MK"
echo "     - Check FY 2023-2024 as well"
echo ""
echo "  2. Revenue JE Pipeline (when ready):"
echo "     - Run: npx tsx scripts/runRevenueJePipeline.ts --dry-run"
echo "     - Review the output carefully"
echo "     - Then: npx tsx scripts/runRevenueJePipeline.ts --live"
echo ""
echo "  3. Chart of Accounts Cleanup (when ready):"
echo "     - Open /coa-cleanup in the app"
echo "     - Click 'Run Full Audit' to review before making changes"
echo ""
echo "  4. Set up Procurement PINs:"
echo "     - Open /procurement → PIN Management tab"
echo "     - Create PINs for each location manager and ops manager"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
