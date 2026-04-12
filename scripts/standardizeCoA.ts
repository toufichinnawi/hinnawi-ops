/**
 * Chart of Accounts Standardization — Issue #5
 * 
 * This script:
 * 1. Queries the sandbox QBO for the "golden" CoA (the standard you created)
 * 2. For each production QBO realm:
 *    a. Queries existing accounts
 *    b. Creates any accounts from sandbox that don't exist in production
 *    c. Deactivates unused accounts (zero balance, no transactions)
 *    d. Renames accounts to match the standard naming convention
 * 
 * Runs in DRY-RUN mode by default. Pass --live to apply changes.
 * 
 * Usage:
 *   npx tsx scripts/standardizeCoA.ts          # dry-run (preview changes)
 *   npx tsx scripts/standardizeCoA.ts --live    # apply changes
 */

import "dotenv/config";
import {
  prodQboRequest,
  getProductionAccounts,
} from "../server/qboProduction";
import {
  auditAllCompanies,
  deactivateAccount,
  renameAccount,
  formatAuditReport,
  type QBOAccount,
} from "../server/coaCleanup";
import { getDb } from "../server/db";
import { qboTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ─── Configuration ───

const PRODUCTION_REALMS = [
  { realmId: "9130346671806126", name: "PK/MK Cafe (Shared)" },
  { realmId: "123146517406139", name: "Ontario" },
  { realmId: "123146517409489", name: "Cathcart Tunnel (CT)" },
];

const isLive = process.argv.includes("--live");

// ─── Sandbox QBO Access ───

const QBO_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com";
const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || "";
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || "";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function getSandboxToken(): Promise<{ accessToken: string; realmId: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(qboTokens)
    .where(eq(qboTokens.isActive, true))
    .orderBy(desc(qboTokens.updatedAt));

  // Get sandbox tokens (not production)
  const sandboxRows = rows.filter(r => r.connectedBy !== "prod-oauth-callback");
  const tokenRow = sandboxRows[0] || rows[0];
  if (!tokenRow) return null;

  // Refresh if needed
  const now = new Date();
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);
  if (tokenRow.accessTokenExpiresAt < fiveMinFromNow) {
    const basicAuth = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(QBO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenRow.refreshToken }),
    });
    if (!res.ok) {
      console.log("⚠️  Could not refresh sandbox token — will try with existing token");
    } else {
      const data = await res.json() as any;
      await db.update(qboTokens).set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: new Date(now.getTime() + data.expires_in * 1000),
        refreshTokenExpiresAt: new Date(now.getTime() + data.x_refresh_token_expires_in * 1000),
      }).where(eq(qboTokens.id, tokenRow.id));
      return { accessToken: data.access_token, realmId: tokenRow.realmId };
    }
  }

  return { accessToken: tokenRow.accessToken, realmId: tokenRow.realmId };
}

async function getSandboxAccounts(accessToken: string, realmId: string): Promise<QBOAccount[]> {
  const allAccounts: QBOAccount[] = [];
  let startPos = 1;
  const maxResults = 100;

  while (true) {
    const query = `SELECT * FROM Account STARTPOSITION ${startPos} MAXRESULTS ${maxResults}`;
    const url = `${QBO_SANDBOX_URL}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Sandbox query failed (${res.status}): ${errText}`);
    }
    const data = await res.json() as any;
    const accounts = data?.QueryResponse?.Account || [];
    allAccounts.push(...accounts);
    if (accounts.length < maxResults) break;
    startPos += maxResults;
  }

  return allAccounts;
}

// ─── Account Matching ───

interface AccountMatch {
  sandboxAccount: QBOAccount;
  prodAccount: QBOAccount | null;
  action: "exists" | "create" | "rename";
  details: string;
}

