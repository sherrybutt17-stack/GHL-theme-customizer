/**
 * Cross-reference every theme column against the layers CLAUDE.md says it must pass
 * through. A column the API won't accept is a feature nobody can use, and it looks
 * finished from every angle except a live test — exactly how brandName and faviconUrl
 * stayed broken.
 */
const fs = require("fs");
const ROOT = "/Users/shaheerbutt/GHL theme builder";
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, "utf8");

const schema = read("apps/server/prisma/schema.prisma");
const admin = read("apps/server/src/routes/admin.ts");
const bundle = read("apps/server/src/services/themeCssBundle.ts");
/**
 * The OTHER delivery path. Theming is CSS, but two fields cannot be — a favicon and the
 * browser-tab title — so they ride the optional JS bundle instead. Checking only the
 * stylesheet reported both as dead on every run, which is a standing false positive on
 * the two columns this audit was WRITTEN for, and one line that is always wrong teaches
 * the reader to skim the ones that aren't.
 *
 * "Reaches the browser" is what the leg always meant; the stylesheet was just the only
 * way it happened at the time.
 */
const jsBundle = read("apps/server/src/services/themeBundleScript.ts");
/**
 * A column can reach the stylesheet through a RESOLVER rather than by name. The content
 * area is decided in `contentTheme.ts` — extracted so the dashboard's live preview has one
 * definition to mirror rather than a fourth opinion — and `themeCssBundle` then reads only
 * `content.bg` / `content.text`. So the three columns it resolves appear nowhere in the
 * stylesheet's own source and were reported dead the moment they stopped being dead.
 *
 * Widened by measurement rather than by hope, the discipline this audit's twin already
 * records: of all 65 columns across the two models, this file mentions exactly
 * `contentBgColor`, `contentTextColor` and `darkMode`. Nothing else can hide behind it.
 */
const contentTheme = read("apps/server/src/services/contentTheme.ts");
const editor = read("apps/admin-dashboard/src/ThemeEditor.tsx");
const lookFields = read("apps/admin-dashboard/src/LookFields.tsx");

const model = (name) => {
  const m = schema.match(new RegExp(`model ${name} \\{([^]*?)\\n\\}`));
  return m[1].split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("///") && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0])
    .filter((f) => !["id", "agencyInstallId", "agencyInstall", "locationInstallId", "locationInstall",
                     "version", "createdAt", "updatedAt", "themeConfigs", "name"].includes(f));
};

const visual = admin.match(/function visualFields[^]*?\n\}/)[0];
const login = admin.match(/function loginFields[^]*?\n\}/)[0];
const agencyDefault = admin.match(/function agencyDefaultFields[^]*?\n\}/)?.[0] ?? "";

/**
 * Columns whose API payload key is NOT the column name.
 *
 * Without this the audit reports `customCssOverride` as dead on every run — the route
 * does accept it, under the key `customCss`. That matters more than it sounds: this
 * report's whole value is that a line in it means a real dead feature, and one standing
 * false positive teaches the reader to skim past the two that aren't.
 */
const API_ALIAS = { customCssOverride: "customCss" };

const rows = [];
for (const [modelName, fields] of [["ThemeConfig", model("ThemeConfig")], ["AgencyDefaultTheme", model("AgencyDefaultTheme")]]) {
  for (const f of fields) {
    const key = API_ALIAS[f] ?? f;
    const inApi = visual.includes(`${key}:`) || login.includes(`${key}:`) || agencyDefault.includes(`${key}:`)
      || new RegExp(`${key}\\s*[:,]`).test(admin.match(/createThemeVersion[^]*?\n\}/)?.[0] ?? "")
      // An aliased column is written by the route body rather than a *Fields() helper.
      || (API_ALIAS[f] !== undefined && new RegExp(`${f}:[^\\n]*req\\.body`).test(admin));
    // `?.` counts. A resolver that reads `t?.contentBgColor` reads the column exactly as
    // much as one that reads `theme.contentBgColor`, and missing that reported three live
    // columns as dead — which is a standing false positive on the audit's own newest work.
    const reaches = new RegExp(`(?:theme|t)\\??\\.${f}\\b`);
    // Read by the stylesheet, or by the pasted script. Being RETURNED by the config
    // endpoint is not enough: `secondaryColor` has been shipped to the browser since the
    // beginning and read by nothing at either end.
    const inCss = reaches.test(bundle) || reaches.test(jsBundle) || reaches.test(contentTheme);
    const inUi = new RegExp(`\\b${f}\\b`).test(editor) || new RegExp(`\\b${f}\\b`).test(lookFields);
    rows.push({ model: modelName, field: f, inApi, inCss, inUi });
  }
}

/**
 * NEVER-RENDERED IS A FINDING ON ITS OWN — the same asymmetry `audit-support-fields.js`
 * had to be taught, arriving here from the other side.
 *
 * The old rule reported a column only when the API leg failed, or when the CSS and UI legs
 * failed TOGETHER. That is one failed leg too many for this model, because the whole point
 * of the stylesheet is that it IS the product: a column the API accepts, a screen appears
 * to offer, and `themeCssBundle` never reads produces exactly nothing in a client's
 * browser, forever, and looks finished from both ends.
 *
 * It hid `darkMode` for the entire life of the column — accepted by the PUT, stored on all
 * three models, carried through presets, threaded into `Look` and the save payload, and
 * read by not one line of the bundle. `inUi` was true only because the word appears in the
 * editor as a TYPE and a state default, never as a control, which is precisely the trap
 * this file records for the support twin: a declaration must not satisfy a UI leg.
 *
 * The UI leg is deliberately left as the loose check it always was. Detecting a real
 * control across `onChange({field: …})`, a named toggle handler and a drag reorder needs
 * three heuristics, and the two extra ones misfire — a standing false positive destroys
 * the report, which is the reason this file already carries `API_ALIAS`.
 */
const bad = rows.filter((r) => !r.inApi || !r.inCss);
console.log(`\nchecked ${rows.length} columns across 2 models\n`);
if (!bad.length) console.log("  every column is writable and used.");
for (const r of bad) {
  const missing = [!r.inApi && "API won't accept it", !r.inCss && "nothing renders it — not the stylesheet, not the JS bundle", !r.inUi && "no UI"]
    .filter(Boolean).join(" · ");
  console.log(`  ${r.model}.${r.field}`.padEnd(46), missing);
}
