/**
 * Batch Invoice Processor
 * 
 * Processes all invoice PDFs from the extracted ZIP:
 * 1. Derives supplier + location from folder paths
 * 2. Extracts invoice # from filename where possible
 * 3. Sends PDF to AI for full extraction (amounts, dates, line items)
 * 4. Deduplicates against existing DB records
 * 5. Creates invoice records + line items
 * 6. Uploads PDFs to S3
 * 7. Triggers cost pipeline for approved invoices
 */

import fs from "fs";
import path from "path";

// ─── Supplier mapping from folder names ───
const SUPPLIER_MAP = {
  "dube": { id: 3, name: "Dubé Loiselle" },
  "dub": { id: 3, name: "Dubé Loiselle" },
  "gordon": { id: 1, name: "Gordon Food Service" },
  "gfs": { id: 1, name: "Gordon Food Service" },
  "farinex": { id: 2, name: "Farinex Distribution" },
  "jg": { id: 4, name: "JG Rive-Sud" },
  "jgrivesud": { id: 4, name: "JG Rive-Sud" },
  "nantel": { id: 5, name: "Nantel Distribution" },
  "costco": { id: 6, name: "Costco Wholesale" },
  "tourier": { id: 7, name: "Les Touriers" },
  "lightspeed": { id: 8, name: "Lightspeed Commerce" },
  "hydro": { id: 9, name: "Hydro-Québec" },
  "koomi": { id: 10, name: "Koomi POS" },
  "pure tea": { id: 11, name: "Pure Tea" },
  "puretea": { id: 11, name: "Pure Tea" },
};

// ─── Location mapping from folder names ───
const LOCATION_MAP = {
  "pk": 1,
  "president kennedy": 1,
  "mk": 2,
  "mackay": 2,
  "ontario": 3,
  "on": 3,
  "tunnel": 4,
  "cathcart": 4,
  "ck": 5,
  "factory": 5,
  "commissary": 5,
};

function deriveSupplier(filePath) {
  const lower = filePath.toLowerCase();
  const parts = lower.split("/").map(p => p.trim());
  
  // Check each part of the path for supplier matches
  for (const part of parts) {
    for (const [key, supplier] of Object.entries(SUPPLIER_MAP)) {
      if (part.includes(key)) return supplier;
    }
  }
  
  // Check filename too
  const filename = path.basename(lower);
  if (filename.includes("gfs") || filename.includes("gordon")) return SUPPLIER_MAP["gordon"];
  if (filename.includes("dube") || filename.startsWith("f1")) return SUPPLIER_MAP["dube"];
  if (filename.includes("farinex") || filename.startsWith("fc")) return SUPPLIER_MAP["farinex"];
  if (filename.includes("jg")) return SUPPLIER_MAP["jg"];
  
  return null;
}

function deriveLocation(filePath) {
  const lower = filePath.toLowerCase();
  const parts = lower.split("/").map(p => p.trim());
  
  // Check each folder part for location
  for (const part of parts) {
    for (const [key, locId] of Object.entries(LOCATION_MAP)) {
      if (part === key || part.startsWith(key + " ") || part.endsWith(" " + key)) return locId;
    }
  }
  
  // Check filename for location prefix patterns like "GFS-PK", "MK Dube", "Costco MK"
  const filename = path.basename(lower, ".pdf");
  const locPatterns = [
    { pattern: /\bpk\b/, id: 1 },
    { pattern: /\bmk\b/, id: 2 },
    { pattern: /\bontario\b/, id: 3 },
    { pattern: /\btunnel\b/, id: 4 },
    { pattern: /\bck\b/, id: 5 },
    { pattern: /\bmackay\b/, id: 2 },
  ];
  
  for (const { pattern, id } of locPatterns) {
    if (pattern.test(filename)) return id;
  }
  
  return null;
}

function extractInvoiceNumberFromFilename(filePath) {
  const filename = path.basename(filePath, ".pdf");
  
  // Pattern: F1234567 (Dubé)
  const dubeMatch = filename.match(/F(\d{7})/i);
  if (dubeMatch) return `F${dubeMatch[1]}`;
  
  // Pattern: FC00221028 (Farinex)
  const farinexMatch = filename.match(/(FC\d+)/i);
  if (farinexMatch) return farinexMatch[1];
  
  // Pattern: FAC0002730718 (JG Rive-Sud)
  const jgMatch = filename.match(/(FAC\d+)/i);
  if (jgMatch) return jgMatch[1];
  
  // Pattern: 9021917638 (Gordon/GFS)
  const gfsMatch = filename.match(/(\d{10})/);
  if (gfsMatch) return gfsMatch[1];
  
  // Pattern: 1193640916 (Costco)
  const costcoMatch = filename.match(/(\d{10})/);
  if (costcoMatch) return costcoMatch[1];
  
  // Pattern: Invoice_310 (Pure Tea)
  const pureTeaMatch = filename.match(/Invoice[_\s]*(\d+)/i);
  if (pureTeaMatch) return pureTeaMatch[1];
  
  // Pattern: 301-MACKAY (Pure Tea)
  const pureTeaMatch2 = filename.match(/^(\d{3})-/);
  if (pureTeaMatch2) return pureTeaMatch2[1];
  
  // Fallback: use the full filename as a reference
  return null;
}

// ─── Main processing ───

async function buildManifest() {
  const manifestPath = "/home/ubuntu/invoice-batch/invoice_manifest.txt";
  const lines = fs.readFileSync(manifestPath, "utf-8").trim().split("\n");
  
  const manifest = [];
  
  for (const line of lines) {
    const filePath = line.trim();
    if (!filePath) continue;
    
    const fullPath = path.join("/home/ubuntu/invoice-batch", filePath.replace(/^\.\//, ""));
    const supplier = deriveSupplier(filePath);
    const locationId = deriveLocation(filePath);
    const invoiceNum = extractInvoiceNumberFromFilename(filePath);
    
    manifest.push({
      filePath: fullPath,
      relativePath: filePath,
      supplier,
      locationId,
      invoiceNumberFromFilename: invoiceNum,
      filename: path.basename(filePath),
    });
  }
  
  return manifest;
}

// Build and output the manifest
const manifest = await buildManifest();

// Summary stats
const bySupplier = {};
const byLocation = {};
let noSupplier = 0;
let noLocation = 0;
let hasInvoiceNum = 0;

for (const item of manifest) {
  const sName = item.supplier?.name || "UNKNOWN";
  bySupplier[sName] = (bySupplier[sName] || 0) + 1;
  
  const lName = item.locationId || "UNKNOWN";
  byLocation[lName] = (byLocation[lName] || 0) + 1;
  
  if (!item.supplier) noSupplier++;
  if (!item.locationId) noLocation++;
  if (item.invoiceNumberFromFilename) hasInvoiceNum++;
}

console.log("=== MANIFEST SUMMARY ===");
console.log(`Total invoices: ${manifest.length}`);
console.log(`With invoice # from filename: ${hasInvoiceNum}`);
console.log(`Missing supplier: ${noSupplier}`);
console.log(`Missing location: ${noLocation}`);
console.log("\nBy Supplier:");
for (const [name, count] of Object.entries(bySupplier).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}: ${count}`);
}
console.log("\nBy Location:");
for (const [name, count] of Object.entries(byLocation).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}: ${count}`);
}

// Write manifest to JSON for the next step
fs.writeFileSync("/home/ubuntu/invoice-batch/manifest.json", JSON.stringify(manifest, null, 2));
console.log("\nManifest written to /home/ubuntu/invoice-batch/manifest.json");
