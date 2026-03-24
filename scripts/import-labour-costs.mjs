import fs from 'fs';
import mysql from 'mysql2/promise';

// Location mapping from CSV names to DB location IDs
const LOCATION_MAP = {
  'Mackay': 2,
  'Cathcart': 4,
  'President Kennedy': 1,
};

/**
 * Parse a CSV line handling quoted fields with commas inside
 * e.g. "1,003.91" should be treated as a single value
 */
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

function parseNumericValue(val) {
  if (!val || val.trim() === '' || val.trim() === '---') return null;
  // Remove any remaining commas from numbers like "1,003.91"
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function extractLocationName(headerRow) {
  const name = headerRow.trim();
  const match = name.match(/Hinnawi Bros \(([^)]+)\)/);
  return match ? match[1] : null;
}

function parseKoomiCSV(filePath) {
  console.log(`\nParsing: ${filePath}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  // Remove BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');
  const lines = cleanContent.split('\n');
  
  const rows = lines.map(line => parseCSVLine(line.replace(/\r$/, '')));
  
  // Extract the date header row (row index 1)
  const dateRow = rows[1];
  
  // Build date groups (separated by empty cells)
  const dateGroups = [];
  let currentGroup = [];
  for (let i = 1; i < dateRow.length; i++) {
    const val = dateRow[i] ? dateRow[i].trim() : '';
    if (val === '' && currentGroup.length > 0) {
      dateGroups.push(currentGroup);
      currentGroup = [];
    } else if (val && val.match(/^\d{4}-\d{2}-\d{2}$/)) {
      currentGroup.push({ colIdx: i, date: val });
    }
  }
  if (currentGroup.length > 0) {
    dateGroups.push(currentGroup);
  }
  
  // Flatten all dates with their column indices
  const allDates = [];
  for (const group of dateGroups) {
    for (const entry of group) {
      allDates.push(entry);
    }
  }
  
  console.log(`  Found ${dateGroups.length} day-of-week groups, ${allDates.length} total date columns`);
  
  // Parse each location block
  const results = [];
  let currentLocation = null;
  let currentLocationId = null;
  
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const label = row[0] ? row[0].trim() : '';
    
    // Check if this is a location header
    if (label.startsWith('Hinnawi Bros (')) {
      currentLocation = extractLocationName(label);
      currentLocationId = currentLocation ? LOCATION_MAP[currentLocation] : null;
      if (currentLocation) {
        console.log(`  Location: ${currentLocation} -> ID ${currentLocationId}`);
      }
      continue;
    }
    
    if (!currentLocationId) continue;
    
    // Parse "Total Salaries Paid" row
    if (label === 'Total Salaries Paid') {
      let count = 0;
      for (const { colIdx, date } of allDates) {
        const val = parseNumericValue(row[colIdx]);
        if (val !== null && val > 0) {
          let entry = results.find(r => r.locationId === currentLocationId && r.date === date);
          if (!entry) {
            entry = { locationId: currentLocationId, date, labourCost: 0, orderCount: 0 };
            results.push(entry);
          }
          entry.labourCost = val;
          count++;
        }
      }
      console.log(`    Total Salaries Paid: ${count} non-zero values`);
    }
    
    // Parse "Total Number of Completed Orders" row
    if (label === 'Total Number of Completed Orders') {
      let count = 0;
      for (const { colIdx, date } of allDates) {
        const val = parseNumericValue(row[colIdx]);
        if (val !== null && val > 0) {
          let entry = results.find(r => r.locationId === currentLocationId && r.date === date);
          if (!entry) {
            entry = { locationId: currentLocationId, date, labourCost: 0, orderCount: 0 };
            results.push(entry);
          }
          entry.orderCount = Math.round(val);
          count++;
        }
      }
      console.log(`    Total Orders: ${count} non-zero values`);
    }
    
    // Reset location on separator
    if (label === '---') {
      currentLocation = null;
      currentLocationId = null;
    }
  }
  
  return results;
}

async function main() {
  // Parse both CSV files
  const data2025 = parseKoomiCSV('/home/ubuntu/upload/Net_Onsite_Consolidated-20250101_000000-20251231_235959.csv');
  const data2026 = parseKoomiCSV('/home/ubuntu/upload/Net_Onsite_Consolidated-20260101_000000-20260313_235959.csv');
  
  const allData = [...data2025, ...data2026];
  
  console.log(`\nTotal records to update: ${allData.length}`);
  
  // Summary by location
  const summary = {};
  for (const d of allData) {
    if (!summary[d.locationId]) {
      summary[d.locationId] = { count: 0, totalLabour: 0, totalOrders: 0, minDate: d.date, maxDate: d.date };
    }
    summary[d.locationId].count++;
    summary[d.locationId].totalLabour += d.labourCost;
    summary[d.locationId].totalOrders += d.orderCount;
    if (d.date < summary[d.locationId].minDate) summary[d.locationId].minDate = d.date;
    if (d.date > summary[d.locationId].maxDate) summary[d.locationId].maxDate = d.date;
  }
  
  console.log('\nSummary by location:');
  for (const [locId, s] of Object.entries(summary)) {
    console.log(`  Location ${locId}: ${s.count} records, $${s.totalLabour.toFixed(2)} total labour, ${s.totalOrders} total orders, ${s.minDate} to ${s.maxDate}`);
  }
  
  // Connect to DB and update
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  
  const updateStmt = `
    UPDATE dailySales 
    SET labourCost = ?, orderCount = ?
    WHERE locationId = ? AND saleDate = ?
  `;
  
  for (const record of allData) {
    try {
      const [result] = await conn.execute(updateStmt, [
        record.labourCost.toFixed(2),
        record.orderCount,
        record.locationId,
        record.date,
      ]);
      if (result.affectedRows > 0) {
        updated++;
      } else {
        notFound++;
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error updating ${record.date} loc ${record.locationId}: ${err.message}`);
      }
    }
  }
  
  console.log(`\nUpdate results:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Not found (no matching dailySales record): ${notFound}`);
  console.log(`  Errors: ${errors}`);
  
  // Verify
  const [verify] = await conn.execute(`
    SELECT locationId, COUNT(*) as cnt, 
      SUM(CAST(labourCost AS DECIMAL(12,2))) as totalLabour,
      SUM(orderCount) as totalOrders,
      COUNT(CASE WHEN CAST(labourCost AS DECIMAL(12,2)) > 0 THEN 1 END) as withLabour
    FROM dailySales GROUP BY locationId
  `);
  console.log('\nVerification:');
  console.log(JSON.stringify(verify, null, 2));
  
  await conn.end();
}

main().catch(console.error);
