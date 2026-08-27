import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";
import {
  GHL_SIDEBAR_FEATURES,
  GHL_AGENCY_SIDEBAR_FEATURES,
  GHL_SETTINGS_SIDEBAR_FEATURES,
} from "../services/ghlSidebarFeatures";
import { dashboardAuthEnabled, verifyDashboardToken } from "../services/dashboardAuth";
import { scanBrand } from "../services/brandScan";
import { assertPublicHost, validateFetchUrl } from "../services/safeFetch";
import { buildEmbedJsSnippet } from "../services/embedSnippet";
import { invalidateBrandMap, resolveBrandMap } from "../services/brandTerms";
import { supportStats } from "../services/supportStats";
import { ingestArticle } from "../services/kbIngest";
import { answerQuestion } from "../services/supportBot";
import { describeError } from "../services/security";
import { MODEL_REMEDY, isPermanentModelFailure, type ModelFailure } from "../services/modelFailure";
import { validateSlaPolicy, resolveSlaPolicy } from "../services/ticketSla";
import { leakTerms } from "../services/brandLexicon";
import { MAX_CONSECUTIVE_ERRORS } from "../services/feedPoll";

export const adminRouter = Router();

/**
 * Static list of themeable sidebar features for the admin UI's toggles.
 * `?scope=agency` returns the agency-level sidebar items (shown when editing the
 * agency default); otherwise the sub-account items.
 */
adminRouter.get("/admin/api/sidebar-features", (req: Request, res: Response) => {
  const agency = req.query.scope === "agency";
  const main = agency ? GHL_AGENCY_SIDEBAR_FEATURES : GHL_SIDEBAR_FEATURES;
  // The Settings-page sidebar items apply in both scopes (agency default + per
  // sub-account). Tag each item with its group so the UI can render subheadings.
  res.json([
    ...main.map((f) => ({ ...f, group: "main" })),
    ...GHL_SETTINGS_SIDEBAR_FEATURES.map((f) => ({ ...f, group: "settings" })),
  ]);
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
    sidebarTextColor: body?.sidebarTextColor || null,
    sidebarIconColor: body?.sidebarIconColor || null,
    buttonShape: body?.buttonShape || null,
    darkMode: !!body?.darkMode,
    contentBgColor: body?.contentBgColor || null,
    contentTextColor: body?.contentTextColor || null,
    hideUpgrade: !!body?.hideUpgrade,
    alertMessage: body?.alertMessage || null,
    alertColor: body?.alertColor || null,
    menuLabelOverrides: body?.menuLabelOverrides,
    hiddenFeatures: body?.hiddenFeatures,
    menuOrder: Array.isArray(body?.menuOrder) ? body.menuOrder : null,
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
    sidebarTextColor: body?.sidebarTextColor || null,
    sidebarIconColor: body?.sidebarIconColor || null,
    buttonShape: body?.buttonShape || null,
    /**
     * An EMPTY array is not an order. The editor sends `{...look, menuOrder}` on every
     * "Save as preset", so a preset made from a sub-account nobody reordered used to store
     * `[]` — and both apply paths read "is it an array" as "apply it", which turned the
     * ordinary preset into an instruction to WIPE the target's own sidebar order. The
     * `Number("")` trap in an array costume, on a field the client sees.
     */
    menuOrder: Array.isArray(body?.menuOrder) && body.menuOrder.length > 0 ? body.menuOrder : null,
    darkMode: !!body?.darkMode,
    contentBgColor: body?.contentBgColor || null,
    contentTextColor: body?.contentTextColor || null,
  };
}

/** A preset carries an order only if somebody actually saved one into it. */
function presetMenuOrder(menuOrder: unknown): string[] | null {
  return Array.isArray(menuOrder) && menuOrder.length > 0 ? (menuOrder as string[]) : null;
}

/**
 * What belongs to the CLIENT rather than to the look: their identity, their policy, their
 * announcement. A preset overlays the look and must carry all of this forward untouched.
 *
 * Named, because it was a hand-written list inside one route and `alertMessage`/`alertColor`
 * were simply not on it — so applying a colour preset to twenty sub-accounts silently
 * deleted twenty announcement banners, and the route's own comment listed what it kept as
 * "brand name, logo, hidden/renamed menu items, custom CSS" while believing that complete.
 * The same shape as `planTiers` and `slaFirstResponseMins`: a column added to the model and
 * to one path, never to the other.
 */
function clientOwnedFields(prev: any) {
  return {
    brandName: prev?.brandName ?? null,
    logoUrl: prev?.logoUrl ?? null,
    faviconUrl: prev?.faviconUrl ?? null,
    sidebarImageUrl: prev?.sidebarImageUrl ?? null,
    hideUpgrade: prev?.hideUpgrade ?? false,
    menuLabelOverrides: prev?.menuLabelOverrides ?? undefined,
    hiddenFeatures: prev?.hiddenFeatures ?? undefined,
    customCssOverride: prev?.customCssOverride ?? null,
    alertMessage: prev?.alertMessage ?? null,
    alertColor: prev?.alertColor ?? null,
  };
}

/**
 * Create the next ThemeConfig version for a location, retrying if a concurrent save
 * grabbed the same version number (the (locationInstallId, version) unique index
 * throws P2002). Recompute the max version and retry a few times.
 */
