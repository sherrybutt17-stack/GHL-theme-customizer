/**
 * The editor's fallbacks must be the SERVER's fallbacks.
 *
 * `MosaicPreview` and `lookFrom` together form a second definition of what a theme looks
 * like, and this repo's most repeated bug is two definitions of one fact drifting apart —
 * already recorded once for this exact pair, when the preview sorted unlisted menu items
 * LAST while the stylesheet put them FIRST, "so the preview and the real sidebar disagree
 * precisely when it mattered".
 *
 * It had drifted again, on the accent colour. `renderRules` resolves the active menu item
 * as `accentColor || primaryColor || "#4f46e5"`; `lookFrom` resolved it as
 * `accentColor ?? "#f59e0b"`. So a sub-account branded teal with no accent chosen — the
 * ordinary outcome of "Brand from websites", which only sets colours — showed a TEAL active
 * item in the live stylesheet, and turned AMBER the moment anybody opened the editor and
 * pressed Save for any reason at all.
 *
 * Measured on this database before the fix: zero of ten sub-accounts were in the
 * primary-set / accent-unset state, because every themed one already carried a stored
 * accent — which is itself the evidence that the editor had been materialising it.
 *
 * This compares the two implementations DIRECTLY, over synthetic themes, so it needs no
 * browser and writes nothing. `themeDefaults.ts` is dependency-free on purpose: importing
 * `ThemeEditor.tsx` would drag in `api.ts`, which reads `import.meta.env` at module load
 * and cannot run outside Vite — the trap already recorded for `SESSION_EXPIRED_MESSAGE`.
 *
 *   npx tsx scratchpad/verify-preview-truth.ts
 */
import "../apps/server/src/services/loadEnv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRules } from "../apps/server/src/services/themeCssBundle";
import { renderLoginRules } from "../apps/server/src/services/themeCssBundle";
import {
  resolveAccentColor,
  resolveLoginBackground,
  resolveLoginCard,
  resolveLoginButton,
  unbrandedLoginParts,
  resolveContentTheme as previewContentTheme,
} from "../apps/admin-dashboard/src/themeDefaults";
import { resolveContentTheme as serverContentTheme } from "../apps/server/src/services/contentTheme";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

const scope: any = { bases: ["#sidebar-v2"], prefix: "" };

/** What the LIVE stylesheet paints on the active menu item for a stored theme. */
function liveAccent(theme: Record<string, unknown>): string | null {
  const rule = renderRules(scope, theme as any).find((r) => r.includes("a.active"));
  const m = rule?.match(/background:\s*([^ !]+)/);
  return m ? m[1] : null;
}

const CASES: [string, { primaryColor?: string | null; accentColor?: string | null }][] = [
  ["branded teal, no accent chosen — the brand-scan case", { primaryColor: "#0f766e", accentColor: null }],
  ["branded, accent chosen too", { primaryColor: "#0f766e", accentColor: "#ff5722" }],
  ["nothing set at all — a brand-new sub-account", { primaryColor: null, accentColor: null }],
  ["accent only, no primary", { primaryColor: null, accentColor: "#123456" }],
];

console.log("\n== the editor and the stylesheet must agree on the active menu item ==");
for (const [label, theme] of CASES) {
  const live = liveAccent(theme);
  const editor = resolveAccentColor(theme);
  check(
    `${label}: ${editor} vs ${live}`,
    live !== null && live.toLowerCase() === editor.toLowerCase(),
    `the editor would show and SAVE ${editor}, while the live stylesheet paints ${live}`
  );
}

console.log("\n== …and the fallback chain is the server's, in order ==");
/**
 * Order matters, not just the endpoints. `accentColor ?? primary` and
 * `primary ?? accentColor` agree on three of the four cases above and disagree on the one
 * that actually happens — which is how the original bug survived: it was RIGHT whenever an
 * accent had been stored, and every sub-account anybody had opened had one.
 */
check(
  "an explicit accent beats the primary",
  resolveAccentColor({ primaryColor: "#111111", accentColor: "#222222" }) === "#222222"
);
check(
  "the primary is preferred over any hardcoded colour",
  resolveAccentColor({ primaryColor: "#111111", accentColor: null }) === "#111111"
);
check(
  "an EMPTY STRING is not a colour — the editor stores '' for a cleared field",
  resolveAccentColor({ primaryColor: "#111111", accentColor: "" }) === "#111111",
  `got ${resolveAccentColor({ primaryColor: "#111111", accentColor: "" })}`
);
check(
  "with neither, it lands on the same constant the server uses",
  resolveAccentColor({}) === "#4f46e5",
  resolveAccentColor({})
);

