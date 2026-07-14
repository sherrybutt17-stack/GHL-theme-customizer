import { prisma } from "./prisma";
import { featureSelector, isSettingsFeature, isKnownFeatureKey } from "./ghlSidebarFeatures";

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
  sidebarTextColor?: string | null;
  contentBgColor?: string | null;
  contentTextColor?: string | null;
  menuOrder?: unknown;
  darkMode?: boolean | null;
  hideUpgrade?: boolean | null;
  alertMessage?: string | null;
  alertColor?: string | null;
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
const CONTENT_SURFACE_SELECTOR =
  ".hl_wrapper, .hl_wrapper--inner, .hl-main, main, .container-fluid, #app-content, .hr-wrapper-container, .hr-config-provider";
const CONTENT_CARD_SELECTOR = ".card, .hl-card";
// Text-bearing descendants of the content surfaces. GHL's inner text nodes set their
// OWN color, which does not inherit the container color we set - so when the content
// background changes we must recolor these directly, or text goes invisible.
const CONTENT_TEXT_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label", "li", "td", "th", "dt", "dd", "small", "strong", "b", "em",
];
function contentTextSelector(): string {
  const bases = [".hl_wrapper--inner", ".hl-main", "main", ".card", ".hl-card", ".hr-wrapper-container"];
  return bases.flatMap((b) => CONTENT_TEXT_TAGS.map((t) => `${b} ${t}`)).join(", ");
}
/** Pick readable text (light vs dark) for a given background color, by luminance. */
function readableTextOn(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#1a1a1a";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? "#e2e8f0" : "#1a1a1a";
}
const UPGRADE_SELECTOR =
  "[class*='upgrade'], [href*='upgrade'], [href*='billing'], .upgrade-banner, [data-testid*='upgrade']";

/**
 * A scope determines whether rules apply globally (agency default) or only to
 * one sub-account (location override, which wins by specificity).
 *  - bases:   selectors for the sidebar element itself (for background).
 *  - prefix:  ancestor selector prepended to descendant rules ("" for global).
 */
interface Scope {
  bases: string[];
  prefix: string;
  /** The sub-account id when this is a location override; undefined for global. */
  locationId?: string;
}

function globalScope(): Scope {
  return { bases: ["#sidebar-v2", ".hl_sidebar"], prefix: "" };
}

function locationScope(locationId: string): Scope {
  const has = `:has(a[href*="/location/${locationId}/"])`;
  return {
    bases: [`#sidebar-v2${has}`, `.hl_sidebar${has}`],
    // The sidebar wrapper div carries the raw location id as a CSS class.
    prefix: `[class~="${locationId}"]`,
    locationId,
  };
}

/**
 * Selectors for a feature's nav link, correctly scoped.
 *
 * Main/agency sidebar items live inside the location-classed sidebar wrapper, so
 * we scope them with the ancestor `prefix`. Settings-sidebar items live OUTSIDE
 * that wrapper, so ancestor scoping can't reach them - instead we scope by the
 * locationId embedded in their own href (adding a second `[href*="/location/<id>"]`
 * attribute match), which also sidesteps their id/meta collisions with the main
 * sidebar. Global scope (agency default) leaves both untouched so they apply to
 * every sub-account.
 */