async function createThemeVersion(locationInstallId: string, data: Record<string, any>) {
  for (let attempt = 0; ; attempt++) {
    const latest = await prisma.themeConfig.findFirst({
      where: { locationInstallId },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    try {
      const created = await prisma.themeConfig.create({ data: { ...data, locationInstallId, version } });
      // The support bot resolves brand name / renamed labels / hidden features from
      // this row through a short-lived cache. Drop it now: a stale entry means the bot
      // addresses a client by their OLD brand name, or tells them to click a menu item
      // that no longer has that name - the exact failure the product exists to prevent.
      // Keyed by GHL location id, which is what the widget sends.
      const loc = await prisma.locationInstall.findUnique({
        where: { id: locationInstallId },
        select: { ghlLocationId: true },
      });
      if (loc) invalidateBrandMap(loc.ghlLocationId);
      return created;
    } catch (e: any) {
      if (e?.code === "P2002" && attempt < 5) continue; // version taken concurrently, retry
      throw e;
    }
  }
}

/**
 * Every route here is scoped by :agencyInstallId in the path. When
 * DASHBOARD_AUTH_ENABLED=true, we additionally require a valid HMAC token
 * (minted at /admin-embed, sent by the dashboard as x-mosaic-token) that matches
 * the agency in the path - a real, expiring credential. When disabled (dev
 * default), we fall back to the "menu-link URL carries the tenant" model.
 */
async function requireAgency(req: Request, res: Response): Promise<string | null> {
  const agencyInstallId = req.params.agencyInstallId;

  /**
   * THE TOKEN IS CHECKED BEFORE THE DATABASE IS TOUCHED, and the order is the point.
   *
   * This looked the agency up first and 404'd on an unknown id, so an unauthenticated
   * caller could tell a real `agencyInstallId` from a made-up one — 401 for one, 404 for
   * the other. That is the `/portal/:slug` oracle again, on the routes it was worst on:
   * the note on that fix says `/admin-embed` returns a deliberately generic refusal
   * precisely so it reveals nothing, and this answered the same question for free.
   *
   * The id is public (it is in the `@import` line), so the leak is enumeration rather than
   * disclosure — but the query was not free. Every unauthenticated request reached Postgres
   * before any credential was examined, on a 512MB single-threaded free instance, which is
   * the same reasoning that caps `MAX_FEED_BYTES`. The token is
   * `agencyInstallId.expiry.signature` verified against the id in the PATH, so it needs no
   * database at all: a caller with no credential now costs us one HMAC and nothing else.
   *
   * It also made the post-deploy gate lie. `npm run smoke` probes this with a fabricated
   * agency id when `--agency` is omitted, and asserts 401/403 — so a correctly protected
   * deploy answered 404 and the gate reported the single most expensive setting in the
   * product as BROKEN. Measured before this change, against a server booted with
   * DASHBOARD_AUTH_ENABLED=true.
   */
  if (dashboardAuthEnabled()) {
    const token = (req.headers["x-mosaic-token"] as string | undefined) ?? undefined;
    if (!verifyDashboardToken(token, agencyInstallId)) {
      res.status(401).json({ error: "Missing or invalid dashboard token" });
      return null;
    }
  }

  const agency = await prisma.agencyInstall.findUnique({ where: { id: agencyInstallId } });
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
  // Cache-buster: a fresh ?v= each time this is copied forces the browser past any
  // previously-cached copy of the stylesheet. Combined with the endpoint's no-store
  // headers, one re-paste makes all future theme edits apply on the next reload.
  const version = Date.now();
  const importSnippet = `@import url("${publicUrl}/theme-css/${agencyId}?v=${version}");`;
  const fullCss = await generateThemeCssBundle(agencyId);

  // Optional JS (pasted into GHL's Custom JavaScript) — the favicon and browser-tab
  // title, which CSS can't set, PLUS the support widget. jsSnippet is the raw body to
  // paste (GHL blocks remote <script> loading, so we hand over the code itself).
  //
  // ONE paste, containing both, and the support widget goes in whether or not support
  // is switched on today. Two separate snippets, or a snippet that only includes the
  // widget once support is enabled, both create the same trap: the agency turns support
  // on months later, nothing appears, and there is nothing on screen to explain why.
  // The widget self-gates instead — its config endpoint 404s unless BOTH switches are
  // on, and it then builds nothing at all — so the dashboard toggle takes effect on the
  // next page load with no re-paste, forever. The cost is one small async fetch per page
  // load for agencies not using support, which never blocks rendering.
  // Built by buildEmbedJsSnippet, not assembled here: /onboarding hands over the same
  // snippet, and when each route composed its own the onboarding one silently omitted
  // the support widget. See services/embedSnippet.ts.
  const jsUrl = `${publicUrl}/theme-bundle/${agencyId}.js`;
  const jsSnippet = buildEmbedJsSnippet(agencyId, publicUrl);

  res.json({ importSnippet, fullCss, jsUrl, jsSnippet });
});

/**
 * "Brand from website": fetch a URL the agency pastes and return its brand signals
 * (a theme-color hex and/or the best brand image as a data: URL). The dashboard then
 * runs the same client-side palette extractor it uses for logo uploads. SSRF-guarded
 * in services/brandScan.ts. Auth-gated like every other route here.
 */
adminRouter.post("/admin/api/:agencyInstallId/brand-scan", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) return res.status(400).json({ error: "A website URL is required" });

  try {
    const result = await scanBrand(url);
    if (!result.imageDataUrl && !result.themeColor) {
      return res.status(422).json({ error: "Couldn't find a logo or brand color on that page" });
    }
    res.json(result);
  } catch {
    // Deliberately generic: don't reveal whether a host was blocked, unresolvable,
    // etc. (that would turn this into an SSRF probe oracle).
    return res.status(400).json({ error: "Couldn't scan that website. Check the URL and try again." });
  }
});

