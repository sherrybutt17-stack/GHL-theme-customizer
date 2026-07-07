import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";
import { GHL_SIDEBAR_FEATURES } from "../services/ghlSidebarFeatures";
import { dashboardAuthEnabled, verifyDashboardToken } from "../services/dashboardAuth";

export const adminRouter = Router();

/** Static list of themeable sidebar features, for the admin UI's toggles. */
adminRouter.get("/admin/api/sidebar-features", (_req: Request, res: Response) => {
  res.json(GHL_SIDEBAR_FEATURES);
});

/** Pull the shared visual theme fields out of a request body (whitelist). */
function visualFields(body: any) {
  return {
    logoUrl: body?.logoUrl,
    faviconUrl: body?.faviconUrl,
    primaryColor: body?.primaryColor,
    secondaryColor: body?.secondaryColor,
    accentColor: body?.accentColor,
    fontFamily: body?.fontFamily || null,
    gradientEnabled: !!body?.gradientEnabled,
    gradientColor: body?.gradientColor || null,
    gradientAngle: typeof body?.gradientAngle === "number" ? body.gradientAngle : 135,
    topBarColor: body?.topBarColor || null,
    buttonColor: body?.buttonColor || null,
    cornerRadius: typeof body?.cornerRadius === "number" ? body.cornerRadius : null,
    sidebarImageUrl: body?.sidebarImageUrl || null,
    scrollbarColor: body?.scrollbarColor || null,
    darkMode: !!body?.darkMode,
    hideUpgrade: !!body?.hideUpgrade,
    animateLoadIn: !!body?.animateLoadIn,
    animateScroll: !!body?.animateScroll,
    topNav: !!body?.topNav,
    menuLabelOverrides: body?.menuLabelOverrides,
    hiddenFeatures: body?.hiddenFeatures,
  };
}

/** The look-only fields a preset carries (no client identity/policy). */
function presetLookFields(body: any) {
  return {
    primaryColor: body?.primaryColor || null,
    secondaryColor: body?.secondaryColor || null,
    accentColor: body?.accentColor || null,
    fontFamily: body?.fontFamily || null,
    gradientEnabled: !!body?.gradientEnabled,
    gradientColor: body?.gradientColor || null,
    gradientAngle: typeof body?.gradientAngle === "number" ? body.gradientAngle : 135,
    topBarColor: body?.topBarColor || null,
    buttonColor: body?.buttonColor || null,
    cornerRadius: typeof body?.cornerRadius === "number" ? body.cornerRadius : null,
    scrollbarColor: body?.scrollbarColor || null,
    darkMode: !!body?.darkMode,
    animateLoadIn: !!body?.animateLoadIn,
    animateScroll: !!body?.animateScroll,
    topNav: !!body?.topNav,
  };
}

/**
 * Every route here is scoped by :agencyInstallId in the path. When
 * DASHBOARD_AUTH_ENABLED=true, we additionally require a valid HMAC token
 * (minted at /admin-embed, sent by the dashboard as x-mosaic-token) that matches
 * the agency in the path - a real, expiring credential. When disabled (dev
 * default), we fall back to the "menu-link URL carries the tenant" model.
 */
async function requireAgency(req: Request, res: Response): Promise<string | null> {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    res.status(404).json({ error: "Unknown agency install" });
    return null;
  }
  if (dashboardAuthEnabled()) {
    const token = (req.headers["x-mosaic-token"] as string | undefined) ?? undefined;
    if (!verifyDashboardToken(token, agency.id)) {
      res.status(401).json({ error: "Missing or invalid dashboard token" });
      return null;
    }
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
  // Cache-buster: a fresh ?v= each time this is copied forces the browser past any
  // previously-cached copy of the stylesheet. Combined with the endpoint's no-store
  // headers, one re-paste makes all future theme edits apply on the next reload.
  const version = Date.now();
  const importSnippet = `@import url("${publicUrl}/theme-css/${agencyId}?v=${version}");`;
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

    const nextVersion = (location.themeConfigs[0]?.version ?? 0) + 1;
    const theme = await prisma.themeConfig.create({
      data: {
        locationInstallId: location.id,
        brandName: req.body?.brandName,
        ...visualFields(req.body),
        customCssOverride: req.body?.customCss || null,
        version: nextVersion,
      },
    });

    res.json(theme);
  }
);

/**
 * Reset a sub-account back to inheriting the agency default: delete its own
 * ThemeConfig rows so the CSS bundle stops emitting location-scoped overrides
 * for it (the global agency-default rules still apply to every sidebar).
 */
