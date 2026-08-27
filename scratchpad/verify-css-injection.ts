/**
 * The sanitisers are the only thing between a stored theme value and every client's browser.
 *
 * CLAUDE.md states the guarantee plainly — "Color/URL values are sanitized (`cssColor`/
 * `cssUrl`) before entering the stylesheet; feature keys are whitelisted so they can't
 * break out of a selector" — and `themeCssBundle.test.ts` had NINE tests, not one of which
 * mentions `cssColor`, `cssUrl`, injection or escaping. A security claim with no adversarial
 * coverage, in the one file whose output is render-blocking CSS on every page load.
 *
 * What makes it worth measuring rather than reading: **the stylesheet is ONE file for the
 * whole agency.** `generateThemeCssBundle` concatenates the agency default and every
 * sub-account's block into a single response, so a value that corrupts the CSS parser does
 * not break one sub-account's branding — it breaks whatever comes AFTER it, which is other
 * clients. That is the cross-tenant coupling `circuitBreaker.ts` was extracted to remove,
 * arriving through the parser instead of through an exception.
 *
 * So the assertion here is never "the value was escaped". It is: **does sub-account B still
 * get its rules when sub-account A stores this?** Measured by handing the REAL response from
 * the REAL route to a REAL browser and reading `cssRules` back — a claim about escaping that
 * nothing parses is the same kind of claim as "Copied!".
 *
 * Fixtures are a throwaway agency of its own, so nothing here touches a real one: this file
 * writes theme rows, and CLAUDE.md records `verify-desk` leaving a real sub-account at
 * version 30 by doing exactly that.
 *
 *   npx tsx scratchpad/verify-css-injection.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
const p = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}

/* ------------------------------------------------------------------ browser */
async function pageTarget(): Promise<any> {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = (list as any[]).find((t) => t.type === "page");
  if (found) return found;
  return await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
}
let ws: WebSocket;
let msgId = 0;
const pending = new Map<number, (m: any) => void>();
async function connect(): Promise<void> {
  const page = await pageTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r as any));
  ws.onmessage = (e: any) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  };
}
const send = (method: string, params: any = {}) =>
  new Promise<any>((res, rej) => {
    const n = ++msgId;
    pending.set(n, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
async function ev(body: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression: "(()=>{" + body + "})()", returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}

/**
 * Apply the stylesheet to a DOM shaped like GHL's and read back what the browser PAINTS.
 *
 * The first draft of this file counted `cssRules` and searched their text, and it passed
 * the neighbour's canary on runs where the neighbour had no branding at all — because CSS
 * error recovery does not DELETE the rules that follow a broken one, it swallows them as
 * NESTED rules inside it. B's selector and B's colour are still right there in `cssText`,
 * matching nothing. A check that reads rule text is a check that agrees with you; the only
 * honest question is what colour the sidebar comes out.
 */
async function paint(css: string, locationIds: string[]): Promise<Record<string, string> & { rules: number }> {
  const body =
    "const CSS = " + JSON.stringify(css) + ";" +
    "const IDS = " + JSON.stringify(locationIds) + ";" +
    "document.body.innerHTML = '';" +
    "const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);" +
    "const out = {};" +
    "for (const id of IDS) {" +
    "  const w = document.createElement('div'); w.className = id;" +
    "  w.innerHTML = '<div id=\"sidebar-v2\"><a href=\"/location/' + id + '/dashboard\">x</a></div>';" +
    "  document.body.appendChild(w);" +
    "  out[id] = getComputedStyle(w.firstChild).backgroundColor;" +
    "  out[id + ':link'] = getComputedStyle(w.querySelector('a')).color;" +
    "}" +
    "try { out.rules = s.sheet.cssRules.length; } catch (e) { out.rules = -1; }" +
    "s.remove(); document.body.innerHTML = '';" +
    "return out;";
  return await ev(body);
}

/* ------------------------------------------------------------------ fixtures */
const STAMP = Date.now();
const made = { agencyId: "", locationIds: [] as string[] };

async function teardown(): Promise<void> {
  if (!made.agencyId) return;
  await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: made.agencyId } } });
  await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  made.agencyId = "";
  console.log("\ncleanup: throwaway agency removed");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig as any, () => { teardown().finally(() => process.exit(130)); });
}