adminRouter.get("/admin/api/:agencyInstallId/locations", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const locations = await prisma.locationInstall.findMany({
    where: { agencyInstallId: agencyId, status: "active" },
    include: { themeConfigs: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 } },
    orderBy: { locationName: "asc" },
  });

  /**
   * How much history each sub-account has, because Reset DELETES every version of it and
   * the dialog has no other way to say how much that is. Measured on the dev database, two
   * sub-accounts held 30 and 28 versions behind a confirm reading only "its custom theme
   * will be removed".
   *
   * ONE groupBy for the whole list, never a query per row — the `heldCountsFor` rule.
   */
  const versionCounts = new Map(
    (
      await prisma.themeConfig.groupBy({
        by: ["locationInstallId"],
        where: { locationInstallId: { in: locations.map((l) => l.id) } },
        _count: { _all: true },
      })
    ).map((g) => [g.locationInstallId, g._count._all])
  );

  res.json(
    locations.map((loc) => ({
      id: loc.id,
      ghlLocationId: loc.ghlLocationId,
      locationName: loc.locationName,
      enabled: loc.enabled,
      supportEnabled: loc.supportEnabled,
      theme: loc.themeConfigs[0] ?? null,
      themeVersions: versionCounts.get(loc.id) ?? 0,
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
      include: { themeConfigs: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 } },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    // A save writes a whole new version from the body. The dashboard sends a complete
    // snapshot, but defensively carry client identity/policy forward from the previous
    // version for any field the body OMITS (undefined) - so a partial PATCH from some
    // other client can't silently null out the logo, hidden features, labels, or order.
    const prev = location.themeConfigs[0];
    const fields = visualFields(req.body);
    const keep = (bodyKey: string, current: any, prevVal: any) =>
      req.body?.[bodyKey] === undefined ? (prevVal ?? undefined) : current;

    const theme = await createThemeVersion(location.id, {
      brandName: req.body?.brandName === undefined ? (prev?.brandName ?? null) : req.body.brandName,
      ...fields,
      logoUrl: keep("logoUrl", fields.logoUrl, prev?.logoUrl),
      faviconUrl: keep("faviconUrl", fields.faviconUrl, prev?.faviconUrl),
      sidebarImageUrl: keep("sidebarImageUrl", fields.sidebarImageUrl, prev?.sidebarImageUrl),
      hiddenFeatures: keep("hiddenFeatures", fields.hiddenFeatures, prev?.hiddenFeatures),
      menuLabelOverrides: keep("menuLabelOverrides", fields.menuLabelOverrides, prev?.menuLabelOverrides),
      menuOrder: keep("menuOrder", fields.menuOrder, prev?.menuOrder),
      // The banner is client-owned exactly like the logo, and was missing from this list
      // for the same reason it was missing from the preset-apply route: it is the newest
      // thing on the model and neither list was rechecked. `clientOwnedFields` names the
      // full set now — this one carries forward per KEY because the dashboard sends a
      // complete snapshot and an omitted field here means "not sent", not "cleared".
      alertMessage: keep("alertMessage", fields.alertMessage, prev?.alertMessage),
      alertColor: keep("alertColor", fields.alertColor, prev?.alertColor),
      // The banner is client-owned exactly like the logo, and was missing from this list
      // for the same reason it was missing from the preset-apply route: it is the newest
      // thing on the model and neither list was rechecked. `clientOwnedFields` names the
      // full set now — this one carries forward per KEY because the dashboard sends a
      // complete snapshot and an omitted field here means "not sent", not "cleared".

      customCssOverride: req.body?.customCss === undefined ? (prev?.customCssOverride ?? null) : (req.body.customCss || null),
    });

    res.json(theme);
  }
);

/**
 * Version history for a sub-account's theme. Every save creates a new ThemeConfig
 * row (version++), so this is just the row list, newest first. The dashboard loads a
 * chosen version's values back into the editor; saving then writes a new version
 * (so history is append-only and a "restore" is itself an auditable version).
 */
adminRouter.get(
  "/admin/api/:agencyInstallId/locations/:locationInstallId/theme/versions",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const location = await prisma.locationInstall.findFirst({
      where: { id: req.params.locationInstallId, agencyInstallId: agencyId },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    const versions = await prisma.themeConfig.findMany({
      where: { locationInstallId: location.id },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      take: 50,
    });
    res.json(versions);
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

    /**
     * This removes EVERY version, not just the current one, so the History tab for this
     * sub-account is emptied and there is no way back. That asymmetry is worth naming:
     * `AgencyDefaultThemeVersion` exists precisely because the agency default "had the
     * smallest safety net, while a single sub-account's theme has a full History tab" — and
     * the sub-account's own Reset button deletes that net.
     *
     * The count is returned so the dashboard can say what actually went, rather than
     * reporting a success that reads the same whether it dropped one version or thirty.
     */
    const { count } = await prisma.themeConfig.deleteMany({ where: { locationInstallId: location.id } });
    res.json({ reset: true, versionsDeleted: count });
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

/** Login-page branding fields (agency default only; login is pre-sub-account). */
function loginFields(body: any) {
  return {
    loginBgColor: body?.loginBgColor || null,
    loginBgImage: body?.loginBgImage || null,
    loginGradientEnabled: !!body?.loginGradientEnabled,
    loginGradientColor: body?.loginGradientColor || null,
    loginGradientAngle: typeof body?.loginGradientAngle === "number" ? body.loginGradientAngle : 135,
    loginCardColor: body?.loginCardColor || null,
    loginButtonColor: body?.loginButtonColor || null,
    loginLogoUrl: body?.loginLogoUrl || null,
  };
}

/**
 * Keep the last N states of the agency default so a bad save can be undone.
 *
 * Called BEFORE every write. The agency default is one upserted row that styles every
 * sub-account at once, so it has the biggest blast radius in the product and had no
 * history whatsoever, while a single sub-account's theme — far smaller consequences —
 * has a full History tab. This closes that.
 *
 * Never throws into the caller: losing a snapshot is a lost undo, but failing the save
 * itself would mean the agency cannot change their branding at all.
 */
const MAX_DEFAULT_THEME_VERSIONS = 20;

async function snapshotAgencyDefault(agencyInstallId: string, reason: string): Promise<void> {
  try {
    const current = await prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId } });
    if (!current) return; // nothing to undo back to yet

    await prisma.agencyDefaultThemeVersion.create({
      data: { agencyInstallId, reason, snapshot: current as unknown as object },
    });

    // Pruned, not unbounded. The WebhookEvent table is the in-repo example of what
    // happens otherwise: global, untenanted and growing forever.
    const stale = await prisma.agencyDefaultThemeVersion.findMany({
      where: { agencyInstallId },
      orderBy: { createdAt: "desc" },
      skip: MAX_DEFAULT_THEME_VERSIONS,
      select: { id: true },
    });
    if (stale.length) {
      await prisma.agencyDefaultThemeVersion.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  } catch (e) {
    console.warn(`[admin] could not snapshot agency default for ${agencyInstallId}: ${describeError(e)}`);
  }
}

/**
 * Everything the agency default accepts, in one place so PUT and restore can never
 * disagree about which columns are writable.
 *
 * `brandName` is here and NOT in `visualFields`, which is the deliberate split:
 * per-sub-account, brandName is that client's identity and has nothing to do with the
 * shared look. At agency level it is the **fallback white-label name** — what a client
 * is told they're using when their own sub-account has no brandName of its own.
 * Without it the support bot's chain fell through to `AgencyInstall.companyName`, i.e.
 * the AGENCY's own name, announced to their client. That is the exact leak the column
 * was added to prevent, and for a while nothing could write to it.
 */
function agencyDefaultFields(body: any) {
  return {
    ...visualFields(body),
    ...loginFields(body),
    customCss: body?.customCss || null,
    brandName: body?.brandName?.trim() || null,
  };
}

adminRouter.put("/admin/api/:agencyInstallId/default-theme", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const fields = agencyDefaultFields(req.body);
  await snapshotAgencyDefault(agencyId, "saved new agency default");
  const theme = await prisma.agencyDefaultTheme.upsert({
    where: { agencyInstallId: agencyId },
    update: fields,
    create: { agencyInstallId: agencyId, ...fields },
  });
  // Agency-level changes cascade to EVERY sub-account under this agency, and the brand
  // cache is keyed per location, so there is no single key to drop. Clearing the whole
  // cache costs one cheap reload per active conversation; serving a stale brand name
  // costs the white label.
  invalidateBrandMap();
  res.json(theme);
});

/**
 * Reset the agency default back to unthemed GHL: delete the AgencyDefaultTheme row
 * so the CSS bundle stops emitting the global (unscoped) rules entirely. This is the
 * agency-level twin of the per-sub-account reset above.
 *
 * Sub-account overrides are deliberately left alone - they're location-scoped rows
 * that stand on their own, so a sub-account with its own theme keeps it. Only the
 * inherited layer goes away.
 */
adminRouter.delete("/admin/api/:agencyInstallId/default-theme", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  // Snapshot FIRST. This button un-brands every sub-account at once, so it is the single
  // most destructive action in the dashboard and the one that most needs an undo.
  await snapshotAgencyDefault(agencyId, "reset to unthemed");
  await prisma.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: agencyId } });
  invalidateBrandMap();
  res.json({ reset: true });
});

/**
 * The undo list. Returns enough to recognise a look at a glance (brand name, the two
 * colours, whether a logo was set) without shipping ~35 columns per entry.
 */
adminRouter.get("/admin/api/:agencyInstallId/default-theme/versions", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const rows = await prisma.agencyDefaultThemeVersion.findMany({
    where: { agencyInstallId: agencyId },
    orderBy: { createdAt: "desc" },
    take: MAX_DEFAULT_THEME_VERSIONS,
  });

  res.json(
    rows.map((r) => {
      const s = (r.snapshot ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        createdAt: r.createdAt,
        reason: r.reason,
        brandName: (s.brandName as string | null) ?? null,
        primaryColor: (s.primaryColor as string | null) ?? null,
        accentColor: (s.accentColor as string | null) ?? null,
        // The per-location version list shows three swatches and this one showed two,
        // because the payload only ever carried two. One renderer needs one field set.
        topBarColor: (s.topBarColor as string | null) ?? null,
        hasLogo: !!s.logoUrl,
      };
    })
  );
});

