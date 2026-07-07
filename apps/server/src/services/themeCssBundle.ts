import { prisma } from "./prisma";
import { featureSelector } from "./ghlSidebarFeatures";

/**
 * GHL sidebar logo, confirmed via live DOM inspection:
 *   <div class="... agency-logo-container">
 *     <img class="object-contain agency-logo" alt="agency logo" ...>
 *   </div>
 * Swap by hiding the original <img> (opacity:0) and painting the new logo as a
 * background-image on its container.
 */
const LOGO_CONTAINER_SELECTOR = ".agency-logo-container";
const LOGO_IMG_SELECTOR = "img.agency-logo";

/**
 * Top-bar (white header) selector, confirmed via DOM inspection:
 * <header class="hl_header hl_header--collapse">. It sits inside the
 * location-classed wrapper, so location scoping applies the same as the sidebar.
 */
const TOP_BAR_SELECTOR = ".hl_header";

/** Visual fields shared by ThemeConfig, AgencyDefaultTheme, and ThemePreset. */
interface VisualTheme {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  fontFamily?: string | null;
  gradientEnabled?: boolean | null;
  gradientColor?: string | null;
  gradientAngle?: number | null;
  topBarColor?: string | null;
  menuLabelOverrides?: unknown;
  hiddenFeatures?: unknown;
}

/**
 * A scope determines whether rules apply globally (agency default) or only to
 * one sub-account (location override, which wins by specificity).
 *  - bases:   selectors for the sidebar element itself (for background).
 *  - prefix:  ancestor selector prepended to descendant rules ("" for global).
 *  - descendant(sel): helper that scopes a descendant selector list correctly.
 */
interface Scope {
  bases: string[];
  prefix: string;
}

function globalScope(): Scope {
  return { bases: ["#sidebar-v2", ".hl_sidebar"], prefix: "" };
}

function locationScope(locationId: string): Scope {
  return {
    bases: [
      `#sidebar-v2:has(a[href*="/location/${locationId}/"])`,
      `.hl_sidebar:has(a[href*="/location/${locationId}/"])`,
    ],
    // The sidebar wrapper div carries the raw location id as a CSS class.
    prefix: `[class~="${locationId}"]`,
  };
}

/** Scope a comma-separated descendant selector list under the scope's prefix. */
function scoped(scope: Scope, selectorList: string): string {
  return selectorList
    .split(",")
    .map((s) => s.trim())
    .map((s) => (scope.prefix ? `${scope.prefix} ${s}` : s))
    .join(", ");
}

function sidebarBackground(primary: string, theme: VisualTheme): string {
  if (theme.gradientEnabled && theme.gradientColor) {
    const angle = theme.gradientAngle ?? 135;
    return `linear-gradient(${angle}deg, ${primary}, ${theme.gradientColor})`;
  }
  return primary;
}

/** Render the CSS rules for one theme under one scope. */
function renderRules(scope: Scope, theme: VisualTheme): string[] {
  const rules: string[] = [];
  const primary = theme.primaryColor || "#4f46e5";
  const accent = theme.accentColor || primary;

  // Sidebar background (solid or gradient)
  rules.push(`${scope.bases.join(", ")} { background: ${sidebarBackground(primary, theme)} !important; }`);

  // Active item + icons
  rules.push(
    `${scope.bases.map((b) => `${b} a.active`).join(", ")}, ${scope.bases
      .map((b) => `${b} .active`)
      .join(", ")} { background: ${accent} !important; color: #fff !important; }`
  );
  rules.push(`${scope.bases.map((b) => `${b} a i`).join(", ")} { color: ${accent} !important; }`);

  // Font family (applies to the whole scoped subtree; for global, to sidebar + body)
  if (theme.fontFamily) {
    const stack = `'${theme.fontFamily}', sans-serif`;
    if (scope.prefix) {
      rules.push(`${scope.prefix} { font-family: ${stack} !important; }`);
    } else {
      rules.push(`body, #sidebar-v2, #sidebar-v2 * { font-family: ${stack} !important; }`);
    }
  }

  // Top bar color
  if (theme.topBarColor) {
    rules.push(`${scoped(scope, TOP_BAR_SELECTOR)} { background: ${theme.topBarColor} !important; }`);
  }

  // Logo swap
  if (theme.logoUrl) {
    rules.push(
      `${scoped(scope, LOGO_CONTAINER_SELECTOR)} { background-image: url("${theme.logoUrl}") !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; min-height: 40px !important; }`
    );
    rules.push(`${scoped(scope, LOGO_IMG_SELECTOR)} { opacity: 0 !important; }`);
  }

  // Feature hiding
  const hidden = Array.isArray(theme.hiddenFeatures) ? (theme.hiddenFeatures as string[]) : [];
  for (const key of hidden) {
    rules.push(`${scoped(scope, featureSelector(key))} { display: none !important; }`);
  }

  // Menu label renaming
  const labels =
    theme.menuLabelOverrides && typeof theme.menuLabelOverrides === "object"
      ? (theme.menuLabelOverrides as Record<string, string>)
      : {};
  for (const [key, label] of Object.entries(labels)) {
    if (!label) continue;
    const safe = label.replace(/"/g, '\\"');
    const parts = featureSelector(key)
      .split(",")
      .map((s) => scoped(scope, `${s.trim()} .nav-title`));
    rules.push(`${parts.join(", ")} { font-size: 0 !important; }`);
    rules.push(
      `${parts.map((p) => `${p}::after`).join(", ")} { content: "${safe}" !important; font-size: 14px !important; }`
    );
  }

  return rules;
}

/** Collect distinct Google Font families for the @import block at the top. */
function fontImports(themes: VisualTheme[]): string {
  const families = new Set<string>();
  for (const t of themes) {
    if (t.fontFamily) families.add(t.fontFamily);
  }
  return [...families]
    .map(
      (f) =>
        `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          f
        ).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap');`
    )
    .join("\n");
}

/**
 * CSS-only theming served for one agency. Layers:
 *  1. Google Font @imports (must come first in the stylesheet).
 *  2. Agency default look (global, unscoped selectors).
 *  3. Per-sub-account overrides (location-scoped selectors; win by specificity).
 * See routes/themeCss.ts for why this is CSS rather than JS.
 */
export async function generateThemeCssBundle(agencyInstallId: string): Promise<string> {
  const [defaultTheme, locations] = await Promise.all([
    prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId } }),
    prisma.locationInstall.findMany({
      where: { agencyInstallId, status: "active", enabled: true },
      include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
    }),
  ]);

  const locationThemes = locations
    .map((loc) => ({ loc, theme: loc.themeConfigs[0] }))
    .filter((x) => x.theme);

  const allThemes: VisualTheme[] = [
    ...(defaultTheme ? [defaultTheme as VisualTheme] : []),
    ...locationThemes.map((x) => x.theme as VisualTheme),
  ];

  if (allThemes.length === 0) {
    return "/* No themes configured yet - set an agency default or a sub-account theme in the Mosaic dashboard. */";
  }

  const blocks: string[] = [];

  const imports = fontImports(allThemes);
  if (imports) blocks.push(imports);

  if (defaultTheme) {
    blocks.push("/* Agency default (applies to all sub-accounts unless overridden) */\n" + renderRules(globalScope(), defaultTheme as VisualTheme).join("\n"));
  }

  for (const { loc, theme } of locationThemes) {
    blocks.push(
      `/* ${loc.locationName ?? loc.ghlLocationId} */\n` +
        renderRules(locationScope(loc.ghlLocationId), theme as VisualTheme).join("\n")
    );
  }

  return blocks.join("\n\n");
}
