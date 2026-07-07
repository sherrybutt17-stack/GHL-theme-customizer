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
  buttonColor?: string | null;
  cornerRadius?: number | null;
  sidebarImageUrl?: string | null;
  scrollbarColor?: string | null;
  darkMode?: boolean | null;
  hideUpgrade?: boolean | null;
  animateLoadIn?: boolean | null;
  animateScroll?: boolean | null;
  topNav?: boolean | null;
  menuLabelOverrides?: unknown;
  hiddenFeatures?: unknown;
  // Raw power-user CSS. ThemeConfig stores it as customCssOverride, the agency
  // default as customCss - renderRules reads whichever is present.
  customCss?: string | null;
  customCssOverride?: string | null;
}

/**
 * Primary-button / card / upgrade-prompt selectors are best-effort guesses at
 * GHL's current markup (unlike the sidebar/top-bar/logo selectors, which were
 * confirmed by live DOM inspection). If any prove off, the per-client Custom CSS
 * escape hatch lets the agency drop in the exact selector without a code change.
 */
const PRIMARY_BUTTON_SELECTOR =
  ".hl-btn.primary, .hl-btn--primary, .btn-primary, button[class*='--primary'], .n-button--primary-type";
const RADIUS_SELECTOR = ".hl-btn, button, .card, .hl-card, input, select, textarea, .modal";
const DARK_SURFACE_SELECTOR = ".hl_wrapper, .hl_wrapper--inner, .hl-main, main";
const DARK_CARD_SELECTOR = ".card, .hl-card";
const UPGRADE_SELECTOR =
  "[class*='upgrade'], [href*='upgrade'], [href*='billing'], .upgrade-banner, [data-testid*='upgrade']";
/** Content surfaces that fade in on load; cards that reveal on scroll. */
const LOAD_IN_SELECTOR = ".hl_wrapper, .hl_wrapper--inner, .hl-main, main";
const SCROLL_REVEAL_SELECTOR = ".card, .hl-card";
/** Emitted once at the top of the bundle when any theme uses an animation. */
const ANIMATION_KEYFRAMES =
  "@keyframes mosaic-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }";

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
  // `:has(...)` fragment that lets us select the layout WRAPPER (an ancestor of
  // the sidebar) for just this location - needed for top-nav layout reflow.
  // Empty for the global/agency-default scope (applies to all).
  wrap: string;
}

function globalScope(): Scope {
  return { bases: ["#sidebar-v2", ".hl_sidebar"], prefix: "", wrap: "" };
}

function locationScope(locationId: string): Scope {
  const has = `:has(a[href*="/location/${locationId}/"])`;
  return {
    bases: [`#sidebar-v2${has}`, `.hl_sidebar${has}`],
    // The sidebar wrapper div carries the raw location id as a CSS class.
    prefix: `[class~="${locationId}"]`,
    wrap: has,
  };
}

/**
 * Selectors for the flex container that holds the sidebar + content side by
 * side. Best-effort (needs live DOM confirmation) - top-nav flips these to
 * stack vertically so the sidebar sits on top.
 */
const LAYOUT_WRAPPER_SELECTORS = ["#app", ".hl_wrapper", ".hl_wrapper--inner"];

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

/**
 * Prefix each top-level selector in a block of raw CSS so a location's custom
 * rules only apply within that sub-account's wrapper. Deliberately simple: it
 * handles flat rules (the common case for the escape hatch) and passes at-rules
 * (@media/@keyframes) through untouched. Agency-default custom CSS uses an empty
 * prefix and is emitted verbatim, so nested/at-rules work fully there.
 */