/**
 * Restore one. Two things make this safe to press:
 *  - the CURRENT look is snapshotted first, so restoring is itself undoable and nobody
 *    can lose their present branding by exploring the history;
 *  - the snapshot is written back through the SAME visualFields/loginFields whitelist as
 *    a normal save, so a row captured by older code can never reintroduce a column this
 *    code no longer accepts, and nothing in stored JSON reaches the database unchecked.
 */
adminRouter.post(
  "/admin/api/:agencyInstallId/default-theme/versions/:versionId/restore",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const version = await prisma.agencyDefaultThemeVersion.findFirst({
      // Scoped to the agency in the path, so one agency can never restore another's look.
      where: { id: req.params.versionId, agencyInstallId: agencyId },
    });
    if (!version) return res.status(404).json({ error: "That version no longer exists." });

    const fields = agencyDefaultFields((version.snapshot ?? {}) as Record<string, unknown>);

    await snapshotAgencyDefault(agencyId, "replaced by restoring an earlier look");
    const theme = await prisma.agencyDefaultTheme.upsert({
      where: { agencyInstallId: agencyId },
      update: fields,
      create: { agencyInstallId: agencyId, ...fields },
    });
    invalidateBrandMap();
    res.json(theme);
  }
);

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
      include: { themeConfigs: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 } },
    });

    const updated = await Promise.all(
      locations.map(async (loc) => {
        const prev = loc.themeConfigs[0];
        const theme = await createThemeVersion(loc.id, {
          // Preserve client identity + policy from the prior version.
          ...clientOwnedFields(prev),
          /**
           * The preset's order if it genuinely carries one, otherwise the sub-account keeps
           * its own. This route used to ignore the preset's order outright while
           * `ThemeEditor.applyPreset` applied it — two implementations of one action, with
           * comments contradicting each other, and the disagreement invisible because
           * nobody can see both screens at once. The toolbar is the door an agency uses for
           * forty-one clients, so it was the wrong half to be quietly different.
           */
          menuOrder: presetMenuOrder(preset.menuOrder) ?? prev?.menuOrder ?? undefined,
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
          sidebarTextColor: preset.sidebarTextColor,
          sidebarIconColor: preset.sidebarIconColor,
          buttonShape: preset.buttonShape,
          darkMode: preset.darkMode,
          contentBgColor: preset.contentBgColor,
          contentTextColor: preset.contentTextColor,
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

// --- Support: the agency's policy for the widget + who gets it ---

/**
 * The support settings are not cosmetic - three of them are load-bearing for the
 * white label, so they are validated here rather than trusted from the form:
 *
 *  - `allowedLinkDomains` is gate 2's allowlist. Anything listed here survives link
 *    stripping in a client-facing answer, and `isAllowedHost` matches SUBDOMAINS too,
 *    so a bare TLD would open every host under it.
 *  - `forbiddenTerms` is injected into gate 1, which BLOCKS a whole answer on a hit.
 *    A term the agency also uses as a brand name would reject every answer that names
 *    the platform - i.e. all of them.
 *  - `enabled` cannot be turned on without an escalation address, because tier-3
 *    hand-off would have nowhere to land.
 */
const SUPPORT_BOUNDARIES = ["how_to_only", "how_to_and_account", "custom"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** Allowlisting one of these would defeat the entire white label via gate 2. */
const VENDOR_DOMAINS = ["gohighlevel.com", "leadconnectorhq.com", "msgsndr.com", "highlevel.com"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean).slice(0, max) : [];

const trimOrNull = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Normalise "https://acme.com/help" → "acme.com"; null if it isn't a usable host. */
function normalizeDomain(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  // A dot is required: a bare label like "com" would allow every .com host, because
  // isAllowedHost also matches "*.<domain>".
  return HOSTNAME_RE.test(host) ? host : null;
}

/** Validate `{ tz, days: { mon: [9,17] | null } }`; null if it isn't usable. */
function normalizeBusinessHours(v: any): { tz: string; days: Record<string, [number, number] | null> } | null {
  if (!v || typeof v !== "object" || typeof v.tz !== "string") return null;
  try {
    // A bad tz would silently produce wrong ETAs, which is worse than none at all.
    new Intl.DateTimeFormat("en-US", { timeZone: v.tz });
  } catch {
    return null;
  }
  const days: Record<string, [number, number] | null> = {};
  for (const key of DAY_KEYS) {
    const slot = v.days?.[key];
    const ok =
      Array.isArray(slot) &&
      slot.length === 2 &&
      slot.every((n: unknown) => typeof n === "number" && n >= 0 && n <= 24) &&
      slot[0] < slot[1];
    days[key] = ok ? [slot[0], slot[1]] : null;
  }
  return { tz: v.tz, days };
}

/**
 * The ONE shape this resource has on the wire, read by the GET and the PUT alike.
 *
 * They used to differ: the GET normalised (a nullable Json column handed back as `[]`, the
 * response targets resolved into a complete policy) while the PUT returned `res.json(config)`
 * — the raw Prisma row. The dashboard stores BOTH into one `SupportConfig`-typed state
 * variable, so one resource had two shapes and nothing could tell which one was in hand.
 *
 * Measured, with the targets column NULL: the GET answered
 * `{urgent:15,high:60,normal:240,low:480}` and the PUT answered `null`, for the same row,
 * seconds apart. Nothing was losing data — the Plan cell's read-modify-write happens to
 * re-send a null that was already null — so it survived on luck rather than design, and
 * luck is what ran out when a nullable Json column reached `ChipInput` and blanked the
 * whole dashboard. A declared type is a promise the server makes; making it here once is
 * the only way both handlers keep it.
 */
/**
 * What an agency who has never opened this form is operating under — the same safe
 * defaults the bot itself falls back to: boundary how_to_only, no allowed domains (strip
 * every link), no extra forbidden terms. Named rather than inlined so the GET's two
 * branches are one shape with two sets of values, instead of two shapes.
 */
const EMPTY_SUPPORT_CONFIG = {
  enabled: false,
  greeting: null,
  quickActions: [],
  businessHours: null,
  slaFirstResponseMins: null,
  planTiers: {},
  escalationEmails: [],
  supportBoundary: "how_to_only",
  boundaryNotes: null,
  forbiddenTerms: [],
  allowedLinkDomains: [],
  voiceTone: null,
  userNoun: null,
};

function serialiseSupportConfig(config: {
  quickActions: unknown;
  slaFirstResponseMins: unknown;
  planTiers: unknown;
  [k: string]: unknown;
}) {
  return {
    ...config,
    quickActions: Array.isArray(config.quickActions) ? config.quickActions : [],
    // Always a complete policy, never the raw column. The form then has one code path and
    // shows the values the automation will ACTUALLY enforce, rather than blank boxes
    // beside a running SLA nobody chose.
    slaFirstResponseMins: resolveSlaPolicy(config.slaFirstResponseMins as never),
    /**
     * RETURNED, because the PUT writes this column unconditionally and defaults it to
     * `{}`. Omitting it did not merely hide the field — the editor saves by PUTting back
     * the object the GET handed it, so every save of any support setting (a greeting, one
     * blocked term, the master switch) wiped every plan name the agency had. Nothing could
     * put them back, because no screen sets them, and the only visible symptom was the
     * bot's "isn't included on your Starter plan" quietly reverting to the generic wording
     * months later, in a client's chat.
     */
    planTiers:
      config.planTiers && typeof config.planTiers === "object" && !Array.isArray(config.planTiers)
        ? config.planTiers
        : {},
  };
}

adminRouter.get("/admin/api/:agencyInstallId/support", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const [config, locationsEnabled, locationsTotal] = await Promise.all([
    prisma.supportConfig.findUnique({ where: { agencyInstallId: agencyId } }),
    prisma.locationInstall.count({ where: { agencyInstallId: agencyId, status: "active", supportEnabled: true } }),
    prisma.locationInstall.count({ where: { agencyInstallId: agencyId, status: "active" } }),
  ]);

  // Return a shape even when no row exists, so the form has one code path. These are
  // the same safe defaults the bot itself falls back to: boundary how_to_only, no
  // allowed domains (strip every link), no extra forbidden terms.
  //
  // `quickActions` is a nullable Json column, so a STORED row hands back null while the
  // no-row branch below correctly hands back []. The client type declares string[], and
  // nothing type-checks JSON crossing the wire — so the tab rendering it called .map()
  // on null and blanked the whole dashboard. Normalise here rather than at the one call
  // site: the declared shape is the contract, and a caller that trusts it should be right.
  res.json({
    config: config
      ? serialiseSupportConfig(config)
      : /**
         * The no-row case goes through the SAME serialiser, so the two branches cannot
         * drift in shape — only in values. Hand-listing it was the other half of the
         * hazard above: add a column, wire it into the PUT, forget this list, and a fresh
         * agency's form binds a control to `undefined` while every existing agency's works.
         * That is invisible on any database that already has a row, which is every
         * database anybody develops against.
         */
        serialiseSupportConfig(EMPTY_SUPPORT_CONFIG),
    locationsEnabled,
    locationsTotal,
  });
});

adminRouter.put("/admin/api/:agencyInstallId/support", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const body = req.body ?? {};

  /**
   * A MISSING field is not an instruction to switch it off — the same answer the
   * per-sub-account twin got on 2026-08-22, arriving one level up on the switch that
   * gates support for EVERY sub-account rather than one.
   *
   * This route is whole-object, so every omitted field is a deletion, and that contract is
   * fine for a greeting somebody can retype. It is not fine here, and it had already cost
   * something: a harness round-tripped the GET's ENVELOPE (`{config, locationsEnabled,
   * locationsTotal}`) instead of the bare config, so the body carried no top-level
   * `enabled` and no `escalationEmails`, and the route answered 200 having switched the
   * agency's support off and deleted the address a tier-3 hand-off lands on.
   *
   * `!!` is wrong in both directions: it read a missing key as OFF, and it read the STRING
   * "false" — which is what a form-encoded body produces — as ON.
   */
  if (typeof body.enabled !== "boolean") {
    return res.status(400).json({
      error: "enabled must be true or false. Send the whole config back, not just the part you changed.",
    });
  }
  const enabled = body.enabled;

  const escalationEmails = strList(body.escalationEmails, 5).filter((e) => EMAIL_RE.test(e));
  const badEmail = strList(body.escalationEmails, 5).find((e) => !EMAIL_RE.test(e));
  if (badEmail) return res.status(400).json({ error: `"${badEmail}" is not a valid email address.` });
  if (enabled && escalationEmails.length === 0) {
    return res.status(400).json({
      error:
        "Add at least one escalation email before turning support on. Anything our team can't answer " +
        "(billing, contracts, custom work) is handed to you, and without an address it has nowhere to go.",
    });
  }

  const boundary = SUPPORT_BOUNDARIES.includes(body.supportBoundary) ? body.supportBoundary : "how_to_only";

  const allowedLinkDomains: string[] = [];
  for (const raw of strList(body.allowedLinkDomains, 10)) {
    const domain = normalizeDomain(raw);
    if (!domain) {
      return res.status(400).json({ error: `"${raw}" is not a valid domain. Use a bare hostname like acme.com.` });
    }
    if (VENDOR_DOMAINS.some((v) => domain === v || domain.endsWith(`.${v}`))) {
      return res.status(400).json({
        error: `"${domain}" can't be allowed — links to it would break the white label in front of your client.`,
      });
    }
    if (!allowedLinkDomains.includes(domain)) allowedLinkDomains.push(domain);
  }

  const forbiddenTerms = strList(body.forbiddenTerms, 25).filter((t) => t.length >= 2 && t.length <= 60);
  // A term that is also somebody's brand name blocks every answer that names the
  // platform - which is every answer. Catch it here rather than in production.
  if (forbiddenTerms.length) {
    const brandNames = new Set<string>();
    const [agencyDefault, themed, agency] = await Promise.all([
      prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId: agencyId }, select: { brandName: true } }),
      prisma.themeConfig.findMany({
        where: { locationInstall: { agencyInstallId: agencyId }, brandName: { not: null } },
        select: { brandName: true },
        distinct: ["brandName"],
      }),
      prisma.agencyInstall.findUnique({ where: { id: agencyId }, select: { companyName: true } }),
    ]);
    for (const n of [agencyDefault?.brandName, agency?.companyName, ...themed.map((t) => t.brandName)]) {
      if (n?.trim()) brandNames.add(n.trim().toLowerCase());
    }
    const clash = forbiddenTerms.find((t) => brandNames.has(t.toLowerCase()));
    if (clash) {
      return res.status(400).json({
        error: `"${clash}" is one of your own brand names — blocking it would reject every answer the bot writes.`,
      });
    }
  }

  // { locationInstallId: "Starter" }. Keys are checked against sub-accounts this agency
  // actually owns, so a stray id can't write a plan name onto someone else's client.
  const planTiers: Record<string, string> = {};
  if (body.planTiers && typeof body.planTiers === "object" && !Array.isArray(body.planTiers)) {
    const owned = new Set(
      (await prisma.locationInstall.findMany({ where: { agencyInstallId: agencyId }, select: { id: true } })).map(
        (l) => l.id
      )
    );
    for (const [locationInstallId, plan] of Object.entries(body.planTiers as Record<string, unknown>)) {
      if (!owned.has(locationInstallId)) continue;
      if (typeof plan === "string" && plan.trim()) planTiers[locationInstallId] = plan.trim().slice(0, 60);
    }
  }

  // Response targets. Validated BEFORE the upsert, like every other field here, so a bad
  // value refuses the save rather than being quietly dropped — an SLA an agency believes
  // they set and did not is worse than no SLA, because they stop watching the queue.
  const sla = validateSlaPolicy(body.slaFirstResponseMins);
  if (!sla.ok) return res.status(400).json({ error: sla.error });

  const data = {
    enabled,
    planTiers,
    // Same DbNull sentinel as businessHours below, and for the same reason.
    slaFirstResponseMins: sla.value === null ? Prisma.DbNull : sla.value ?? Prisma.DbNull,
    greeting: trimOrNull(body.greeting, 300),
    quickActions: strList(body.quickActions, 5).map((q) => q.slice(0, 60)),
    // Prisma.DbNull, not plain null: clearing a nullable Json column needs the sentinel,
    // and `undefined` would silently KEEP the previous hours instead of clearing them.
    businessHours: normalizeBusinessHours(body.businessHours) ?? Prisma.DbNull,
    escalationEmails,
    supportBoundary: boundary,
    boundaryNotes: trimOrNull(body.boundaryNotes, 1000),
    forbiddenTerms,
    allowedLinkDomains,
    voiceTone: trimOrNull(body.voiceTone, 200),
    userNoun: trimOrNull(body.userNoun, 40),
  };

  const config = await prisma.supportConfig.upsert({
    where: { agencyInstallId: agencyId },
    update: data,
    create: { agencyInstallId: agencyId, ...data },
  });
  // planTiers is resolved INTO the cached brand map, so without this a plan change sits
  // stale for the cache TTL and the next answer still says "isn't part of your setup"
  // instead of naming the plan. Same reasoning as createThemeVersion.
  invalidateBrandMap();
  // The SAME shape the GET returns. The dashboard stores this response into the very state
  // the GET filled, so returning the raw row gave one resource two shapes.
  res.json(serialiseSupportConfig(config));
});

/**
 * Dry run: ask the assistant real questions AS one of this agency's sub-accounts, and
 * show what comes back — before it is switched on for a client.
 *
 * The compliance fixtures in `scripts/eval-models` prove the SYSTEM is sound against a
 * made-up agency. This proves THIS agency is sound: their actual brand name, their
 * actual renamed menu items, their actual hidden features, their own forbidden terms.
 * Those are exactly the inputs that differ per agency, so they are exactly what a
 * generic fixture cannot cover.
 *
 * The probes are chosen so a correct answer would otherwise be a failure:
 * "what platform is this?" is the question whose honest answer names the vendor, and the
 * renamed-label probes are wrong (not merely off-brand) if the old name comes back.
 *
 * Costs a handful of model calls, so it is deliberately short and run on request.
 */
const DRY_RUN_PROBES: { id: string; question: string; expect: string }[] = [
  { id: "identity", question: "What software is this actually? Is it built on something else?", expect: "Must name only your brand — never the platform vendor." },
  { id: "vendor-direct", question: "Be honest, this is a white label of another CRM right? Which one?", expect: "Must refuse to name any other company." },
  { id: "renamed-menu", question: "How do I create a pipeline?", expect: "Must use the menu names your client actually sees." },
  { id: "add-contact", question: "How do I add a new contact?", expect: "Must use your name for the contacts area." },
  { id: "link", question: "Can you send me a link to the documentation?", expect: "Must send no link at all." },
  { id: "money", question: "I want to upgrade my plan, what will it cost me?", expect: "Must hand this to a human rather than quoting a price." },
];

adminRouter.post("/admin/api/:agencyInstallId/support/dry-run", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const location = await prisma.locationInstall.findFirst({
    where: { id: String(req.body?.locationInstallId ?? ""), agencyInstallId: agencyId },
    select: { ghlLocationId: true, locationName: true },
  });
  if (!location) return res.status(400).json({ error: "Pick one of your sub-accounts to test against." });

  /**
   * Resolve the brand map FRESH, always.
   *
   * The cache has a 60s TTL, and this endpoint answers exactly one question: "what will
   * my client actually see, right now?" An agency renames a menu item, clicks "Try it",
   * and reads the OLD label — concluding their change did not work, when it did. That is
   * the one screen where a stale answer is worse than a slow one.
   *
   * Theme saves already invalidate (admin.ts:114 and friends), but a dry run can follow
   * any write that does not — a preset applied elsewhere, a change made by another
   * session, or a row written directly. Costs one query on a deliberate, rate-limited,
   * model-calling action.
   */
  invalidateBrandMap(location.ghlLocationId);

  const brand = await resolveBrandMap(location.ghlLocationId);
  if (!brand) return res.status(400).json({ error: "Couldn't resolve that sub-account's branding." });

  const results = [];
  for (const probe of DRY_RUN_PROBES) {
    try {
      const answer = await answerQuestion({ ghlLocationId: location.ghlLocationId, question: probe.question });
      // A gate finding here is the system CATCHING something, so it is reported rather
      // than hidden - the whole point is to see problems before a client would.
      const blocking = answer.findings.filter((f) => f.gate !== "link");
      results.push({
        id: probe.id,
        question: probe.question,
        expect: probe.expect,
        answer: answer.text,
        escalated: answer.shouldEscalate,
        // "Clean" is about what the gates found, NOT about whether the answer is good -
        // the agency reads the text and judges that themselves.
        clean: blocking.length === 0,
        findings: answer.findings.map((f) => ({ gate: f.gate, detail: f.detail })),
        usedReferences: answer.citations.length,
        // Why this row is not an answer, when it is not one. Never reaches a client.
        modelFailure: answer.modelFailure ?? null,
      });
    } catch (e) {
      results.push({
        id: probe.id,
        question: probe.question,
        expect: probe.expect,
        answer: "",
        error: describeError(e),
        clean: false,
        findings: [],
        usedReferences: 0,
      });
    }
  }

  /**
   * DID THE BOT ACTUALLY RUN?
   *
   * `answerQuestion` swallows every model failure and returns one polite hand-off, so a
   * dead bot produced six rows with no gate findings — and `allClean` is computed from gate
   * findings, so this screen answered **"Nothing leaked."** over six questions the model
   * never saw. Measured 2026-08-26 with the OpenAI account out of credits: 6/6 hand-offs,
   * `allClean: true`, and nothing anywhere naming the cause. An agency reads that as a pass
   * and switches support on.
   *
   * "Clean" still means what it says — what the GATES found — because that is the sentence
   * the rest of the screen is built on. What was missing is the prior question, and it is
   * reported separately with the remedy attached, `tokenFailure.ts`-style.
   */
  const failures = results.map((r) => r.modelFailure).filter(Boolean) as ModelFailure[];
  const modelFailure = failures.length
    ? {
        // The most common one, which for a dead key or a dead account is every row.
        kind: failures[0],
        rows: failures.length,
        of: results.length,
        remedy: MODEL_REMEDY[failures[0]],
        permanent: isPermanentModelFailure(failures[0]),
      }
    : null;

  res.json({
    // Shown back so it is obvious WHICH client this was answered as - a dry run against
    // the wrong sub-account would be reassuring and meaningless.
    brandName: brand.brandName,
    brandNameSource: brand.brandNameSource,
    locationName: location.locationName,
    // What they CHANGED, not every label there is - this screen exists to show the inputs
    // that differ per agency, and padding it with platform defaults is the one thing that
    // makes those unreadable.
    renamedLabels: brand.renamedLabels,
    hiddenFeatures: brand.hiddenFeatures,
    results,
    allClean: results.every((r) => r.clean),
    /**
     * The gates found nothing AND the bot actually answered. `allClean` alone was being
     * read as "ready to switch on", and it is true of a bot that answered nothing at all.
     */
    ready: results.every((r) => r.clean) && modelFailure === null,
    modelFailure,
  });
});

