/**
 * The content area, end to end: the editor's payload -> the PUT -> the row -> the bytes
 * every client's browser actually parses.
 *
 * Three columns carried this for the life of the schema and rendered nothing.
 * `contentBgColor` and `contentTextColor` appeared nowhere outside `schema.prisma`;
 * `darkMode` was accepted by the PUT, stored on all three models, carried through presets
 * and threaded into the editor's `Look` — and read by not one line of `themeCssBundle`.
 * `audit-fields.js` reported all three on every run since it was written.
 *
 * WHAT THIS SUITE IS REALLY FOR. Every other selector in the stylesheet is either
 * confirmed against live GHL DOM or a best-effort guess at a GHL class name. This one is
 * neither, because nothing in this repository knows what GHL calls its content container.
 * Shipping it is therefore defensible only if two properties hold, and they are what is
 * asserted here rather than argued:
 *
 *   1. OPT-IN. A theme nobody has touched emits ZERO content bytes. The stylesheet is
 *      render-blocking and shared by a whole agency, so an unconfirmed selector that
 *      everybody pays for would be the menu-reordering fallback this repo already refuses.
 *   2. IT CANNOT MAKE ANYTHING WORSE. The rules set colours and never position, size or
 *      display; they never name the sidebar or the header; and a background never derives
 *      a text colour, because `color` inherits into GHL's own cards, which we do not
 *      repaint. The worst case is a visible no-op the agency clears in one click.
 *
 * Fixtures are a throwaway agency of its own — this writes theme versions, and CLAUDE.md
 * records `verify-desk` leaving a real sub-account at version 30 by doing exactly that.
 *
 *   npx tsx scratchpad/verify-content-area.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
const p = new PrismaClient();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail === undefined ? "" : "   " + String(detail).slice(0, 300)}`); }
}

const made = { agencyId: "" };
async function teardown(): Promise<void> {
  if (!made.agencyId) return;
  await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: made.agencyId } } });
  await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyDefaultThemeVersion.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  made.agencyId = "";
  console.log("\ncleanup: throwaway agency removed");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { void teardown().then(() => process.exit(130)); });
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + "/admin/api/" + made.agencyId + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** The stylesheet the agency's clients actually load. */
async function sheet(): Promise<string> {
  const r = await fetch(`${BASE}/theme-css/${made.agencyId}`);
  if (!r.ok) throw new Error(`/theme-css -> ${r.status}`);
  return r.text();
}

