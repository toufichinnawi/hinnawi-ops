/**
 * Organize Outlook Mailbox for Accounting@bagelandcafe.com
 * 
 * This script:
 * 1. Creates proper accounting folder structure
 * 2. Classifies emails by sender, subject, and content
 * 3. Moves emails to appropriate folders
 * 4. Flags emails that need follow-up
 * 
 * Run with: npx tsx scripts/organizeMailbox.ts [--dry-run]
 */
import "dotenv/config";
import * as msgraph from "../server/msgraph";

// ─── Folder Structure ───

const FOLDER_STRUCTURE = [
  "Invoices & Bills",
  "Payroll",
  "Banking & Finance",
  "Government & Tax",
  "Insurance",
  "Suppliers",
  "Utilities",
  "Rent & Leases",
  "IT & Software",
  "Internal",
  "Newsletters & Promotions",
  "Processed",
];

// ─── Classification Rules ───

interface ClassificationRule {
  folder: string;
  flag: boolean;       // Should this email be flagged for follow-up?
  flagReason?: string;
  match: (email: EmailInfo) => boolean;
}

interface EmailInfo {
  subject: string;
  from: string;
  fromName: string;
  bodyPreview: string;
  hasAttachments: boolean;
  isRead: boolean;
  receivedDateTime: string;
}

function lower(s: string): string { return (s || "").toLowerCase(); }
function has(text: string, ...keywords: string[]): boolean {
  const t = lower(text);
  return keywords.some(k => t.includes(k.toLowerCase()));
}

