import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";

export const adminRouter = Router();

/**
 * Every route here is scoped by :agencyInstallId in the path. This is the same
 * "link carries the tenant" pattern as the onboarding page (no separate login
 * system yet) - real auth is a future refinement, not required for the admin
 * to safely manage only their own agency's data.
 */
async function requireAgency(req: Request, res: Response): Promise<string | null> {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    res.status(404).json({ error: "Unknown agency install" });
    return null;
  }
  return agency.id;
}

/**
 * Returns both ways to embed the theming CSS into GHL's Custom CSS field:
 *  - importSnippet: a one-line `@import` the agency pastes ONCE; it re-fetches
 *    live so theme edits apply without ever re-pasting (works because GHL serves
 *    our text/css endpoint as a normal cross-origin stylesheet). This is the
 *    preferred path.
 *  - fullCss: the fully-expanded static CSS, as a fallback if GHL's CSS
 *    sanitizer strips @import (needs re-paste on every theme change).
 */
adminRouter.get("/admin/api/:agencyInstallId/embed", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const publicUrl = process.env.APP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  const importSnippet = `@import url("${publicUrl}/theme-css/${agencyId}");`;
  const fullCss = await generateThemeCssBundle(agencyId);

  res.json({ importSnippet, fullCss });
});

adminRouter.get("/admin/api/:agencyInstallId/locations", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const locations = await prisma.locationInstall.findMany({
    where: { agencyInstallId: agencyId, status: "active" },
    include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { locationName: "asc" },
  });

  res.json(
    locations.map((loc) => ({
      id: loc.id,
      ghlLocationId: loc.ghlLocationId,
      locationName: loc.locationName,
      enabled: loc.enabled,
      theme: loc.themeConfigs[0] ?? null,
    }))
  );
});

adminRouter.put(
  "/admin/api/:agencyInstallId/locations/:locationInstallId/theme",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    // Tenant isolation: the location must actually belong to this agency install,
    // not just exist somewhere in the DB (cross-agency IDOR check).
    const location = await prisma.locationInstall.findFirst({
      where: { id: req.params.locationInstallId, agencyInstallId: agencyId },
      include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    const {
      brandName,
      logoUrl,
      faviconUrl,
      primaryColor,
      secondaryColor,
      accentColor,
      menuLabelOverrides,
      hiddenFeatures,
    } = req.body ?? {};

    const nextVersion = (location.themeConfigs[0]?.version ?? 0) + 1;
    const theme = await prisma.themeConfig.create({
      data: {
        locationInstallId: location.id,
        brandName,
        logoUrl,
        faviconUrl,
        primaryColor,
        secondaryColor,
        accentColor,
        menuLabelOverrides,
        hiddenFeatures,
        version: nextVersion,
      },
    });

    res.json(theme);
  }
);

adminRouter.put(
  "/admin/api/:agencyInstallId/locations/:locationInstallId/enabled",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const location = await prisma.locationInstall.findFirst({
      where: { id: req.params.locationInstallId, agencyInstallId: agencyId },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    const { enabled } = req.body ?? {};
    const updated = await prisma.locationInstall.update({
      where: { id: location.id },
      data: { enabled: !!enabled },
    });

    res.json({ id: updated.id, enabled: updated.enabled });
  }
);