function featureSelectorsScoped(key: string, scope: Scope): string[] {
  const raw = featureSelector(key)
    .split(",")
    .map((s) => s.trim());
  if (isSettingsFeature(key)) {
    if (!scope.locationId) return raw; // agency default: match the item on any location
    return raw.map((s) => s.replace(/^a\[/, `a[href*="/location/${scope.locationId}"][`));
  }
  return raw.map((s) => (scope.prefix ? `${scope.prefix} ${s}` : s));
}

/**
 * Selectors to apply a menu-label rename to. Every sidebar item — main, agency,
 * AND Settings — carries its label in a `.nav-title` child span (confirmed for
 * Settings via live DOM: `<span class="… nav-title …">Custom Fields</span>`), so
 * we target that span. Renaming the span (not the whole `<a>`) leaves the icon's
 * own text node untouched and keeps the injected label inside the label element.
 */
function featureLabelSelectorsScoped(key: string, scope: Scope): string[] {
  return featureSelectorsScoped(key, scope).map((s) => `${s} .nav-title`);
}

/** Scope a comma-separated descendant selector list under the scope's prefix. */
function scoped(scope: Scope, selectorList: string): string {
  return selectorList
    .split(",")
    .map((s) => s.trim())
    .map((s) => (scope.prefix ? `${scope.prefix} ${s}` : s))
    .join(", ");
}

/**
 * Strip characters that could terminate a CSS value or rule (`; { } < >` and
 * newlines). Valid colors never contain these, so this can't affect legitimate
 * input - it just stops a malformed/hostile color field from corrupting the whole
 * stylesheet. Raw power-user CSS still goes through the dedicated customCss path.
 */
export function cssColor(value: string): string {
  return value.replace(/[;{}<>\\]/g, "").replace(/[\r\n]+/g, " ").trim();
}

/** Same idea for values dropped inside url("..."): also strip quotes and parens. */
function cssUrl(value: string): string {
  return value.replace(/[;{}<>\\"'()]/g, "").replace(/[\r\n]+/g, " ").trim();
}

function sidebarBackground(primary: string, theme: VisualTheme): string {
  if (theme.gradientEnabled && theme.gradientColor) {
    const angle = typeof theme.gradientAngle === "number" ? theme.gradientAngle : 135;
    return `linear-gradient(${angle}deg, ${primary}, ${cssColor(theme.gradientColor)})`;
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
  const primary = cssColor(theme.primaryColor || "#4f46e5");
  const accent = cssColor(theme.accentColor || theme.primaryColor || "#4f46e5");

  // Sidebar background (solid or gradient)
  rules.push(`${scope.bases.join(", ")} { background: ${sidebarBackground(primary, theme)} !important; }`);

  // Active item + icons
  rules.push(
    `${scope.bases.map((b) => `${b} a.active`).join(", ")}, ${scope.bases
      .map((b) => `${b} .active`)
      .join(", ")} { background: ${accent} !important; color: #fff !important; }`
  );
  rules.push(`${scope.bases.map((b) => `${b} a i`).join(", ")} { color: ${accent} !important; }`);

  // Sidebar menu text color. Scoped to inactive links (`:not(.active)`) so active
  // items keep the white contrast color set against the accent background above.
  if (theme.sidebarTextColor) {
    const txt = cssColor(theme.sidebarTextColor);
    const sel = scope.bases
      .flatMap((b) => [`${b} a:not(.active)`, `${b} a:not(.active) .nav-title`])
      .join(", ");
    rules.push(`${sel} { color: ${txt} !important; }`);
  }

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
    rules.push(`${scoped(scope, TOP_BAR_SELECTOR)} { background: ${cssColor(theme.topBarColor)} !important; }`);
  }

  // Sidebar background image (painted over the color/gradient)
  if (theme.sidebarImageUrl) {
    rules.push(
      `${scope.bases.join(", ")} { background-image: url("${cssUrl(theme.sidebarImageUrl)}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`
    );
  }

  // Primary buttons
  if (theme.buttonColor) {
    const btn = cssColor(theme.buttonColor);
    rules.push(
      `${scoped(scope, PRIMARY_BUTTON_SELECTOR)} { background-color: ${btn} !important; border-color: ${btn} !important; }`
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
      `${sbBase} ::-webkit-scrollbar-thumb { background: ${cssColor(theme.scrollbarColor)} !important; border-radius: 8px !important; }`
    );
  }

  // Content area background + text (optional custom colors). Dark mode was removed;
  // these give the same capability but with any color the agency picks. When a
  // background is set without an explicit text color, we auto-pick readable text.
  if (theme.contentBgColor) {
    const bg = cssColor(theme.contentBgColor);
    rules.push(`${scoped(scope, CONTENT_SURFACE_SELECTOR)} { background: ${bg} !important; }`);
    rules.push(`${scoped(scope, CONTENT_CARD_SELECTOR)} { background: ${bg} !important; }`);
    if (!theme.contentTextColor) {
      const auto = readableTextOn(bg);
      rules.push(`${scoped(scope, CONTENT_SURFACE_SELECTOR)}, ${scoped(scope, CONTENT_CARD_SELECTOR)} { color: ${auto} !important; }`);
      rules.push(`${scoped(scope, contentTextSelector())} { color: ${auto} !important; }`);
    }
  }
  if (theme.contentTextColor) {
    const tc = cssColor(theme.contentTextColor);
    rules.push(`${scoped(scope, CONTENT_SURFACE_SELECTOR)}, ${scoped(scope, CONTENT_CARD_SELECTOR)} { color: ${tc} !important; }`);
    rules.push(`${scoped(scope, contentTextSelector())} { color: ${tc} !important; }`);
  }

  // Hide upgrade / billing prompts (white-label clean-up)
  if (theme.hideUpgrade) {
    rules.push(`${scoped(scope, UPGRADE_SELECTOR)} { display: none !important; }`);
  }

  // Logo swap
  if (theme.logoUrl) {
    rules.push(
      `${scoped(scope, LOGO_CONTAINER_SELECTOR)} { background-image: url("${cssUrl(theme.logoUrl)}") !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; min-height: 40px !important; }`
    );
    rules.push(`${scoped(scope, LOGO_IMG_SELECTOR)} { opacity: 0 !important; }`);
  }

  // Feature hiding. Ignore any key that isn't a real, known feature - stored values
  // are client-supplied, and only whitelisted keys may reach a selector.
  const hidden = (Array.isArray(theme.hiddenFeatures) ? (theme.hiddenFeatures as string[]) : []).filter(
    isKnownFeatureKey
  );
  for (const key of hidden) {
    rules.push(`${featureSelectorsScoped(key, scope).join(", ")} { display: none !important; }`);
  }

  // Sidebar menu ordering. Emits a flex `order` per item; the GHL sidebar nav is a
  // flex column, so lower order floats higher. Unknown keys are ignored. Items not
  // in the list keep order:0 (their natural position). No-op if the nav isn't flex.
  const menuOrder = (Array.isArray(theme.menuOrder) ? (theme.menuOrder as string[]) : []).filter(
    isKnownFeatureKey
  );
  menuOrder.forEach((key, i) => {
    rules.push(`${featureSelectorsScoped(key, scope).join(", ")} { order: ${i} !important; }`);
  });

  // Menu label renaming
  const labels =
    theme.menuLabelOverrides && typeof theme.menuLabelOverrides === "object"
      ? (theme.menuLabelOverrides as Record<string, string>)
      : {};
  for (const [key, label] of Object.entries(labels)) {
    // Same whitelist as feature-hiding: never let an unknown key reach a selector.
    if (!label || !isKnownFeatureKey(key)) continue;
    const safe = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
    const parts = featureLabelSelectorsScoped(key, scope);
    rules.push(`${parts.join(", ")} { font-size: 0 !important; }`);
    rules.push(
      `${parts.map((p) => `${p}::after`).join(", ")} { content: "${safe}" !important; font-size: 14px !important; }`
    );
  }

  // Account alert: a fixed announcement toast rendered from CSS `content`. We
  // hang it off the location wrapper's ::before (or body for the agency-wide
  // default) so it shows only on that sub-account's pages. CSS-only, so it's a
  // persistent banner, not a click-to-dismiss modal (that would need JS).
  if (theme.alertMessage && theme.alertMessage.trim()) {
    // Anchor to the page root so `position: fixed` stays viewport-relative
    // (a `transform` on any ancestor would otherwise break fixed positioning).
    // Scope to the location via :has() - the banner shows only on pages that
    // contain that sub-account's wrapper element.
    const target = scope.prefix ? `html:has(${scope.prefix})` : "body";
    const color = cssColor(theme.alertColor || "#4f46e5");
    const safe = theme.alertMessage.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ");
    rules.push(
      `${target}::before { content: "${safe}" !important; position: fixed !important; bottom: 20px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 2147483000 !important; background: ${color} !important; color: #fff !important; padding: 12px 24px !important; border-radius: 999px !important; font-weight: 600 !important; font-size: 14px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.25) !important; max-width: 90vw !important; text-align: center !important; pointer-events: none !important; }`
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