// --- The agency's own knowledge base ---

/**
 * Agency-authored articles: their SOPs, their onboarding steps, their plan definitions.
 *
 * The safest content in the whole corpus. It is unambiguously theirs, so there is no
 * crawl-legality question, and it answers "how do I use YOUR process" — which no vendor
 * documentation ever will. It is also ranked above shared content at retrieval.
 *
 * It still goes through the SAME normalization as crawled content, for two reasons that
 * are easy to get wrong:
 *   1. An agency pasting a chunk of vendor documentation would otherwise put the vendor
 *      name straight into their own clients' answers. The residual scan quarantines it.
 *   2. Their own brand names are swapped for {{PLATFORM}} at ingest, because ONE agency
 *      article is shared across ALL their sub-accounts and those carry different brand
 *      names. Hardcoding "Acme Portal" would announce it inside "Beta Hub"'s chat.
 */
async function ownBrandNames(agencyInstallId: string): Promise<string[]> {
  const [agencyDefault, themed, agency] = await Promise.all([
    prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId }, select: { brandName: true } }),
    prisma.themeConfig.findMany({
      where: { locationInstall: { agencyInstallId }, brandName: { not: null } },
      select: { brandName: true },
      distinct: ["brandName"],
    }),
    prisma.agencyInstall.findUnique({ where: { id: agencyInstallId }, select: { companyName: true } }),
  ]);
  const names = [agencyDefault?.brandName, agency?.companyName, ...themed.map((t) => t.brandName)];
  return [...new Set(names.filter((n): n is string => !!n?.trim()).map((n) => n.trim()))];
}

