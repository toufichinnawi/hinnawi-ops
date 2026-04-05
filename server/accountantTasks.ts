/**
 * Accountant Task Detection Engine
 * 
 * Auto-detects pending bookkeeping tasks by scanning for data gaps across:
 *   - Revenue JE posting (dailySales vs revenueJournalEntries)
 *   - Invoice processing (pending invoices, unsynced to QBO)
 *   - Email processing (pending emails with attachments)
 *   - Bank reconciliation (unmatched bank transactions)
 *   - Payroll JE posting
 *   - Monthly tax filing preparation
 *   - Month-end close checklist
 * 
 * Tasks are upserted by taskKey + dueDate to prevent duplicates.
 */
import { getDb } from "./db";
import {
  accountantTasks, dailySales, revenueJournalEntries, invoices,
  processedEmails, bankTransactions, payrollRecords, locations
} from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc, isNull, ne, inArray, or, lt } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// ─── Types ───

interface DetectedTask {
  taskKey: string;
  frequency: "daily" | "weekly" | "monthly";
  category: "revenue_posting" | "invoice_processing" | "bank_reconciliation" |
    "payroll" | "tax_filing" | "month_end" | "email_processing" |
    "expense_classification" | "intercompany" | "other";
  title: string;
  description: string;
  locationId?: number;
  dueDate: string;
  periodStart?: string;
  periodEnd?: string;
  priority: "critical" | "high" | "medium" | "low";
  sourceTable?: string;
}

// ─── Location Config ───

const LOCATION_IDS = [1, 2, 3, 4]; // PK, MK, ONT, CT

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function today(): string {
  return formatDate(new Date());
}

function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return formatDate(d);
}

function endOfLastWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 1; // Last Sunday
  d.setDate(diff);
  return formatDate(d);
}

function startOfLastWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7; // Last Monday
  d.setDate(diff);
  return formatDate(d);
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return formatDate(d);
}

function endOfLastMonth(): string {
  const d = new Date();
  d.setDate(0); // Last day of previous month
  return formatDate(d);
}

function startOfLastMonth(): string {
  const d = new Date();
  d.setDate(0);
  d.setDate(1);
  return formatDate(d);
}

function lastMonthName(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function currentQuarterEnd(): string {
  // Fiscal quarters: Q1=Sep-Nov, Q2=Dec-Feb, Q3=Mar-May, Q4=Jun-Aug
  const d = new Date();
  const m = d.getMonth(); // 0-indexed
  if (m >= 8 && m <= 10) return `${d.getFullYear()}-11-30`; // Q1
  if (m === 11) return `${d.getFullYear() + 1}-02-28`; // Q2
  if (m >= 0 && m <= 1) return `${d.getFullYear()}-02-28`; // Q2
  if (m >= 2 && m <= 4) return `${d.getFullYear()}-05-31`; // Q3
  return `${d.getFullYear()}-08-31`; // Q4
}

// ─── Task Detection Functions ───

/**
 * DAILY: Detect missing revenue JE postings.
 * For each location, check if yesterday's dailySales has a corresponding
 * revenueJournalEntries record with status='posted'.
 */
async function detectMissingRevenueJEs(db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];
  const yday = yesterday();

  // Get all daily sales for the last 7 days that don't have posted JEs
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);

    const sales = await db.select().from(dailySales)
      .where(eq(dailySales.saleDate, dateStr));

    for (const sale of sales) {
      if (Number(sale.totalSales) === 0) continue;
      if (!LOCATION_IDS.includes(sale.locationId)) continue;

      // Check if JE was posted
      const posted = await db.select().from(revenueJournalEntries)
        .where(and(
          eq(revenueJournalEntries.locationId, sale.locationId),
          eq(revenueJournalEntries.saleDate, dateStr),
          eq(revenueJournalEntries.status, "posted"),
        ))
        .limit(1);

      if (posted.length === 0) {
        const daysOld = i;
        tasks.push({
          taskKey: `rev-je-${sale.locationId}-${dateStr}`,
          frequency: "daily",
          category: "revenue_posting",
          title: `Post revenue JE for Location #${sale.locationId} — ${dateStr}`,
          description: `Daily sales of $${Number(sale.totalSales).toFixed(2)} recorded but no revenue journal entry posted to QBO. GST: $${Number(sale.gstCollected || 0).toFixed(2)}, QST: $${Number(sale.qstCollected || 0).toFixed(2)}.`,
          locationId: sale.locationId,
          dueDate: dateStr,
          priority: daysOld >= 3 ? "critical" : daysOld >= 2 ? "high" : "medium",
          sourceTable: "dailySales",
        });
      }
    }
  }

  return tasks;
}

/**
 * DAILY: Detect pending invoices not yet synced to QBO.
 */
