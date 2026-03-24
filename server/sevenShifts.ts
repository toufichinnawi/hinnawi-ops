/**
 * 7shifts API Client
 * Handles fetching sales (receipts) and labour (time punches) data for Ontario location.
 * Company: 308388 (Hinnawi Bros ONT)
 * Location: 379210 (Hinnawi Bros ONT-New)
 */
import { ENV } from "./_core/env";

const BASE_URL = "https://api.7shifts.com/v2";
const COMPANY_ID = 308388;
const LOCATION_ID = 379210;
const ONTARIO_DB_LOCATION_ID = 3;

function getHeaders() {
  return {
    Authorization: `Bearer ${ENV.sevenShiftsAccessToken}`,
    "Content-Type": "application/json",
  };
}

export interface DailySalesData {
  date: string;
  totalSales: number;
  tips: number;
  orderCount: number;
  labourCost: number;
  labourHours: number;
}

interface Receipt {
  id: string;
  receipt_date: string;
  net_total: number;
  tips: number;
  total_receipt_discounts: number;
  total_item_discounts: number;
  status: string;
}

interface TimePunch {
  id: number;
  clocked_in: string;
  clocked_out: string | null;
  hourly_wage: number;
  deleted: boolean;
  breaks: Array<{ start: string; end: string }>;
}

/**
 * Fetch all receipts using cursor pagination.
 * Note: 7shifts limits receipt queries to last 90 days.
 */
export async function fetchAllReceipts(): Promise<Receipt[]> {
  const allReceipts: Receipt[] = [];
  let cursor: string | null = null;

  while (true) {
    let url = `${BASE_URL}/company/${COMPANY_ID}/receipts?location_id=${LOCATION_ID}&limit=100`;
    if (cursor) url += `&cursor=${cursor}`;

    const resp = await fetch(url, { headers: getHeaders() });
    const data = await resp.json();

    if (!data.data) break;

    allReceipts.push(...data.data);

    const nextCursor = data.meta?.cursor?.next;
    if (!nextCursor || data.data.length === 0) break;
    cursor = nextCursor;
  }

  return allReceipts;
}

/**
 * Fetch all time punches using cursor pagination.
 */
export async function fetchAllTimePunches(): Promise<TimePunch[]> {
  const allPunches: TimePunch[] = [];
  let cursor: string | null = null;

  while (true) {
    let url = `${BASE_URL}/company/${COMPANY_ID}/time_punches?location_id=${LOCATION_ID}&limit=500`;
    if (cursor) url += `&cursor=${cursor}`;

    const resp = await fetch(url, { headers: getHeaders() });
    const data = await resp.json();

    if (!data.data) break;

    allPunches.push(...data.data);

    const nextCursor = data.meta?.cursor?.next;
    if (!nextCursor || data.data.length === 0) break;
    cursor = nextCursor;
  }

  return allPunches;
}

/**
 * Aggregate receipts into daily sales totals.
 * Amounts from API are in cents.
 */
function aggregateReceiptsByDay(receipts: Receipt[]): Map<string, { netTotal: number; tips: number; orderCount: number }> {
  const daily = new Map<string, { netTotal: number; tips: number; orderCount: number }>();

  for (const r of receipts) {
    if (r.status !== "closed") continue;
    const date = r.receipt_date.substring(0, 10);
    const existing = daily.get(date) || { netTotal: 0, tips: 0, orderCount: 0 };
    existing.netTotal += r.net_total || 0;
    existing.tips += r.tips || 0;
    existing.orderCount += 1;
    daily.set(date, existing);
  }

  return daily;
}

/**
 * Aggregate time punches into daily labour costs.
 * hourly_wage from API is in cents.
 */
function aggregatePunchesByDay(punches: TimePunch[]): Map<string, { labourCostCents: number; totalHours: number }> {
  const daily = new Map<string, { labourCostCents: number; totalHours: number }>();

  for (const p of punches) {
    if (p.deleted || !p.clocked_in || !p.clocked_out) continue;

    const clockedIn = new Date(p.clocked_in);
    const clockedOut = new Date(p.clocked_out);
    let hours = (clockedOut.getTime() - clockedIn.getTime()) / (1000 * 60 * 60);

    // Skip unreasonable punches (> 16 hours)
    if (hours > 16 || hours < 0) continue;

    // Subtract break time
    let breakMinutes = 0;
    for (const b of p.breaks || []) {
      if (b.start && b.end) {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        breakMinutes += (bEnd.getTime() - bStart.getTime()) / (1000 * 60);
      }
    }
    const netHours = Math.max(0, hours - breakMinutes / 60);

    const costCents = Math.round(p.hourly_wage * netHours);
    const date = clockedIn.toISOString().substring(0, 10);

    const existing = daily.get(date) || { labourCostCents: 0, totalHours: 0 };
    existing.labourCostCents += costCents;
    existing.totalHours += netHours;
    daily.set(date, existing);
  }

  return daily;
}

/**
 * Fetch and aggregate all Ontario data into daily records.
 * Returns array of DailySalesData ready for database insertion.
 */
export async function fetchOntarioDailyData(): Promise<DailySalesData[]> {
  const [receipts, punches] = await Promise.all([
    fetchAllReceipts(),
    fetchAllTimePunches(),
  ]);

  const dailyReceipts = aggregateReceiptsByDay(receipts);
  const dailyLabour = aggregatePunchesByDay(punches);

  // Merge all dates
  const allDates = new Set([...Array.from(dailyReceipts.keys()), ...Array.from(dailyLabour.keys())]);
  const results: DailySalesData[] = [];

  for (const date of Array.from(allDates).sort()) {
    const receipt = dailyReceipts.get(date) || { netTotal: 0, tips: 0, orderCount: 0 };
    const labour = dailyLabour.get(date) || { labourCostCents: 0, totalHours: 0 };

    results.push({
      date,
      totalSales: receipt.netTotal / 100,
      tips: receipt.tips / 100,
      orderCount: receipt.orderCount,
      labourCost: labour.labourCostCents / 100,
      labourHours: labour.totalHours,
    });
  }

  return results;
}

/**
 * Get connection status info for the UI.
 */
export async function getConnectionStatus() {
  try {
    const resp = await fetch(`${BASE_URL}/company/${COMPANY_ID}`, {
      headers: getHeaders(),
    });
    const data = await resp.json();

    if (data.data) {
      return {
        connected: true,
        companyName: data.data.name,
        companyId: COMPANY_ID,
        locationId: LOCATION_ID,
        dbLocationId: ONTARIO_DB_LOCATION_ID,
      };
    }
    return { connected: false, error: data.detail || "Unknown error" };
  } catch (err: any) {
    return { connected: false, error: err.message };
  }
}

export { ONTARIO_DB_LOCATION_ID };
