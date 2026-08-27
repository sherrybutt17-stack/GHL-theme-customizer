import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeBundleScript } from "../services/themeBundleScript";
import { cssColor } from "../services/themeCssBundle";

export const themeBundleRouter = Router();

/** Null-safe color sanitize for the public config JSON (concatenated into CSS by the injected script). */
const color = (v: string | null | undefined) => (v ? cssColor(v) : null);

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
    const [location, agencyDefault, agency] = await Promise.all([
      prisma.locationInstall.findFirst({
        where: {
          agencyInstallId: req.params.agencyInstallId,
          ghlLocationId: req.params.ghlLocationId,
          status: "active",
          enabled: true,
        },
        include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
      }),
      prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId: req.params.agencyInstallId } }),
      prisma.agencyInstall.findUnique({
        where: { id: req.params.agencyInstallId },
        select: { status: true },
      }),
    ]);

    // Stop answering for an agency that removed the app, explicitly rather than by
    // relying on the uninstall cascade having disabled its locations. /theme-css checks
    // this directly and so does the support config endpoint; leaving this one to inherit
    // the property from somewhere else is how the uninstall handler stayed broken for
    // months while appearing to work.
    if (!location || agency?.status === "uninstalled") {
      return res.status(404).json(null);
    }

    /**
     * FALL BACK TO THE AGENCY DEFAULT, per field.
     *
     * This returned 404 whenever a sub-account had no ThemeConfig of its own, and the
     * pasted script reads a 404 as `null` and returns immediately. So an agency who
     * branded once at the agency-default level — the documented way to cover 41
     * sub-accounts, and the only sane one — got their colours and logo on every
     * sub-account through the stylesheet, and the browser-tab title and favicon on NONE
     * of them. Silently, because the CSS half plainly worked.
     *
     * Per field, not whole-object, because that is what the stylesheet already does: the
     * agency-default block is emitted globally and location rules override it property by
     * property. A sub-account that sets only its own primaryColor still inherits the
     * agency's favicon there, and must here too, or the two halves of one theme disagree.
     */
    const own = location.themeConfigs[0] ?? null;
    if (!own && !agencyDefault) {
      // Nothing branded at either level: there is genuinely nothing to apply.
      return res.status(404).json(null);
    }
    const pick = <K extends "brandName" | "faviconUrl" | "primaryColor" | "accentColor">(
      key: K
    ): string | null => own?.[key] ?? (agencyDefault as Record<string, any> | null)?.[key] ?? null;

    /**
     * RETURN WHAT THE CLIENT NEEDS, NOT WHAT WE HAPPEN TO HAVE — the rule the support
     * widget's config endpoint already follows, for the same reason.
     *
     * This is unauthenticated by necessity: it is fetched by a script pasted into GHL,
     * keyed on an `agencyInstallId` that is PUBLIC (it sits in the `@import` line every
     * agency pastes into their Custom CSS). It used to answer with eight fields. The
     * pasted script reads TWO — `brandName` and `faviconUrl` — and `primaryColor` /
     * `accentColor` are kept only because OLDER pasted snippets read them and those are
     * still sitting in agencies' Custom JavaScript fields, unchangeable from here
     * (confirmed against the file's own history, not assumed).
     *
     * The three that went were never read by ANY version, and two of them should not have
     * been on the wire at all:
     *  - `hiddenFeatures` is the agency's commercial packaging. This file's own note says
     *    it is the proxy for what a client bought — it is why `planName` exists — so
     *    answering with it tells anyone who asks which features each client did not get.
     *  - `menuLabelOverrides` is that agency's private renaming scheme for their clients.
     *  - `logoUrl` is base64-inlined for uploaded logos, so it is the largest thing here
     *    by far, in aid of nothing. (Measured: the route does 304 on a conditional
     *    request, so this was never a per-page-load cost — worth saying, because that is
     *    what it looks like until you check.)
     *
     * `secondaryColor` went with them: nothing has ever read it at either end.
     */
    res.json({
      brandName: pick("brandName"),
      faviconUrl: pick("faviconUrl"),
      primaryColor: color(pick("primaryColor")),
      accentColor: color(pick("accentColor")),
    });
  }
);
