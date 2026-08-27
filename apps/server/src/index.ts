// MUST be first: several modules below read process.env at import time.
import "./services/loadEnv";
import express, { Express } from "express";
import { json } from "body-parser";
import cors from "cors";
import { validateEnv, trustProxyHops } from "./services/env";
import { prisma } from "./services/prisma";
import { oauthRouter } from "./routes/oauth";
import { onboardingRouter } from "./routes/onboarding";
import { webhooksRouter } from "./routes/webhooks";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { adminEmbedRouter } from "./routes/adminEmbed";
import { themeBundleRouter } from "./routes/themeBundle";
import { themeCssRouter } from "./routes/themeCss";
import { deskRouter } from "./routes/desk";
import { deskInboxRouter } from "./routes/deskInbox";
import { deskQueueRouter } from "./routes/deskQueue";
import { supportRouter } from "./routes/support";
import { refreshAllExpiringAgencyTokens } from "./services/tokenRefresh";
import { pruneWebhookEvents } from "./services/webhookEvents";
import { reportReadiness } from "./services/readiness";
import { securityHeaders, rateLimit, describeError } from "./services/security";

// Fail fast on missing/invalid config instead of silently degrading at runtime.
validateEnv();

const app: Express = express();
// Behind Render/Cloudflare's TLS-terminating proxy, trust X-Forwarded-* so
// req.protocol resolves to "https" (not "http") - this keeps any APP_PUBLIC_URL
// fallback from emitting insecure http:// links that GHL blocks as mixed content.
// Also makes req.ip the real client IP, which the rate limiter keys on.
// IMPORTANT: trust a FIXED number of hops, not `true`. `true` trusts the entire
// X-Forwarded-For chain, letting a client spoof req.ip and get a fresh rate-limit
// bucket per request. Default 1 (Render's single TLS proxy); override if more hops
// (e.g. Cloudflare in front → 2).
app.set("trust proxy", trustProxyHops());
app.use(securityHeaders);
app.use(json({ type: "application/json" }));

// Per-IP rate limits (in-memory; fine at a few-agencies scale on a single instance).
// /admin-embed mints admin tokens, so it's the tightest; /theme-css is hit on every
// themed page load so it's generous - the limits only exist to blunt abuse.
// ONE limiter instance shared by both, not two configured alike: each rateLimit() call
// closes over its own counter, so a second instance would hand out a second budget. Both
// routes gate the SAME per-agency slug — the only thing between a scraped (public) agency
// id and a valid admin token — so probing them must spend one 30/min allowance between
// them. /portal is a phase-1 redirect that used to sit here on 60/min of its own, i.e.
// the tightest limit in the app was undercut by a route nothing had used since commit 3.
const embedLimiter = rateLimit({ windowMs: 60_000, max: 30, name: "admin-embed" });
app.use("/admin-embed", embedLimiter);
app.use("/portal", embedLimiter);
app.use("/webhooks", rateLimit({ windowMs: 60_000, max: 600, name: "webhooks" }));
app.use("/admin/api", rateLimit({ windowMs: 60_000, max: 240, name: "admin-api" }));
app.use("/theme-css", rateLimit({ windowMs: 60_000, max: 300, name: "theme-css" }));
app.use("/theme-bundle", rateLimit({ windowMs: 60_000, max: 300, name: "theme-bundle" }));
// The desk is a working surface for a handful of staff, so it can be generous - but
// login is a credential-guessing target, so it gets its own much tighter bucket
// mounted first (Express runs both; the stricter one wins for that path).
app.use("/desk/api/login", rateLimit({ windowMs: 60_000, max: 10, name: "desk-login" }));
// Changing a password submits the CURRENT one, so it is a credential-guessing target too —
// it just needs a live session first. That is not a high bar in the case that matters: an
// unattended signed-in desk machine, where guessing the current password is the difference
// between reading today's tickets and holding the account permanently. It sat on the
// generous 600/min desk budget purely because nothing could reach it — no screen called
// the route at all until the dialog was built, which is exactly when the limit starts
// mattering. A separate instance from the login bucket on purpose: a busy office behind
// one NAT must not spend its sign-ins on somebody rotating a password.
app.use("/desk/api/password", rateLimit({ windowMs: 60_000, max: 10, name: "desk-password" }));
app.use("/desk/api", rateLimit({ windowMs: 60_000, max: 600, name: "desk-api" }));
// The widget is public and unauthenticated, and each message costs a model call - so
// this limit is about cost as much as abuse. Generous enough for a real conversation,
// tight enough that a script can't run up a bill.
app.use("/support/api", rateLimit({ windowMs: 60_000, max: 60, name: "support-api" }));

