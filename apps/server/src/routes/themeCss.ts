import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";
import { describeError } from "../services/security";

export const themeCssRouter = Router();

/**
 * This route is loaded by `@import` from GHL's Custom CSS field, which means a slow
 * response here blocks rendering of the agency's entire GHL UI - browsers treat a
 * pending stylesheet as render-blocking. So it must ALWAYS answer quickly, even when
 * the database is unreachable. (Production, 2026-08-10: a suspended Postgres made
 * every DB query hang, this route never responded, and the outage degraded page loads
 * on top of dropping the theming.)
 *
 * Two guards, in order of preference:
 *   1. a wall-clock timeout, so we respond even if the driver never errors;
 *   2. a last-known-good cache, so a DB blip keeps serving the real theme.
 */
const DB_TIMEOUT_MS = Number(process.env.THEME_CSS_TIMEOUT_MS ?? 8000);

class TimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const bell = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} exceeded ${ms}ms`)), ms);
  });
  // `finally` clears the pending timer so a fast success doesn't hold the event loop
  // open for the rest of the window.
  return Promise.race([work, bell]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Last-known-good stylesheet per agency, so a database outage degrades to "theme
 * keeps working" rather than "branding vanishes".
 *
 * Only populated on a successful build, and unknown agency ids 404 before they ever
 * get here - so a caller can't grow this map by requesting made-up ids.
 *
 * In-memory and therefore per-instance and lost on restart: it covers a database that
 * falls over under a running server, NOT a cold boot against a dead database. Backing
 * it with something durable would need a store that isn't the database we're guarding
 * against (Render's disk is ephemeral too).
 */
const lastKnownGood = new Map<string, { css: string; at: number }>();

/**
 * Circuit breaker. Waiting out the connect timeout on *every* request is still far
 * too slow for a render-blocking stylesheet that every GHL page load fetches, so once
 * a build fails we stop dialling the database for a short cooldown and answer straight
 * from cache. After the cooldown one request is let through to probe for recovery, so
 * the theme comes back on its own within a cooldown of the database returning.
 */
const BREAKER_COOLDOWN_MS = Number(process.env.THEME_CSS_BREAKER_MS ?? 10_000);
let dbDownUntil = 0;

themeCssRouter.get("/theme-css/:agencyInstallId", async (req: Request, res: Response) => {
  const agencyInstallId = req.params.agencyInstallId;
  // The whole point of the @import approach is that theme edits apply live; a cached
  // copy would silently serve stale CSS and mask logo/theme updates.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  if (Date.now() < dbDownUntil) return respondDegraded(res, agencyInstallId, "circuit open");

  try {
    const css = await withTimeout(
      (async () => {
        const agency = await prisma.agencyInstall.findUnique({ where: { id: agencyInstallId } });
        if (!agency) return { status: 404 as const, body: "/* Unknown agency install */" };
        // Stop branding an agency that has removed the app. The @import line lives in
        // GHL's Custom CSS field and keeps hitting us after UninstallCompany; serve
        // nothing so we don't keep theming for an org that uninstalled us.
        if (agency.status === "uninstalled") {
          return { status: 200 as const, body: "/* This Mosaic install has been removed. */" };
        }
        return { status: 200 as const, body: await generateThemeCssBundle(agency.id), cache: true };
      })(),
      DB_TIMEOUT_MS,
      `theme-css build for ${agencyInstallId}`
    );

    // A build got through, so the database is healthy again - close the breaker.
    dbDownUntil = 0;
    if (css.cache) lastKnownGood.set(agencyInstallId, { css: css.body, at: Date.now() });
    return res.status(css.status).type("text/css").send(css.body);
  } catch (e) {
    dbDownUntil = Date.now() + BREAKER_COOLDOWN_MS;
    const reason = e instanceof TimeoutError ? "timed out" : "failed";
    console.error(`[theme-css] build ${reason} for ${agencyInstallId}: ${describeError(e)}`);
    return respondDegraded(res, agencyInstallId, reason);
  }
});

/**
 * Answer without touching the database: the agency's last good stylesheet if we have
 * one, otherwise a comment. Either way it returns immediately, which is the property
 * that matters - a hang here stalls the whole GHL page.
 */
function respondDegraded(res: Response, agencyInstallId: string, reason: string) {
  const stale = lastKnownGood.get(agencyInstallId);
  if (stale) {
    const ageSec = Math.round((Date.now() - stale.at) / 1000);
    // Valid CSS and a 200, so the browser actually applies it - the agency keeps its
    // branding through the outage.
    return res
      .status(200)
      .type("text/css")
      .send(`/* Mosaic: last-known-good theme (${ageSec}s old, ${reason}) - datastore unreachable. */\n${stale.css}`);
  }
  // Nothing cached. Answer anyway: a fast failure lets the page render unstyled,
  // where a hang would stall it.
  return res
    .status(503)
    .type("text/css")
    .send(`/* Mosaic: theme temporarily unavailable (${reason}) - datastore unreachable. */`);
}
