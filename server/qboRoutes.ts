import type { Express, Request, Response } from "express";
import { getQboAuthUrl, exchangeCodeForTokens, saveTokens, getCompanyInfo } from "./qbo";

export function registerQboOAuthRoutes(app: Express) {
  // Step 1: Redirect user to Intuit OAuth
  app.get("/api/qbo/connect", (req: Request, res: Response) => {
    const origin = req.query.origin as string || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/qbo/callback`;
    const state = JSON.stringify({ origin, redirectUri });
    const stateB64 = Buffer.from(state).toString("base64");
    const authUrl = getQboAuthUrl(redirectUri, stateB64);
    res.redirect(authUrl);
  });

  // Step 2: Handle callback from Intuit
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

      // Decode state to get redirect URI
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

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code, redirectUri);

      // Get company name
      let companyName = "Unknown";
      try {
        // Temporarily save tokens to make the API call
        await saveTokens(realmId, tokens, undefined, "oauth-callback");
        const info = await getCompanyInfo();
        companyName = info?.CompanyInfo?.CompanyName || "Unknown";
        // Re-save with company name
        await saveTokens(realmId, tokens, companyName, "oauth-callback");
      } catch (e) {
        // Save tokens even if company info fetch fails
        await saveTokens(realmId, tokens, companyName, "oauth-callback");
      }

      // Redirect back to the app's integrations page
      res.redirect(`${origin}/integrations?qbo=connected&company=${encodeURIComponent(companyName)}`);
    } catch (err: any) {
      console.error("[QBO OAuth] Callback error:", err);
      res.status(500).send(`QBO OAuth error: ${err.message}`);
    }
  });
}
