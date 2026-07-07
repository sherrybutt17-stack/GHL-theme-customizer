import "dotenv/config";
import express, { Express } from "express";
import { json } from "body-parser";
import cors from "cors";
import { oauthRouter } from "./routes/oauth";
import { onboardingRouter } from "./routes/onboarding";
import { webhooksRouter } from "./routes/webhooks";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { adminEmbedRouter } from "./routes/adminEmbed";
import { themeBundleRouter } from "./routes/themeBundle";
import { themeCssRouter } from "./routes/themeCss";
import { refreshAllExpiringAgencyTokens } from "./services/tokenRefresh";

const app: Express = express();
app.use(json({ type: "application/json" }));
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
