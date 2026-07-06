import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";

export const onboardingRouter = Router();

onboardingRouter.get("/onboarding/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("Unknown agency install");
  }

  const appBaseUrl = process.env.APP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  const snippet = `<script src="${appBaseUrl}/theme-bundle/${agency.id}.js"></script>`;

  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mosaic &mdash; Finish setup</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
    pre { background: #1a1a1a; color: #e6e6e6; padding: 16px; border-radius: 8px; overflow-x: auto; }
    ol { line-height: 1.8; }
  </style>
</head>
<body>
  <h1>Mosaic is installed &mdash; one more step</h1>
  <p>To turn on per-sub-account branding, paste this snippet <strong>once</strong> into your agency's own Custom JavaScript &amp; CSS settings:</p>
  <pre>${snippet}</pre>
  <ol>
    <li>In GoHighLevel, go to <strong>Settings &rarr; Company &rarr; Custom JavaScript &amp; Custom CSS</strong>.</li>
    <li>Paste the snippet above into the Custom JavaScript field.</li>
    <li>Click <strong>Update Company</strong>.</li>
  </ol>
  <p>That's it &mdash; you only need to do this once. Every sub-account will automatically pick up whatever branding you configure in your admin dashboard.</p>
</body>
</html>`);
});
