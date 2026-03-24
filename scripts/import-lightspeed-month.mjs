/**
 * Parse Lightspeed L-Series "RESTAURANT SUMMARY MONTH REPORT" CSV
 * and import daily sales into the dailySales table for Ontario (locationId=3).
 *
 * Usage: node scripts/import-lightspeed-month.mjs <csv_file_path>
 *
 * The CSV format has:
 *  - Header section (company info, totals, taxable sales, payments)
 *  - "DAY REVENUES:" section with daily breakdown
 *  - Each day has 1 main row + 2 tax rows (T.P.S = GST 5%, T.V.Q = QST 9.975%)
 *  - Main row: DAY, STARTS, ENDS AT, # tickets, TOTAL, then first tax line
 *  - Tax continuation rows: empty first cols, then TAXE NAME, TAXE RATE, NET REVENUE, TAXE, TOTAL REVENUE
 */
import fs from 'fs';
import mysql from 'mysql2/promise';

const ONTARIO_LOCATION_ID = 3;

function parseLightspeedMonthReport(csvContent) {
  const lines = csvContent.split('\n');
  const days = [];

  // Find the "DAY REVENUES:" section
  let dayRevenuesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('DAY REVENUES:')) {
      dayRevenuesStart = i;
      break;
    }
  }

  if (dayRevenuesStart === -1) {
    throw new Error('Could not find "DAY REVENUES:" section in CSV');
  }

  // Skip the header row (DAY, STARTS, ENDS AT, #, TOTAL, TAXE NAME, ...)
  let i = dayRevenuesStart + 2; // +1 for header, +1 for first data row

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }

    // Parse CSV fields (handle quoted values)
    const fields = parseCSVLine(line);

    // A day's main row starts with a number (day of month)
    const dayNum = parseInt(fields[0]);
    if (isNaN(dayNum)) { i++; continue; }

    // Extract: STARTS date, # tickets, TOTAL revenue
    const startDate = fields[1]?.trim(); // e.g. "25-01-03 00:00"
    const tickets = parseInt(fields[3]) || 0;
    const totalRevenue = parseFloat(fields[4]) || 0;

    // Parse the date from STARTS field: "25-01-03 00:00" -> "2025-01-03"
    let saleDate = '';
    if (startDate) {
      const datePart = startDate.split(' ')[0]; // "25-01-03"
      const parts = datePart.split('-');
      if (parts.length === 3) {
        const year = parts[0].length === 2 ? '20' + parts[0] : parts[0];
        saleDate = `${year}-${parts[1]}-${parts[2]}`;
      }
    }

    // Now collect tax breakdown from this row and continuation rows
    let gst = 0;
    let qst = 0;
    let noTaxNet = 0;

    // First tax info is on the same row (fields 5-9)
    const taxName1 = fields[5]?.trim() || '';
    const netRev1 = parseFloat(fields[7]) || 0;
    const taxAmt1 = parseFloat(fields[8]) || 0;

    if (taxName1 === 'No Tax') noTaxNet = netRev1;
    else if (taxName1 === 'T.P.S') gst = taxAmt1;
    else if (taxName1 === 'T.V.Q') qst = taxAmt1;

    // Read continuation rows (lines starting with comma / empty first field)
    i++;
    while (i < lines.length) {
      const nextLine = lines[i].trim();
      if (!nextLine) { i++; continue; }

      const nextFields = parseCSVLine(nextLine);
      // Continuation rows have empty first field (day number)
      if (nextFields[0]?.trim() !== '') break;

      const taxName = nextFields[5]?.trim() || '';
      const netRev = parseFloat(nextFields[7]) || 0;
      const taxAmt = parseFloat(nextFields[8]) || 0;

      if (taxName === 'No Tax') noTaxNet = netRev;
      else if (taxName === 'T.P.S') gst = taxAmt;
      else if (taxName === 'T.V.Q') qst = taxAmt;

      i++;
    }

    // Only add days with actual sales
    if (saleDate) {
      // Net sales = total revenue - GST - QST (i.e. tax-exempt + taxable net)
      const netSales = totalRevenue - gst - qst;
      days.push({
        saleDate,
        totalSales: totalRevenue.toFixed(2),
        taxExemptSales: noTaxNet.toFixed(2),
        taxableSales: (netSales - noTaxNet).toFixed(2),
        gstCollected: gst.toFixed(2),
        qstCollected: qst.toFixed(2),
        orderCount: tickets,
        totalDeposit: totalRevenue.toFixed(2),
      });
    }
  }

  return days;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/import-lightspeed-month.mjs <csv_file_path>');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const days = parseLightspeedMonthReport(csvContent);

  console.log(`Parsed ${days.length} days from Lightspeed report`);

  // Show summary
  const totalSales = days.reduce((s, d) => s + parseFloat(d.totalSales), 0);
  const totalGst = days.reduce((s, d) => s + parseFloat(d.gstCollected), 0);
  const totalQst = days.reduce((s, d) => s + parseFloat(d.qstCollected), 0);
  const totalOrders = days.reduce((s, d) => s + d.orderCount, 0);

  console.log(`Total Sales: $${totalSales.toFixed(2)}`);
  console.log(`Total GST: $${totalGst.toFixed(2)}`);
  console.log(`Total QST: $${totalQst.toFixed(2)}`);
  console.log(`Total Orders: ${totalOrders}`);
  console.log(`Date Range: ${days[0]?.saleDate} to ${days[days.length - 1]?.saleDate}`);
  console.log('');

  // Print each day
  for (const d of days) {
    const sales = parseFloat(d.totalSales);
    if (sales > 0) {
      console.log(`  ${d.saleDate}: $${d.totalSales} (${d.orderCount} orders, GST: $${d.gstCollected}, QST: $${d.qstCollected})`);
    }
  }

  // Connect to database and upsert
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  let inserted = 0;
  let updated = 0;

  for (const day of days) {
    // Check if record exists
    const [existing] = await conn.execute(
      'SELECT id FROM dailySales WHERE locationId = ? AND saleDate = ?',
      [ONTARIO_LOCATION_ID, day.saleDate]
    );

    if (existing.length > 0) {
      // Update existing record
      await conn.execute(
        `UPDATE dailySales SET 
          totalSales = ?, taxExemptSales = ?, taxableSales = ?,
          gstCollected = ?, qstCollected = ?, orderCount = ?, totalDeposit = ?
        WHERE locationId = ? AND saleDate = ?`,
        [
          day.totalSales, day.taxExemptSales, day.taxableSales,
          day.gstCollected, day.qstCollected, day.orderCount, day.totalDeposit,
          ONTARIO_LOCATION_ID, day.saleDate
        ]
      );
      updated++;
    } else {
      // Insert new record
      await conn.execute(
        `INSERT INTO dailySales (locationId, saleDate, totalSales, taxExemptSales, taxableSales, gstCollected, qstCollected, orderCount, totalDeposit, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          ONTARIO_LOCATION_ID, day.saleDate, day.totalSales, day.taxExemptSales,
          day.taxableSales, day.gstCollected, day.qstCollected, day.orderCount, day.totalDeposit
        ]
      );
      inserted++;
    }
  }

  console.log(`\nImport complete: ${inserted} inserted, ${updated} updated`);
  await conn.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
