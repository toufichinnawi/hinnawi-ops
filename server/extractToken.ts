import { getDb } from "./db";
import { qboTokens } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import * as fs from "fs";

async function main() {
  const db = await getDb();
  if (!db) { console.error("No DB"); process.exit(1); }
  const rows = await db.select().from(qboTokens).where(eq(qboTokens.isActive, true)).orderBy(desc(qboTokens.updatedAt)).limit(1);
  if (rows.length === 0) { console.error("No active tokens"); process.exit(1); }
  fs.writeFileSync("/tmp/qbo_token.txt", rows[0].accessToken);
  fs.writeFileSync("/tmp/qbo_realm.txt", rows[0].realmId);
  console.log("Token and realm saved. Realm: " + rows[0].realmId);
  process.exit(0);
}
main();