console.log("\n== the amber placeholder is gone from the editor ==");
/**
 * A source check, with its known limit stated: it proves the CONSTANT is not there, not
 * that the chain is right — the executable checks above do that. Both are needed, which is
 * the `slaTone` lesson: the source check missed the fixed-threshold mutation and the
 * executable ones missed the hardcoded copy.
 */
import { readFileSync } from "node:fs";
const editorSrc = readFileSync(new URL("../apps/admin-dashboard/src/ThemeEditor.tsx", import.meta.url), "utf8");
const withoutComments = editorSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
check(
  "no #f59e0b left in the editor outside the comments explaining it",
  !/#f59e0b/i.test(withoutComments),
  "the amber default is still being assigned somewhere"
);


/* ------------------------------------------------------------------ login page */
/**
 * The same pair one screen over: `LoginPreview` beside `renderLoginRules`. It had drifted
 * further than the sidebar preview ever did — it INVENTED branding for fields the server
 * delivers nothing for (`bgColor || "#0f172a"`, `cardColor || "#ffffff"`,
 * `buttonColor || "#4f46e5"`), so an agency who had set nothing saw a dark-slate login
 * screen with a white box and an indigo button, and got GoHighLevel's own page live.
 *
 * And it required only a gradient COLOUR where the server requires a base colour too, so a
 * gradient could paint here and be absent from the stylesheet entirely.
 */

const LOGIN_BG = ".sidebar-v2-agency, .hl_login";

/** What the stylesheet will actually paint the login background, read out of the rules. */
function liveLoginBg(t: Record<string, unknown>): string | null {
  const rule = renderLoginRules(t as never).find((r) => r.startsWith(LOGIN_BG));
  if (!rule) return null;
  const img = rule.match(/background-image: url\("([^"]*)"\)/);
  if (img) return "image:" + img[1];
  return rule.match(/background: (.+?) !important/)?.[1] ?? null;
}
/** …and the editor's answer, in the same vocabulary. */
function editorLoginBg(l: any): string | null {
  const v = resolveLoginBackground(l);
  if (v === null) return null;
  const img = v.match(/^url\("([^"]*)"\)/);
  return img ? "image:" + img[1] : v;
}

const emptyLogin = {
  bgColor: "", bgImage: "", gradientEnabled: false, gradientColor: "", gradientAngle: 135,
  cardColor: "", buttonColor: "",
};
const toStored = (l: typeof emptyLogin) => ({
  loginBgColor: l.bgColor || null,
  loginBgImage: l.bgImage || null,
  loginGradientEnabled: l.gradientEnabled,
  loginGradientColor: l.gradientColor || null,
  loginGradientAngle: l.gradientAngle,
  loginCardColor: l.cardColor || null,
  loginButtonColor: l.buttonColor || null,
});

const LOGIN_CASES: [string, Partial<typeof emptyLogin>][] = [
  ["a fresh agency that has set nothing", {}],
  ["a background colour only", { bgColor: "#0f766e" }],
  ["a gradient, properly set up", { bgColor: "#0f766e", gradientEnabled: true, gradientColor: "#1e293b" }],
  ["a gradient with NO base colour — the drift", { gradientEnabled: true, gradientColor: "#1e293b" }],
  ["a gradient switched on with no second colour", { bgColor: "#0f766e", gradientEnabled: true }],
  ["an image, which outranks the gradient", { bgImage: "https://x/y.png", bgColor: "#0f766e", gradientEnabled: true, gradientColor: "#1e293b" }],
  ["a non-default angle", { bgColor: "#0f766e", gradientEnabled: true, gradientColor: "#1e293b", gradientAngle: 20 }],
];

console.log("\n== the login preview and the login stylesheet must agree ==");
for (const [label, patch] of LOGIN_CASES) {
  const look = { ...emptyLogin, ...patch };
  const live = liveLoginBg(toStored(look));
  const editor = editorLoginBg(look);
  check(
    `${label}: ${editor ?? "(GHL's own)"} vs ${live ?? "(GHL's own)"}`,
    live === editor,
    `the preview would show ${editor ?? "nothing"} while the stylesheet delivers ${live ?? "nothing"}`
  );
}

console.log("\n== …and an unset part is reported as unset, not painted ==");
/**
 * `null` is a real answer here, not a colour. Painting a placeholder for it is what made a
 * preview of an unbranded login page indistinguishable from a branded one.
 */
