/**
 * 7shifts Daily Sync Scheduler
 * Automatically syncs Ontario daily sales and labour data from 7shifts API.
 * Runs daily at 6 AM ET (same schedule as Koomi).
 * Also supports manual triggering and configurable sync windows.
 */
import * as sevenShifts from "./sevenShifts";
import * as db from "./db";
import { getSetting, setSetting } from "./autoRetry";

let syncInterval: ReturnType<typeof setInterval> | null = null;
let lastSyncTime: Date | null = null;
let lastSyncResult: SevenShiftsSyncResult | null = null;
let isRunning = false;

interface SevenShiftsSyncResult {
  success: boolean;
  daysProcessed: number;
  inserted: number;
  updated: number;
  dateRange: { from: string; to: string } | null;
  totalSales: number;
  totalLabour: number;
  totalOrders: number;
  error?: string;
  timestamp: number;
}

/**
 * Run a full 7shifts sync.
 * Fetches all available Ontario data (last 90 days from 7shifts API).
 */
export async function runSevenShiftsSync(): Promise<SevenShiftsSyncResult> {
  if (isRunning) {
    return {
      success: false,
      daysProcessed: 0, inserted: 0, updated: 0,
      dateRange: null,
      totalSales: 0, totalLabour: 0, totalOrders: 0,
      error: "Sync already in progress",
      timestamp: Date.now(),
    };
  }

  isRunning = true;
  console.log("[7shifts Scheduler] Starting Ontario sync");

  try {
    const dailyData = await sevenShifts.fetchOntarioDailyData();
    const locationId = sevenShifts.ONTARIO_DB_LOCATION_ID;
    let inserted = 0;
    let updated = 0;

    for (const day of dailyData) {
      const result = await db.upsertDailySale({
        locationId,
        saleDate: day.date,
        totalSales: String(day.totalSales),
        taxableSales: String(day.totalSales),
        tipsCollected: String(day.tips),
        orderCount: day.orderCount,
        labourCost: String(day.labourCost),
      });
      if (result === "inserted") inserted++;
      else updated++;
    }

    console.log(`[7shifts Scheduler] Processed ${dailyData.length} days (${inserted} new, ${updated} updated)`);

    // Update integration status
    const dbConn = await db.getDb();
    if (dbConn) {
      const { integrations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbConn.update(integrations)
        .set({ lastSyncAt: new Date(), status: "live" })
        .where(eq(integrations.name, "7shifts (Ontario)"));
    }

    // Save last sync timestamp
    await setSetting("7shifts_last_sync", new Date().toISOString());

    const result: SevenShiftsSyncResult = {
      success: true,
      daysProcessed: dailyData.length,
      inserted,
      updated,
      dateRange: dailyData.length > 0
        ? { from: dailyData[0].date, to: dailyData[dailyData.length - 1].date }
        : null,
      totalSales: dailyData.reduce((s, d) => s + d.totalSales, 0),
      totalLabour: dailyData.reduce((s, d) => s + d.labourCost, 0),
      totalOrders: dailyData.reduce((s, d) => s + d.orderCount, 0),
      timestamp: Date.now(),
    };

    lastSyncTime = new Date();
    lastSyncResult = result;
    return result;
  } catch (err: any) {
    console.error("[7shifts Scheduler] Sync failed:", err.message);
    const result: SevenShiftsSyncResult = {
      success: false,
      daysProcessed: 0, inserted: 0, updated: 0,
      dateRange: null,
      totalSales: 0, totalLabour: 0, totalOrders: 0,
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
 * Run the daily sync — checks if it's the right time and hasn't run recently.
 */
async function runDailySync(): Promise<void> {
  const enabled = await getSetting("7shifts_auto_sync_enabled");
  if (enabled !== "true") return;

  // Check if it's the right time (6 AM ET)
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", { timeZone: "America/Toronto", hour12: false });
  const hourMatch = etTimeStr.match(/(\d{1,2}):\d{2}:\d{2}/);
  if (!hourMatch) return;
  const etHour = parseInt(hourMatch[1], 10);

  // Only run between 6:00 and 6:10 AM ET (slightly offset from Koomi to avoid overlap)
  if (etHour !== 6) return;

  // Check if we already ran today
  const lastSync = await getSetting("7shifts_last_sync");
  if (lastSync) {
    const lastSyncDate = new Date(lastSync);
    const hoursSinceLastSync = (Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastSync < 20) {
      return;
    }
  }

  console.log("[7shifts Scheduler] Running daily sync");
  await runSevenShiftsSync();
}

/**
 * Start the 7shifts daily sync scheduler.
 * Checks every 5 minutes if it's time to run the daily sync.
 */
export function startSevenShiftsScheduler(): void {
  if (syncInterval) {
    console.log("[7shifts Scheduler] Already running");
    return;
  }

  syncInterval = setInterval(async () => {
    try {
      await runDailySync();
    } catch (err) {
      console.error("[7shifts Scheduler] Error:", err);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  console.log("[7shifts Scheduler] Started (daily sync at 6 AM ET)");
}

export function stopSevenShiftsScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[7shifts Scheduler] Stopped");
  }
}

export function getSevenShiftsSchedulerStatus() {
  return {
    running: syncInterval !== null,
    isCurrentlySyncing: isRunning,
    lastSync: lastSyncTime?.getTime() || null,
    lastResult: lastSyncResult,
  };
}