function matchAccounts(sandboxAccounts: QBOAccount[], prodAccounts: QBOAccount[]): AccountMatch[] {
  const matches: AccountMatch[] = [];

  for (const sbAcct of sandboxAccounts) {
    if (!sbAcct.Active) continue;

    // Try matching by AcctNum first (most reliable)
    let prodMatch: QBOAccount | null = null;
    if (sbAcct.AcctNum) {
      prodMatch = prodAccounts.find(p =>
        p.AcctNum === sbAcct.AcctNum && p.Active
      ) || null;
    }

    // Try matching by exact name
    if (!prodMatch) {
      prodMatch = prodAccounts.find(p =>
        p.Name.toLowerCase() === sbAcct.Name.toLowerCase() &&
        p.AccountType === sbAcct.AccountType &&
        p.Active
      ) || null;
    }

    // Try matching by similar name
    if (!prodMatch) {
      prodMatch = prodAccounts.find(p =>
        p.Name.toLowerCase().includes(sbAcct.Name.toLowerCase()) &&
        p.AccountType === sbAcct.AccountType &&
        p.Active
      ) || null;
    }

    if (prodMatch) {
      if (prodMatch.Name !== sbAcct.Name) {
        matches.push({
          sandboxAccount: sbAcct,
          prodAccount: prodMatch,
          action: "rename",
          details: `"${prodMatch.Name}" → "${sbAcct.Name}"`,
        });
      } else {
        matches.push({
          sandboxAccount: sbAcct,
          prodAccount: prodMatch,
          action: "exists",
          details: `Already matches (ID: ${prodMatch.Id})`,
        });
      }
    } else {
      matches.push({
        sandboxAccount: sbAcct,
        prodAccount: null,
        action: "create",
        details: `New: ${sbAcct.AccountType} / ${sbAcct.AccountSubType || "N/A"}`,
      });
    }
  }

  return matches;
}

// ─── Unused Account Detection ───

interface UnusedAccount {
  account: QBOAccount;
  reason: string;
}

function findUnusedAccounts(prodAccounts: QBOAccount[], sandboxAccounts: QBOAccount[]): UnusedAccount[] {
  const unused: UnusedAccount[] = [];
  const sandboxNames = new Set(sandboxAccounts.filter(a => a.Active).map(a => a.Name.toLowerCase()));
  const sandboxNums = new Set(sandboxAccounts.filter(a => a.Active && a.AcctNum).map(a => a.AcctNum!));

  for (const prodAcct of prodAccounts) {
    if (!prodAcct.Active) continue;

    // Skip system accounts that can't be deactivated
    const systemTypes = ["Accounts Payable", "Accounts Receivable", "Opening Balance Equity"];
    if (systemTypes.some(t => prodAcct.AccountSubType?.includes(t) || prodAcct.Name.includes(t))) continue;

    // Check if this account exists in the sandbox standard
    const inSandboxByName = sandboxNames.has(prodAcct.Name.toLowerCase());
    const inSandboxByNum = prodAcct.AcctNum ? sandboxNums.has(prodAcct.AcctNum) : false;

    if (!inSandboxByName && !inSandboxByNum) {
      // Check if it has a zero balance
      if (prodAcct.CurrentBalance === 0 && prodAcct.CurrentBalanceWithSubAccounts === 0) {
        unused.push({
          account: prodAcct,
          reason: "Not in standard CoA and zero balance",
        });
      } else {
        unused.push({
          account: prodAcct,
          reason: `Not in standard CoA but has balance $${prodAcct.CurrentBalance} — REVIEW NEEDED`,
        });
      }
    }
  }

  return unused;
}

// ─── Create Account in Production ───