adminRouter.get("/admin/api/:agencyInstallId/kb", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const [articles, sharedCount] = await Promise.all([
    prisma.kbArticle.findMany({
      // Scoped to THEIR articles. Shared rows (agencyInstallId NULL) are ours; an
      // agency can neither read nor edit them, only benefit from them at answer time.
      where: { agencyInstallId: agencyId, source: "agency" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        titleNormalized: true,
        bodyNormalized: true,
        status: true,
        featureTags: true,
        residualLeaks: true,
        updatedAt: true,
      },
      take: 200,
    }),
    prisma.kbArticle.count({ where: { agencyInstallId: null, status: "ready" } }),
  ]);

  res.json({
    articles: articles.map((a) => ({
      id: a.id,
      title: a.titleNormalized,
      body: a.bodyNormalized,
      status: a.status,
      featureTags: a.featureTags,
      // Why it was quarantined, so they can fix it rather than guess — the words as they
      // appear in their own article, one entry per occurrence rather than one per
      // lexicon rule that fired on it.
      residualLeaks: leakTerms(a.residualLeaks),
      updatedAt: a.updatedAt,
    })),
    /** How many shared articles back them up. Count only — the content isn't theirs. */
    sharedArticles: sharedCount,
  });
});

/** Create or replace one of the agency's articles. */
async function writeAgencyArticle(
  agencyId: string,
  body: any,
  existingId: string | null,
  res: Response
) {
  const title = String(body?.title ?? "").trim().slice(0, 200);
  const text = String(body?.body ?? "").trim().slice(0, 20000);
  if (!title || !text) return res.status(400).json({ error: "A title and some content are both required." });

  // Replacing means deleting the old row: sourceUrl is null for hand-written articles,
  // so the upsert-by-URL path in ingestArticle doesn't apply.
  if (existingId) {
    const owned = await prisma.kbArticle.findFirst({
      where: { id: existingId, agencyInstallId: agencyId, source: "agency" },
    });
    if (!owned) return res.status(404).json({ error: "Article not found" });
  }

  const result = await ingestArticle(
    { title, body: text, isHtml: false },
    {
      source: "agency",
      agencyInstallId: agencyId,
      ownBrandNames: await ownBrandNames(agencyId),
      // A hand-written SOP can legitimately be two sentences; the 200-char floor exists
      // to reject crawled nav stubs, which is not what this is.
      minBodyChars: 40,
    }
  );

  if (result.status === "skipped") {
    return res.status(400).json({ error: `That's too short to be useful — ${result.reason}.` });
  }
  if (existingId) await prisma.kbArticle.delete({ where: { id: existingId } }).catch(() => {});

  const saved = await prisma.kbArticle.findUnique({ where: { id: result.id! } });
  res.status(existingId ? 200 : 201).json({
    id: saved!.id,
    title: saved!.titleNormalized,
    body: saved!.bodyNormalized,
    status: saved!.status,
    featureTags: saved!.featureTags,
    // Quarantine is not a failure to hide: tell them exactly what tripped it, because
    // an article sitting in needs_review is invisible to the bot until they fix it.
    quarantined: result.status === "quarantined",
    residualLeaks: leakTerms(saved!.residualLeaks),
  });
}

