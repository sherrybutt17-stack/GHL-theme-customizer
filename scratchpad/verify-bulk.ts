/**
 * Bulk branding, checked where it can actually hurt.
 *
 *   1. applying a brand to the WRONG sub-account — invisible to the agency, obvious to
 *      the client; and
 *   2. a partial save quietly clearing settings the sub-account already had, on every
 *      row at once.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRows, mergedTheme, bulkBrandDirty } from "/Users/shaheerbutt/GHL theme builder/apps/admin-dashboard/src/bulkBrandLogic";
import { resolveAccentColor } from "/Users/shaheerbutt/GHL theme builder/apps/admin-dashboard/src/themeDefaults";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  if (ok) { console.log(`  ok    ${n}`); pass++; }
  else { console.log(`  FAIL  ${n}`); if (d !== undefined) console.log(`        ${String(d).slice(0, 220)}`); fail++; }
};

const locs: any[] = [
  { id: "l1", ghlLocationId: "AbC123", locationName: "190 Ranch", theme: null },
  { id: "l2", ghlLocationId: "XyZ789", locationName: "Acme Dental", theme: null },
  { id: "l3", ghlLocationId: "Dup111", locationName: "Same Name", theme: null },
  { id: "l4", ghlLocationId: "Dup222", locationName: "Same Name", theme: null },
];

console.log("\n== matching a row to a sub-account ==");
const r = parseRows(
  [
    "190 Ranch, 190ranch.com",
    "  acme dental , https://acmedental.com",
    "XyZ789, other.com",
    "Same Name, ambiguous.com",
    "Nobody Ltd, ghost.com",
    "190 Ranch",
  ].join("\n"),
  locs
);
check("matches an exact name", r[0].location?.id === "l1", JSON.stringify(r[0]));
check("matches case-insensitively, ignoring padding", r[1].location?.id === "l2", JSON.stringify(r[1]));
check("matches a GHL location id", r[2].location?.ghlLocationId === "XyZ789", JSON.stringify(r[2]));
check("REFUSES a duplicated name rather than guessing", r[3].status === "skipped" && !r[3].location, JSON.stringify(r[3]));
check("  -> and says how to disambiguate", /location id/i.test(r[3].note ?? ""), r[3].note);
check("skips an unknown sub-account", r[4].status === "skipped" && !r[4].location, JSON.stringify(r[4]));
check("skips a row with no website", r[5].status === "skipped", JSON.stringify(r[5]));
check("adds https:// when omitted", r[0].url === "https://190ranch.com", r[0].url);
check("leaves an explicit scheme alone", r[1].url === "https://acmedental.com", r[1].url);

console.log("\n== a bulk save must not erase what's already set ==");
const existing: any = {
  logoUrl: "data:image/webp;base64,AAAA",
  primaryColor: "#111111", accentColor: "#222222",
  fontFamily: "Lato", cornerRadius: 14, topBarColor: "#333333",
  alertMessage: "Scheduled maintenance Friday", alertColor: "#f59e0b",
  sidebarTextColor: "#ffffff", darkMode: true, hideUpgrade: true,
  menuLabelOverrides: { opportunities: "Leads" },
  hiddenFeatures: ["memberships"],
  menuOrder: ["dashboard", "conversations"],
  customCssOverride: ".x{color:red}",
};
const out = mergedTheme(existing, { primaryColor: "#0a7d55", secondaryColor: "#0a7d55", accentColor: "#abcdef" });

check("applies the scanned colours", out.primaryColor === "#0a7d55" && out.accentColor === "#abcdef");
check("keeps the chosen font", out.fontFamily === "Lato", out.fontFamily);
check("keeps corner radius", out.cornerRadius === 14, out.cornerRadius);
check("keeps the top bar colour", out.topBarColor === "#333333", out.topBarColor);
check("keeps the alert banner", out.alertMessage === "Scheduled maintenance Friday" && out.alertColor === "#f59e0b");
check("keeps renamed menu items", out.menuLabelOverrides?.opportunities === "Leads", JSON.stringify(out.menuLabelOverrides));
check("keeps hidden features", out.hiddenFeatures?.[0] === "memberships", JSON.stringify(out.hiddenFeatures));
check("keeps the menu order", out.menuOrder?.length === 2, JSON.stringify(out.menuOrder));
check("keeps custom CSS", out.customCss === ".x{color:red}", out.customCss);
check("keeps dark mode and hide-upgrade", out.darkMode === true && out.hideUpgrade === true);
check("does NOT clear a hand-uploaded logo when none was found", out.logoUrl === existing.logoUrl);

console.log("\n== a brand-new sub-account still gets a complete payload ==");
const fresh = mergedTheme(null, { primaryColor: "#0a7d55" });
const missing = Object.entries(fresh).filter(([, v]) => v === undefined).map(([k]) => k);
check("no field is left undefined", missing.length === 0, missing.join(", "));

/**
 * …and COMPLETE is not the same as TRUE, which is how this section passed over a live bug
 * for the whole life of the feature. Every field was defined; `accentColor` was defined as
 * `#f59e0b`, a colour nobody had chosen — the same amber `lookFrom` was fixed for on
 * 2026-08-23, in a third place, in the one tool that writes forty-one sub-accounts at once.
 *
 * `resolveAccentColor` is the established single definition (`verify-preview-truth` asserts
 * it against the real `renderRules`), so reading it here is checking against the stylesheet
 * rather than inventing a fourth opinion.
 */