const adminDashboardCors = cors({ origin: process.env.ADMIN_DASHBOARD_URL ?? "http://localhost:5173" });
app.use("/admin/api", adminDashboardCors);
app.use("/theme-css", adminDashboardCors);
// The desk sends its session cookie cross-origin, so unlike the dashboard's CORS this
// one MUST set credentials:true - and consequently the origin must be an explicit
// allowlist, never "*" (the browser rejects wildcard + credentials outright).
// This pin is also half the CSRF defence: a custom header (x-mosaic-desk) can only be
// set after a successful preflight, and only this origin gets one. See deskAuth.ts.
app.use(
  "/desk/api",
  cors({
    origin: process.env.SUPPORT_DESK_URL ?? "http://localhost:5174",
    credentials: true,
    allowedHeaders: ["Content-Type", "x-mosaic-desk"],
  })
);
// The optional Custom-JS bundle fetches /theme-bundle/:agency/config/:loc from GHL's
// origin. It's unauthenticated, non-credentialed public branding data, so allow any
// origin - without this the browser blocks the cross-origin fetch and the JS theme
// (browser-tab title) silently never applies.
app.use("/theme-bundle", cors({ origin: "*" }));
// Same reasoning for the support widget: it is fetched from GHL's origin inside the
// client's browser. No credentials ride these requests - the conversation bearer is an
// explicit header, never a cookie - so a wildcard origin grants nothing extra.
app.use("/support/api", cors({ origin: "*", allowedHeaders: ["Content-Type", "x-mosaic-conversation"] }));

app.use(oauthRouter);
app.use(onboardingRouter);
app.use(webhooksRouter);
app.use(portalRouter);
app.use(adminRouter);
app.use(adminEmbedRouter);
app.use(themeBundleRouter);
app.use(themeCssRouter);
app.use(deskRouter);
app.use(deskInboxRouter);
app.use(deskQueueRouter);
app.use(supportRouter);

app.get("/", (_req, res) => {
  res.send("GHL Theme Builder server is running.");
});

/**
 * Real health check: does a DB round trip, because "the process is up" is not what we
 * need to know.
 *
 * The August 2026 outage is the whole argument. Postgres was suspended, every query
 * hung, and the platform health check - pointed at `/`, which returns a static string -
 * reported the service perfectly healthy throughout. The one signal that would have
 * caught it was the one we weren't taking.
 *
 * The 2s timeout is the point: an unreachable database HANGS rather than erroring, so
 * without a wall clock this endpoint would hang too and time out as "unhealthy" only by
 * accident, with no diagnosis. Returns 503 with a reason instead.
 */
app.get("/health", async (_req, res) => {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_r, reject) => setTimeout(() => reject(new Error("db check exceeded 2000ms")), 2000)),
    ]);
    res.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch (e) {
    // 503, not 500: this is "temporarily unable to serve", which is what a load
    // balancer and an uptime monitor both need to see.
    res.status(503).json({ ok: false, db: "down", ms: Date.now() - started, error: describeError(e) });
  }
});

// Catch-all error handler: return a clean 500 without leaking internals, and log the
// real error. (Express only routes synchronous throws / next(err) here; async route
// rejections are additionally caught by the process handler below.)
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled route error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

// Never let a stray async rejection take the process down silently. Log and keep
// serving - one bad request must not knock the (single) instance offline.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`GHL Theme Builder server listening on port ${port}`);
});

// What validateEnv structurally cannot see: the failures that boot clean, log nothing,
// serve 200s and answer nobody (an unseeded KB, a desk with no staff, an unstaffed tier).
// After listen() and never awaited - a readiness check must not be able to delay or fail
// the boot it is reporting on.
reportReadiness();

// Keep tokens fresh proactively (see services/tokenRefresh.ts for why this exists
// instead of relying on the SDK's built-in refresh-on-401 behavior).
refreshAllExpiringAgencyTokens().catch((e) => console.error("Startup token refresh check failed:", e));
setInterval(() => {
  refreshAllExpiringAgencyTokens().catch((e) => console.error("Background token refresh check failed:", e));
  // Piggy-backed on the token timer rather than given its own schedule: the prune is an
  // idempotent DELETE, so two instances racing it is harmless, and a whole scheduler for
  // that would be more moving parts than the job is worth. Never on the webhook path -
  // GHL retries on a timeout, so a slow prune there would manufacture the duplicate
  // deliveries it exists to stop accumulating.
  pruneWebhookEvents().catch((e) => console.error("Webhook audit prune failed:", e));
}, 30 * 60 * 1000);
