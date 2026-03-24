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

  console.log("Testing QBO API...");
  console.log("Realm:", realm);

  // Test: Query accounts
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/query?query=${encodeURIComponent("SELECT Id, Name, AccountType FROM Account MAXRESULTS 50")}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.substring(0, 5000));
  } catch (err: any) {
    console.error("Fetch error:", err.message);
    if (err.cause) console.error("Cause:", JSON.stringify(err.cause, null, 2));
  }
  process.exit(0);
}
main();
