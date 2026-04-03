import type { Express, Request, Response } from "express";
import { getQboAuthUrl, exchangeCodeForTokens, saveTokens, getCompanyInfo } from "./qbo";
import { getDb } from "./db";
import { qboTokens, qboEntities } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Production QBO Credentials (for Financial Statements only) ───
const QBO_PROD_CLIENT_ID = "AB1l3yvNjbzID6Qjg6sWWxYh6bJLUjVDKqbcisw8KNkYMyAmlB";
const QBO_PROD_CLIENT_SECRET = "eur57dkXRw3ZDZMrhsDK5wFIiMlgx73WMfbQQxEa";
const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_PROD_API_URL = "https://quickbooks.api.intuit.com";

export function registerQboOAuthRoutes(app: Express) {
  // ─── EXISTING: Sandbox OAuth (for other features) ───

  // Step 1: Redirect user to Intuit OAuth (sandbox)
  app.get("/api/qbo/connect", (req: Request, res: Response) => {
    const origin = req.query.origin as string || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/qbo/callback`;
    const state = JSON.stringify({ origin, redirectUri });
    const stateB64 = Buffer.from(state).toString("base64");
    const authUrl = getQboAuthUrl(redirectUri, stateB64);
    res.redirect(authUrl);
  });

  // Step 2: Handle callback from Intuit (sandbox)
  app.get("/api/qbo/callback", async (req: Request, res: Response) => {
    try {
      const { code, realmId, state } = req.query as {
        code?: string;
        realmId?: string;
        state?: string;
      };

      if (!code || !realmId) {
        const error = req.query.error as string;
        res.status(400).send(`QBO OAuth failed: ${error || "Missing code or realmId"}`);
        return;
      }

      let redirectUri: string;
      let origin: string;
      try {
        const stateObj = JSON.parse(Buffer.from(state || "", "base64").toString());
        redirectUri = stateObj.redirectUri;
        origin = stateObj.origin;
      } catch {
        redirectUri = `${req.protocol}://${req.get("host")}/api/qbo/callback`;
        origin = `${req.protocol}://${req.get("host")}`;
      }

      const tokens = await exchangeCodeForTokens(code, redirectUri);

      let companyName = "Unknown";
      try {
        await saveTokens(realmId, tokens, undefined, "oauth-callback");
        const info = await getCompanyInfo();
        companyName = info?.CompanyInfo?.CompanyName || "Unknown";
        await saveTokens(realmId, tokens, companyName, "oauth-callback");
      } catch (e) {
        await saveTokens(realmId, tokens, companyName, "oauth-callback");
      }

      res.redirect(`${origin}/integrations?qbo=connected&company=${encodeURIComponent(companyName)}`);
    } catch (err: any) {
      console.error("[QBO OAuth] Callback error:", err);
      res.status(500).send(`QBO OAuth error: ${err.message}`);
    }
  });

  // ─── NEW: Production OAuth (for Financial Statements) ───

  // Step 1: Redirect to Intuit OAuth with PRODUCTION credentials
  app.get("/api/qbo/prod/connect", (req: Request, res: Response) => {
    const entityId = req.query.entityId as string;
    const origin = req.query.origin as string || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/qbo/prod/callback`;
    const state = JSON.stringify({ origin, redirectUri, entityId });
    const stateB64 = Buffer.from(state).toString("base64");

    const params = new URLSearchParams({
      client_id: QBO_PROD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "com.intuit.quickbooks.accounting",
      state: stateB64,
    });

    res.redirect(`${QBO_AUTH_URL}?${params.toString()}`);
  });

  // Step 2: Handle callback from Intuit (production)
  app.get("/api/qbo/prod/callback", async (req: Request, res: Response) => {
    try {
      const { code, realmId, state } = req.query as {
        code?: string;
        realmId?: string;
        state?: string;
      };

      if (!code || !realmId) {
        const error = req.query.error as string;
        res.status(400).send(`QBO Production OAuth failed: ${error || "Missing code or realmId"}`);
        return;
      }

      let redirectUri: string;
      let origin: string;
      let entityId: string | undefined;
      try {
        const stateObj = JSON.parse(Buffer.from(state || "", "base64").toString());
        redirectUri = stateObj.redirectUri;
        origin = stateObj.origin;
        entityId = stateObj.entityId;
      } catch {
        redirectUri = `${req.protocol}://${req.get("host")}/api/qbo/prod/callback`;
        origin = `${req.protocol}://${req.get("host")}`;
      }

      // Exchange code for tokens using PRODUCTION credentials
      const basicAuth = Buffer.from(`${QBO_PROD_CLIENT_ID}:${QBO_PROD_CLIENT_SECRET}`).toString("base64");
      const tokenRes = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Production token exchange failed: ${tokenRes.status} ${err}`);
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      // Get company name from production QBO
      let companyName = "Unknown";
      try {
        const companyRes = await fetch(`${QBO_PROD_API_URL}/v3/company/${realmId}/companyinfo/${realmId}`, {
          headers: {
            "Authorization": `Bearer ${tokens.access_token}`,
            "Accept": "application/json",
          },
        });
        if (companyRes.ok) {
          const companyData = await companyRes.json();
          companyName = companyData?.CompanyInfo?.CompanyName || "Unknown";
        }
      } catch (e) {
        console.error("[QBO Prod] Failed to get company info:", e);
      }

      // Save production tokens to the qboTokens table
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const now = new Date();
      const accessTokenExpiresAt = new Date(now.getTime() + tokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000);

      // Deactivate any existing tokens for this realm
      await db.update(qboTokens).set({ isActive: false }).where(eq(qboTokens.realmId, realmId));

      // Insert new production tokens
      await db.insert(qboTokens).values({
        realmId,
        companyName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scope: "com.intuit.quickbooks.accounting",
        isActive: true,
        connectedBy: "prod-oauth-callback",
      });

      console.log(`[QBO Prod] Connected company: ${companyName} (realm: ${realmId})`);

      // If entityId was provided, update the entity's realmId
      if (entityId) {
        try {
          const entId = parseInt(entityId, 10);
          if (!isNaN(entId)) {
            await db.update(qboEntities)
              .set({ realmId, companyName })
              .where(eq(qboEntities.id, entId));
            console.log(`[QBO Prod] Updated entity ${entId} with realm ${realmId}`);
          }
        } catch (e) {
          console.error("[QBO Prod] Failed to update entity:", e);
        }
      }

      // Redirect back to Financial Statements page
      res.redirect(`${origin}/financial-statements?qbo=connected&company=${encodeURIComponent(companyName)}&realm=${realmId}`);
    } catch (err: any) {
      console.error("[QBO Prod OAuth] Callback error:", err);
      res.status(500).send(`QBO Production OAuth error: ${err.message}`);
    }
  });

  // ─── Production QBO Status endpoint ───
  app.get("/api/qbo/prod/status", async (req: Request, res: Response) => {
    try {
      const db = await getDb();
      if (!db) {
        res.json({ connected: false });
        return;
      }

      // Get all active production tokens (connected via prod-oauth-callback)
      const rows = await db.select().from(qboTokens)
        .where(eq(qboTokens.isActive, true));

      // Filter to only production tokens
      const prodTokens = rows.filter(r => r.connectedBy === "prod-oauth-callback");

      const connections = prodTokens.map(t => ({
        realmId: t.realmId,
        companyName: t.companyName,
        accessTokenExpiresAt: t.accessTokenExpiresAt?.getTime(),
        refreshTokenExpiresAt: t.refreshTokenExpiresAt?.getTime(),
      }));

      res.json({ connections });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