adminRouter.delete(
  "/admin/api/:agencyInstallId/locations/:locationInstallId/theme",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const location = await prisma.locationInstall.findFirst({
      where: { id: req.params.locationInstallId, agencyInstallId: agencyId },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    await prisma.themeConfig.deleteMany({ where: { locationInstallId: location.id } });
    res.json({ reset: true });
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

// --- Agency default theme (the baseline every sub-account inherits) ---

adminRouter.get("/admin/api/:agencyInstallId/default-theme", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const theme = await prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId: agencyId } });
  res.json(theme);
});

adminRouter.put("/admin/api/:agencyInstallId/default-theme", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const fields = { ...visualFields(req.body), customCss: req.body?.customCss || null };
  const theme = await prisma.agencyDefaultTheme.upsert({
    where: { agencyInstallId: agencyId },
    update: fields,
    create: { agencyInstallId: agencyId, ...fields },
  });
  res.json(theme);
});

// --- Theme presets (named looks the agency can apply to many sub-accounts) ---

adminRouter.get("/admin/api/:agencyInstallId/presets", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const presets = await prisma.themePreset.findMany({
    where: { agencyInstallId: agencyId },
    orderBy: { createdAt: "asc" },
  });
  res.json(presets);
});

adminRouter.post("/admin/api/:agencyInstallId/presets", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Preset name is required" });
  }
  const preset = await prisma.themePreset.create({
    data: {
      agencyInstallId: agencyId,
      name,
      ...presetLookFields(req.body),
    },
  });
  res.json(preset);
});

/**
 * Apply one preset's look to many sub-accounts at once. For each location we
 * create a new ThemeConfig version that keeps the client's identity (brand name,
 * logo, hidden/renamed menu items, custom CSS) and overlays the preset's look,
 * then enable the location so the look actually renders. Scoped to this agency.
 */
adminRouter.post(
  "/admin/api/:agencyInstallId/presets/:presetId/apply",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const preset = await prisma.themePreset.findFirst({
      where: { id: req.params.presetId, agencyInstallId: agencyId },
    });
    if (!preset) return res.status(404).json({ error: "Preset not found" });

    const ids: string[] = Array.isArray(req.body?.locationInstallIds) ? req.body.locationInstallIds : [];
    if (ids.length === 0) return res.status(400).json({ error: "No sub-accounts selected" });

    const locations = await prisma.locationInstall.findMany({
      where: { id: { in: ids }, agencyInstallId: agencyId },
      include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
    });

    const updated = await Promise.all(
      locations.map(async (loc) => {
        const prev = loc.themeConfigs[0];
        const theme = await prisma.themeConfig.create({
          data: {
            locationInstallId: loc.id,
            // Preserve client identity + policy from the prior version.
            brandName: prev?.brandName ?? null,
            logoUrl: prev?.logoUrl ?? null,
            faviconUrl: prev?.faviconUrl ?? null,
            sidebarImageUrl: prev?.sidebarImageUrl ?? null,
            hideUpgrade: prev?.hideUpgrade ?? false,
            menuLabelOverrides: prev?.menuLabelOverrides ?? undefined,
            hiddenFeatures: prev?.hiddenFeatures ?? undefined,
            customCssOverride: prev?.customCssOverride ?? null,
            // Overlay the preset look.
            primaryColor: preset.primaryColor,
            secondaryColor: preset.secondaryColor,
            accentColor: preset.accentColor,
            fontFamily: preset.fontFamily,
            gradientEnabled: preset.gradientEnabled,
            gradientColor: preset.gradientColor,
            gradientAngle: preset.gradientAngle,
            topBarColor: preset.topBarColor,
            buttonColor: preset.buttonColor,
            cornerRadius: preset.cornerRadius,
            scrollbarColor: preset.scrollbarColor,
            darkMode: preset.darkMode,
            animateLoadIn: preset.animateLoadIn,
            animateScroll: preset.animateScroll,
            topNav: preset.topNav,
            version: (prev?.version ?? 0) + 1,
          },
        });
        await prisma.locationInstall.update({ where: { id: loc.id }, data: { enabled: true } });
        return { locationInstallId: loc.id, theme };
      })
    );

    res.json({ applied: updated.length, results: updated });
  }
);

adminRouter.delete(
  "/admin/api/:agencyInstallId/presets/:presetId",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;
    // Scope the delete to this agency (don't let a preset id from another tenant be deleted).
    const result = await prisma.themePreset.deleteMany({
      where: { id: req.params.presetId, agencyInstallId: agencyId },
    });
    if (result.count === 0) return res.status(404).json({ error: "Preset not found" });
    res.json({ deleted: true });
  }
);
