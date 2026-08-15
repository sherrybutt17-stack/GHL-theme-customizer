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

export /** A complete theme payload: everything the sub-account already has, plus what we found. */
function mergedTheme(existing: ThemeConfig | null, patch: Partial<ThemeInput>): ThemeInput {
  return {
    logoUrl: existing?.logoUrl ?? "",
    faviconUrl: existing?.faviconUrl ?? null,
    primaryColor: existing?.primaryColor ?? "#4f46e5",
    secondaryColor: existing?.secondaryColor ?? existing?.primaryColor ?? "#4f46e5",
    accentColor: existing?.accentColor ?? "#f59e0b",
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
