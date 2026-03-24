/**
 * Koomi Admin Scraper
 * Scrapes admin.koomi.com for Net Onsite Sales and Breakdown Onsite reports.
 * Uses HTTP requests to login, fetch report HTML, and parse data from tables.
 *
 * Store mapping:
 *   Koomi 2207 → DB locationId 2 (Mackay)
 *   Koomi 1036 → DB locationId 4 (Cathcart/Tunnel)
 *   Koomi 1037 → DB locationId 1 (President Kennedy)
 */
import { ENV } from "./_core/env";

const KOOMI_BASE = "https://admin.koomi.com";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Koomi location IDs → internal DB location IDs
export const KOOMI_STORE_MAP: Record<string, { koomiId: string; dbLocationId: number; code: string; name: string }> = {
  "2207": { koomiId: "2207", dbLocationId: 2, code: "MK", name: "Mackay" },
  "1036": { koomiId: "1036", dbLocationId: 4, code: "CT", name: "Cathcart/Tunnel" },
  "1037": { koomiId: "1037", dbLocationId: 1, code: "PK", name: "President Kennedy" },
};

// Reverse map: Koomi store name → DB location
export const KOOMI_NAME_MAP: Record<string, number> = {
  "Hinnawi Bros (Mackay)": 2,
  "Hinnawi Bros (Cathcart)": 4,
  "Hinnawi Bros (President Kennedy)": 1,
};

// ─── Session Management ───

let sessionCookie: string | null = null;
let lastLoginTime: number = 0;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function extractSetCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(/PHPSESSID=([^;]+)/);
  return match ? match[1] : null;
}

export async function login(): Promise<string> {
  const email = ENV.koomiAdminEmail;
  const password = ENV.koomiAdminPassword;
  if (!email || !password) {
    throw new Error("Koomi admin credentials not configured (KOOMI_ADMIN_EMAIL, KOOMI_ADMIN_PASSWORD)");
  }

  // Step 1: Get login page to extract CSRF token (login_user_code)
  const loginPageRes = await fetch(KOOMI_BASE, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "manual",
  });
  const loginPageHtml = await loginPageRes.text();
  const phpSessId = extractSetCookie(loginPageRes.headers);

  const codeMatch = loginPageHtml.match(/login_user_code.*?value="([^"]+)"/);
  const loginCode = codeMatch ? codeMatch[1] : "";

  if (!phpSessId) {
    throw new Error("Failed to get PHP session from Koomi login page");
  }

  // Step 2: Submit login form
  const loginRes = await fetch(KOOMI_BASE, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `PHPSESSID=${phpSessId}`,
      "Referer": KOOMI_BASE,
    },
    body: new URLSearchParams({
      email,
      password,
      cms_login_submit: "1",
      login_user_code: loginCode,
    }).toString(),
    redirect: "manual",
  });

  // Login returns refresh:0 header and new session cookie
  const newSessId = extractSetCookie(loginRes.headers) || phpSessId;

  // Step 3: Verify login by fetching dashboard
  const dashRes = await fetch(KOOMI_BASE, {
    headers: {
      "User-Agent": USER_AGENT,
      "Cookie": `PHPSESSID=${newSessId}`,
    },
    redirect: "follow",
  });
  const dashHtml = await dashRes.text();

  if (dashHtml.includes("form-signin")) {
    throw new Error("Koomi login failed — still showing login form. Check credentials.");
  }

  sessionCookie = newSessId;
  lastLoginTime = Date.now();
  console.log("[Koomi] Login successful");
  return newSessId;
}

async function ensureSession(): Promise<string> {
  if (sessionCookie && (Date.now() - lastLoginTime) < SESSION_TIMEOUT) {
    return sessionCookie;
  }
  return login();
}

// ─── Report Fetching ───

interface FetchReportOptions {
  orderType: "net" | "breakdown";
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
  consolidated: boolean;
  locationIds?: string[]; // Koomi location IDs, or omit for "all"
}