const RULES: ClassificationRule[] = [
  // ─── Government & Tax ───
  {
    folder: "Government & Tax",
    flag: true,
    flagReason: "Government notice — may require action",
    match: (e) => has(e.from, "revenuquebec", "canada.ca", "cra-arc", "arc.gc.ca", "revenu.gouv", "gov.ca", "wsib", "cnesst", "csst") ||
                  has(e.subject, "tax", "impôt", "gst", "hst", "tps", "tvq", "remittance", "assessment", "avis de cotisation", "revenu quebec", "revenue canada", "t4", "rl-1", "payroll deduction"),
  },

  // ─── Payroll ───
  {
    folder: "Payroll",
    flag: true,
    flagReason: "Payroll — time-sensitive",
    match: (e) => has(e.from, "7shifts", "sevenshift", "adp", "ceridian", "payworks", "wagepoint", "humi", "paychex", "gusto", "payroll") ||
                  has(e.subject, "payroll", "pay stub", "paie", "direct deposit", "t4", "rl-1", "roe ", "record of employment", "relevé", "timesheet", "schedule", "shift"),
  },

  // ─── Banking & Finance ───
  {
    folder: "Banking & Finance",
    flag: true,
    flagReason: "Banking — may need review",
    match: (e) => has(e.from, "cibc", "bmo", "desjardins", "rbc", "scotiabank", "td.com", "tangerine", "national bank", "bnc", "banque", "square", "stripe", "clover", "lightspeed", "moneris", "chase", "paypal", "interac", "etransfer") ||
                  has(e.subject, "bank statement", "relevé bancaire", "credit card", "carte de crédit", "wire transfer", "virement", "nsf", "overdraft", "loan", "prêt", "mortgage", "line of credit", "marge de crédit", "e-transfer", "deposit"),
  },

  // ─── Insurance ───
  {
    folder: "Insurance",
    flag: true,
    flagReason: "Insurance — may require renewal or action",
    match: (e) => has(e.from, "intact", "aviva", "desjardins assurance", "sunlife", "manulife", "greatwest", "wawanesa", "economical", "belair", "industrielle alliance", "ia.ca", "beneva", "assurance", "insurance") ||
                  has(e.subject, "insurance", "assurance", "policy", "police", "premium", "prime", "claim", "réclamation", "renewal", "renouvellement", "coverage", "couverture"),
  },

  // ─── Rent & Leases ───
  {
    folder: "Rent & Leases",
    flag: true,
    flagReason: "Rent/Lease — payment may be due",
    match: (e) => has(e.subject, "rent", "loyer", "lease", "bail", "landlord", "propriétaire", "common area", "cam charge", "tenant") ||
                  has(e.from, "landlord", "property management", "gestion immobilière", "realty", "immobilier"),
  },

  // ─── Utilities ───
  {
    folder: "Utilities",
    flag: true,
    flagReason: "Utility bill — payment may be due",
    match: (e) => has(e.from, "hydro", "bell", "rogers", "telus", "videotron", "cogeco", "fido", "virgin", "koodo", "enbridge", "gaz metro", "energir", "waste", "epcor", "fortis") ||
                  has(e.subject, "utility", "hydro", "electricity", "électricité", "gas bill", "facture de gaz", "internet bill", "phone bill", "water bill", "waste", "telecom"),
  },

  // ─── Invoices & Bills (with attachments — likely invoices) ───
  {
    folder: "Invoices & Bills",
    flag: true,
    flagReason: "Invoice/Bill — needs processing",
    match: (e) => (has(e.subject, "invoice", "facture", "bill", "statement", "état de compte", "credit note", "note de crédit", "purchase order", "bon de commande", "receipt", "reçu", "amount due", "montant dû", "payment due", "overdue", "past due", "en retard") && e.hasAttachments) ||
                  has(e.subject, "invoice #", "facture #", "inv-", "inv #"),
  },

  // ─── Suppliers (emails from known food/supply vendors) ───
  {
    folder: "Suppliers",
    flag: false,
    match: (e) => has(e.from, "sysco", "gfs", "gordon food", "colabor", "saputo", "agropur", "lantic", "barry callebaut", "metro", "costco", "provigo", "iga", "mayrand", "aubut", "distribution", "wholesale", "grossiste", "alimentaire", "boulangerie", "bakery", "dairy", "laitier", "coffee", "café", "roaster", "torréfacteur") ||
                  has(e.subject, "order confirmation", "confirmation de commande", "delivery", "livraison", "shipment", "expédition", "backorder", "price list", "liste de prix", "catalogue", "product update"),
  },

  // ─── IT & Software ───
  {
    folder: "IT & Software",
    flag: false,
    match: (e) => has(e.from, "microsoft", "google", "apple", "amazon", "aws", "quickbooks", "intuit", "xero", "freshbooks", "shopify", "wix", "squarespace", "godaddy", "namecheap", "cloudflare", "zoom", "slack", "dropbox", "adobe", "canva", "mailchimp", "hubspot", "github", "notion", "asana", "trello", "doordash", "ubereats", "skip", "grubhub") ||
                  has(e.subject, "subscription", "abonnement", "license", "licence", "software update", "account", "password", "security alert", "two-factor", "verification", "api", "integration"),
  },

  // ─── Internal (from bagelandcafe.com domain) ───
  {
    folder: "Internal",
    flag: false,
    match: (e) => has(e.from, "bagelandcafe.com", "hinnawi"),
  },

  // ─── Newsletters & Promotions (catch-all for marketing) ───
  {
    folder: "Newsletters & Promotions",
    flag: false,
    match: (e) => has(e.subject, "newsletter", "unsubscribe", "se désabonner", "promotion", "deal", "offer", "offre", "sale ", "vente", "webinar", "event", "événement", "update", "digest", "weekly", "monthly", "bulletin") ||
                  has(e.bodyPreview, "unsubscribe", "se désabonner", "view in browser", "email preferences", "opt out"),
  },

  // ─── Invoices & Bills (without attachments — still flag if subject mentions invoice) ───
  {
    folder: "Invoices & Bills",
    flag: true,
    flagReason: "Invoice mention — check if action needed",
    match: (e) => has(e.subject, "invoice", "facture", "bill", "statement", "amount due", "payment due", "overdue", "past due"),
  },
];

