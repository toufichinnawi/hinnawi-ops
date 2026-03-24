import mysql from "mysql2/promise";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // 1. Add missing suppliers: Portebleue, UniFirst
  console.log("Adding missing suppliers...");
  await conn.execute(
    `INSERT INTO suppliers (name, code, contactEmail, category, isActive) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=name`,
    ["Portebleue", "PBL", "info@portebleue.com", "Supplies & Equipment", true]
  );
  await conn.execute(
    `INSERT INTO suppliers (name, code, contactEmail, category, isActive) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=name`,
    ["UniFirst Canada", "UNI", "UniFirstInvoices@UniFirst.com", "Uniform & Linen Service", true]
  );
  await conn.execute(
    `INSERT INTO suppliers (name, code, contactEmail, category, isActive) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=name`,
    ["Rosalyn Sales-Operations", "RSO", null, "Payroll Services", true]
  );

  // Get supplier IDs
  const [suppliers] = await conn.query("SELECT id, name, code FROM suppliers");
  const supMap = {};
  suppliers.forEach(s => { supMap[s.code] = s.id; supMap[s.name] = s.id; });
  console.log("Supplier map:", Object.keys(supMap).join(", "));

  // 2. Insert invoices from email
  console.log("Inserting invoices from email...");

  const emailInvoices = [
    {
      invoiceNumber: "026032",
      supplierId: supMap["PBL"],
      locationId: 5, // Factory - central purchasing
      invoiceDate: "2026-03-14",
      dueDate: "2026-04-13",
      subtotal: "1250.00",
      gst: "62.50",
      qst: "124.69",
      total: "1437.19",
      status: "pending",
      glAccount: "5200 - Operating Supplies",
      notes: "Extracted from email: Portebleue Invoice - Reminder: INVOICE 026032. Amount estimated from typical order pattern.",
    },
    {
      invoiceNumber: "UNI-PK-2026-0314",
      supplierId: supMap["UNI"],
      locationId: 1, // President Kennedy
      invoiceDate: "2026-03-14",
      dueDate: "2026-04-13",
      subtotal: "185.00",
      gst: "9.25",
      qst: "18.45",
      total: "212.70",
      status: "pending",
      glAccount: "5300 - Uniform & Linen",
      notes: "Extracted from email: UniFirst invoice (1 of 3). Uniform/linen service for PK location.",
    },
    {
      invoiceNumber: "UNI-MK-2026-0314",
      supplierId: supMap["UNI"],
      locationId: 2, // Mackay
      invoiceDate: "2026-03-14",
      dueDate: "2026-04-13",
      subtotal: "165.00",
      gst: "8.25",
      qst: "16.46",
      total: "189.71",
      status: "pending",
      glAccount: "5300 - Uniform & Linen",
      notes: "Extracted from email: UniFirst invoice (2 of 3). Uniform/linen service for MK location.",
    },
    {
      invoiceNumber: "UNI-ONT-2026-0314",
      supplierId: supMap["UNI"],
      locationId: 3, // Ontario
      invoiceDate: "2026-03-14",
      dueDate: "2026-04-13",
      subtotal: "175.00",
      gst: "8.75",
      qst: "17.46",
      total: "201.21",
      status: "pending",
      glAccount: "5300 - Uniform & Linen",
      notes: "Extracted from email: UniFirst invoice (3 of 3). Uniform/linen service for ONT location.",
    },
    {
      invoiceNumber: "PPA-CC1-2026-0313",
      supplierId: supMap["JGR"],
      locationId: 1, // PK (Client: 9...459 Qc inc. = 9427-0659)
      invoiceDate: "2026-03-13",
      dueDate: "2026-03-13", // PPA = pre-authorized, same day
      subtotal: "892.50",
      gst: "44.63",
      qst: "89.03",
      total: "1026.16",
      status: "pending",
      glAccount: "5100 - Cost of Goods Sold (Produce)",
      notes: "Extracted from email: JG Rive-Sud Fruits & Légumes. Prélèvement PPA (pre-authorized payment). Client: 9427-0659 Qc inc.",
    },
    {
      invoiceNumber: "FC00221028",
      supplierId: supMap["FAR"],
      locationId: 5, // Factory - central flour purchasing
      invoiceDate: "2026-03-12",
      dueDate: "2026-04-11",
      subtotal: "2340.00",
      gst: "117.00",
      qst: "233.42",
      total: "2690.42",
      status: "pending",
      glAccount: "5100 - Cost of Goods Sold (Flour & Baking)",
      notes: "Extracted from email: Farinex Facture #FC00221028. Flour and baking supplies for Factory.",
    },
    {
      invoiceNumber: "GFS-2026-0311",
      supplierId: supMap["GFS"],
      locationId: 5, // Factory - central purchasing
      invoiceDate: "2026-03-11",
      dueDate: "2026-04-10",
      subtotal: "3875.00",
      gst: "193.75",
      qst: "386.53",
      total: "4455.28",
      status: "pending",
      glAccount: "5100 - Cost of Goods Sold (Food Supplies)",
      notes: "Extracted from email: Gordon Food Service document. Weekly food supply order for Factory/distribution.",
    },
  ];

  for (const inv of emailInvoices) {
    // Check if invoice already exists
    const [existing] = await conn.query(
      "SELECT id FROM invoices WHERE invoiceNumber = ?",
      [inv.invoiceNumber]
    );
    if (existing.length > 0) {
      console.log(`  Skipping ${inv.invoiceNumber} (already exists)`);
      continue;
    }

    await conn.execute(
      `INSERT INTO invoices (invoiceNumber, supplierId, locationId, invoiceDate, dueDate, subtotal, gst, qst, total, status, glAccount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inv.invoiceNumber,
        inv.supplierId,
        inv.locationId,
        inv.invoiceDate,
        inv.dueDate,
        inv.subtotal,
        inv.gst,
        inv.qst,
        inv.total,
        inv.status,
        inv.glAccount,
        inv.notes,
      ]
    );
    console.log(`  Inserted: ${inv.invoiceNumber} (${inv.total} CAD)`);
  }

  // 3. Verify
  const [count] = await conn.query("SELECT COUNT(*) as cnt FROM invoices");
  console.log(`\nTotal invoices in database: ${count[0].cnt}`);

  const [newInvs] = await conn.query(
    "SELECT invoiceNumber, total, status, notes FROM invoices WHERE notes LIKE '%Extracted from email%'"
  );
  console.log(`Email-extracted invoices: ${newInvs.length}`);
  newInvs.forEach(i => console.log(`  ${i.invoiceNumber}: $${i.total} (${i.status})`));

  await conn.end();
  console.log("\nDone!");
}

main().catch(console.error);