async function fetchReportHtml(opts: FetchReportOptions): Promise<string> {
  const session = await ensureSession();

  const params = new URLSearchParams();
  params.set("new", "1");
  params.set("_qf__order", "");
  params.set("order_type", opts.orderType);
  if (opts.consolidated) params.set("consolidated", "1");
  params.set("quantities", "money");
  params.set("from_date", opts.fromDate);
  params.set("to_date", opts.toDate);

  if (opts.locationIds && opts.locationIds.length > 0) {
    for (const locId of opts.locationIds) {
      params.append("reports-location-selected[]", locId);
    }
  } else {
    params.append("reports-location-selected[]", "all");
  }

  const url = `${KOOMI_BASE}/franchise_app/reports/?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Cookie": `PHPSESSID=${session}`,
    },
  });

  const html = await res.text();

  // Check if session expired (redirected to login)
  if (html.includes("form-signin")) {
    console.log("[Koomi] Session expired, re-logging in...");
    sessionCookie = null;
    const newSession = await login();
    // Retry with new session
    const retryRes = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": `PHPSESSID=${newSession}`,
      },
    });
    return retryRes.text();
  }

  return html;
}

// ─── HTML Table Parser ───

interface ParsedRow {
  label: string;
  values: string[];
}

interface ParsedStoreBlock {
  storeName: string;
  koomiId: string;
  dbLocationId: number;
  dates: string[];
  rows: ParsedRow[];
}

function parseNumber(str: string): number {
  if (!str || str === "---" || str === "-" || str.trim() === "") return 0;
  // Remove commas, dollar signs, spaces
  const cleaned = str.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse the Net Onsite consolidated report HTML into structured data.
 * The consolidated report has one table with "All" header and dates as columns.
 */
function parseNetConsolidatedHtml(html: string): {
  dates: string[];
  rows: ParsedRow[];
} {
  const rows = extractTableRows(html);
  if (rows.length < 2) return { dates: [], rows: [] };

  // Row 0: header (e.g., "All")
  // Row 1: dates
  const dateRow = rows[1];
  const dates = dateRow.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.trim()));

  const dataRows: ParsedRow[] = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;
    const label = row[0].trim();
    if (!label || label === "---") continue;
    dataRows.push({
      label,
      values: row.slice(1),
    });
  }

  return { dates, rows: dataRows };
}

/**
 * Parse the Net Onsite per-store report HTML.
 * Each store has its own section separated by "---".
 */
function parseNetPerStoreHtml(html: string): ParsedStoreBlock[] {
  const rows = extractTableRows(html);
  const blocks: ParsedStoreBlock[] = [];
  let currentBlock: ParsedStoreBlock | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0) continue;

    const firstCell = row[0].trim();

    // Check for store header (e.g., "Hinnawi Bros (Mackay) - 2023042001")
    if (firstCell.startsWith("Hinnawi Bros")) {
      if (currentBlock) blocks.push(currentBlock);

      // Extract Koomi ID from the header
      const idMatch = firstCell.match(/(\d{10,})/);
      const koomiId = idMatch ? idMatch[1] : "";

      // Map store name to DB location
      const nameMatch = firstCell.match(/^(Hinnawi Bros \([^)]+\))/);
      const storeName = nameMatch ? nameMatch[1] : firstCell;
      const dbLocationId = KOOMI_NAME_MAP[storeName] || 0;

      currentBlock = {
        storeName,
        koomiId,
        dbLocationId,
        dates: [],
        rows: [],
      };
      continue;
    }

    // Check for separator
    if (firstCell === "---") {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = null;
      continue;
    }

    if (!currentBlock) continue;

    // Check for date row
    if (row.some(cell => /^\d{4}-\d{2}-\d{2}$/.test(cell.trim()))) {
      currentBlock.dates = row.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.trim()));
      continue;
    }

    // Data row
    if (firstCell.startsWith("Total ")) {
      currentBlock.rows.push({
        label: firstCell,
        values: row.slice(1),
      });
    }
  }

  if (currentBlock) blocks.push(currentBlock);
  return blocks;
}

/**
 * Parse the Breakdown Onsite report HTML into product-level data.
 */
export interface BreakdownItem {
  itemName: string;
  category: string;
  group: string;
  totalRevenue: number;
  quantitySold: number;
  quantityRefunded: number;
}

export interface BreakdownStoreBlock {
  storeName: string;
  dbLocationId: number;
  dateRange: { from: string; to: string };
  items: BreakdownItem[];
}

function parseBreakdownHtml(html: string): BreakdownStoreBlock[] {
  const rows = extractTableRows(html);
  const blocks: BreakdownStoreBlock[] = [];
  let currentBlock: BreakdownStoreBlock | null = null;
  let headerFound = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0) continue;

    const firstCell = row[0].trim();

    // Store header
    if (firstCell.startsWith("Hinnawi Bros")) {
      if (currentBlock && currentBlock.items.length > 0) blocks.push(currentBlock);
      const nameMatch = firstCell.match(/^(Hinnawi Bros \([^)]+\))/);
      const storeName = nameMatch ? nameMatch[1] : firstCell;
      currentBlock = {
        storeName,
        dbLocationId: KOOMI_NAME_MAP[storeName] || 0,
        dateRange: { from: "", to: "" },
        items: [],
      };
      headerFound = false;
      continue;
    }

    if (!currentBlock) continue;

    // Date range row (e.g., "2026-03-16 00:00:00 to 2026-03-16 23:59:59")
    if (firstCell.includes(" to ") && firstCell.match(/\d{4}-\d{2}-\d{2}/)) {
      const dateMatches = firstCell.match(/(\d{4}-\d{2}-\d{2})/g);
      if (dateMatches && dateMatches.length >= 2) {
        currentBlock.dateRange = { from: dateMatches[0], to: dateMatches[1] };
      } else if (dateMatches && dateMatches.length === 1) {
        currentBlock.dateRange = { from: dateMatches[0], to: dateMatches[0] };
      }
      continue;
    }

    // Header row (ITEMS | CATEGORY | GROUP | TOTALS | QUANTITY SOLD | QUANTITY REFUNDED)
    if (firstCell === "ITEMS") {
      headerFound = true;
      continue;
    }

    // Skip summary/total rows
    if (firstCell.startsWith("Total ") || firstCell === "SUMMARY" || firstCell === "DETAILS" || firstCell === "") continue;

    // Data rows (after header)
    if (headerFound && row.length >= 6) {
      const item: BreakdownItem = {
        itemName: row[0].trim(),
        category: row[1]?.trim() || "",
        group: row[2]?.trim() || "",
        totalRevenue: parseNumber(row[3] || "0"),
        quantitySold: Math.round(parseNumber(row[4] || "0")),
        quantityRefunded: Math.round(parseNumber(row[5] || "0")),
      };
      if (item.itemName && item.itemName !== "---") {
        currentBlock.items.push(item);
      }
    }
  }

  if (currentBlock && currentBlock.items.length > 0) blocks.push(currentBlock);
  return blocks;
}

/**
 * Basic HTML table row extractor.
 * Returns array of rows, each row is array of cell text content.
 */
function extractTableRows(html: string): string[][] {
  const rows: string[][] = [];
  // Match each <tr>...</tr>
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1];
    const cells: string[] = [];
    // Match each <td> or <th>
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      // Strip HTML tags from cell content
      const text = cellMatch[1].replace(/<[^>]+>/g, "").trim();
      cells.push(text);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

// ─── Public API ───

export interface DailySalesRecord {
  locationId: number;
  saleDate: string;
  taxExemptSales: string;
  taxableSales: string;
  totalSales: string;
  gstCollected: string;
  qstCollected: string;
  totalDeposit: string;
  tipsCollected: string;
  labourCost: string;
  orderCount: number;
}

/**
 * Fetch Net Onsite Sales for a date range, per store.
 * Returns structured daily sales records ready for DB upsert.
 */
export async function fetchNetOnsiteSales(fromDate: string, toDate: string): Promise<DailySalesRecord[]> {
  console.log(`[Koomi] Fetching Net Onsite Sales: ${fromDate} to ${toDate}`);

  const locationIds = Object.keys(KOOMI_STORE_MAP);
  const html = await fetchReportHtml({
    orderType: "net",
    fromDate,
    toDate,
    consolidated: true,
    locationIds,
  });

  const storeBlocks = parseNetPerStoreHtml(html);

  // If consolidated returned (no per-store blocks), try per-store individually
  if (storeBlocks.length === 0) {
    // Fetch per-store separately
    const records: DailySalesRecord[] = [];
    for (const locId of locationIds) {
      const storeHtml = await fetchReportHtml({
        orderType: "net",
        fromDate,
        toDate,
        consolidated: true,
        locationIds: [locId],
      });
      const blocks = parseNetPerStoreHtml(storeHtml);
      if (blocks.length === 0) {
        // Try consolidated format
        const parsed = parseNetConsolidatedHtml(storeHtml);
        const store = KOOMI_STORE_MAP[locId];
        if (parsed.dates.length > 0 && store) {
          records.push(...buildDailySalesFromConsolidated(parsed, store.dbLocationId));
        }
      } else {
        records.push(...buildDailySalesFromBlocks(blocks));
      }
    }
    return records;
  }

  return buildDailySalesFromBlocks(storeBlocks);
}

function buildDailySalesFromBlocks(blocks: ParsedStoreBlock[]): DailySalesRecord[] {
  const records: DailySalesRecord[] = [];

  for (const block of blocks) {
    if (block.dbLocationId === 0) {
      console.warn(`[Koomi] Unknown store: ${block.storeName}`);
      continue;
    }

    const getRow = (label: string) => block.rows.find(r => r.label.includes(label));

    const taxExemptRow = getRow("Tax Exempt");
    const taxableRow = getRow("Taxable");
    const netSalesRow = getRow("Total Net Sales");
    const ordersRow = getRow("Completed Orders");
    const tipsRow = getRow("Tips");
    const salariesRow = getRow("Salaries Paid");
    const cashRow = getRow("Cash Payments");

    for (let d = 0; d < block.dates.length; d++) {
      const date = block.dates[d];
      const totalNet = parseNumber(netSalesRow?.values[d] || "0");
      const taxExempt = parseNumber(taxExemptRow?.values[d] || "0");
      const taxable = parseNumber(taxableRow?.values[d] || "0");
      const orders = Math.round(parseNumber(ordersRow?.values[d] || "0"));
      const tips = parseNumber(tipsRow?.values[d] || "0");
      const salaries = parseNumber(salariesRow?.values[d] || "0");

      // Estimate GST/QST from taxable sales (5% GST, 9.975% QST for Quebec)
      const gst = taxable * 0.05;
      const qst = taxable * 0.09975;
      const totalDeposit = totalNet + gst + qst;

      // totalSales = taxExempt + taxable (the full net revenue)
      const correctTotalSales = taxExempt + taxable;

      records.push({
        locationId: block.dbLocationId,
        saleDate: date,
        taxExemptSales: taxExempt.toFixed(2),
        taxableSales: taxable.toFixed(2),
        totalSales: correctTotalSales.toFixed(2),
        gstCollected: gst.toFixed(2),
        qstCollected: qst.toFixed(2),
        totalDeposit: totalDeposit.toFixed(2),
        tipsCollected: tips.toFixed(2),
        labourCost: salaries.toFixed(2),
        orderCount: orders,
      });
    }
  }

  return records;
}

function buildDailySalesFromConsolidated(
  parsed: { dates: string[]; rows: ParsedRow[] },
  locationId: number
): DailySalesRecord[] {
  const records: DailySalesRecord[] = [];
  const getRow = (label: string) => parsed.rows.find(r => r.label.includes(label));

  const taxExemptRow = getRow("Tax Exempt");
  const taxableRow = getRow("Taxable");
  const netSalesRow = getRow("Total Net Sales");
  const ordersRow = getRow("Completed Orders");
  const tipsRow = getRow("Tips");
  const salariesRow = getRow("Salaries Paid");

  for (let d = 0; d < parsed.dates.length; d++) {
    const date = parsed.dates[d];
    const totalNet = parseNumber(netSalesRow?.values[d] || "0");
    const taxExempt = parseNumber(taxExemptRow?.values[d] || "0");
    const taxable = parseNumber(taxableRow?.values[d] || "0");
    const orders = Math.round(parseNumber(ordersRow?.values[d] || "0"));
    const tips = parseNumber(tipsRow?.values[d] || "0");
    const salaries = parseNumber(salariesRow?.values[d] || "0");

    const gst = taxable * 0.05;
    const qst = taxable * 0.09975;
    const totalDeposit = totalNet + gst + qst;

    // totalSales = taxExempt + taxable (the full net revenue)
    const correctTotalSales = taxExempt + taxable;

    records.push({
      locationId,
      saleDate: date,
      taxExemptSales: taxExempt.toFixed(2),
      taxableSales: taxable.toFixed(2),
      totalSales: correctTotalSales.toFixed(2),
      gstCollected: gst.toFixed(2),
      qstCollected: qst.toFixed(2),
      totalDeposit: totalDeposit.toFixed(2),
      tipsCollected: tips.toFixed(2),
      labourCost: salaries.toFixed(2),
      orderCount: orders,
    });
  }

  return records;
}

/**
 * Fetch Breakdown Onsite report for product-level sales data.
 */
export async function fetchBreakdownOnsiteSales(fromDate: string, toDate: string): Promise<BreakdownStoreBlock[]> {
  console.log(`[Koomi] Fetching Breakdown Onsite: ${fromDate} to ${toDate}`);

  const locationIds = Object.keys(KOOMI_STORE_MAP);
  const allBlocks: BreakdownStoreBlock[] = [];

  // Fetch per-store to get individual breakdowns
  for (const locId of locationIds) {
    const html = await fetchReportHtml({
      orderType: "breakdown",
      fromDate,
      toDate,
      consolidated: false,
      locationIds: [locId],
    });

    const blocks = parseBreakdownHtml(html);
    for (const block of blocks) {
      if (block.dbLocationId === 0) {
        // Try to map from locId
        const store = KOOMI_STORE_MAP[locId];
        if (store) block.dbLocationId = store.dbLocationId;
      }
      if (block.dateRange.from === "") {
        block.dateRange = { from: fromDate, to: toDate };
      }
      allBlocks.push(block);
    }
  }

  return allBlocks;
}

/**
 * Convert breakdown blocks to productSales records for DB upsert.
 */
export function breakdownToProductSalesRows(blocks: BreakdownStoreBlock[]) {
  const rows: Array<{
    locationId: number;
    periodStart: string;
    periodEnd: string;
    section: "items" | "options";
    itemName: string;
    category: string;
    groupName: string;
    totalRevenue: string;
    quantitySold: number;
    quantityRefunded: number;
  }> = [];

  for (const block of blocks) {
    for (const item of block.items) {
      rows.push({
        locationId: block.dbLocationId,
        periodStart: block.dateRange.from,
        periodEnd: block.dateRange.to,
        section: "items",
        itemName: item.itemName,
        category: item.category,
        groupName: item.group,
        totalRevenue: item.totalRevenue.toFixed(2),
        quantitySold: item.quantitySold,
        quantityRefunded: item.quantityRefunded,
      });
    }
  }

  return rows;
}

/**
 * Test connection to Koomi admin.
 */
export async function testConnection(): Promise<{
  connected: boolean;
  accountName?: string;
  stores?: Array<{ koomiId: string; name: string; code: string }>;
  error?: string;
}> {
  try {
    await login();
    return {
      connected: true,
      accountName: "Hinnawi Bros — Account #52",
      stores: Object.values(KOOMI_STORE_MAP).map(s => ({
        koomiId: s.koomiId,
        name: s.name,
        code: s.code,
      })),
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || "Unknown error",
    };
  }
}

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Get yesterday's date string.
 */
export function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

/**
 * Get today's date string.
 */
export function getToday(): string {
  return formatDate(new Date());
}
