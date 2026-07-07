import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";

export const adminEmbedRouter = Router();

/**
 * Agency-level Custom Menu Link entry point (showOnCompany: true). Originally
 * this resolved the agency via the SSO postMessage handshake (like the
 * per-location portal), but that turned out to be unnecessary complexity:
 * unlike the per-location portal (one link shared across many locations,
 * genuinely needing runtime resolution of which one is active), we create
 * exactly one menu link per agency - so we already know which agency it is
 * at creation time and can just bake the id into the URL, same pattern as
 * the onboarding page. Confirmed via DevTools that GHL's own SSO-context
 * handler errors out for agency-level (no-location) pages anyway
 * ("message channel closed before a response was received", traced to
 * GHL's own /agency_dashboard code) - so this also sidesteps that bug.
 */
adminEmbedRouter.get("/admin-embed/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("Unknown agency install");
  }

  const adminDashboardUrl = process.env.ADMIN_DASHBOARD_URL ?? "http://localhost:5173";
  res.redirect(`${adminDashboardUrl}/${agency.id}`);
});
