/**
 * Batch Invoice Processing Script
 * 
 * Reads the manifest.json, processes each PDF with AI,
 * creates invoice records in DB with deduplication,
 * uploads PDFs to S3, and triggers cost pipeline.
 * 
 * Usage: node server/batchProcess.mjs [--start N] [--limit N] [--dry-run]
 */

import fs from "fs";
import path from "path";

// Parse args
const args = process.argv.slice(2);
const startIdx = parseInt(args.find((_, i) => args[i - 1] === "--start") || "0");
const limit = parseInt(args.find((_, i) => args[i - 1] === "--limit") || "999999");
const dryRun = args.includes("--dry-run");

// Load env
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || "";
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!FORGE_API_URL || !FORGE_API_KEY) {
  console.error("Missing BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY");
  process.exit(1);
}

// ─── LLM Helper ───
async function invokeLLM(messages, responseFormat) {
  const url = `${FORGE_API_URL.replace(/\/+$/, "")}/v1/chat/completions`;
  const payload = {
    model: "gemini-2.5-flash",
    messages,
    max_tokens: 32768,
    thinking: { budget_tokens: 128 },
  };
  if (responseFormat) payload.response_format = responseFormat;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${FORGE_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${err}`);
  }
  return await resp.json();
}

// ─── S3 Upload Helper ───
async function uploadToS3(fileBuffer, relKey, contentType = "application/pdf") {
  const baseUrl = FORGE_API_URL.replace(/\/+$/, "");
  const uploadUrl = new URL("v1/storage/upload", baseUrl + "/");
  uploadUrl.searchParams.set("path", relKey);

  const blob = new Blob([fileBuffer], { type: contentType });
  const form = new FormData();
  form.append("file", blob, relKey.split("/").pop());

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${FORGE_API_KEY}` },
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`S3 upload failed: ${resp.status} ${err}`);
  }
  return (await resp.json()).url;
}

// ─── DB Helper (direct MySQL) ───
import mysql from "mysql2/promise";