/** Only the declarations aimed at the content canvas. */
const contentRules = (css: string) =>
  css.split("\n").filter((l) => /body, #app, main|:is\(body, #app, main/.test(l));

/**
 * What the EDITOR sends. Whole-object, exactly as `ThemeEditor`'s save payload is built,
 * because a harness that posts a hand-picked subset measures its own bug — the trap that
 * cost `verify-preset-apply` a false failure by sending `customCssOverride` for `customCss`.
 */
const BASE_THEME = {
  brandName: "Canvas Probe",
  primaryColor: "#0f766e",
  accentColor: "",
  fontFamily: "",
  gradientEnabled: false,
  gradientColor: "",
  gradientAngle: 135,
  topBarColor: "",
  buttonColor: "",
  cornerRadius: 8,
  scrollbarColor: "",
  sidebarTextColor: "#ffffff",
  sidebarIconColor: "",
  buttonShape: "",
  darkMode: false,
  contentBgColor: "",
  contentTextColor: "",
  hideUpgrade: false,
  hiddenFeatures: [],
  menuLabelOverrides: {},
  menuOrder: [],
};

async function main(): Promise<void> {
  const stamp = Date.now();
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "canvascheck-" + stamp,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Content Area Probe",
    },
  });
  made.agencyId = agency.id;
  const loc = await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id,
      ghlLocationId: "canvascheck-" + stamp,
      status: "active", enabled: true, locationName: "Client A",
    },
  });
  const other = await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id,
      ghlLocationId: "canvasneighbour-" + stamp,
      status: "active", enabled: true, locationName: "Client B",
    },
  });

  console.log("\n== a theme nobody has touched pays NOTHING ==");
  await api("PUT", "/locations/" + loc.id + "/theme", BASE_THEME);
  {
    const css = await sheet();
    check("the sub-account's theme is in the stylesheet at all", css.includes("#sidebar-v2"), css.length);
    const rules = contentRules(css);
    check("…and it emits ZERO content rules", rules.length === 0, rules.join("\n"));
    // The control: "no content rules" is trivially true of a stylesheet that failed to
    // build. This proves the theme really rendered.
    check("…while the colour it DID set is present", css.includes("#0f766e"));
  }

  console.log("\n== dark mode paints the canvas, and only the canvas ==");
  await api("PUT", "/locations/" + loc.id + "/theme", { ...BASE_THEME, darkMode: true });
  {
    const stored = await p.themeConfig.findFirst({
      where: { locationInstallId: loc.id }, orderBy: { version: "desc" },
    });
    check("the PUT stored darkMode", stored?.darkMode === true, stored?.darkMode);

    const rules = contentRules(await sheet());
    check("exactly one content rule is emitted", rules.length === 1, rules.join("\n"));
    check("…a background", /background-color:\s*#111827/.test(rules.join("")), rules.join(""));
    // The load-bearing negative. `color` on the canvas inherits into GHL's own cards and
    // tables, which this stylesheet does not repaint, so a derived light text would land
    // on their white backgrounds and disappear.
    check("…and NO text colour, derived or otherwise", !/[^-]color:\s*#/.test(rules.join("")), rules.join(""));
  }

  console.log("\n== an explicit pair is honoured, and a chosen colour beats the toggle ==");
  await api("PUT", "/locations/" + loc.id + "/theme", {
    ...BASE_THEME, darkMode: true, contentBgColor: "#332211", contentTextColor: "#eeddcc",
  });
  {
    const rules = contentRules(await sheet()).join("\n");
    check("the chosen background wins over dark mode's", rules.includes("#332211") && !rules.includes("#111827"), rules);
    check("…and the chosen text colour is emitted", rules.includes("#eeddcc"), rules);
  }

  console.log("\n== it never reaches anything we already brand ==");
  {
    const rules = contentRules(await sheet()).join("\n");
    check("no sidebar in a content rule", !/sidebar-v2|hl_nav/.test(rules), rules);
    check("no header in a content rule", !/hl_header/.test(rules), rules);
    check("no layout property — colours only", !/position:|display:|width:|height:|margin:|padding:|float:/.test(rules), rules);
  }

  console.log("\n== a sub-account's canvas does not become its neighbour's ==");
  await api("PUT", "/locations/" + other.id + "/theme", { ...BASE_THEME, brandName: "Client B" });
  {
    const css = await sheet();
    const rules = contentRules(css);
    check("only ONE sub-account has content rules", rules.length === 2, rules.join("\n"));
    check(
      "…and every one of them is scoped to that sub-account",
      rules.every((r) => r.includes(loc.ghlLocationId)),
      rules.join("\n")
    );
    check("the neighbour is in the sheet and has none", css.includes(other.ghlLocationId) && !rules.some((r) => r.includes(other.ghlLocationId)));
  }

  console.log("\n== the AGENCY DEFAULT paints every sub-account, unscoped ==");
  await api("PUT", "/locations/" + loc.id + "/theme", BASE_THEME);
  await api("PUT", "/default-theme", { ...BASE_THEME, brandName: "Agency Fallback", darkMode: true });
  {
    const rules = contentRules(await sheet());
    check("the agency default emits a content rule", rules.length === 1, rules.join("\n"));
    check("…globally, with no location prefix", !/has\(|\[class~=/.test(rules[0] ?? ""), rules[0]);
    check("…and it is the dark canvas", (rules[0] ?? "").includes("#111827"), rules[0]);
  }

  console.log("\n== a sub-account OVERRIDES the agency default, by specificity ==");
  await api("PUT", "/locations/" + loc.id + "/theme", { ...BASE_THEME, contentBgColor: "#445566" });
  {
    const rules = contentRules(await sheet());
    check("both rules are present", rules.length === 2, rules.join("\n"));
    const global = rules.find((r) => !r.includes("has("));
    const local = rules.find((r) => r.includes("has("));
    check("the global one is the agency default", (global ?? "").includes("#111827"), global);
    check("the local one is the sub-account's", (local ?? "").includes("#445566"), local);
    // Order matters as much as presence: the override has to come AFTER, and it wins on
    // specificity anyway, but a sheet that emitted them the other way round would be
    // relying on specificity alone.
    check(
      "…and the override is emitted after the default",
      rules.indexOf(local!) > rules.indexOf(global!),
      rules.join("\n")
    );
  }

  console.log("\n== a hostile value cannot break out, as everywhere else in this file ==");
  await api("PUT", "/locations/" + loc.id + "/theme", {
    ...BASE_THEME, contentBgColor: "red/*", contentTextColor: "#fff;}body{display:none",
  });
  {
    const css = await sheet();
    const rules = contentRules(css).join("\n");
    check("no comment opener survives", !rules.includes("/*") && !rules.includes("*/"), rules);
    /*
      The property is that the value could not open a SECOND block — not that no `;}`
      appears anywhere, which was the first draft and could never pass, because every CSS
      rule on earth ends `!important; }`. A check that cannot pass is as useless as one
      that cannot fail; this one failed for the wrong reason and said the product was
      broken.

      `cssColor` strips `; { } < > *`, so the injected `}body{display:none` collapses into
      one unusable value inside one declaration. The parser drops that declaration and
      keeps the rest — which `verify-css-injection` measures in a real browser by reading
      the colour a neighbour is actually PAINTED. Here it is the structure that matters.
    */
    for (const r of contentRules(css)) {
      check(
        "one block per content rule, so nothing broke out: " + r.slice(0, 48),
        (r.match(/\{/g) ?? []).length === 1 && (r.match(/\}/g) ?? []).length === 1,
        r
      );
    }
    check("…and the rest of the stylesheet still parses to real rules", css.includes("#sidebar-v2"), css.length);
  }
}

main()
  .catch((e) => { fail++; console.error("\nHARNESS ERROR:", e); })
  .finally(async () => {
    await teardown();
    await p.$disconnect();
    console.log(`\n${"-".repeat(60)}\n  ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