for (const [field, resolve] of [
  ["card", (l: any) => resolveLoginCard(l.cardColor)],
  ["button", (l: any) => resolveLoginButton(l.buttonColor)],
] as [string, (l: any) => string | null][]) {
  check(`an unset ${field} resolves to null, not a placeholder`, resolve(emptyLogin) === null);
}
check(
  "a set card is passed through unchanged",
  resolveLoginCard("#123456") === "#123456"
);
check(
  "the server agrees there is no card rule when it is unset",
  !renderLoginRules(toStored(emptyLogin) as never).some((r) => r.includes(".card"))
);
check(
  "everything unset is named, so the mock cannot pass for branding",
  unbrandedLoginParts({ ...emptyLogin, logoUrl: "" }).join(",") === "background,login box,button,logo",
  unbrandedLoginParts({ ...emptyLogin, logoUrl: "" }).join(",")
);
check(
  "nothing is named once it is all set",
  unbrandedLoginParts({
    ...emptyLogin, bgColor: "#111111", cardColor: "#222222", buttonColor: "#333333", logoUrl: "https://x/l.png",
  }).length === 0
);



console.log("\n== the sidebar-icon field claimed a default the stylesheet does not have ==");
/**
 * `LookFields` drew this swatch as `sidebarIconColor || accentColor || "#f59e0b"` under a
 * hint reading "Defaults to the accent color." `renderRules` has NO such fallback — the
 * icon rule is emitted only `if (theme.sidebarIconColor)`.
 *
 * So an agency with a teal accent saw a teal swatch, the hex `#14b8a6` printed beneath it,
 * and a sentence saying that is what the icons do. The icons were GHL's own grey. And
 * unlike the four rows `lookFrom` materialises, this one stays EMPTY through a save, so no
 * amount of saving ever made the claim true.
 */
{
  const branded: any = { primaryColor: "#0f766e", accentColor: "#14b8a6", sidebarIconColor: "" };
  const hasFilter = (t: any) => renderRules(scope, t).some((r) => /filter:/.test(r));
  check("with the field unset, NO icon rule is emitted — the accent is not a fallback", !hasFilter(branded));
  check("…and setting it does emit one (a fix that kills the feature is not a fix)",
    hasFilter({ ...branded, sidebarIconColor: "#14b8a6" }));

  const lf = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "LookFields.tsx"), "utf8");
  const code = lf.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
  check(
    "the swatch no longer resolves through the accent colour",
    !/sidebarIconColor \|\| value\.accentColor/.test(code),
    code.match(/.{0,40}sidebarIconColor \|\|.{0,40}/)?.[0]
  );
  check(
    "…and the hint no longer promises a default that does not exist",
    !/Defaults to the accent color/.test(code),
    code.match(/.{0,60}Defaults to the accent.{0,30}/)?.[0]
  );
  check("the row can say 'not set'", code.includes("not set") && code.includes("unsetPlaceholder"));
}

console.log("\n== the PREVIEW borrowed the accent for the icons too ==");
/**
 * The field beside it was only half of that lie. `MosaicPreview` painted its glyphs
 * `look.sidebarIconColor || look.accentColor` — so with nothing set, the mock sidebar an
 * agency stares at while deciding showed accent-coloured icons the stylesheet never emits.
 * Fourth place with its own idea of what a theme looks like, and the one on screen.
 */
{
  const mp = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "MosaicPreview.tsx"), "utf8");
  const code = mp.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(
    "the preview no longer paints unset icons in the accent colour",
    !/sidebarIconColor \|\| look\.accentColor/.test(code),
    code.match(/.{0,40}sidebarIconColor \|\|.{0,40}/)?.[0]
  );

  // The GRADIENT, which is the pair that went wrong on the login tab: both sides must need
  // a gradient COLOUR, or the preview paints a gradient the bundle does not emit.
  check(
    "…and its gradient needs a colour, exactly as `sidebarBackground` does",
    /look\.gradientEnabled && look\.gradientColor/.test(code),
    code.match(/.{0,20}gradientEnabled.{0,50}/)?.[0]
  );
  const enabledNoColour: any = { primaryColor: "#0f766e", gradientEnabled: true, gradientColor: "" };
  const bg = renderRules(scope, enabledNoColour).find((r) => r.includes("background:")) ?? "";
  check("…and the server really does fall back to a flat colour there", !bg.includes("linear-gradient"), bg.slice(0, 90));

  // Button shape: two copies of one three-row table, four files apart.
  const shapes = ["square", "rounded", "pill"] as const;
  const expected: Record<string, string> = { square: "0", rounded: "10px", pill: "999px" };
  for (const shape of shapes) {
    const rule = renderRules(scope, { primaryColor: "#0f766e", buttonShape: shape } as any)
      .find((r) => /border-radius/.test(r) && !/RADIUS_SELECTOR/.test(r)) ?? "";
    check(
      `the server renders ${shape} buttons at ${expected[shape]}`,
      rule.includes(`border-radius: ${expected[shape]}`),
      rule.slice(0, 100)
    );
  }
  check(
    "…and the preview's own table names the same three radii",
    /"square"\s*\?\s*0/.test(code) && /"pill"\s*\?\s*999/.test(code) && /"rounded"\s*\?\s*10/.test(code),
    code.match(/buttonShape ===[\s\S]{0,180}/)?.[0]
  );
}

