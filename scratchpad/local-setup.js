/**
 * Set up a local browser test: demo state + a mock-GHL page that loads the REAL pasted
 * code (theme @import + the JS snippet from "Get the code"), so the widget, the favicon,
 * the tab title and the stylesheet can all be seen working before anything is deployed.
 *
 * Everything it changes is listed at the end, with how to undo it. Nothing is deleted.
 *
 *   node local-setup.js            set up + write the harness page
 *   node local-setup.js --undo     put the flags back
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const fs = require("node:fs");
const path = require("node:path");

const p = new PrismaClient();
const BASE = "http://localhost:3210";
const HARNESS = path.join(__dirname, "harness");
const UNDO = process.argv.includes("--undo");

(async () => {
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, locationName: true },
  });

  if (UNDO) {
    await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: false } });
    /**
     * The SupportConfig is deliberately NOT deleted. Setup UPSERTS it, so on any agency
     * that already had one this only ever edited a row somebody else wrote — and deleting
     * it here would take their greeting, blocked terms, business hours, response targets
     * and plan names with it, none of which this script can put back. That is the same
     * asymmetry the six harnesses had, and unknown must mean "leave it", which is the
     * reasoning already applied to theme versions on the line below.
     */
    console.log("Reverted: support switched off for", loc.locationName + ".");
    console.log("The agency's SupportConfig was LEFT ALONE — setup upserts it, so it may predate this script, and its greeting/blocked terms/hours are not ours to delete.");
    console.log("Theme versions were LEFT ALONE — they're versioned, so restore from the History tab if you want the old look back.");
    await p.$disconnect();
    return;
  }

  // --- Demo state -----------------------------------------------------------------
  // A sub-account configured the way a real one is, so the widget has something to be.
  await p.supportConfig.upsert({
    where: { agencyInstallId: agency.id },
    update: { enabled: true, escalationEmails: ["you@agency.test"] },
    create: { agencyInstallId: agency.id, enabled: true, escalationEmails: ["you@agency.test"] },
  });
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: true } });

  const latest = await p.themeConfig.findFirst({
    where: { locationInstallId: loc.id },
    orderBy: { version: "desc" },
  });
  if (!latest?.brandName) {
    // A new VERSION, never an edit — the existing look stays restorable from History.
    await p.themeConfig.create({
      data: {
        locationInstallId: loc.id,
        brandName: latest?.brandName ?? "Harbour Suite",
        primaryColor: latest?.primaryColor ?? "#0f766e",
        accentColor: latest?.accentColor ?? "#f59e0b",
        logoUrl: latest?.logoUrl ?? null,
        menuLabelOverrides: { opportunities: "Deals" },
        hiddenFeatures: ["memberships"],
        version: (latest?.version ?? 0) + 1,
      },
    });
  }

  // --- The mock GHL page ------------------------------------------------------------
  // The URL must contain /location/<id>/ because that is how both pasted scripts detect
  // which sub-account they are in (AppUtils first, this regex as the fallback).
  const raw = await (await fetch(`${BASE}/admin/api/${agency.id}/embed`)).json();

  /**
   * Point the pasted code at the origin the dev server actually speaks.
   *
   * `/embed` builds both snippets from APP_PUBLIC_URL, and env.ts requires that to be
   * https even locally (isProductionUrl() decides "production" by host, not scheme —
   * marking a dev cookie Secure over http is how you get "login worked but I'm logged
   * out"). The dev server listens on plain http, so the snippets come out pointing at
   * https://localhost:3210 and every fetch — and the @import itself — fails silently:
   * no stylesheet, no widget, no favicon, no tab title, and nothing in the console
   * saying why. Rewriting the origin here is a HARNESS concern only; in production the
   * https URL is correct and must stay.
   */
  const localise = (s) => s.split(BASE.replace("http://", "https://")).join(BASE);
  const embed = { importSnippet: localise(raw.importSnippet), jsSnippet: localise(raw.jsSnippet) };
  const dir = path.join(HARNESS, "location", loc.ghlLocationId);
  fs.mkdirSync(dir, { recursive: true });

  const NAV = [
    ["dashboard", "Dashboard"], ["conversations", "Conversations"], ["calendars", "Calendars"],
    ["contacts", "Contacts"], ["opportunities", "Opportunities"], ["payments", "Payments"],
    ["marketing", "Marketing"], ["automation", "Automation"], ["sites", "Sites"],
    ["memberships", "Memberships"], ["reputation", "Reputation"], ["reporting", "Reporting"],
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mock sub-account</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14'>⬜</text></svg>">
<link rel="shortcut icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14'>⬜</text></svg>">
<style>
  /* A stand-in for GHL's own chrome. The ids, the meta= attributes and the flex column
     are copied from the real DOM; everything else here is just so the page looks like
     something. This CANNOT prove our selectors match live GHL — only that the stylesheet
     we generate does what we think it does. */
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; display: flex; min-height: 100vh; }
  #sidebar-v2 {
    width: 232px; background: #1f2937; color: #fff; padding: 14px 10px;
    display: flex; flex-direction: column; gap: 2px;   /* <- the flex assumption */
  }
  #sidebar-v2 .agency-logo { max-width: 140px; margin: 4px 8px 16px; }
  #sidebar-v2 a {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
    color: #cbd5e1; text-decoration: none; font-size: 13.5px;
  }
  #sidebar-v2 a.active { background: rgba(255,255,255,.14); color: #fff; }
  #sidebar-v2 a i { width: 16px; height: 16px; display: inline-block; background: #94a3b8; border-radius: 3px; }
  .hl_header { background: #fff; border-bottom: 1px solid #e5e7eb; }
  .hl_header .container-fluid { background: #fff; padding: 10px 18px; }
  .hl_header .topmenu-nav { background: #fff; padding: 8px 18px; color: #607179; font-size: 13px; }
  main { flex: 1; display: flex; flex-direction: column; }
  .body-pad { padding: 24px; }
  .note { max-width: 620px; color: #475569; font-size: 13px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
</style>
<style>
/* THIS is the line the agency pastes into GHL -> Settings -> Company -> Custom CSS. */
${embed.importSnippet}
</style>
</head>
<body class="${loc.ghlLocationId}">
  <nav id="sidebar-v2">
    <img class="agency-logo" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='34'><rect width='140' height='34' rx='6' fill='%23334155'/><text x='12' y='22' fill='white' font-family='sans-serif' font-size='13'>Agency logo</text></svg>" alt="">
${NAV.map(([k, label]) => `    <a id="sb_${k}" meta="${k}" href="/location/${loc.ghlLocationId}/${k}"><i></i><span class="nav-title">${label}</span></a>`).join("\n")}
  </nav>
  <main>
    <div class="hl_header">
      <div class="container-fluid">Top bar (icon row)</div>
      <div class="topmenu-nav">Page title · Tab one · Tab two</div>
    </div>
    <div class="body-pad">
      <h1>Mock sub-account</h1>
      <p class="note">
        This page loads the <strong>real</strong> theme stylesheet by <code>@import</code> and the
        <strong>real</strong> pasted JavaScript, against sub-account
        <code>${loc.ghlLocationId}</code>${loc.locationName ? ` (${loc.locationName})` : ""}.
        The sidebar markup mimics GHL's — same ids, same <code>meta=</code> attributes, and a flex
        column — but it is a stand-in: it can show that our CSS does what we intend, and it
        <em>cannot</em> prove those selectors match live GoHighLevel.
      </p>
      <p class="note">Look for: sidebar colour · renamed menu item · hidden item gone ·
      recoloured icons · the browser tab's title and icon · the support bubble, bottom-right.</p>
    </div>
  </main>

<script>
/* THIS is what the agency pastes into GHL -> Settings -> Company -> Custom JavaScript. */
${embed.jsSnippet}
</script>
</body>
</html>`;

  fs.writeFileSync(path.join(dir, "index.html"), html);

  /**
   * A second page for testing the BOT specifically.
   *
   * index.html answers "does the theme apply", and the widget is one thing on it among
   * ten. Asking the bot twenty questions there means squinting past a fake sidebar, and
   * every reload re-applies a stylesheet that has nothing to do with the answer being
   * read. This page carries the SAME pasted snippet (so it is the real widget, not a
   * stub) and nothing else — it must live in this directory because both scripts detect
   * the sub-account from a /location/<id>/ path segment.
   */
  const chat = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chatbot test</title>
<style>
  body { margin: 0; font: 15px/1.6 system-ui, sans-serif; color: #1e293b;
         display: flex; align-items: center; justify-content: center; min-height: 100vh;
         background: #f8fafc; }
  .card { max-width: 560px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #64748b; margin: 0 0 24px; font-size: 14px; }
  ul { padding-left: 20px; color: #334155; font-size: 14px; }
  li { margin: 6px 0; }
  code { background: #e2e8f0; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  .hint { margin-top: 24px; padding: 12px 14px; background: #eff6ff; border-radius: 8px;
          font-size: 13px; color: #1e40af; }
</style>
</head>
<body class="${loc.ghlLocationId}">
  <div class="card">
    <h1>Chatbot test — ${loc.locationName ?? loc.ghlLocationId}</h1>
    <p class="sub">The real widget, on a blank page. Bubble is bottom-right.</p>
    <p style="font-size:14px;margin:0 0 8px"><strong>Questions worth asking:</strong></p>
    <ul>
      <li>"What software is this built on? Be honest." — must name your brand, never the vendor</li>
      <li>"Send me a documentation link" — must refuse; the bot emits no URLs</li>
      <li>"How do I create a pipeline?" — must say <code>Deals</code>, the renamed label</li>
      <li>"A friend said I can build a course area for my members" — hidden feature, hands to a person</li>
      <li>"Why is my call quality bad and crackly?" — only answerable from the crawled corpus</li>
      <li>"I want to upgrade, what does it cost?" — handed off before the model even runs</li>
    </ul>
    <div class="hint">
      Anything you send here lands in the support desk at <code>localhost:5174</code>,
      so you can answer yourself and watch the reply arrive in this window.
    </div>
  </div>
<script>
/* The same snippet the agency pastes into GHL. No theme CSS on this page deliberately. */
${embed.jsSnippet}
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(dir, "chat.html"), chat);

  console.log(`
Local test set up.
${"-".repeat(64)}
Mock GHL page written to:
  ${path.join(dir, "index.html")}
Chatbot-only test page:
  ${path.join(dir, "chat.html")}

CHANGED (all reversible — run with --undo):
  • SupportConfig for the agency: enabled, escalation email you@agency.test
  • ${loc.locationName ?? loc.ghlLocationId}: supportEnabled = true
  • a NEW theme version for it (brand name / renamed "Opportunities"→"Deals" /
    hidden "Memberships") — the previous version is untouched and restorable
    from that sub-account's History tab.

AGENCY_ID   ${agency.id}
LOCATION    ${loc.ghlLocationId}
`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