// ─── Main Script ───

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`\n📧 Organizing Outlook Mailbox for accounting@bagelandcafe.com`);
  console.log(`   Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE"}\n`);

  // Step 1: List existing folders
  console.log("📁 Step 1: Checking existing folders...");
  const existingFolders = await msgraph.listMailFolders();
  console.log(`   Found ${existingFolders.length} existing folders:`);
  for (const f of existingFolders) {
    console.log(`   - ${f.displayName} (${f.totalItemCount} items, ${f.unreadItemCount} unread)`);
  }

  // Step 2: Create folder structure
  console.log("\n📁 Step 2: Creating folder structure...");
  const folderMap: Record<string, string> = {};

  for (const folderName of FOLDER_STRUCTURE) {
    const existing = existingFolders.find(f => f.displayName === folderName);
    if (existing) {
      folderMap[folderName] = existing.id;
      console.log(`   ✓ "${folderName}" already exists`);
    } else if (dryRun) {
      folderMap[folderName] = `dry-run-${folderName}`;
      console.log(`   🔹 Would create: "${folderName}"`);
    } else {
      const created = await msgraph.createMailFolder(folderName);
      folderMap[folderName] = created.id;
      console.log(`   ✅ Created: "${folderName}"`);
    }
  }

  // Step 3: Fetch all inbox emails (paginated)
  console.log("\n📬 Step 3: Fetching inbox emails...");
  const allEmails: msgraph.GraphEmail[] = [];
  let skip = 0;
  const pageSize = 50;

  // Find the Inbox folder ID
  const inboxFolder = existingFolders.find(f => f.displayName === "Inbox" || f.displayName === "Boîte de réception");
  const inboxId = inboxFolder?.id || "inbox";

  while (true) {
    const result = await msgraph.listEmails({ top: pageSize, skip, folder: inboxId });
    allEmails.push(...result.emails);
    console.log(`   Fetched ${allEmails.length} / ${result.totalCount} emails...`);
    if (allEmails.length >= result.totalCount || result.emails.length < pageSize) break;
    skip += pageSize;
    // Small delay to avoid throttling
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`   Total inbox emails: ${allEmails.length}`);

  // Step 4: Classify and organize emails
  console.log("\n🏷️  Step 4: Classifying emails...\n");

  const stats: Record<string, number> = {};
  const flagged: Array<{ subject: string; from: string; reason: string }> = [];
  let movedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;

  for (const email of allEmails) {
    const info: EmailInfo = {
      subject: email.subject || "(no subject)",
      from: email.from?.emailAddress?.address || "",
      fromName: email.from?.emailAddress?.name || "",
      bodyPreview: email.bodyPreview || "",
      hasAttachments: email.hasAttachments,
      isRead: email.isRead,
      receivedDateTime: email.receivedDateTime,
    };

    // Find matching rule
    let matched = false;
    for (const rule of RULES) {
      if (rule.match(info)) {
        const folderId = folderMap[rule.folder];
        stats[rule.folder] = (stats[rule.folder] || 0) + 1;

        if (!dryRun && folderId && !folderId.startsWith("dry-run")) {
          try {
            // Move email to folder
            await msgraph.moveEmail(email.id, folderId);
            movedCount++;

            // Flag for follow-up if needed
            if (rule.flag) {
              // Use Graph API to set follow-up flag
              const token = await msgraph.getAccessToken();
              await fetch(`https://graph.microsoft.com/v1.0/users/accounting@bagelandcafe.com/messages/${email.id}`, {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  flag: {
                    flagStatus: "flagged",
                  },
                }),
              });
              flaggedCount++;
              flagged.push({
                subject: info.subject,
                from: `${info.fromName} <${info.from}>`,
                reason: rule.flagReason || "Needs follow-up",
              });
            }

            // Small delay to avoid throttling
            await new Promise(r => setTimeout(r, 100));
          } catch (err: any) {
            console.log(`   ⚠️  Error moving "${info.subject.substring(0, 50)}": ${err.message}`);
          }
        } else {
          if (rule.flag) {
            flaggedCount++;
            flagged.push({
              subject: info.subject,
              from: `${info.fromName} <${info.from}>`,
              reason: rule.flagReason || "Needs follow-up",
            });
          }
          movedCount++;
        }

        matched = true;
        break; // First matching rule wins
      }
    }

    if (!matched) {
      skippedCount++;
      // Log unclassified emails for review
      if (skippedCount <= 20) {
        console.log(`   ❓ Unclassified: "${info.subject.substring(0, 60)}" from ${info.from}`);
      }
    }
  }

  // Step 5: Print summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  📊 ORGANIZATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Total emails processed:  ${allEmails.length}`);
  console.log(`  Moved to folders:        ${movedCount}`);
  console.log(`  Flagged for follow-up:   ${flaggedCount}`);
  console.log(`  Unclassified (stayed):   ${skippedCount}`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("  📁 Emails per folder:");
  for (const [folder, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${folder}: ${count}`);
  }

  if (flagged.length > 0) {
    console.log(`\n  🚩 Emails flagged for follow-up (${flagged.length}):`);
    for (const f of flagged.slice(0, 30)) {
      console.log(`     📌 ${f.subject.substring(0, 60)}`);
      console.log(`        From: ${f.from}`);
      console.log(`        Reason: ${f.reason}`);
    }
    if (flagged.length > 30) {
      console.log(`     ... and ${flagged.length - 30} more`);
    }
  }

  if (skippedCount > 0) {
    console.log(`\n  ℹ️  ${skippedCount} emails remained in Inbox (no matching rule).`);
    console.log(`     These can be manually reviewed and moved.`);
  }

  console.log(`\n✅ Done! ${dryRun ? "(DRY RUN — no changes made)" : "Mailbox organized!"}\n`);
}

main().catch(err => {
  console.error(`\n❌ Fatal error: ${err.message}\n`);
  process.exit(1);
});
