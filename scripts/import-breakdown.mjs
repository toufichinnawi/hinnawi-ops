import mysql from 'mysql2/promise';
import fs from 'fs';

const csvPath = process.argv[2] || '/home/ubuntu/upload/Breakdown_Onsite-20250101_000000-20250131_235959(1).csv';
const locationId = parseInt(process.argv[3] || '2'); // Default: Mackay = 2

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n');

  const dateRangeLine = lines[1]?.replace(/"/g, '').trim() || '';
  const dateMatch = dateRangeLine.match(/(\d{4}-\d{2}-\d{2}).*to.*(\d{4}-\d{2}-\d{2})/);
  const periodStart = dateMatch?.[1] || '';
  const periodEnd = dateMatch?.[2] || '';
  console.log(`Period: ${periodStart} to ${periodEnd}, Location: ${locationId}`);

  let section = 'items';
  let inData = false;
  let inserted = 0;

  function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { fields.push(current); current = ''; }
      else current += ch;
    }
    fields.push(current);
    return fields;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('ITEMS,CATEGORY,GROUP,TOTALS')) {
      section = 'items';
      inData = true;
      continue;
    }
    if (line.startsWith('OPTIONS,GROUP')) {
      section = 'options';
      inData = true;
      continue;
    }

    if (!inData) continue;

    const fields = parseCSVLine(line);
    const itemName = fields[0]?.trim();
    if (!itemName) continue;

    const category = fields[1]?.trim() || null;
    const groupName = section === 'items' ? (fields[2]?.trim() || null) : null;
    const totalStr = (fields[3] || '0').replace(/,/g, '').trim();
    const total = parseFloat(totalStr) || 0;
    const qtySold = parseInt(fields[4]) || 0;
    const qtyRefunded = parseInt(fields[5]) || 0;

    await conn.execute(
      `INSERT INTO productSales (locationId, periodStart, periodEnd, section, itemName, category, groupName, totalRevenue, quantitySold, quantityRefunded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE totalRevenue = VALUES(totalRevenue), quantitySold = VALUES(quantitySold), quantityRefunded = VALUES(quantityRefunded)`,
      [locationId, periodStart, periodEnd, section, itemName, category, groupName, total.toFixed(2), qtySold, qtyRefunded]
    );
    inserted++;
  }

  console.log(`Inserted: ${inserted} rows`);

  const [rows] = await conn.execute('SELECT COUNT(*) as cnt, SUM(totalRevenue) as total FROM productSales WHERE locationId = ?', [locationId]);
  console.log('Total in DB:', rows[0]);

  await conn.end();
}

main().catch(console.error);
