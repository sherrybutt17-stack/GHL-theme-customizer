import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { mintDashboardToken } from "../services/dashboardAuth";
import { safeEqual } from "../services/security";

export const adminEmbedRouter = Router();

/**
 * Agency-level Custom Menu Link entry point (showOnCompany: true). We can't use
 * GHL's SSO postMessage handshake to authenticate the viewer here: GHL's own
 * SSO-context handler errors out for agency-level (no-location) pages
 * ("message channel closed before a response was received", traced to GHL's own
 * /agency_dashboard code). So instead the menu-link URL carries a per-agency
 * secret (?k=<slug>) that only that agency's signed-in users ever see, and we
 * require it before minting a dashboard token.
 *
 * SECURITY: the :agencyInstallId is NOT a secret - it appears in the public
 * @import CSS. The ?k= slug is. Without this check, anyone who scraped the id
 * from a themed page could mint a valid admin token and take over the agency.
 */
adminEmbedRouter.get("/admin-embed/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({
    where: { id: req.params.agencyInstallId },
    include: { menuLink: true },
  });
  if (!agency) {
    return res.status(404).send("Unknown agency install");
  }

  const provided = typeof req.query.k === "string" ? req.query.k : "";
  const expected = agency.menuLink?.slug ?? "";
  if (!expected || !safeEqual(provided, expected)) {
    // Generic 403 - don't reveal whether the id existed or the key was wrong.
    return res.status(403).send("Forbidden");
  }

  const adminDashboardUrl = process.env.ADMIN_DASHBOARD_URL ?? "http://localhost:5173";
  const token = mintDashboardToken(agency.id);
  // Deliver the bearer token in the URL FRAGMENT (#t=), not the query. Fragments are
  // never sent to servers, so the token can't land in access logs, the Referer header,
  // or proxies. The dashboard reads it from location.hash and immediately strips it.
  res.redirect(`${adminDashboardUrl}/${agency.id}#t=${encodeURIComponent(token)}`);
});
