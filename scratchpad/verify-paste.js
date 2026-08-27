/**
 * The last mile: does the thing the agency actually PASTES contain the product?
 *
 * Everything else can be perfect and still ship nothing — the support widget lived only
 * at its own URL, which no screen in the dashboard ever mentioned, so no client would
 * have seen a bubble no matter how many switches were on.
 *
 * Runs the pasted snippet in a fake browser rather than eyeballing it. A snippet that
 * throws on load runs inside the customer's CRM, so "it parses" is not the bar.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const vm = require("node:vm");

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;

const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${String(detail).slice(0, 300)}`); fail++; }
};

(async () => {
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const res = await fetch(`${BASE}/admin/api/${agency.id}/embed`);
  const embed = await res.json();

  console.log("\n== one paste, both halves ==");
  check("embed returns a JS snippet", res.status === 200 && typeof embed.jsSnippet === "string", res.status);
  check("contains the theme half (tab title)", /document\.title/.test(embed.jsSnippet));
  check("  -> and actually applies the favicon", /applyFavicon\(theme\.faviconUrl\)/.test(embed.jsSnippet));
  check("contains the support half (the widget)", /Mosaic support widget/.test(embed.jsSnippet));
  check("both point at this server", (embed.jsSnippet.match(/localhost:3210/g) ?? []).length >= 2);
  console.log(`        (${(embed.jsSnippet.length / 1024).toFixed(1)}KB to paste, once)`);

  console.log("\n== it survives being run in a page ==");
  // A DOM stub thin enough that anything the snippet assumes about the host page shows
  // up as a throw rather than passing quietly.
  const calls = { fetches: [], intervals: 0, listeners: [], headAdded: [] };
  const FAVICON = "https://cdn.example.com/harbour.png";
  const el = (tag) => {
    const attrs = {};
    return {
      tag, style: {}, attrs,
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null,
      removeAttribute(k) { delete attrs[k]; },
      appendChild() {}, remove() { attrs.__removed = true; }, addEventListener() {},
      attachShadow: () => ({ appendChild() {} }),
      querySelector: () => null, querySelectorAll: () => [],
    };
  };
  // GHL ships several icon links; a real page has more than one to overwrite.
  const existingIcons = [el("link"), el("link")];
  existingIcons[0].setAttribute("rel", "icon");
  existingIcons[1].setAttribute("rel", "shortcut icon");
  const head = el("head");
  head.appendChild = (node) => calls.headAdded.push(node);

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => { calls.intervals++; return 1; },
    setTimeout: () => 1,
    clearInterval() {}, clearTimeout() {},
    fetch: (url) => {
      calls.fetches.push(String(url));
      // Answer the theme config the way the real endpoint does, so the favicon path runs.
      const body = /\/theme-bundle\//.test(String(url))
        ? { brandName: "Harbour Suite", primaryColor: "#123456", faviconUrl: FAVICON }
        : {};
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
    document: {
      readyState: "complete",
      body: el("body"),
      head,
      styleSheets: [],
      createElement: el,
      createTextNode: () => ({}),
      addEventListener: (e) => calls.listeners.push(e),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel) => (/icon/.test(sel) ? existingIcons : []),
    },
    location: { pathname: "/location/abc123XYZ/dashboard", href: "https://app.example.com/location/abc123XYZ/dashboard" },
    navigator: { userAgent: "node" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  let threw = null;
  try {
    vm.runInNewContext(embed.jsSnippet, sandbox, { timeout: 4000 });
  } catch (e) {
    threw = e;
  }
  check("runs without throwing", threw === null, threw && threw.stack);
  check("hooks the SPA route poll", calls.intervals >= 1, `${calls.intervals} intervals`);

  // The fetch callbacks are microtasks, so let them settle before asserting on the DOM.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  console.log("\n== the favicon actually reaches the tab ==");
  check("rewrote EVERY existing icon link, not just the first",
    existingIcons.every((l) => l.getAttribute("href") === FAVICON),
    existingIcons.map((l) => l.getAttribute("href")).join(" | "));
  check("  -> tagged as ours so it can be undone later",
    existingIcons.every((l) => l.getAttribute("data-mosaic") === "1"));
  check("didn't add a redundant link when ones already existed", calls.headAdded.filter((n) => n.tag === "link").length === 0);
  check("set the browser-tab title too", sandbox.document.title === "Harbour Suite", sandbox.document.title);

  console.log("\n== the JS never re-does the stylesheet's job ==");
  // It used to inject its own '#sidebar-v2 { background: primary !important }'. That
  // style lands in <head> after GHL's Custom CSS, so it WON — an agency who pasted the
  // optional JS had their gradient silently flattened to a solid colour.
  check("injects no sidebar background rule", !/#sidebar-v2[^]*background/.test(embed.jsSnippet));
  check("injects no icon colour rule (only 'filter' works anyway)", !/a i.*color:/.test(embed.jsSnippet));
  check("  -> so a gradient set in the stylesheet survives the paste",
    !/'#sidebar-v2, \.hl_sidebar \{ background/.test(embed.jsSnippet));

  console.log("\n== it asks the server about THIS sub-account ==");
  const urls = calls.fetches.join(" ");
  check("detects the location id from the URL", /abc123XYZ/.test(urls), urls || "(no fetches)");
  check("asks whether support is on here", /\/support\/api\/.*\/config/.test(urls), urls || "(no fetches)");
  check("asks for the theme config too", /\/theme-bundle\/.*\/config\//.test(urls), urls || "(no fetches)");

  console.log("\n== BOTH places that hand over the paste hand over the same thing ==");
  // The onboarding page is where the OAuth redirect lands, so it is the first and most
  // likely moment an agency ever pastes anything. It used to compose its own snippet and
  // shipped the theme bundle ALONE — no support widget — under a heading offering only to
  // "brand the browser-tab title". The dashboard's copy was correct, which is what made it
  // invisible: nobody returns to a page they have already finished with, so switching
  // support on months later did nothing and no screen said why.
  const onboardingHtml = await (await fetch(`${BASE}/onboarding/${agency.id}`)).text();
  const pre = onboardingHtml.match(/<pre id="js-snippet">([\s\S]*?)<\/pre>/)?.[1] ?? "";
  const unescaped = pre.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  check("the onboarding page offers a JS snippet", unescaped.length > 1000, `${unescaped.length} chars`);
  check("  -> it includes the support widget, not just the theme bundle", /Mosaic support widget/.test(unescaped));
  check("  -> and it is byte-identical to the dashboard's", unescaped === embed.jsSnippet, `onboarding ${unescaped.length} chars vs dashboard ${embed.jsSnippet.length}`);
  check("  -> the page no longer calls it merely a tab-title tweak", !/Optional:<\/strong> brand the browser-tab title/.test(onboardingHtml));

  console.log("\n== 'Copied!' means it was actually copied ==");
  // Both copy buttons said "Copied!" for a write that never happened.
  // `navigator.clipboard.writeText` returns a PROMISE, so a rejection — which is exactly
  // what GHL's cross-origin iframe produces — landed outside the try that was meant to
  // catch it, and the missing-API case (plain http, i.e. local dev and ngrok) didn't
  // throw either. The agency pastes, nothing happens, and the thing that told them it
  // worked was us. On the one action the whole product depends on.
  //
  // Executed rather than pattern-matched: the onboarding page ships this as real script
  // text, so it can be run against a stub clipboard that rejects the way GHL's does.
  const script = onboardingHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  check("the onboarding page ships its copy helper", /function copyText/.test(script), `${script.length} chars`);

  const runCopy = (clipboard, execOk) => {
    const btn = { textContent: "Copy" };
    const sandbox = {
      navigator: { clipboard },
      document: {
        getElementById: () => ({ textContent: "@import url(...);" }),
        createElement: () => ({ setAttribute() {}, select() {}, setSelectionRange() {}, style: {} }),
        body: { appendChild() {}, removeChild() {} },
        execCommand: () => execOk,
      },
      setTimeout: () => 0,
    };
    new Function("navigator", "document", "setTimeout", `${script}; copyText(arguments[3], "x");`)(
      sandbox.navigator, sandbox.document, sandbox.setTimeout, btn
    );
    return btn;
  };

  check(
    "execCommand succeeding still reports success",
    runCopy(undefined, true).textContent === "Copied!"
  );
  const noApi = runCopy(undefined, false);
  check(
    "no clipboard API at all is a FAILURE, not a silent success",
    noApi.textContent === "Select & copy",
    noApi.textContent
  );

  // The pre-fix code did not merely mislabel this case — it left the rejection with no
  // handler at all, which on Node 24 terminates the process. Captured rather than left to
  // crash the suite, so the finding is reported instead of looking like a broken harness.
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on("unhandledRejection", onUnhandled);
  const rejecting = runCopy({ writeText: () => Promise.reject(new Error("blocked")) }, false);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  process.off("unhandledRejection", onUnhandled);
  check(
    "a REJECTED write says so — the cross-origin iframe case",
    rejecting.textContent === "Select & copy",
    rejecting.textContent
  );
  check(
    "  -> and the rejection is handled, not left to crash the page",
    unhandled === null,
    String(unhandled)
  );
  const resolving = runCopy({ writeText: () => Promise.resolve() }, false);
  await new Promise((r) => setImmediate(r));
  check("and a real write still says Copied!", resolving.textContent === "Copied!", resolving.textContent);

  // The dashboard half of the same bug, in the shipped bundle.
  const fs = require("node:fs");
  const path = require("node:path");
  const dashDir = `${ROOT}/apps/admin-dashboard/dist/assets`;
  const bundle = fs
    .readdirSync(dashDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(dashDir, f), "utf8"))
    .join("");
  check(
    "the dashboard AWAITS its clipboard write rather than assuming it",
    /await navigator\.clipboard\.writeText|navigator\.clipboard\.writeText\([^)]*\)\.then/.test(bundle) ||
      /await [a-zA-Z$_]+\.clipboard\.writeText/.test(bundle),
    "no awaited clipboard write found in the built bundle"
  );

  console.log("\n== switching support on needs no re-paste ==");
  // The snippet is static text; the gate lives in the response. So the check that matters
  // is that nothing in the paste hardcodes today's on/off state.
  check("no baked-in enabled flag", !/\benabled\s*[:=]\s*(true|false)\b/.test(embed.jsSnippet));
  check("the widget builds nothing until the server says yes", /cfg\.enabled/.test(embed.jsSnippet));

  console.log("\n== the reason to paste it is readable while the section is CLOSED ==");
  /**
   * The JS snippet lives behind a collapsed `<details>` on this page, below a green
   * "That's it." The paragraph INSIDE already said the decisive thing — "skipping it now is
   * the one thing that would make you come back to this page later" — and that is precisely
   * the sentence somebody needs in order to open the disclosure it is hidden in.
   *
   * So this asserts the consequence is in the SUMMARY. Checking that it appears anywhere on
   * the page is what would have passed all along, because it always did: it was one
   * disclosure triangle away from being read, on the page whose entire history is agencies
   * finishing at step 3 and never coming back.
   */
  const summary = onboardingHtml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "";
  check(
    "the summary names the consequence, not just the features",
    /brings you back here later|come back/i.test(summary),
    summary.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140) || "(no summary found)"
  );
  check(
    "  -> and the section is still CLOSED, so the required CSS step is not buried under 31KB",
    !/<details[^>]*\sopen[\s>]/.test(onboardingHtml),
    "details must not be open by default"
  );

  console.log("\n== and the dashboard's own copy of that surface says it too ==");
  /**
   * The other place the paste is handed over, and the one an agency returns to when they DO
   * come back. Everything correct about its JavaScript section was one click away: expanded,
   * it already explained that the snippet is never re-pasted and that the bubble appears
   * months later when support is switched on. Collapsed — which is how everyone meets it —
   * the label read "Show OPTIONAL JavaScript", a word that argues against the click, with
   * nothing about what skipping it costs.
   *
   * Asserted on the COLLAPSED branch specifically. "The phrase is in the file" would have
   * passed the whole time, because the expanded copy has always been there — the same reason
   * the onboarding check reads the summary rather than the page.
   */
  const modalSrc = require("fs").readFileSync(`${ROOT}/apps/admin-dashboard/src/CssExportModal.tsx`, "utf8");
  const collapsed = modalSrc.split("{!showJs &&")[1]?.split("{showJs &&")[0] ?? "";
  check(
    "the JS section states the consequence while it is still collapsed",
    /brings you back here later|come back here later/i.test(collapsed),
    collapsed ? "no consequence in the !showJs branch" : "no !showJs branch at all"
  );
  check(
    "  -> and nothing on that screen calls the snippet \"optional\"",
    // Strip BOTH comment forms before looking. The word survives in prose here — including
    // in the note explaining why it was removed from the UI — and a check that reads its own
    // rationale as a violation is the CSS-comment trap in another language.
    !/\boptional\b/i.test(
      modalSrc
        .replace(/\/\*[^]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n")
    ),
    "the word argues against the one paste the support half depends on"
  );

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => { await p.$disconnect(); process.exit(fail ? 1 : 0); });
