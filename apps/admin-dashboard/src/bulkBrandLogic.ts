import type { LocationRow, ThemeConfig, ThemeInput } from "./api";

/**
 * The two pure decisions behind bulk branding, kept out of the component so they can be
 * checked directly. Both are places where a mistake is silent and wide:
 * matching a row to the wrong sub-account, and a save that clears settings it didn't set.
 */

export type RowState = {
  /** The raw left-hand cell, kept verbatim so an unmatched row is recognisable. */
  input: string;
  url: string;
  location?: LocationRow;
  status: "pending" | "scanning" | "ready" | "skipped" | "saving" | "saved" | "failed";
  primary?: string;
  accent?: string;
  logoUrl?: string;
  /** Size AFTER downscaling — shown because it lands in a render-blocking stylesheet. */
  logoBytes?: number;
  logoFormat?: "webp" | "png";
  note?: string;
};

export /** Split "Client Name, https://site.com" — also accepts tab or comma separation. */
function parseRows(text: string, locations: LocationRow[]): RowState[] {
  const byId = new Map(locations.map((l) => [l.ghlLocationId.toLowerCase(), l]));
  // Names are NOT unique in GHL, so count them: a duplicate name can't be matched safely.
  const nameCounts = new Map<string, number>();
  for (const l of locations) {
    const n = (l.locationName ?? "").trim().toLowerCase();
    if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  const byName = new Map(
    locations
      .filter((l) => (nameCounts.get((l.locationName ?? "").trim().toLowerCase()) ?? 0) === 1)
      .map((l) => [(l.locationName ?? "").trim().toLowerCase(), l])
  );

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,(?![^(]*\))/).map((s) => s.trim());
      const input = parts[0] ?? "";
      const rawUrl = parts.slice(1).join(",").trim();
      const key = input.toLowerCase();
      const location = byId.get(key) ?? byName.get(key);

      if (!rawUrl) return { input, url: "", status: "skipped" as const, note: "No website on this line." };
      if (!location) {
        const dupe = (nameCounts.get(key) ?? 0) > 1;
        return {
          input,
          url: rawUrl,
          status: "skipped" as const,
          note: dupe
            ? "More than one sub-account has this name — use its location id instead."
            : "No sub-account matches this name or id.",
        };
      }
      return {
        input,
        url: /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
        location,
        status: "pending" as const,
      };
    });
}

/**
 * A complete theme payload: everything the sub-account already has, plus what we found.
 *
 * COMPLETE because it has to be — `visualFields` on the server unconditionally resets any
 * column the payload omits, so a partial PUT would clear the font, corner radius, top bar
 * and alert banner on every sub-account this touches.
 *
 * "Everything they already have" must therefore include **not having chosen a colour**.
 * These fields used to fall back to hex literals, and `accentColor` fell back to the same
 * `#f59e0b` that `lookFrom` was fixed for on 2026-08-23 — a THIRD hardcoded idea of what a
 * theme looks like, in the one tool that writes forty-one sub-accounts at a time. A scan
 * that finds a brand colour and no usable logo palette sets `primary` and leaves `accent`
 * undefined (brandScan's own doc: a result "may have only themeColor, only an image"), so
 * the amber went in unasked, and `renderRules` paints the active menu item from it.
 *
 * An unset colour is `""` — the same thing the editor stores for a cleared field, and what
 * `renderRules` reads as "fall through to the primary". Do not put a hex literal here.
 */
export function mergedTheme(existing: ThemeConfig | null, patch: Partial<ThemeInput>): ThemeInput {
  return {
    logoUrl: existing?.logoUrl ?? "",
    faviconUrl: existing?.faviconUrl ?? null,
    primaryColor: existing?.primaryColor ?? "",
    secondaryColor: existing?.secondaryColor ?? existing?.primaryColor ?? "",
    accentColor: existing?.accentColor ?? "",
    fontFamily: existing?.fontFamily ?? "",
    gradientEnabled: existing?.gradientEnabled ?? false,
    gradientColor: existing?.gradientColor ?? "#1e293b",
    gradientAngle: existing?.gradientAngle ?? 135,
    topBarColor: existing?.topBarColor ?? "",
    buttonColor: existing?.buttonColor ?? "",
    cornerRadius: existing?.cornerRadius ?? null,
    sidebarImageUrl: existing?.sidebarImageUrl ?? "",
    scrollbarColor: existing?.scrollbarColor ?? "",
    sidebarTextColor: existing?.sidebarTextColor ?? "",
    sidebarIconColor: existing?.sidebarIconColor ?? "",
    buttonShape: existing?.buttonShape ?? "",
    darkMode: existing?.darkMode ?? false,
    contentBgColor: existing?.contentBgColor ?? "",
    contentTextColor: existing?.contentTextColor ?? "",
    hideUpgrade: existing?.hideUpgrade ?? false,
    alertMessage: existing?.alertMessage ?? "",
    alertColor: existing?.alertColor ?? "",
    customCss: existing?.customCssOverride ?? "",
    menuLabelOverrides: existing?.menuLabelOverrides ?? {},
    hiddenFeatures: existing?.hiddenFeatures ?? [],
    menuOrder: (existing?.menuOrder as string[] | null) ?? [],
    ...patch,
  };
}

/**
 * Would closing this modal throw work away?
 *
 * Extracted for the same reason as `summariseBulk` and `slaTone`: it is a judgement a
 * person acts on, and inline in a component it can only be checked by clicking — which is
 * exactly how it went unnoticed that the modal had no guard at all. The Escape handler
 * even carried the comment "Never lose a long pasted list to a stray Escape" while
 * guarding only on `busy`, so a stray Escape lost the list, and a completed scan with it.
 *
 * Two distinct losses, and the prompt has to name the right one or people learn to click
 * through it:
 *  - `ready` rows are sites already READ and not yet applied. This is the expensive half:
 *    the scan is deliberately sequential (41 simultaneous fetches at other people's
 *    websites is how an IP gets blocked), so redoing it is another pass over every site.
 *  - a pasted list nothing has come of yet is just typing, but it is still typing nobody
 *    wants to redo for 41 clients.
 *
 * A run that has SAVED something is not dirty on account of the list: those rows are in
 * the database and closing costs nothing. Unapplied scans still count, because they are
 * not.
 */
export function bulkBrandDirty(rows: RowState[] | null, text: string): "scans" | "list" | null {
  const ready = (rows ?? []).filter((r) => r.status === "ready").length;
  if (ready > 0) return "scans";
  const anySaved = (rows ?? []).some((r) => r.status === "saved");
  return text.trim() !== "" && !anySaved ? "list" : null;
}
