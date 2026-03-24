import { getDb } from "./db";
import { invoices, appSettings, syncLogs, suppliers } from "../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import * as qbo from "./qbo";

// ─── Settings Helpers ───

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows.length > 0 ? (rows[0].value ?? null) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(appSettings).set({ value }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value });
  }
}

// ─── Sync Log Helpers ───

export async function logSync(entry: {
  syncType: "auto_retry" | "manual_bulk" | "manual_single" | "scheduled";
  invoiceId?: number;
  status: "success" | "failed" | "skipped";
  errorMessage?: string;
  qboBillId?: string;
  triggeredBy?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(syncLogs).values({
    syncType: entry.syncType,
    invoiceId: entry.invoiceId || null,
    status: entry.status,
    errorMessage: entry.errorMessage || null,
    qboBillId: entry.qboBillId || null,
    triggeredBy: entry.triggeredBy || null,
  });
}

export async function getRecentSyncLogs(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(syncLogs).orderBy(desc(syncLogs.createdAt)).limit(limit);
}

// ─── Auto-Retry Logic ───

let autoRetryInterval: ReturnType<typeof setInterval> | null = null;
let lastAutoRetryRun: Date | null = null;
let lastAutoRetryResult: { attempted: number; succeeded: number; failed: number } | null = null;

function isBusinessHours(): boolean {
  // Business hours: 7 AM – 8 PM Eastern Time (America/Montreal)
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", { timeZone: "America/Montreal", hour12: false });
  const hourMatch = etTimeStr.match(/(\d{1,2}):\d{2}:\d{2}/);
  if (!hourMatch) return false;
  const etHour = parseInt(hourMatch[1], 10);
  return etHour >= 7 && etHour < 20;
}

function isNightSyncTime(): boolean {
  // One-time syncs at 9 PM and 12 AM ET
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", { timeZone: "America/Montreal", hour12: false });
  const timeMatch = etTimeStr.match(/(\d{1,2}):(\d{2}):\d{2}/);
  if (!timeMatch) return false;
  const etHour = parseInt(timeMatch[1], 10);
  const etMinute = parseInt(timeMatch[2], 10);
  // Within 5-minute window of 9 PM or 12 AM
  return (etHour === 21 && etMinute < 5) || (etHour === 0 && etMinute < 5);
}

async function runAutoRetry(): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const db = await getDb();
  if (!db) return { attempted: 0, succeeded: 0, failed: 0 };

  // Check if auto-retry is enabled
  const enabled = await getSetting("qbo_auto_retry_enabled");
  if (enabled !== "true") return { attempted: 0, succeeded: 0, failed: 0 };

  // Check if QBO is connected
  const connectionStatus = await qbo.getQboConnectionStatus();
  if (!connectionStatus.connected) return { attempted: 0, succeeded: 0, failed: 0 };

  // Only run during business hours OR at the scheduled night sync times
  if (!isBusinessHours() && !isNightSyncTime()) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  // Get all failed invoices
  const failedInvoices = await db.select().from(invoices)
    .where(eq(invoices.qboSyncStatus, "failed"))
    .orderBy(invoices.id);

  if (failedInvoices.length === 0) return { attempted: 0, succeeded: 0, failed: 0 };

  console.log(`[AutoRetry] Starting auto-retry for ${failedInvoices.length} failed invoices`);

  let succeeded = 0;
  let failed = 0;

  for (const inv of failedInvoices) {
    try {
      // Mark as pending
      await db.update(invoices).set({
        qboSyncStatus: "pending",
        qboSyncError: null,
      }).where(eq(invoices.id, inv.id));

      // Get supplier info
      const supplierRows = inv.supplierId
        ? await db.select().from(suppliers).where(sql`${suppliers.id} = ${inv.supplierId}`)
        : [];
      const supplier = supplierRows[0];

      // Create bill in QBO
      const result = await qbo.createBill({
        vendorName: supplier?.name || "Unknown Vendor",
        txnDate: String(inv.invoiceDate),
        dueDate: inv.dueDate ? String(inv.dueDate) : undefined,
        docNumber: inv.invoiceNumber || undefined,
        lineItems: [{
          description: `Invoice ${inv.invoiceNumber || inv.id} - ${supplier?.name || "Vendor"}`,
          amount: Number(inv.subtotal),
        }],
      });

      // Mark as synced
      await db.update(invoices).set({
        qboSynced: true,
        qboSyncStatus: "synced",
        qboSyncError: null,
        qboSyncedAt: new Date(),
        qboBillId: result?.Bill?.Id ? String(result.Bill.Id) : null,
      }).where(eq(invoices.id, inv.id));

      await logSync({
        syncType: "auto_retry",
        invoiceId: inv.id,
        status: "success",
        qboBillId: result?.Bill?.Id ? String(result.Bill.Id) : undefined,
        triggeredBy: "scheduler",
      });

      succeeded++;
    } catch (error: any) {
      // Mark as failed again
      await db.update(invoices).set({
        qboSynced: false,
        qboSyncStatus: "failed",
        qboSyncError: error?.message || "Auto-retry failed",
      }).where(eq(invoices.id, inv.id));

      await logSync({
        syncType: "auto_retry",
        invoiceId: inv.id,
        status: "failed",
        errorMessage: error?.message || "Auto-retry failed",
        triggeredBy: "scheduler",
      });

      failed++;
    }
  }

  const result = { attempted: failedInvoices.length, succeeded, failed };
  lastAutoRetryRun = new Date();
  lastAutoRetryResult = result;

  console.log(`[AutoRetry] Completed: ${succeeded} succeeded, ${failed} failed out of ${failedInvoices.length}`);
  return result;
}

// ─── Scheduler Control ───

export function startAutoRetryScheduler(): void {
  if (autoRetryInterval) {
    console.log("[AutoRetry] Scheduler already running");
    return;
  }

  // Run every 5 minutes (300,000 ms)
  autoRetryInterval = setInterval(async () => {
    try {
      await runAutoRetry();
    } catch (err) {
      console.error("[AutoRetry] Scheduler error:", err);
    }
  }, 5 * 60 * 1000);

  console.log("[AutoRetry] Scheduler started (every 5 minutes during business hours 7AM-8PM ET, plus 9PM and 12AM)");
}

export function stopAutoRetryScheduler(): void {
  if (autoRetryInterval) {
    clearInterval(autoRetryInterval);
    autoRetryInterval = null;
    console.log("[AutoRetry] Scheduler stopped");
  }
}

export function getSchedulerStatus() {
  return {
    running: autoRetryInterval !== null,
    lastRun: lastAutoRetryRun?.getTime() || null,
    lastResult: lastAutoRetryResult,
  };
}

// ─── Manual trigger (for testing or on-demand) ───
export { runAutoRetry };
