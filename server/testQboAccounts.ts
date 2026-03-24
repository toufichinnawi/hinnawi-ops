import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const rows = await db!.select().from(qboTokens).where(eq(qboTokens.isActive, true)).orderBy(desc(qboTokens.updatedAt)).limit(1);
  if (rows.length === 0) {
    console.log("No active tokens");
    process.exit(1);
  }

  const token = rows[0].accessToken;
  const realm = rows[0].realmId;

  // Get ALL accounts (paginated)
  let allAccounts: any[] = [];
  let startPos = 1;
  while (true) {
    const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/query?query=${encodeURIComponent(`SELECT Id, Name, AccountType, AccountSubType FROM Account STARTPOSITION ${startPos} MAXRESULTS 100`)}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    const data = await res.json();
    const accounts = data?.QueryResponse?.Account || [];
    allAccounts.push(...accounts);
    if (accounts.length < 100) break;
    startPos += 100;
  }

  console.log(`Total accounts: ${allAccounts.length}\n`);
  
  // Group by type
  const byType: Record<string, any[]> = {};
  for (const a of allAccounts) {
    const type = a.AccountType;
    if (!byType[type]) byType[type] = [];
    byType[type].push(a);
  }

  for (const [type, accounts] of Object.entries(byType).sort()) {
    console.log(`\n=== ${type} ===`);
    for (const a of accounts) {
      console.log(`  ID=${a.Id} | ${a.Name}`);
    }
  }

  // Also get vendors
  const vendorUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/query?query=${encodeURIComponent("SELECT Id, DisplayName FROM Vendor MAXRESULTS 100")}`;
  const vendorRes = await fetch(vendorUrl, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  const vendorData = await vendorRes.json();
  const vendors = vendorData?.QueryResponse?.Vendor || [];
  
  console.log(`\n\n=== VENDORS (${vendors.length}) ===`);
  for (const v of vendors) {
    console.log(`  ID=${v.Id} | ${v.DisplayName}`);
  }

  process.exit(0);
}
main();