let dbPool;
async function getPool() {
  if (!dbPool) {
    dbPool = mysql.createPool({
      uri: DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return dbPool;
}

async function query(sql, params = []) {
  const pool = await getPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ─── Check for duplicates ───
async function isDuplicate(invoiceNumber, supplierId) {
  if (!invoiceNumber) return false;
  const rows = await query(
    "SELECT id FROM invoices WHERE invoiceNumber = ? AND supplierId = ? LIMIT 1",
    [invoiceNumber, supplierId]
  );
  return rows.length > 0;
}

// ─── Create invoice record ───
async function createInvoice(data) {
  const result = await query(
    `INSERT INTO invoices (supplierId, locationId, invoiceNumber, invoiceDate, dueDate, 
     subtotal, gst, qst, total, status, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      data.supplierId,
      data.locationId,
      data.invoiceNumber,
      data.invoiceDate,
      data.dueDate,
      data.subtotal || 0,
      data.gst || 0,
      data.qst || 0,
      data.totalAmount || 0,
      "pending",
      data.notes || `Batch imported from: ${data.sourceFile}`,
    ]
  );
  return result.insertId;
}

// ─── Create line items ───
async function createLineItems(invoiceId, lineItems) {
  if (!lineItems || lineItems.length === 0) return;
  
  for (const item of lineItems) {
    await query(
      `INSERT INTO invoiceLineItems (invoiceId, description, productCode, quantity, unitPrice, amount, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        invoiceId,
        item.description || "",
        item.productCode || null,
        item.quantity || 0,
        item.unitPrice || 0,
        item.amount || 0,
      ]
    );
  }
}

// ─── Update invoice file URL ───
async function updateInvoiceFile(invoiceId, fileUrl, fileKey) {
  await query(
    "UPDATE invoices SET fileUrl = ?, fileKey = ? WHERE id = ?",
    [fileUrl, fileKey, invoiceId]
  );
}

// ─── Parse PDF with AI ───
async function parsePDFWithAI(pdfPath, supplierHint, locationHint) {
  // Upload PDF to S3 first so LLM can access it
  const fileBuffer = fs.readFileSync(pdfPath);
  const tempKey = `temp-batch/${Date.now()}-${path.basename(pdfPath)}`;
  const pdfUrl = await uploadToS3(fileBuffer, tempKey);

  const response = await invokeLLM(
    [
      {
        role: "system",
        content: `You are an invoice parsing assistant for a food service business in Montreal, Quebec, Canada. 
Extract structured data from the invoice PDF. The business has these locations:
- President Kennedy (PK) - Location 1
- Mackay (MK) - Location 2  
- Ontario - Location 3
- Cathcart Tunnel - Location 4
- Factory/CK - Location 5

Invoices may be in French or English. Extract all line items with quantities and prices.
For dates, use YYYY-MM-DD format. For amounts, use numbers without currency symbols.
If a field cannot be determined, use null.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Parse this invoice PDF. Supplier hint: ${supplierHint || "unknown"}. Location hint: ${locationHint || "unknown"}.
Extract: invoice number, date, due date, subtotal, GST, QST, total amount, currency, delivery location, and all line items.`,
          },
          {
            type: "file_url",
            file_url: { url: pdfUrl, mime_type: "application/pdf" },
          },
        ],
      },
    ],
    {
      type: "json_schema",
      json_schema: {
        name: "invoice_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            invoiceNumber: { type: ["string", "null"] },
            invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
            dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
            subtotal: { type: ["number", "null"] },
            gst: { type: ["number", "null"] },
            qst: { type: ["number", "null"] },
            totalAmount: { type: ["number", "null"] },
            currency: { type: "string" },
            deliveryLocation: { type: ["string", "null"], description: "PK, MK, Ontario, Tunnel, or CK" },
            lineItems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  productCode: { type: ["string", "null"] },
                  quantity: { type: ["number", "null"] },
                  unitPrice: { type: ["number", "null"] },
                  amount: { type: ["number", "null"] },
                },
                required: ["description", "productCode", "quantity", "unitPrice", "amount"],
                additionalProperties: false,
              },
            },
          },
          required: ["invoiceNumber", "invoiceDate", "dueDate", "subtotal", "gst", "qst", "totalAmount", "currency", "deliveryLocation", "lineItems"],
          additionalProperties: false,
        },
      },
    }
  );

  const content = response.choices?.[0]?.message?.content;
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  
  return { ...parsed, pdfUrl };
}

// ─── Location resolution ───
const LOCATION_RESOLVE = {
  "pk": 1, "president kennedy": 1,
  "mk": 2, "mackay": 2,
  "ontario": 3, "on": 3,
  "tunnel": 4, "cathcart": 4, "cathcart tunnel": 4,
  "ck": 5, "factory": 5, "commissary": 5,
};

function resolveLocation(aiLocation, folderLocation) {
  if (folderLocation) return folderLocation;
  if (!aiLocation) return null;
  const lower = aiLocation.toLowerCase().trim();
  return LOCATION_RESOLVE[lower] || null;
}

