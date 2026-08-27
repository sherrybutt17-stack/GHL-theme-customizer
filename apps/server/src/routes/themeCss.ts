import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";
import { describeError } from "../services/security";
import { CircuitBreaker } from "../services/circuitBreaker";

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
 *   2. a last-known-good cache, so a DB blip keeps serving the real theme;
 *   3. a per-agency circuit breaker, so requests during an outage don't each pay it.
 */

/**
 * 2.5s, not 8s. This is a RENDER-BLOCKING asset: the browser holds the whole GHL page
 * until it answers, so the timeout is the worst-case stall we impose on every page load
 * during an outage. Eight seconds of white screen is indefensible when the
 * last-known-good cache can answer instantly - the timeout only needs to be longer than
 * a healthy build (single-digit ms), not generous.
 */
const DB_TIMEOUT_MS = Number(process.env.THEME_CSS_TIMEOUT_MS ?? 2500);

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
 *
 * KEYED BY AGENCY, deliberately. As a process global, ANY failure - including one
 * agency's malformed theme data throwing inside generateThemeCssBundle - stopped every
 * other agency's stylesheet from being rebuilt for the cooldown. One tenant's bug
 * degraded all of them, which is the failure mode this product can least afford.
 *
 * The trade-off is explicit: when the database really is down, each agency now pays one
 * timeout before its own breaker opens, instead of the first one paying for everybody.
 * At a 2.5s timeout and a handful of agencies that is a far better deal than
 * cross-tenant coupling.
 */
const BREAKER_COOLDOWN_MS = Number(process.env.THEME_CSS_BREAKER_MS ?? 10_000);
const breaker = new CircuitBreaker(BREAKER_COOLDOWN_MS);

themeCssRouter.get("/theme-css/:agencyInstallId", async (req: Request, res: Response) => {
  const agencyInstallId = req.params.agencyInstallId;
  /**
   * `no-cache`, NOT `no-store` — the difference is the whole cost of this endpoint.
   *
   * Theme edits must apply live, and the pasted `@import` line carries a `?v=` fixed at
   * paste time, so it can never bust a cache: an agency edits their theme and never
   * re-pastes. That rules out `max-age`. It does NOT rule out revalidation.
   *
   * `no-store` forbids the browser from keeping a copy at all, so it cannot send
   * `If-None-Match` and the full body ships on EVERY page load. Measured on a realistic
   * agency — 41 sub-accounts with 40KB logos base64-inlined — that is **1.7MB gzipped,
   * render-blocking, every single page**. `no-cache` still forces a revalidation round
   * trip before use, so an edit is live exactly as before, but an unchanged theme
   * answers 304 with no body.
   */
  res.set("Cache-Control", "no-cache, must-revalidate");

  if (breaker.isOpen(agencyInstallId)) return respondDegraded(res, agencyInstallId, "circuit open");

  try {
    const css = await withTimeout(
      (async () => {
        const agency = await prisma.agencyInstall.findUnique({ where: { id: agencyInstallId } });
        if (!agency) return { status: 404 as const, body: "/* Unknown agency install */" };
        // Stop branding an agency that has removed the app. The @import line lives in
        // GHL's Custom CSS field and keeps hitting us after UninstallCompany; serve
        // nothing so we don't keep theming for an org that uninstalled us.
        if (agency.status === "uninstalled") {
          // EVICT the last-known-good copy, don't just stop refreshing it. Left in place
          // it outlives the uninstall: the next database blip opens this agency's breaker,
          // `respondDegraded` finds the stale entry and serves the full pre-uninstall
          // stylesheet as a 200 — re-branding, from cache, an org that removed the app.
          lastKnownGood.delete(agencyInstallId);
          return { status: 200 as const, body: "/* This Mosaic install has been removed. */" };
        }
        return { status: 200 as const, body: await generateThemeCssBundle(agency.id), cache: true };
      })(),
      DB_TIMEOUT_MS,
      `theme-css build for ${agencyInstallId}`
    );

    // A build got through for THIS agency, so close its breaker. Deliberately not a
    // global reset: another agency may still be failing for its own reason.
    breaker.close(agencyInstallId);
    if (css.cache) lastKnownGood.set(agencyInstallId, { css: css.body, at: Date.now() });
    return res.status(css.status).type("text/css").send(css.body);
  } catch (e) {
    breaker.open(agencyInstallId);
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
    // The age goes in a HEADER, not in the body, so the body stays byte-identical
    // between requests and keeps its ETag. Interpolated into the CSS it changed every
    // second, which changes the ETag every second, which means no browser can ever
    // revalidate to a 304 — so the full stylesheet (megabytes, for an agency with
    // logos) would ship on every page load for the whole outage. That is precisely
    // when the database is least able to help and the page can least afford it.
    res.set("X-Mosaic-Stale-Age", String(Math.round((Date.now() - stale.at) / 1000)));
    res.set("X-Mosaic-Degraded", reason);
    // Valid CSS and a 200, so the browser actually applies it - the agency keeps its
    // branding through the outage.
    return res
      .status(200)
      .type("text/css")
      .send(`/* Mosaic: last-known-good theme (${reason}) - datastore unreachable. */\n${stale.css}`);
  }
  // Nothing cached. Answer anyway: a fast failure lets the page render unstyled,
  // where a hang would stall it.
  return res
    .status(503)
    .type("text/css")
    .send(`/* Mosaic: theme temporarily unavailable (${reason}) - datastore unreachable. */`);
}
