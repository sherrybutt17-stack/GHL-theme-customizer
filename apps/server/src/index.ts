import "dotenv/config";
import express, { Express } from "express";
import { json } from "body-parser";
import { oauthRouter } from "./routes/oauth";
import { onboardingRouter } from "./routes/onboarding";
import { webhooksRouter } from "./routes/webhooks";
import { portalRouter } from "./routes/portal";

const app: Express = express();
app.use(json({ type: "application/json" }));

app.use(oauthRouter);
app.use(onboardingRouter);
app.use(webhooksRouter);
app.use(portalRouter);

app.get("/", (_req, res) => {
  res.send("GHL Theme Builder server is running.");
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`GHL Theme Builder server listening on port ${port}`);
});
