import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { buildEmbedJsSnippet } from "../services/embedSnippet";

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
  // Optional Custom JavaScript — favicon + browser-tab title (CSS can't set either) AND
  // the support widget. Built by the shared builder rather than assembled here: this page
  // used to hand over the theme bundle ALONE, so an agency who pasted at the natural
  // moment (right here, immediately after installing) had no widget, and switching support
  // on months later did nothing with no explanation anywhere. See services/embedSnippet.ts.
  const jsSnippet = buildEmbedJsSnippet(agency.id, appBaseUrl);

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
    /* A failed copy must LOOK failed and stay that way — see the note in the script. */
    button.copy-failed { background: #92610a; }
    .done { margin-top: 30px; padding: 16px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; }
    .done strong { color: #15803d; }
    .optional { margin-top: 24px; border-top: 1px solid #e5e5e5; padding-top: 18px; }
    .optional summary { cursor: pointer; color: var(--brand); font-size: 14px; }
    /* Amber, not red: this is an instruction, not a fault - the same distinction the
       dashboard's session banner makes. */
    .optional summary .warn-inline { color: #92610a; }
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

  <details class="optional">
    <!--
      The SUMMARY carries the consequence, not a feature list.

      The paragraph inside already says the decisive thing - "skipping it now is the one
      thing that would make you come back to this page later" - and it was invisible until
      somebody opened the disclosure it was arguing for. Worse, it sits BELOW a green
      "That's it", so the page declares the job finished and then offers what reads as an
      optional extra. That is the same trap this page's history is about, one layer softer:
      an agency pastes at the natural moment, never opens this, enables support months later
      and nothing appears - with nothing on any screen to explain that a re-paste was the
      missing step. Nobody returns to a page they have already finished.

      Not forced open: the CSS line above genuinely is the required step, and expanding 31KB
      of code by default would bury it. The reason to open it just has to be readable while
      it is closed.
    -->
    <summary>
      <strong>Recommended:</strong> browser-tab title, favicon and client support &mdash;
      <span class="warn-inline">skipping this is the one thing that brings you back here later.</span>
    </summary>
    <p class="hint" style="margin-top:12px">
      CSS can't change a sub-account's browser-tab title or favicon, and it can't run the
      client support widget. Paste the code below <strong>once</strong> into
      <strong>Settings &rarr; Company &rarr; Custom JavaScript</strong> and all three are covered.
    </p>
    <p class="hint">
      <strong>Paste it even if you're not using support yet.</strong> The widget stays
      completely inactive until you switch support on in Mosaic &mdash; and then it appears on
      the next page load, with nothing to re-paste. Skipping it now is the one thing that
      would make you come back to this page later.
    </p>
    <div class="embed">
      <pre id="js-snippet">${escapeHtml(jsSnippet)}</pre>
      <button id="copy-js-btn" onclick="copyText(this, 'js-snippet')">Copy</button>
    </div>
  </details>

  <script>
    // Says 'Copied!' only when it actually copied. navigator.clipboard.writeText returns
    // a PROMISE, so setting ok = true beside the call reports success for a write that
    // may still reject - on the one action this whole page exists for. The dashboard's
    // own copy button had the identical bug; both are fixed, and this is the copy an
    // agency meets FIRST, straight off the OAuth redirect.
    //
    // TWO THINGS THE DASHBOARD WAS FIXED FOR AND THIS PAGE WAS NOT, measured 2026-08-27 by
    // driving both buttons with every clipboard route failing:
    //
    //  1. It said 'Select & copy' and SELECTED NOTHING (selection length 0). That is fine
    //     advice for a 90-byte @import line and close to useless for the 31KB snippet
    //     below, which the reader would have to drag-select out of a scroll box. The
    //     failure now puts the caret round the text itself, so it is one keystroke.
    //  2. The failure REVERTED to 'Copy' after 2.5 seconds. So the only report that the
    //     copy did not happen was transient: look away, look back, and the button reads
    //     normal over a clipboard that still holds whatever it held before. A success may
    //     time out — there is nothing left to do. A failure may not.
    function selectNode(id) {
      var el = document.getElementById(id);
      if (!el || !window.getSelection || !document.createRange) return 0;
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      return String(sel.toString()).length;
    }
    function done(btn, ok, id) {
      if (ok) {
        btn.classList.remove('copy-failed');
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 2500);
        return;
      }
      selectNode(id);
      btn.classList.add('copy-failed');
      btn.textContent = 'Selected \u2014 press \u2318/Ctrl + C';
    }
    function copyText(btn, id) {
      var text = document.getElementById(id).textContent;
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
      if (ok) return done(btn, true, id);
      // No clipboard API at all is a FAILURE, not a success. It is absent over plain
      // http, which is exactly what local dev and an ngrok tunnel serve.
      if (!navigator.clipboard || !navigator.clipboard.writeText) return done(btn, false, id);
      navigator.clipboard.writeText(text).then(
        function () { done(btn, true, id); },
        function () { done(btn, false, id); }
      );
    }
    function copyImport(btn) { copyText(btn, 'import-line'); }
  </script>
</body>
</html>`);
});
