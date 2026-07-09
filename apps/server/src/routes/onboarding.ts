import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";

export const onboardingRouter = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shown right after install (OAuth redirects here). Walks the agency through the
 * single manual step: pasting the one-line @import into GHL's Custom CSS. This is
 * the CSS path (a stylesheet GHL fetches live) - NOT the old Custom JavaScript
 * snippet, which is cross-origin-blocked and deprecated. The agency's Mosaic menu
 * link (auto-created on install) is where they actually configure themes.
 */
onboardingRouter.get("/onboarding/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("Unknown agency install");
  }

  const appBaseUrl = process.env.APP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  // Cache-buster so the first paste isn't shadowed by a previously cached copy.
  const importLine = `@import url("${appBaseUrl}/theme-css/${agency.id}?v=${Date.now()}");`;

  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mosaic &mdash; Finish setup</title>
  <style>
    :root { --brand: #4f46e5; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 680px; margin: 48px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.55; }
    h1 { font-size: 24px; margin: 0 0 6px; }
    .sub { color: #666; margin: 0 0 28px; }
    .steps { list-style: none; padding: 0; margin: 0; counter-reset: step; }
    .steps > li { position: relative; padding: 0 0 22px 44px; counter-increment: step; }
    .steps > li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; background: var(--brand); color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .steps > li:not(:last-child)::after { content: ""; position: absolute; left: 14px; top: 32px; bottom: 0; width: 2px; background: #e5e5e5; }
    code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .embed { display: flex; gap: 8px; align-items: stretch; margin: 10px 0 2px; }
    pre { background: #1a1a1a; color: #e6e6e6; padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; margin: 0; flex: 1; white-space: pre-wrap; word-break: break-all; }
    button { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: none; background: var(--brand); color: #fff; cursor: pointer; white-space: nowrap; }
    button:hover { filter: brightness(1.08); }
    .hint { font-size: 12px; color: #888; margin: 6px 0 0; }
    .done { margin-top: 30px; padding: 16px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; }
    .done strong { color: #15803d; }
  </style>
</head>
<body>
  <h1>&#127881; Mosaic is installed</h1>
  <p class="sub">One quick step turns on branding across all your sub-accounts. You only do this <strong>once</strong>.</p>

  <ol class="steps">
    <li>
      <strong>Copy your embed line</strong> (unique to your agency):
      <div class="embed">
        <pre id="import-line">${escapeHtml(importLine)}</pre>
        <button id="copy-btn" onclick="copyImport(this)">Copy</button>
      </div>
      <p class="hint">If the button doesn't copy, select the line and press &#8984;/Ctrl + C.</p>
    </li>
    <li>
      In GoHighLevel, open <strong>Settings &rarr; Company &rarr; Custom CSS</strong>
      (the <strong>CSS</strong> field &mdash; not Custom JavaScript).
    </li>
    <li>
      <strong>Paste</strong> the line into that field and click <strong>Update Company</strong>.
    </li>
  </ol>

  <div class="done">
    <strong>That's it.</strong> Every theme change you make in the <strong>Mosaic</strong> menu item
    (in your agency sidebar) now applies live &mdash; no need to paste anything again.
  </div>

  <script>
    function copyImport(btn) {
      var text = document.getElementById('import-line').textContent;
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select(); ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {}
      if (!ok) { try { navigator.clipboard.writeText(text); ok = true; } catch (e) {} }
      btn.textContent = ok ? 'Copied!' : 'Select & copy';
      setTimeout(function () { btn.textContent = 'Copy'; }, 2500);
    }
  </script>
</body>
</html>`);
});
