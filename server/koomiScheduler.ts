/**
 * Koomi Auto-Sync Scheduler
 * Automatically syncs Net Onsite Sales and Breakdown Onsite reports from admin.koomi.com.
 *
 * Schedule:
 *   - Every 5 minutes between 7:00 AM and 8:00 PM ET (business hours)
 *   - One-time sync at 9:00 PM ET (end-of-day capture)
 *   - One-time sync at 12:00 AM ET (midnight final capture)
 *
 * Syncs yesterday + today to keep data fresh throughout the day.
 */
import * as koomi from "./koomiScraper";
import * as db from "./db";
import { getSetting, setSetting } from "./autoRetry";

let syncInterval: ReturnType<typeof setInterval> | null = null;
let lastSyncTime: Date | null = null;
let lastSyncResult: KoomiSyncResult | null = null;
let isRunning = false;

interface KoomiSyncResult {
  success: boolean;
  salesRecords: number;
  salesInserted: number;
  salesUpdated: number;
  breakdownItems: number;
  breakdownStores: number;
  dateRange: { from: string; to: string };
  error?: string;
  timestamp: number;
}

/**
 * Get the current hour and minute in ET (America/Montreal).
 */
function getETTime(): { hour: number; minute: number } {
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", { timeZone: "America/Montreal", hour12: false });
  const match = etTimeStr.match(/(\d{1,2}):(\d{2}):\d{2}/);
  if (!match) return { hour: -1, minute: -1 };
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
}

/**
 * Check if current ET time falls within a sync window.
 *
 * Returns true if:
 *   - Between 7:00 AM and 8:00 PM ET (every 5 min interval)
 *   - At 9:00 PM ET (21:00, one-time)
 *   - At 12:00 AM ET (0:00, one-time / midnight)
 */
function isWithinSyncWindow(): boolean {
  const { hour } = getETTime();
  if (hour < 0) return false;

  // Business hours: 7 AM (7) to 8 PM (20) — hours 7..19 inclusive
  if (hour >= 7 && hour <= 19) return true;

  // End-of-day capture: 9 PM (21)
  if (hour === 21) return true;

  // Midnight capture: 12 AM (0)
  if (hour === 0) return true;

  return false;
}

/**
 * Run a full Koomi sync for a given date range.
 * Fetches both Net Onsite Sales and Breakdown Onsite reports.
 */
export async function runKoomiSync(fromDate: string, toDate: string): Promise<KoomiSyncResult> {
  if (isRunning) {
    return {
      success: false,
      salesRecords: 0, salesInserted: 0, salesUpdated: 0,
      breakdownItems: 0, breakdownStores: 0,
      dateRange: { from: fromDate, to: toDate },
      error: "Sync already in progress",
      timestamp: Date.now(),
    };
  }

  isRunning = true;
  console.log(`[Koomi Scheduler] Starting sync for ${fromDate} to ${toDate}`);

  try {
    // 1. Sync Net Onsite Sales
    const salesRecords = await koomi.fetchNetOnsiteSales(fromDate, toDate);
    let salesInserted = 0;
    let salesUpdated = 0;

    for (const rec of salesRecords) {
      const result = await db.upsertDailySale({
        locationId: rec.locationId,
        saleDate: rec.saleDate,
        totalSales: rec.totalSales,
        taxableSales: rec.taxableSales,
        tipsCollected: rec.tipsCollected,
        orderCount: rec.orderCount,
        labourCost: rec.labourCost,
      });
      if (result === "inserted") salesInserted++;
      else salesUpdated++;
    }

    console.log(`[Koomi Scheduler] Sales: ${salesRecords.length} records (${salesInserted} new, ${salesUpdated} updated)`);

    // 2. Sync Breakdown Onsite
    const breakdownBlocks = await koomi.fetchBreakdownOnsiteSales(fromDate, toDate);
    const breakdownRows = koomi.breakdownToProductSalesRows(breakdownBlocks);
    let breakdownResult = { imported: 0, updated: 0, skipped: 0 };

    if (breakdownRows.length > 0) {
      breakdownResult = await db.importProductSales(breakdownRows);
    }

    console.log(`[Koomi Scheduler] Breakdown: ${breakdownRows.length} items across ${breakdownBlocks.length} stores`);

    // 3. Update integration status
    const dbConn = await db.getDb();
    if (dbConn) {
      const { integrations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbConn.update(integrations)
        .set({ lastSyncAt: new Date(), status: "live" })
        .where(eq(integrations.name, "Koomi POS"));
    }

    // 4. Save last sync timestamp
    await setSetting("koomi_last_sync", new Date().toISOString());
    await setSetting("koomi_last_sync_range", `${fromDate}|${toDate}`);

    const result: KoomiSyncResult = {
      success: true,
      salesRecords: salesRecords.length,
      salesInserted,
      salesUpdated,
      breakdownItems: breakdownRows.length,
      breakdownStores: breakdownBlocks.length,
      dateRange: { from: fromDate, to: toDate },
      timestamp: Date.now(),
    };

    lastSyncTime = new Date();
    lastSyncResult = result;
    return result;
  } catch (err: any) {
    console.error("[Koomi Scheduler] Sync failed:", err.message);
    const result: KoomiSyncResult = {
      success: false,
      salesRecords: 0, salesInserted: 0, salesUpdated: 0,
      breakdownItems: 0, breakdownStores: 0,
      dateRange: { from: fromDate, to: toDate },
      error: err.message,
      timestamp: Date.now(),
    };
    lastSyncResult = result;
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * Run the auto-sync — syncs yesterday + today.
 * Only runs if within the configured sync windows.
 */
async function runAutoSync(): Promise<void> {
  const enabled = await getSetting("koomi_auto_sync_enabled");
  if (enabled !== "true") return;

  // Only sync during configured windows
  if (!isWithinSyncWindow()) return;

  // Sync yesterday + today to capture ongoing sales
  const yesterday = koomi.getYesterday();
  const today = koomi.getToday();
  console.log(`[Koomi Scheduler] Running auto-sync for ${yesterday} to ${today}`);
  await runKoomiSync(yesterday, today);
}

/**
 * Start the Koomi auto-sync scheduler.
 * Runs every 5 minutes and checks if within sync window before executing.
 *
 * Schedule:
 *   - Every 5 min between 7 AM - 8 PM ET (business hours)
 *   - One-time at 9 PM ET (end-of-day)
 *   - One-time at 12 AM ET (midnight)
 */
export function startKoomiScheduler(): void {
  if (syncInterval) {
    console.log("[Koomi Scheduler] Already running");
    return;
  }

  // Run immediately on start if within sync window
  runAutoSync().catch(err => console.error("[Koomi Scheduler] Initial sync error:", err));

  syncInterval = setInterval(async () => {
    try {
      await runAutoSync();
    } catch (err) {
      console.error("[Koomi Scheduler] Error:", err);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  console.log("[Koomi Scheduler] Started (every 5 min: 7 AM–8 PM, plus 9 PM & midnight ET)");
}

export function stopKoomiScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[Koomi Scheduler] Stopped");
  }
}

export function getKoomiSchedulerStatus() {
  return {
    running: syncInterval !== null,
    isCurrentlySyncing: isRunning,
    lastSync: lastSyncTime?.getTime() || null,
    lastResult: lastSyncResult,
    schedule: "Every 5 min (7 AM–8 PM ET), plus 9 PM & midnight ET",
  };
}
