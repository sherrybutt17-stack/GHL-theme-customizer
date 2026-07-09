import "dotenv/config";
import express, { Express } from "express";
import { json } from "body-parser";
import cors from "cors";
import { validateEnv } from "./services/env";
import { oauthRouter } from "./routes/oauth";
import { onboardingRouter } from "./routes/onboarding";
import { webhooksRouter } from "./routes/webhooks";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { adminEmbedRouter } from "./routes/adminEmbed";
import { themeBundleRouter } from "./routes/themeBundle";
import { themeCssRouter } from "./routes/themeCss";
import { refreshAllExpiringAgencyTokens } from "./services/tokenRefresh";
import { securityHeaders, rateLimit } from "./services/security";

// Fail fast on missing/invalid config instead of silently degrading at runtime.
validateEnv();

const app: Express = express();
// Behind Render/Cloudflare's TLS-terminating proxy, trust X-Forwarded-* so
// req.protocol resolves to "https" (not "http") - this keeps any APP_PUBLIC_URL
// fallback from emitting insecure http:// links that GHL blocks as mixed content.
// Also makes req.ip the real client IP, which the rate limiter keys on.
app.set("trust proxy", true);
app.use(securityHeaders);
app.use(json({ type: "application/json" }));

// Per-IP rate limits (in-memory; fine at a few-agencies scale on a single instance).
// /admin-embed mints admin tokens, so it's the tightest; /theme-css is hit on every
// themed page load so it's generous - the limits only exist to blunt abuse.
app.use("/admin-embed", rateLimit({ windowMs: 60_000, max: 30, name: "admin-embed" }));
app.use("/portal", rateLimit({ windowMs: 60_000, max: 60, name: "portal" }));
app.use("/webhooks", rateLimit({ windowMs: 60_000, max: 600, name: "webhooks" }));
app.use("/admin/api", rateLimit({ windowMs: 60_000, max: 240, name: "admin-api" }));
app.use("/theme-css", rateLimit({ windowMs: 60_000, max: 300, name: "theme-css" }));
app.use("/theme-bundle", rateLimit({ windowMs: 60_000, max: 300, name: "theme-bundle" }));

const adminDashboardCors = cors({ origin: process.env.ADMIN_DASHBOARD_URL ?? "http://localhost:5173" });
app.use("/admin/api", adminDashboardCors);
app.use("/theme-css", adminDashboardCors);

app.use(oauthRouter);
app.use(onboardingRouter);
app.use(webhooksRouter);
app.use(portalRouter);
app.use(adminRouter);
app.use(adminEmbedRouter);
app.use(themeBundleRouter);
app.use(themeCssRouter);

app.get("/", (_req, res) => {
  res.send("GHL Theme Builder server is running.");
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

// Keep tokens fresh proactively (see services/tokenRefresh.ts for why this exists
// instead of relying on the SDK's built-in refresh-on-401 behavior).
refreshAllExpiringAgencyTokens().catch((e) => console.error("Startup token refresh check failed:", e));
setInterval(() => {
  refreshAllExpiringAgencyTokens().catch((e) => console.error("Background token refresh check failed:", e));
}, 30 * 60 * 1000);
