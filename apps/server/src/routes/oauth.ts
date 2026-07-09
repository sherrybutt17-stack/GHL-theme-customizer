import { Router, Request, Response } from "express";
import { ghl, sessionStorage } from "../services/ghlClient";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";
import { ensureAgencyAdminMenuLink } from "../services/customMenuLink";
import { describeError } from "../services/security";

export const oauthRouter = Router();

/**
 * GHL redirects here with ?code=... after the agency admin approves the install.
 * We exchange the code for a token pair, persist it, then hand the admin their
 * one-time Custom JS/CSS paste snippet (see routes/onboarding.ts).
 */
oauthRouter.get("/authorize-handler", async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code || typeof code !== "string") {
    return res.status(400).send("Missing ?code from GHL authorization redirect");
  }

  try {
    const tokenResponse = await ghl.oauth.getAccessToken({
      client_id: process.env.GHL_APP_CLIENT_ID as string,
      client_secret: process.env.GHL_APP_CLIENT_SECRET as string,
      grant_type: "authorization_code",
      code,
    });

    const resourceId = tokenResponse.companyId ?? tokenResponse.locationId;
    if (!resourceId) {
      throw new Error("Token exchange response had neither companyId nor locationId");
    }
    await sessionStorage.setSession(resourceId, tokenResponse as any);

    const agency = tokenResponse.companyId
      ? await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: tokenResponse.companyId } })
      : null;

    if (agency) {
      try {
        await syncLocationsForAgency(agency.id);
        await ensureAgencyAdminMenuLink(agency.id, process.env.APP_PUBLIC_URL as string);
      } catch (setupError) {
        // Non-fatal: the install itself succeeded and tokens are safely stored.
        // Portal setup can be retried later (e.g. from the Phase 4 admin dashboard).
        console.error(`Post-install portal setup failed (install still succeeded): ${describeError(setupError)}`);
      }
      return res.redirect(`/onboarding/${agency.id}`);
    }
    return res.redirect("https://app.gohighlevel.com/");
  } catch (error) {
    // describeError, not the raw error: the token-exchange failure carries the POST
    // body (client_secret + auth code) in config.data - keep it out of the logs.
    console.error(`OAuth authorize-handler failed: ${describeError(error)}`);
    return res.status(500).send("Failed to complete GHL OAuth install. Check server logs.");
  }
});