console.log("\n== …and no colour nobody chose is written into it ==");
{
  // brandScan's own doc: a result "may have only themeColor, only an image, or ...". A site
  // with a <meta name="theme-color"> and no usable logo yields primary and NO accent, and
  // `paletteFromImage` returning null does the same.
  const colourOnly = { primaryColor: "#0f766e", secondaryColor: "#0f766e" };
  const withPalette = { ...colourOnly, accentColor: "#14b8a6" };
  const paint = (t: any) => resolveAccentColor({ accentColor: t.accentColor ?? "", primaryColor: t.primaryColor ?? "" } as any);

  for (const [label, start] of [
    ["a sub-account with no theme at all", null],
    // The ordinary outcome of a PREVIOUS bulk brand, which is what makes this compound.
    ["one already branded teal, accent never set", { primaryColor: "#0f766e", accentColor: null } as any],
  ] as const) {
    const t = mergedTheme(start as any, colourOnly as any);
    check(
      `${label}: a scan with no logo palette leaves the accent unset`,
      !t.accentColor,
      `stored accentColor=${JSON.stringify(t.accentColor)}`
    );
    check(
      `${label}: so the active menu item is painted the client's own colour`,
      paint(t) === "#0f766e",
      `painted ${paint(t)} — nobody picked that`
    );
  }

  // The control every guard here carries: a fix that stops applying the scan is not a fix.
  const applied = mergedTheme(null, withPalette as any);
  check("a scan that DID find a palette still applies it", applied.accentColor === "#14b8a6", applied.accentColor);
  check("…and the stylesheet paints that", paint(applied) === "#14b8a6", paint(applied));

  // The same shape one field over: an unset primary must not become indigo either.
  const nothing = mergedTheme(null, {} as any);
  check("an empty scan writes no primary colour of its own", !nothing.primaryColor, JSON.stringify(nothing.primaryColor));
  check("…nor a secondary", !nothing.secondaryColor, JSON.stringify(nothing.secondaryColor));

  // And the source, because the whole defect was a hex literal sitting where only a save
  // and a read of the generated stylesheet could catch it.
  const src = readFileSync(
    join(__dirname, "..", "apps", "admin-dashboard", "src", "bulkBrandLogic.ts"), "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const hex of ["#f59e0b", "#4f46e5"]) {
    check(`no ${hex} placeholder left in bulkBrandLogic`, !src.includes(hex), src.match(new RegExp(".{0,70}" + hex))?.[0]);
  }
}

console.log("\n== what closing the modal would throw away ==");
/**
 * Measured on the real screen before this guard existed: a five-line pasted list vanished
 * on Escape, and so did five completed scans — reopening gave an empty box both times, and
 * a backdrop click did the same. The Escape handler's own comment said "Never lose a long
 * pasted list to a stray Escape" and guarded only on `busy`, which is false for the whole
 * time anybody is reading the results.
 *
 * The distinction the prompt depends on is which loss it is: a warning that describes the
 * wrong thing is one people learn to click through.
 */
const row = (status: string, extra: any = {}) => ({ input: "x", url: "u", status, ...extra }) as any;
check("nothing typed and nothing scanned is not dirty", bulkBrandDirty(null, "") === null);
check("whitespace alone is not dirty", bulkBrandDirty(null, "   \n  ") === null);
check("a pasted list nothing has come of is a LIST loss", bulkBrandDirty(null, "190 Ranch, x.com") === "list");
check(
  "sites read and not applied are a SCAN loss — the expensive half",
  bulkBrandDirty([row("ready"), row("skipped")], "190 Ranch, x.com") === "scans"
);
check(
  "  ↳ and scans outrank the list, so the prompt names the costlier one",
  bulkBrandDirty([row("ready")], "190 Ranch, x.com") === "scans"
);
check(
  "a run where everything saved is CLEAN — those rows are in the database",
  bulkBrandDirty([row("saved"), row("saved")], "190 Ranch, x.com") === null
);
check(
  "  ↳ but a partly applied run is not: the unapplied scans are still only on screen",
  bulkBrandDirty([row("saved"), row("ready")], "190 Ranch, x.com") === "scans"
);
check(
  "a scan that matched nobody still protects the typed list",
  bulkBrandDirty([row("skipped"), row("skipped")], "Nobody, x.com") === "list"
);
check(
  "  ↳ as does one where every site refused us",
  bulkBrandDirty([row("failed"), row("failed")], "190 Ranch, x.com") === "list"
);

console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