async function detectUnsyncedInvoices(db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];

  const pending = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    total: invoices.total,
    status: invoices.status,
    qboSyncStatus: invoices.qboSyncStatus,
    invoiceDate: invoices.invoiceDate,
    locationId: invoices.locationId,
  }).from(invoices)
    .where(and(
      eq(invoices.status, "approved"),
      or(
        eq(invoices.qboSyncStatus, "not_synced"),
        eq(invoices.qboSyncStatus, "failed"),
      ),
    ))
    .orderBy(invoices.invoiceDate);

  for (const inv of pending) {
    tasks.push({
      taskKey: `sync-invoice-${inv.id}`,
      frequency: "daily",
      category: "invoice_processing",
      title: `Sync invoice #${inv.invoiceNumber || inv.id} to QBO ($${Number(inv.total).toFixed(2)})`,
      description: `Approved invoice not yet synced to QuickBooks. Status: ${inv.qboSyncStatus}. Date: ${inv.invoiceDate}.`,
      locationId: inv.locationId || undefined,
      dueDate: today(),
      priority: inv.qboSyncStatus === "failed" ? "high" : "medium",
      sourceTable: "invoices",
    });
  }

  return tasks;
}

/**
 * DAILY: Detect pending invoices awaiting approval.
 */
async function detectPendingInvoices(db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];

  const pending = await db.select({
    count: sql<number>`count(*)`,
    totalAmount: sql<string>`COALESCE(SUM(${invoices.total}), 0)`,
  }).from(invoices)
    .where(eq(invoices.status, "pending"));

  const row = pending[0];
  if (row && Number(row.count) > 0) {
    tasks.push({
      taskKey: `review-pending-invoices-${today()}`,
      frequency: "daily",
      category: "invoice_processing",
      title: `Review ${row.count} pending invoices ($${Number(row.totalAmount).toFixed(2)} total)`,
      description: `There are ${row.count} invoices awaiting review and approval before they can be synced to QuickBooks.`,
      dueDate: today(),
      priority: Number(row.count) >= 10 ? "high" : "medium",
      sourceTable: "invoices",
    });
  }

  return tasks;
}

/**
 * DAILY: Detect unprocessed emails with attachments.
 */
async function detectUnprocessedEmails(db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];

  const pending = await db.select({
    count: sql<number>`count(*)`,
  }).from(processedEmails)
    .where(eq(processedEmails.status, "pending"));

  const row = pending[0];
  if (row && Number(row.count) > 0) {
    tasks.push({
      taskKey: `process-emails-${today()}`,
      frequency: "daily",
      category: "email_processing",
      title: `Process ${row.count} pending email${Number(row.count) > 1 ? "s" : ""} with invoices`,
      description: `${row.count} emails in the inbox have not been processed. They may contain invoices that need to be extracted and recorded.`,
      dueDate: today(),
      priority: Number(row.count) >= 20 ? "high" : "medium",
      sourceTable: "processedEmails",
    });
  }

  return tasks;
}

/**
 * WEEKLY: Detect unmatched bank transactions.
 */
async function detectUnmatchedBankTransactions(db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];

  const unmatched = await db.select({
    count: sql<number>`count(*)`,
    totalDebit: sql<string>`COALESCE(SUM(${bankTransactions.debit}), 0)`,
    totalCredit: sql<string>`COALESCE(SUM(${bankTransactions.credit}), 0)`,
  }).from(bankTransactions)
    .where(eq(bankTransactions.matchedType, "unmatched"));

  const row = unmatched[0];
  if (row && Number(row.count) > 0) {
    tasks.push({
      taskKey: `reconcile-bank-${startOfWeek()}`,
      frequency: "weekly",
      category: "bank_reconciliation",
      title: `Reconcile ${row.count} unmatched bank transactions`,
      description: `${row.count} bank transactions are unmatched. Total debits: $${Number(row.totalDebit).toFixed(2)}, Total credits: $${Number(row.totalCredit).toFixed(2)}. Classify each transaction by type (deposit, supplier payment, payroll, etc.) and assign to a location.`,
      dueDate: today(),
      priority: Number(row.count) >= 50 ? "critical" : Number(row.count) >= 20 ? "high" : "medium",
      sourceTable: "bankTransactions",
    });
  }

  return tasks;
}

/**
 * MONTHLY: GST/QST filing preparation.
 * Due by the end of the month following the reporting period.
 */