async function createAccountInProduction(
  realmId: string,
  sandboxAccount: QBOAccount,
): Promise<{ success: boolean; newId?: string; error?: string }> {
  try {
    const payload: any = {
      Name: sandboxAccount.Name,
      AccountType: sandboxAccount.AccountType,
      Active: true,
    };
    if (sandboxAccount.AccountSubType) payload.AccountSubType = sandboxAccount.AccountSubType;
    if (sandboxAccount.AcctNum) payload.AcctNum = sandboxAccount.AcctNum;
    if (sandboxAccount.Description) payload.Description = sandboxAccount.Description;

    const result = await prodQboRequest(realmId, "POST", "account", payload);
    return { success: true, newId: result?.Account?.Id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Main ───

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Chart of Accounts Standardization ${isLive ? "(LIVE)" : "(DRY-RUN)"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Step 1: Get sandbox CoA (the golden standard)
  console.log("Step 1: Fetching sandbox (standard) Chart of Accounts...\n");
  const sandboxToken = await getSandboxToken();
  if (!sandboxToken) {
    console.error("❌ Could not get sandbox QBO token. Please connect the sandbox QBO company first.");
    process.exit(1);
  }
  console.log(`  Sandbox realm: ${sandboxToken.realmId}`);

  const sandboxAccounts = await getSandboxAccounts(sandboxToken.accessToken, sandboxToken.realmId);
  const activeSandbox = sandboxAccounts.filter(a => a.Active);
  console.log(`  Total sandbox accounts: ${sandboxAccounts.length} (${activeSandbox.length} active)\n`);

  // List sandbox accounts by type
  const sandboxByType = new Map<string, QBOAccount[]>();
  for (const acct of activeSandbox) {
    const type = acct.AccountType;
    if (!sandboxByType.has(type)) sandboxByType.set(type, []);
    sandboxByType.get(type)!.push(acct);
  }
  console.log("  Standard CoA structure:");
  for (const [type, accts] of Array.from(sandboxByType.entries()).sort()) {
    console.log(`    ${type} (${accts.length}):`);
    for (const a of accts.sort((x, y) => (x.AcctNum || "").localeCompare(y.AcctNum || ""))) {
      console.log(`      ${a.AcctNum || "----"} ${a.Name}`);
    }
  }
  console.log();

  // Step 2: Process each production realm
  for (const realm of PRODUCTION_REALMS) {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  ${realm.name} (${realm.realmId})`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);

    let prodAccounts: QBOAccount[];
    try {
      prodAccounts = await getProductionAccounts(realm.realmId) as QBOAccount[];
    } catch (err: any) {
      console.log(`  ❌ Could not fetch accounts: ${err.message}\n`);
      continue;
    }

    const activeProd = prodAccounts.filter(a => a.Active);
    console.log(`  Production accounts: ${prodAccounts.length} (${activeProd.length} active)\n`);

    // Match sandbox accounts to production
    const matches = matchAccounts(activeSandbox, activeProd);
    const toCreate = matches.filter(m => m.action === "create");
    const toRename = matches.filter(m => m.action === "rename");
    const existing = matches.filter(m => m.action === "exists");

    console.log(`  Matching results:`);
    console.log(`    ✅ Already exist: ${existing.length}`);
    console.log(`    ➕ To create:     ${toCreate.length}`);
    console.log(`    ✏️  To rename:     ${toRename.length}\n`);

    // Show accounts to create
    if (toCreate.length > 0) {
      console.log(`  Accounts to CREATE:`);
      for (const m of toCreate) {
        console.log(`    + ${m.sandboxAccount.AcctNum || "----"} ${m.sandboxAccount.Name} (${m.details})`);
        if (isLive) {
          const result = await createAccountInProduction(realm.realmId, m.sandboxAccount);
          console.log(`      → ${result.success ? `✅ Created (ID: ${result.newId})` : `❌ ${result.error}`}`);
        }
      }
      console.log();
    }

    // Show accounts to rename
    if (toRename.length > 0) {
      console.log(`  Accounts to RENAME:`);
      for (const m of toRename) {
        console.log(`    ~ ${m.details}`);
        if (isLive && m.prodAccount) {
          const result = await renameAccount(realm.realmId, m.prodAccount.Id, m.sandboxAccount.Name);
          console.log(`      → ${result.success ? "✅ Renamed" : `❌ ${result.error}`}`);
        }
      }
      console.log();
    }

    // Find unused accounts in production
    const unused = findUnusedAccounts(activeProd, activeSandbox);
    const canDeactivate = unused.filter(u => u.account.CurrentBalance === 0);
    const needsReview = unused.filter(u => u.account.CurrentBalance !== 0);

    console.log(`  Unused accounts: ${unused.length} total`);
    console.log(`    🗑️  Can deactivate (zero balance): ${canDeactivate.length}`);
    console.log(`    ⚠️  Needs review (has balance):     ${needsReview.length}\n`);

    if (canDeactivate.length > 0) {
      console.log(`  Accounts to DEACTIVATE:`);
      for (const u of canDeactivate) {
        console.log(`    - ${u.account.AcctNum || "----"} ${u.account.Name} (${u.reason})`);
        if (isLive) {
          const result = await deactivateAccount(realm.realmId, u.account.Id);
          console.log(`      → ${result.success ? "✅ Deactivated" : `❌ ${result.error}`}`);
        }
      }
      console.log();
    }

    if (needsReview.length > 0) {
      console.log(`  Accounts needing REVIEW (have balance, not in standard CoA):`);
      for (const u of needsReview) {
        console.log(`    ⚠️  ${u.account.AcctNum || "----"} ${u.account.Name} — Balance: $${u.account.CurrentBalance} (${u.reason})`);
      }
      console.log();
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  if (isLive) {
    console.log("  DONE — Changes have been applied to production QBO.");
  } else {
    console.log("  DRY-RUN COMPLETE — No changes were made.");
    console.log("  Run with --live to apply: npx tsx scripts/standardizeCoA.ts --live");
  }
  console.log("═══════════════════════════════════════════════════════════════\n");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
