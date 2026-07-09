import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeBundleScript } from "../services/themeBundleScript";
import { cssColor } from "../services/themeCssBundle";
import { isKnownFeatureKey } from "../services/ghlSidebarFeatures";

export const themeBundleRouter = Router();

/** Null-safe color sanitize for the public config JSON (concatenated into CSS by the injected script). */
const color = (v: string | null | undefined) => (v ? cssColor(v) : null);

/** Drop any non-whitelisted keys from a stored menuLabelOverrides map. */
function safeLabels(overrides: unknown): Record<string, string> {
  if (!overrides || typeof overrides !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    if (isKnownFeatureKey(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Kept as a plain .js endpoint for reference/future use (e.g. if we later find a
 * context where a real <script src> tag is valid - a Custom Page, for instance).
 * The actual paste-into-Custom-JavaScript flow uses the raw script text directly
 * (see routes/onboarding.ts), not this URL, since that field executes its content
 * as JS, not HTML.
 */
themeBundleRouter.get("/theme-bundle/:agencyInstallId.js", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    res.status(404).type("application/javascript").send("console.error('Mosaic: unknown agency install');");
    return;
  }

  const apiBase = process.env.APP_PUBLIC_URL ?? "";
  res.type("application/javascript").send(generateThemeBundleScript(agency.id, apiBase));
});

/**
 * Public-safe theme config for one location - no tokens, no internal ids beyond
 * what's needed to render. Deliberately unauthenticated (the injected script has no
 * way to hold a secret), but only ever exposes branding fields, never anything
 * sensitive - same trust model as any public CDN asset.
 */
themeBundleRouter.get(
  "/theme-bundle/:agencyInstallId/config/:ghlLocationId",
  async (req: Request, res: Response) => {
    const location = await prisma.locationInstall.findFirst({
      where: {
        agencyInstallId: req.params.agencyInstallId,
        ghlLocationId: req.params.ghlLocationId,
        status: "active",
        enabled: true,
      },
      include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
    });

    if (!location || !location.themeConfigs[0]) {
      return res.status(404).json(null);
    }

    const theme = location.themeConfigs[0];
    const hidden = Array.isArray(theme.hiddenFeatures)
      ? (theme.hiddenFeatures as string[]).filter(isKnownFeatureKey)
      : [];
    res.json({
      brandName: theme.brandName,
      logoUrl: theme.logoUrl,
      faviconUrl: theme.faviconUrl,
      primaryColor: color(theme.primaryColor),
      secondaryColor: color(theme.secondaryColor),
      accentColor: color(theme.accentColor),
      menuLabelOverrides: safeLabels(theme.menuLabelOverrides),
      hiddenFeatures: hidden,
    });
  }
);