async function detectTaxFilingTasks(_db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];
  const now = new Date();
  const dayOfMonth = now.getDate();

  // Only generate tax filing tasks in the first 15 days of each month
  // (for the previous month's filing)
  if (dayOfMonth <= 15) {
    const prevMonthEnd = endOfLastMonth();
    const prevMonthStart = startOfLastMonth();
    const monthName = lastMonthName();

    tasks.push({
      taskKey: `gst-qst-filing-${prevMonthEnd}`,
      frequency: "monthly",
      category: "tax_filing",
      title: `Prepare GST/QST filing for ${monthName}`,
      description: `Review and prepare GST/QST collected and paid for ${monthName} (${prevMonthStart} to ${prevMonthEnd}). Verify all revenue JEs are posted and all invoices are synced before filing.`,
      dueDate: formatDate(new Date(now.getFullYear(), now.getMonth(), 15)),
      periodStart: prevMonthStart,
      periodEnd: prevMonthEnd,
      priority: dayOfMonth >= 10 ? "critical" : "high",
    });
  }

  return tasks;
}

/**
 * MONTHLY: Month-end close checklist.
 */
async function detectMonthEndTasks(_db: any): Promise<DetectedTask[]> {
  const tasks: DetectedTask[] = [];
  const now = new Date();
  const dayOfMonth = now.getDate();

  // Generate month-end tasks in the last 5 days of the month or first 5 of next
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  if (dayOfMonth >= daysInMonth - 4 || dayOfMonth <= 5) {
    const isClosingPrevMonth = dayOfMonth <= 5;
    const targetMonth = isClosingPrevMonth ? lastMonthName() : now.toLocaleString("en-US", { month: "long", year: "numeric" });
    const dueDate = isClosingPrevMonth
      ? formatDate(new Date(now.getFullYear(), now.getMonth(), 5))
      : formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const periodEnd = isClosingPrevMonth ? endOfLastMonth() : formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const periodStart = isClosingPrevMonth ? startOfLastMonth() : startOfMonth();

    const checklist = [
      { key: "month-end-revenue-review", title: `Verify all revenue JEs posted for ${targetMonth}`, cat: "revenue_posting" as const, prio: "high" as const },
      { key: "month-end-ap-review", title: `Review accounts payable for ${targetMonth}`, cat: "invoice_processing" as const, prio: "high" as const },
      { key: "month-end-bank-recon", title: `Complete bank reconciliation for ${targetMonth}`, cat: "bank_reconciliation" as const, prio: "critical" as const },
      { key: "month-end-payroll-review", title: `Verify payroll entries for ${targetMonth}`, cat: "payroll" as const, prio: "high" as const },
      { key: "month-end-intercompany", title: `Review inter-company transactions for ${targetMonth}`, cat: "intercompany" as const, prio: "medium" as const },
    ];

    for (const item of checklist) {
      tasks.push({
        taskKey: `${item.key}-${periodEnd}`,
        frequency: "monthly",
        category: item.cat,
        title: item.title,
        description: `Part of the month-end close process for ${targetMonth} (${periodStart} to ${periodEnd}).`,
        dueDate,
        periodStart,
        periodEnd,
        priority: item.prio,
      });
    }
  }

  return tasks;
}

// ─── Main Detection Runner ───

/**
 * Run all task detection functions and upsert results into accountantTasks table.
 * Returns the count of new/updated tasks.
 */
export async function detectAndUpsertTasks(): Promise<{ total: number; new: number; updated: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Run all detectors
  const allDetected: DetectedTask[] = [];

  const detectors = [
    detectMissingRevenueJEs,
    detectUnsyncedInvoices,
    detectPendingInvoices,
    detectUnprocessedEmails,
    detectUnmatchedBankTransactions,
    detectTaxFilingTasks,
    detectMonthEndTasks,
  ];

  for (const detector of detectors) {
    try {
      const tasks = await detector(db);
      allDetected.push(...tasks);
    } catch (err: any) {
      console.error(`[TaskDetection] Detector failed: ${err.message}`);
    }
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const task of allDetected) {
    try {
      // Check if task already exists
      const existing = await db.select().from(accountantTasks)
        .where(and(
          eq(accountantTasks.taskKey, task.taskKey),
          eq(accountantTasks.dueDate, task.dueDate),
        ))
        .limit(1);

      if (existing.length === 0) {
        // Insert new task
        await db.insert(accountantTasks).values({
          taskKey: task.taskKey,
          frequency: task.frequency,
          category: task.category,
          title: task.title,
          description: task.description,
          locationId: task.locationId || null,
          dueDate: task.dueDate,
          periodStart: task.periodStart || null,
          periodEnd: task.periodEnd || null,
          priority: task.priority,
          status: task.dueDate < today() ? "overdue" : "pending",
          autoDetected: true,
          sourceTable: task.sourceTable || null,
        });
        newCount++;
      } else {
        // Update if not completed/skipped
        const ex = existing[0];
        if (ex.status !== "completed" && ex.status !== "skipped") {
          const newStatus = task.dueDate < today() ? "overdue" : ex.status;
          await db.update(accountantTasks)
            .set({
              title: task.title,
              description: task.description,
              priority: task.priority,
              status: newStatus,
            })
            .where(eq(accountantTasks.id, ex.id));
          updatedCount++;
        }
      }
    } catch (err: any) {
      console.error(`[TaskDetection] Failed to upsert task ${task.taskKey}: ${err.message}`);
    }
  }

  // Mark overdue tasks
  await db.update(accountantTasks)
    .set({ status: "overdue" })
    .where(and(
      lt(accountantTasks.dueDate, today()),
      eq(accountantTasks.status, "pending"),
    ));

  console.log(`[TaskDetection] Detected ${allDetected.length} tasks. New: ${newCount}, Updated: ${updatedCount}`);
  return { total: allDetected.length, new: newCount, updated: updatedCount };
}