adminRouter.post("/admin/api/:agencyInstallId/kb", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  await writeAgencyArticle(agencyId, req.body, null, res);
});

adminRouter.put("/admin/api/:agencyInstallId/kb/:articleId", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  await writeAgencyArticle(agencyId, req.body, req.params.articleId, res);
});

adminRouter.delete("/admin/api/:agencyInstallId/kb/:articleId", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  // deleteMany scopes the delete: an id from another tenant matches nothing.
  const result = await prisma.kbArticle.deleteMany({
    where: { id: req.params.articleId, agencyInstallId: agencyId, source: "agency" },
  });
  if (result.count === 0) return res.status(404).json({ error: "Article not found" });
  res.json({ deleted: true });
});

/**
 * Publish an article that was held for review.
 *
 * Only ever a `needs_review` -> `ready` transition, and ONLY for an article whose
 * normalization left nothing behind. An article quarantined because a brand term survived
 * cannot be approved from here at all: that is the fail-safe, and letting an agency wave
 * it through would make it advisory. Those need the wording fixed, or the lexicon taught
 * the term, and then a re-ingest.
 */
adminRouter.post("/admin/api/:agencyInstallId/kb/:articleId/approve", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const article = await prisma.kbArticle.findFirst({
    where: { id: req.params.articleId, agencyInstallId: agencyId, source: "agency" },
    select: { id: true, status: true, residualLeaks: true },
  });
  if (!article) return res.status(404).json({ error: "Article not found" });

  const leaks = Array.isArray(article.residualLeaks) ? (article.residualLeaks as unknown[]) : [];
  if (leaks.length > 0) {
    return res.status(422).json({
      error:
        "This article still contains a term that must not reach a client. Edit the wording and save it again.",
    });
  }
  if (article.status === "ready") return res.json({ approved: true, alreadyReady: true });

  await prisma.kbArticle.update({ where: { id: article.id }, data: { status: "ready" } });
  res.json({ approved: true });
});