console.log("\n== …and the component reads the resolver, not its own placeholders ==");
/**
 * The `slaTone` precedent's known limit applies: this proves the CONDITION, not the pixels.
 * It is still worth having, because the whole defect was three `||` fallbacks sitting in a
 * component where they could only be checked by opening the editor and reading a stylesheet.
 */
{
  const src = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "LoginPreview.tsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const hex of ["#0f172a", "#ffffff", "#4f46e5"]) {
    check(`no ${hex} placeholder left in LoginPreview`, !code.includes(hex), code.match(new RegExp(".{0,60}" + hex + ".{0,20}"))?.[0]);
  }
  check("it resolves through themeDefaults", code.includes("resolveLoginBackground"));
}

console.log("\n== the content area: two resolvers, one answer ==");
/**
 * The third pair, and the one that had drifted furthest — it did not disagree with the
 * server, it had NO counterpart there at all. `contentBgColor` and `contentTextColor`
 * appeared nowhere outside `schema.prisma`; `darkMode` was accepted by the PUT, stored on
 * three models, carried through presets and threaded into `Look`, and read by not one line
 * of the stylesheet.
 *
 * Compared by VALUE over synthetic themes rather than by reading either implementation,
 * because "both files mention dark mode" is exactly the check that would have passed all
 * along.
 */
{
  const cases: Record<string, any> = {
    "nothing set": {},
    "dark mode off, explicitly": { darkMode: false },
    "a cleared colour is not a choice": { contentBgColor: "", contentTextColor: "" },
    "whitespace is not a choice": { contentBgColor: "   " },
    "dark mode alone": { darkMode: true },
    "a chosen background": { contentBgColor: "#0b1120" },
    "a chosen background beats dark mode": { darkMode: true, contentBgColor: "#332211" },
    "a chosen text colour beside dark mode": { darkMode: true, contentTextColor: "#abcdef" },
    "both chosen": { contentBgColor: "#332211", contentTextColor: "#abcdef" },
    "text alone": { contentTextColor: "#123456" },
    "a very dark background still derives no text": { contentBgColor: "#000000" },
    "a very light background still derives no text": { contentBgColor: "#ffffff" },
  };
  for (const [label, theme] of Object.entries(cases)) {
    const a = serverContentTheme(theme);
    const b = previewContentTheme(theme);
    check(
      `agree: ${label}`,
      JSON.stringify(a) === JSON.stringify(b),
      `server ${JSON.stringify(a)} vs preview ${JSON.stringify(b)}`
    );
  }

  // The property that makes shipping an unconfirmed selector defensible: a canvas colour
  // can never make readable text unreadable, because it never sets a text colour.
  check(
    "dark mode NEVER derives a text colour",
    serverContentTheme({ darkMode: true })?.text === null,
    JSON.stringify(serverContentTheme({ darkMode: true }))
  );
  check(
    "…and neither does a background, however dark",
    serverContentTheme({ contentBgColor: "#000000" })?.text === null
  );

  // And the stylesheet must genuinely emit nothing for a theme nobody has touched — the
  // whole file is render-blocking, so "off" has to cost zero bytes.
  const untouched = renderRules(
    { prefix: ".loc1", locationId: "loc1", bases: ["#sidebar-v2"] } as never,
    { primaryColor: "#0f766e" } as never
  ).filter((r) => /body, #app, main/.test(r));
  check("an untouched theme emits no content rule at all", untouched.length === 0, untouched.join("\n"));
}

console.log("\n== …and the preview reads the resolver, not its own canvas colour ==");
{
  const src = readFileSync(join(__dirname, "..", "apps", "admin-dashboard", "src", "MosaicPreview.tsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("it resolves through themeDefaults", code.includes("resolveContentTheme"));
  check(
    "the canvas literal survives ONLY as the stand-in for 'the stylesheet emits nothing'",
    (code.match(/#f8fafc/g) ?? []).length === 1 && /content\?\.bg \?\? "#f8fafc"/.test(code),
    code.match(/.{0,50}#f8fafc.{0,20}/)?.[0]
  );
  check(
    "the card stays white, so the preview shows the framing rather than flattering it",
    /const cardBg = "#ffffff"/.test(code)
  );
}

console.log(`\n${"-".repeat(66)}\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);