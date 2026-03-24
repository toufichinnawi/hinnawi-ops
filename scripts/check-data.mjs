import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [locations] = await conn.execute('SELECT id, name, code FROM locations');
  console.log('Locations:', JSON.stringify(locations, null, 2));
  
  const [sales] = await conn.execute(`
    SELECT locationId, COUNT(*) as cnt, 
      SUM(CAST(labourCost AS DECIMAL(12,2))) as totalLabour,
      MIN(saleDate) as minDate, MAX(saleDate) as maxDate
    FROM dailySales GROUP BY locationId
  `);
  console.log('Sales summary:', JSON.stringify(sales, null, 2));
  
  await conn.end();
}

main().catch(console.error);