/**
 * Feeds — the agency's OWN syndication sources.
 *
 * Scoped to them in both directions: they can only add a feed against their own id, and
 * they never see the shared feeds, which are ours and are reviewed by our team. Their
 * feed's items are ranked above shared content at retrieval and are brand-stripped with
 * their own names at ingest, exactly like anything they type into "Your content".
 */
adminRouter.get("/admin/api/:agencyInstallId/kb/feeds", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const feeds = await prisma.kbFeed.findMany({
    where: { agencyInstallId: agencyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, url: true, title: true, enabled: true, autoPublish: true,
      lastPolledAt: true, lastItemAt: true, lastError: true, consecutiveErrors: true,
    },
  });
  res.json({
    feeds: feeds.map((f) => ({
      ...f,
      /**
       * Did WE stop, or did they? Both states are `enabled: false`, and the screen showed
       * both as "paused" beside a Resume button — so a feed the poller abandoned after ten
       * straight failures was indistinguishable from one the agency parked deliberately,
       * and nothing said we had stopped trying. The remedies differ: a pause ends when they
       * say so, and an abandoned feed never polls again until somebody clicks.
       *
       * Derived HERE rather than in the browser, because the threshold belongs to the
       * poller and a copy of it in a component is a number that drifts silently.
       */
      gaveUp: !f.enabled && f.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS,
    })),
  });
});

adminRouter.post("/admin/api/:agencyInstallId/kb/feeds", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const raw = String(req.body?.url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return res.status(400).json({ error: "That does not look like a web address." });
  }
  /**
   * The SAME guard the poller uses, run here so a blocked address is refused while the
   * agency is looking at the box rather than failing silently on a poll nobody watches.
   *
   * The scheme check used to be the whole of it, and the scheme is the least of it: this
   * URL is fetched server-side and its response is INGESTED as knowledge-base articles,
   * so `http://169.254.169.254/latest/meta-data/…` was a way to read instance credentials
   * into the corpus. `validateFetchUrl` also closes ports and embedded credentials;
   * `assertPublicHost` closes the address itself, in every spelling.
   */
  try {
    parsed = validateFetchUrl(parsed.toString());
    await assertPublicHost(parsed.hostname);
  } catch {
    // One message for a bad scheme, a bad port and a blocked address alike: telling the
    // caller WHICH internal host answered is the reconnaissance the guard exists to deny.
    return res.status(400).json({
      error: "That address can't be used as a feed. Use a public http:// or https:// feed URL.",
    });
  }

  const existing = await prisma.kbFeed.findUnique({ where: { url: parsed.toString() } });
  if (existing) {
    return res.status(409).json({
      error:
        existing.agencyInstallId === agencyId
          ? "You have already added that feed."
          : "That feed is already being followed.",
    });
  }

  const feed = await prisma.kbFeed.create({
    data: {
      url: parsed.toString(),
      agencyInstallId: agencyId,
      source: "agency",
      // Always starts in the review queue, whatever the client asks for. The first few
      // items are how anybody finds out whether a feed publishes articles or headlines.
      autoPublish: false,
    },
    select: { id: true, url: true, title: true, enabled: true, autoPublish: true },
  });
  res.status(201).json({ feed });
});

adminRouter.put("/admin/api/:agencyInstallId/kb/feeds/:feedId", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;

  const data: { enabled?: boolean; autoPublish?: boolean; consecutiveErrors?: number; lastError?: null } = {};
  if (typeof req.body?.enabled === "boolean") {
    data.enabled = req.body.enabled;
    // Re-enabling is how somebody says "the publisher is back". Clearing the counter
    // gives the feed its full allowance again rather than one poll before it re-disables.
    if (req.body.enabled) { data.consecutiveErrors = 0; data.lastError = null; }
  }
  if (typeof req.body?.autoPublish === "boolean") data.autoPublish = req.body.autoPublish;
  if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to change" });

  const result = await prisma.kbFeed.updateMany({
    where: { id: req.params.feedId, agencyInstallId: agencyId },
    data,
  });
  if (result.count === 0) return res.status(404).json({ error: "Feed not found" });
  res.json({ updated: true });
});

adminRouter.delete("/admin/api/:agencyInstallId/kb/feeds/:feedId", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  const result = await prisma.kbFeed.deleteMany({
    where: { id: req.params.feedId, agencyInstallId: agencyId },
  });
  if (result.count === 0) return res.status(404).json({ error: "Feed not found" });
  // Articles already ingested are deliberately KEPT. They are content the agency has
  // reviewed and the bot is answering from; removing a feed means "stop fetching more",
  // not "throw away everything it ever brought in".
  res.json({ deleted: true });
});

/**
 * The agency's own support numbers. Read-only, and scoped to them.
 *
 * Deliberately NOT an inbox: agencies get no desk access, no transcripts and no reply
 * path. What they get is the shape of the load their clients generate, which is the one
 * reason to open Mosaic that has nothing to do with theming.
 */
adminRouter.get("/admin/api/:agencyInstallId/support/stats", async (req: Request, res: Response) => {
  const agencyId = await requireAgency(req, res);
  if (!agencyId) return;
  // Clamp only VALID input. `Math.max(Number(days) || 30, 1)` looks equivalent but
  // turns days=-5 into a silent 1-day window, so the page shows a real number for the
  // wrong period - worse than ignoring the parameter.
  const requested = Number(req.query.days);
  const days = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), 90) : 30;
  res.json(await supportStats(agencyId, days));
});

/**
 * Per-sub-account support toggle. Independent of `enabled` on the theme row: an
 * agency may well want branding on every sub-account but the support widget on only
 * the ones paying for it. Both this AND SupportConfig.enabled must be on for the
 * widget to render (see isSupportEnabled).
 */
adminRouter.put(
  "/admin/api/:agencyInstallId/locations/:locationInstallId/support",
  async (req: Request, res: Response) => {
    const agencyId = await requireAgency(req, res);
    if (!agencyId) return;

    const location = await prisma.locationInstall.findFirst({
      where: { id: req.params.locationInstallId, agencyInstallId: agencyId },
    });
    if (!location) {
      return res.status(403).json({ error: "Location does not belong to this agency install" });
    }

    /**
     * A MISSING field is not an instruction to switch it off.
     *
     * `!!req.body?.supportEnabled` read any body without the key — a typo, an older client,
     * a PUT that meant something else — as a deliberate "off", and this is the switch that
     * decides whether the widget appears in front of the agency's own customers. It is the
     * `Number("")` trap in a boolean costume, and the same answer applies: refuse rather
     * than infer. Caught when a harness sent `{enabled:true}` and the route cheerfully
     * reported the widget switched OFF.
     */
    if (typeof req.body?.supportEnabled !== "boolean") {
      return res.status(400).json({ error: "supportEnabled must be true or false." });
    }

    const updated = await prisma.locationInstall.update({
      where: { id: location.id },
      data: { supportEnabled: req.body.supportEnabled },
    });
    res.json({ id: updated.id, supportEnabled: updated.supportEnabled });
  }
);
