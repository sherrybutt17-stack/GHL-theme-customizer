import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeBundleScript } from "../services/themeBundleScript";

export const onboardingRouter = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

onboardingRouter.get("/onboarding/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("Unknown agency install");
  }

  const appBaseUrl = process.env.APP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  const script = generateThemeBundleScript(agency.id, appBaseUrl);

  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mosaic &mdash; Finish setup</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
    pre { background: #1a1a1a; color: #e6e6e6; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; max-height: 320px; }
    ol { line-height: 1.8; }
    button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid #ccc; background: #f7f7f7; cursor: pointer; margin-bottom: 8px; }
    button:hover { background: #eee; }
  </style>
</head>
<body>
  <h1>Mosaic is installed &mdash; one more step</h1>
  <p>To turn on per-sub-account branding, paste this <strong>once</strong> into your agency's own Custom JavaScript settings (not Custom CSS &mdash; this goes in the <strong>JavaScript</strong> field, since it's JS code, not an HTML tag):</p>
  <button onclick="navigator.clipboard.writeText(document.getElementById('script-text').textContent); this.textContent='Copied!'">Copy script</button>
  <pre id="script-text">${escapeHtml(script)}</pre>
  <ol>
    <li>In GoHighLevel, go to <strong>Settings &rarr; Company &rarr; Custom JavaScript &amp; Custom CSS</strong>.</li>
    <li>Paste the script above into the <strong>Custom JavaScript</strong> field (the whole thing, as JavaScript code &mdash; not wrapped in a <code>&lt;script&gt;</code> tag).</li>
    <li>Click <strong>Update Company</strong>.</li>
  </ol>
  <p>That's it &mdash; you only need to do this once. Every sub-account will automatically pick up whatever branding you configure in your admin dashboard.</p>
</body>
</html>`);
});