// ─── MAIN ───
async function main() {
  console.log("=== Batch Invoice Processor ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Start: ${startIdx}, Limit: ${limit}`);

  const manifest = JSON.parse(fs.readFileSync("/home/ubuntu/invoice-batch/manifest.json", "utf-8"));
  const toProcess = manifest.slice(startIdx, startIdx + limit);
  
  console.log(`\nProcessing ${toProcess.length} of ${manifest.length} invoices...\n`);

  const results = {
    processed: 0,
    created: 0,
    duplicates: 0,
    errors: 0,
    skipped: 0,
    errorDetails: [],
    createdIds: [],
  };

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const idx = startIdx + i;
    const progress = `[${idx + 1}/${manifest.length}]`;

    try {
      // Check if file exists
      if (!fs.existsSync(item.filePath)) {
        console.log(`${progress} SKIP (file not found): ${item.filename}`);
        results.skipped++;
        continue;
      }

      // Quick dedup check using filename-derived invoice number
      if (item.invoiceNumberFromFilename && item.supplier) {
        const isDup = await isDuplicate(item.invoiceNumberFromFilename, item.supplier.id);
        if (isDup) {
          console.log(`${progress} DUPLICATE (filename): ${item.invoiceNumberFromFilename} - ${item.filename}`);
          results.duplicates++;
          continue;
        }
      }

      // Parse PDF with AI
      console.log(`${progress} Parsing: ${item.filename} (${item.supplier?.name || "?"})`);
      const extracted = await parsePDFWithAI(
        item.filePath,
        item.supplier?.name,
        item.locationId ? `Location ${item.locationId}` : null
      );

      // Resolve invoice number (AI extraction > filename)
      const invoiceNumber = extracted.invoiceNumber || item.invoiceNumberFromFilename || `BATCH-${Date.now()}-${idx}`;
      
      // Dedup check with AI-extracted invoice number
      if (item.supplier && invoiceNumber !== item.invoiceNumberFromFilename) {
        const isDup = await isDuplicate(invoiceNumber, item.supplier.id);
        if (isDup) {
          console.log(`${progress} DUPLICATE (AI): ${invoiceNumber} - ${item.filename}`);
          results.duplicates++;
          continue;
        }
      }

      // Resolve location
      const locationId = resolveLocation(extracted.deliveryLocation, item.locationId);

      if (dryRun) {
        console.log(`${progress} WOULD CREATE: #${invoiceNumber} | ${item.supplier?.name} | Loc:${locationId} | $${extracted.totalAmount} | ${extracted.lineItems?.length || 0} items`);
        results.created++;
      } else {
        // Create invoice record
        const invoiceId = await createInvoice({
          supplierId: item.supplier?.id || null,
          locationId,
          invoiceNumber,
          invoiceDate: extracted.invoiceDate || null,
          dueDate: extracted.dueDate || null,
          subtotal: extracted.subtotal,
          gst: extracted.gst,
          qst: extracted.qst,
          totalAmount: extracted.totalAmount,
          currency: extracted.currency || "CAD",
          sourceFile: item.relativePath,
        });

        // Create line items
        if (extracted.lineItems && extracted.lineItems.length > 0) {
          await createLineItems(invoiceId, extracted.lineItems);
        }

        // Upload PDF to permanent S3 location and link
        const fileBuffer = fs.readFileSync(item.filePath);
        const permKey = `invoices/${item.supplier?.id || 0}/${invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
        const permUrl = await uploadToS3(fileBuffer, permKey);
        await updateInvoiceFile(invoiceId, permUrl, permKey);

        console.log(`${progress} CREATED: #${invoiceNumber} (ID:${invoiceId}) | ${item.supplier?.name} | Loc:${locationId} | $${extracted.totalAmount} | ${extracted.lineItems?.length || 0} items`);
        results.created++;
        results.createdIds.push(invoiceId);
      }

      results.processed++;

      // Rate limit: small delay between API calls
      if (i < toProcess.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }

    } catch (err) {
      console.error(`${progress} ERROR: ${item.filename} - ${err.message}`);
      results.errors++;
      results.errorDetails.push({ file: item.filename, error: err.message });
    }
  }

  // Summary
  console.log("\n=== BATCH PROCESSING COMPLETE ===");
  console.log(`Processed: ${results.processed}`);
  console.log(`Created: ${results.created}`);
  console.log(`Duplicates: ${results.duplicates}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);

  if (results.errorDetails.length > 0) {
    console.log("\nError details:");
    for (const e of results.errorDetails) {
      console.log(`  ${e.file}: ${e.error}`);
    }
  }

  // Save results
  fs.writeFileSync("/home/ubuntu/invoice-batch/batch_results.json", JSON.stringify(results, null, 2));
  console.log("\nResults saved to /home/ubuntu/invoice-batch/batch_results.json");

  // Close DB pool
  if (dbPool) await dbPool.end();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