function scopeCustomCss(css: string, prefix: string): string {
  if (!prefix.trim()) return css.trim();
  const flatRule = /([^{}]+)\{([^{}]*)\}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = flatRule.exec(css)) !== null) {
    matched = true;
    const sel = m[1].trim();
    const body = m[2].trim();
    if (!sel || sel.startsWith("@")) {
      out.push(`${sel} { ${body} }`);
      continue;
    }
    const scopedSel = sel
      .split(",")
      .map((s) => `${prefix} ${s.trim()}`)
      .join(", ");
    out.push(`${scopedSel} { ${body} }`);
  }
  // Fallback for input that isn't a full rule (bare declarations): wrap it.
  return matched ? out.join("\n") : `${prefix} { ${css.trim()} }`;
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

  // Sidebar background image (painted over the color/gradient)
  if (theme.sidebarImageUrl) {
    rules.push(
      `${scope.bases.join(", ")} { background-image: url("${theme.sidebarImageUrl}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`
    );
  }

  // Primary buttons
  if (theme.buttonColor) {
    rules.push(
      `${scoped(scope, PRIMARY_BUTTON_SELECTOR)} { background-color: ${theme.buttonColor} !important; border-color: ${theme.buttonColor} !important; }`
    );
  }

  // Corner radius (buttons, cards, inputs)
  if (typeof theme.cornerRadius === "number") {
    rules.push(`${scoped(scope, RADIUS_SELECTOR)} { border-radius: ${theme.cornerRadius}px !important; }`);
  }

  // Scrollbar color. WebKit scrollbar pseudo-elements can't hang off a :has()
  // base, so we scope by the location wrapper prefix (or body for the default).
  if (theme.scrollbarColor) {
    const sbBase = scope.prefix || "body";
    rules.push(`${sbBase} ::-webkit-scrollbar { width: 10px !important; height: 10px !important; }`);
    rules.push(
      `${sbBase} ::-webkit-scrollbar-thumb { background: ${theme.scrollbarColor} !important; border-radius: 8px !important; }`
    );
  }

  // Dark mode (content area + cards)
  if (theme.darkMode) {
    rules.push(`${scoped(scope, DARK_SURFACE_SELECTOR)} { background: #0f172a !important; color: #e2e8f0 !important; }`);
    rules.push(`${scoped(scope, DARK_CARD_SELECTOR)} { background: #1e293b !important; color: #e2e8f0 !important; }`);
  }

  // Hide upgrade / billing prompts (white-label clean-up)
  if (theme.hideUpgrade) {
    rules.push(`${scoped(scope, UPGRADE_SELECTOR)} { display: none !important; }`);
  }

  // Load-in: fade the main content up on each page load
  if (theme.animateLoadIn) {
    rules.push(`${scoped(scope, LOAD_IN_SELECTOR)} { animation: mosaic-fade-in 0.5s ease both !important; }`);
  }

  // Scroll-reveal: cards fade in as they enter the viewport (CSS scroll-driven
  // animation - progressive enhancement; ignored by browsers without support).
  if (theme.animateScroll) {
    rules.push(
      `${scoped(scope, SCROLL_REVEAL_SELECTOR)} { animation: mosaic-fade-in linear both !important; animation-timeline: view() !important; animation-range: entry 0% cover 25% !important; }`
    );
  }

  // Top navigation: reflow the layout so the sidebar sits across the top as a
  // horizontal bar instead of down the left side.
  if (theme.topNav) {
    // 1. Flip the wrapper (that holds sidebar + content) from a row to a column.
    const wrappers = LAYOUT_WRAPPER_SELECTORS.map((w) => `${w}${scope.wrap}`).join(", ");
    rules.push(`${wrappers} { flex-direction: column !important; }`);
    // 2. Turn the sidebar into a full-width, short, horizontally-scrolling bar.
    rules.push(
      `${scope.bases.join(", ")} { width: 100% !important; max-width: 100% !important; min-width: 0 !important; height: auto !important; min-height: 0 !important; flex-direction: row !important; align-items: center !important; overflow-x: auto !important; overflow-y: hidden !important; }`
    );
    // 3. Lay the nav list + items out horizontally.
    const navSel = scope.bases
      .flatMap((b) => [`${b} nav`, `${b} .nav`, `${b} ul`])
      .join(", ");
    rules.push(`${navSel} { flex-direction: row !important; width: auto !important; height: auto !important; }`);
    const itemSel = scope.bases.flatMap((b) => [`${b} a`, `${b} li`]).join(", ");
    rules.push(`${itemSel} { white-space: nowrap !important; }`);
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

  // Power-user raw CSS (scoped to the location for overrides, verbatim for default)
  const custom = theme.customCss ?? theme.customCssOverride;
  if (custom && custom.trim()) {
    rules.push(`/* custom css */\n${scopeCustomCss(custom, scope.prefix)}`);
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

  if (allThemes.some((t) => t.animateLoadIn || t.animateScroll)) {
    blocks.push(ANIMATION_KEYFRAMES);
  }

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