/** Fetch the real stylesheet the real route builds. */
async function stylesheet(): Promise<string> {
  const r = await fetch(BASE + "/theme-css/" + made.agencyId, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("theme-css returned " + r.status);
  return await r.text();
}

/** Store a theme for sub-account A (the one under test) and read the bundle back. */
async function withThemeA(theme: Record<string, unknown>): Promise<{ css: string; painted: any }> {
  await p.themeConfig.deleteMany({ where: { locationInstallId: made.locationIds[0] } });
  await p.themeConfig.create({ data: { locationInstallId: made.locationIds[0], version: 1, ...(theme as any) } });
  const css = await stylesheet();
  return { css, painted: await paint(css, [idA, idB]) };
}

let idA = "";
let idB = "";
const LIME = "rgb(0, 255, 0)";

async function main(): Promise<void> {
  await connect();

  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "cssinject-" + STAMP,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "CSS Injection Probe",
    },
  });
  made.agencyId = agency.id;

  /**
   * TWO sub-accounts, and B is the whole point. A is where the value under test is stored;
   * B is an innocent neighbour whose block is emitted AFTER A's, which is where a parser
   * that has lost its place does its damage. One agency, one stylesheet — that is what
   * makes a malformed field somebody else's problem.
   */
  for (const name of ["A", "B"]) {
    const loc = await p.locationInstall.create({
      data: {
        agencyInstallId: agency.id,
        ghlLocationId: "cssinject" + STAMP + name,
        status: "active", enabled: true, locationName: "Client " + name,
      },
    });
    made.locationIds.push(loc.id);
  }
  idA = "cssinject" + STAMP + "A";
  idB = "cssinject" + STAMP + "B";

  // B is branded lime and never changes. Its SIDEBAR COLOUR is the canary for every case.
  await p.themeConfig.create({
    data: { locationInstallId: made.locationIds[1], version: 1, primaryColor: "#00ff00", brandName: "Client B" },
  });

  console.log("\n== the control: a clean bundle, so a later failure means something ==");
  const clean = await withThemeA({ primaryColor: "#123456" });
  check("sub-account A's sidebar is painted", clean.painted[idA] === "rgb(18, 52, 86)", clean.painted[idA]);
  check("sub-account B's sidebar is painted — the canary", clean.painted[idB] === LIME, clean.painted[idB]);
  check("and A's second rule is readable too", (await withThemeA({ primaryColor: "#123456", sidebarTextColor: "#0000ff" })).painted[idA + ":link"] === "rgb(0, 0, 255)");
  const BASELINE = clean.painted.rules;
  console.log("        baseline: " + BASELINE + " rules parsed from " + clean.css.length + " bytes");

  /**
   * Every case names what an agency would have to type to reach it. A guard is only worth
   * arguing about if the input is reachable, and each of these is a free-text field in the
   * theme editor — none of them requires anybody to be hostile.
   */
  const CASES: [string, Record<string, unknown>, string][] = [
    ["a colour carrying a CSS comment opener", { primaryColor: "red/*" }, "pasted out of a stylesheet: red/* brand */"],
    ["a colour carrying a comment closer", { primaryColor: "red*/" }, "the tail of that same paste"],
    ["an alert message carrying a bare CR", { alertMessage: "Scheduled maintenance\rtonight" }, "text pasted from a classic-Mac or mixed-newline source"],
    ["an alert message carrying a form feed", { alertMessage: "Scheduled\fmaintenance" }, "text pasted out of a PDF"],
    ["a menu label carrying a form feed", { menuLabelOverrides: { contacts: "Peo\fple" } }, "the same paste, one field over"],
    ["a font family carrying an apostrophe", { fontFamily: "Ev'il Sans" }, "an apostrophe in a font name"],
    ["custom CSS whose value holds a brace", { customCssOverride: '.hl_nav::after { content: "}" }' }, "the raw-CSS escape hatch"],
    ["custom CSS with a stray closing brace", { customCssOverride: "} .hl_nav { color: red } .z {" }, "a paste that lost its opening brace"],
  ];

  for (const [label, theme, why] of CASES) {
    console.log("\n== " + label + " ==");
    console.log("        reachable by: " + why);
    /**
     * Every case ALSO stores a valid `sidebarTextColor`, which lands in a different rule
     * from the value under test. That is the containment property: a malformed field may
     * cost its own declaration — nobody can make `red/*` mean a colour — but it must not
     * cost the sub-account the rest of its theme, and it must never cost the neighbour.
     */
    const got = await withThemeA({ ...theme, sidebarTextColor: "#0000ff" });
    check(
      "the NEIGHBOUR sub-account still gets its branding",
      got.painted[idB] === LIME,
      "B's sidebar is " + got.painted[idB] + ", not " + LIME + " — one agency, one stylesheet, so this is somebody else's client"
    );
    check(
      "the rest of the sub-account's OWN theme still applies",
      got.painted[idA + ":link"] === "rgb(0, 0, 255)",
      "A's other rule died too — its nav text is " + got.painted[idA + ":link"] + ", not rgb(0, 0, 255)"
    );
    console.log("        " + got.painted.rules + " of " + BASELINE + " rules survived the parser");
  }

  console.log("\n== the escape hatch: scoped, and not thrown away ==");
  /**
   * TWO properties from one paste, and they pull against each other. `#sidebar-v2` is
   * written unscoped, so it must be prefixed onto A and reach nobody else; and the stray
   * leading `}` — a paste that lost its opening brace — must not cost the agency the rule.
   *
   * The second is pinned against MY OWN change rather than the original bug: the flat regex
   * dropped a stray brace as a side effect of `[^{}]+`, and the splitter that replaced it
   * has to do so on purpose. Without that, the `}` lands mid-selector, the selector is
   * invalid, and the rule silently vanishes — no escape, just a paste that stopped working.
   */
  const hatch = await withThemeA({
    primaryColor: "#123456",
    // Aimed at the nav LINK, not the sidebar: the theme's own background rule carries a
    // `:has()` and therefore outranks anything the prefix can build, so a custom rule
    // losing to it would prove nothing either way.
    customCssOverride: "} #sidebar-v2 a { color: rgb(255,0,0) !important }",
  });
  check(
    "an unscoped selector in custom CSS reaches its OWN sub-account",
    hatch.painted[idA + ":link"] === "rgb(255, 0, 0)",
    "A's nav text is " + hatch.painted[idA + ":link"] + " — the rule was dropped, so a paste missing its opening brace silently does nothing"
  );
  check(
    "…and reaches no other sub-account",
    hatch.painted[idB + ":link"] !== "rgb(255, 0, 0)",
    "B's nav text is red — painted from A's custom CSS box"
  );

  console.log("\n== …and a media query still MEANS something ==");
  /**
   * The flat regex used to delete the `@media` wrapper and keep the rule inside it, so an
   * agency's mobile tweak also fired on the desktop their client uses all day. Nothing
   * errored; the rule simply always applied. Asserted by painting: at this viewport a
   * 1px-wide query must not match.
   */
  const media = await withThemeA({
    primaryColor: "#123456",
    customCssOverride:
      "@media (max-width: 1px) { #sidebar-v2:has(a[href*=\"/location/" + idA + '/"]) { background: rgb(255,0,0) !important } }',
  });
  check(
    "a query the viewport does not match does not apply",
    media.painted[idA] === "rgb(18, 52, 86)",
    "A's sidebar is " + media.painted[idA] + " — the @media wrapper was dropped, so the rule fires at every width"
  );

  console.log("\n== a sub-account NAME reaches the stylesheet as a comment ==");
  /**
   * `generateThemeCssBundle` labels each block `/* <locationName> *\/`. The name is chosen
   * by the agency in GHL, so a `*\/` in it closes that comment early and the remainder of
   * the name is parsed as CSS — at the top level, unscoped, in front of every other
   * sub-account's block.
   */
  await p.locationInstall.update({
    where: { id: made.locationIds[0] },
    data: {
      // Aimed at the NEIGHBOUR, and more specific than B's own rule, so "B is still lime"
      // cannot pass on specificity while the escape really happened.
      locationName:
        'Acme */ #sidebar-v2:has(a[href*="/location/' + idB + '/"]) { background: rgb(255,0,0) !important } /*',
    },
  });
  const named = await withThemeA({ primaryColor: "#123456" });
  check(
    "a sub-account NAME cannot emit a rule at the neighbour",
    named.painted[idB] === LIME,
    "B's sidebar is " + named.painted[idB] + " — painted by a string typed into another sub-account's name field in GHL"
  );
  await p.locationInstall.update({ where: { id: made.locationIds[0] }, data: { locationName: "Client A" } });

  console.log("\n== …and the values that are supposed to work still do ==");
  /** A guard that blocks the feature is not a fix — the control every SSRF check here carries. */
  const ok = await withThemeA({
    primaryColor: "#0f766e",
    logoUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    alertMessage: 'Say "hello" \u2014 it is fine',
    fontFamily: "Inter",
    menuLabelOverrides: { contacts: "People" },
  });
  check("a data: URL logo survives (the ; that cssUrl must not strip)", ok.css.includes("base64,iVBOR"), ok.css.slice(0, 200));
  check("the quoted alert message is still emitted", ok.css.includes("hello"), "");
  check("the renamed label is still emitted", ok.css.includes("People"), "");
  check("the font is still imported", ok.css.includes("family=Inter"), ok.css.slice(0, 120));
  check("A gets the colour it asked for", ok.painted[idA] === "rgb(15, 118, 110)", ok.painted[idA]);
  check("B is still fine alongside all of it", ok.painted[idB] === LIME, ok.painted[idB]);

  console.log("\n" + "-".repeat(70) + "\n  " + pass + " passed, " + fail + " failed");
}

main()
  .catch((e) => { console.error("\nERROR:", e); fail++; })
  .finally(async () => {
    await teardown();
    await p.$disconnect();
    try { ws?.close(); } catch {}
    process.exit(fail ? 1 : 0);
  });