// ─── Task CRUD Operations ───

export async function getTasksByFrequency(frequency?: string, status?: string) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (frequency) conditions.push(eq(accountantTasks.frequency, frequency as any));
  if (status) conditions.push(eq(accountantTasks.status, status as any));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return await db.select().from(accountantTasks)
    .where(where)
    .orderBy(
      sql`FIELD(${accountantTasks.priority}, 'critical', 'high', 'medium', 'low')`,
      accountantTasks.dueDate,
    );
}

export async function getTaskSummary() {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select({
    frequency: accountantTasks.frequency,
    status: accountantTasks.status,
    count: sql<number>`count(*)`,
  }).from(accountantTasks)
    .groupBy(accountantTasks.frequency, accountantTasks.status);

  const summary: Record<string, Record<string, number>> = {
    daily: { pending: 0, in_progress: 0, completed: 0, overdue: 0, skipped: 0 },
    weekly: { pending: 0, in_progress: 0, completed: 0, overdue: 0, skipped: 0 },
    monthly: { pending: 0, in_progress: 0, completed: 0, overdue: 0, skipped: 0 },
  };

  for (const row of rows) {
    if (summary[row.frequency]) {
      summary[row.frequency][row.status] = Number(row.count);
    }
  }

  return summary;
}

export async function completeTask(taskId: number, completedBy: string, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(accountantTasks)
    .set({
      status: "completed",
      completedBy,
      completedAt: new Date(),
      completionNotes: notes || null,
    })
    .where(eq(accountantTasks.id, taskId));
}

export async function updateTaskStatus(taskId: number, status: string, notes?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updates: Record<string, unknown> = { status };
  if (status === "completed") {
    updates.completedAt = new Date();
  }
  if (notes) {
    updates.completionNotes = notes;
  }

  await db.update(accountantTasks)
    .set(updates)
    .where(eq(accountantTasks.id, taskId));
}

export async function snoozeTask(taskId: number, snoozeUntil: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(accountantTasks)
    .set({ snoozedUntil: snoozeUntil, status: "pending" })
    .where(eq(accountantTasks.id, taskId));
}

// ─── Notification for Overdue Tasks ───

export async function notifyOverdueTasks(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const overdue = await db.select({
    count: sql<number>`count(*)`,
    criticalCount: sql<number>`SUM(CASE WHEN ${accountantTasks.priority} = 'critical' THEN 1 ELSE 0 END)`,
    highCount: sql<number>`SUM(CASE WHEN ${accountantTasks.priority} = 'high' THEN 1 ELSE 0 END)`,
  }).from(accountantTasks)
    .where(eq(accountantTasks.status, "overdue"));

  const row = overdue[0];
  if (!row || Number(row.count) === 0) return false;

  // Get the top 5 overdue tasks for the notification
  const topOverdue = await db.select().from(accountantTasks)
    .where(eq(accountantTasks.status, "overdue"))
    .orderBy(
      sql`FIELD(${accountantTasks.priority}, 'critical', 'high', 'medium', 'low')`,
      accountantTasks.dueDate,
    )
    .limit(5);

  const taskList = topOverdue.map(t =>
    `• [${t.priority.toUpperCase()}] ${t.title} (due: ${t.dueDate})`
  ).join("\n");

  const title = `${row.count} Overdue Accountant Task${Number(row.count) > 1 ? "s" : ""} — ${Number(row.criticalCount)} Critical`;
  const content = `There are ${row.count} overdue tasks requiring attention.\n\nCritical: ${row.criticalCount} | High: ${row.highCount}\n\nTop overdue tasks:\n${taskList}\n\nPlease review and complete these tasks in the Accountant Task Center.`;

  try {
    return await notifyOwner({ title, content });
  } catch (err: any) {
    console.error(`[TaskNotification] Failed to send: ${err.message}`);
    return false;
  }
}
