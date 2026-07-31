import { prisma } from "./prisma";
import { featureSelector, isSettingsFeature, isKnownFeatureKey } from "./ghlSidebarFeatures";
import { cssFilterForColor } from "./iconColorFilter";

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
 * Top-bar (white header) selectors, confirmed via live DOM inspection:
 *   <header class="hl_header hl_header--collapse">
 *     <div class="container-fluid !justify-end">        <- icon row (phone, Ask AI, bell)
 *     <div class="flex … topmenu-nav">                  <- page tab row (Getting Started, …)
 *
 * Colouring only the <header> looks like a no-op: both children paint their own
 * white background over it, so the header's colour never shows. We have to colour
 * the children too.
 *
 * It sits inside the location-classed wrapper, so location scoping applies the
 * same as the sidebar.
 */
const TOP_BAR_SELECTOR = ".hl_header, .hl_header .container-fluid, .hl_header .topmenu-nav";

/**
 * The page title + tab labels inside the top bar ("AI Agents · Getting Started ·
 * Voice AI …"). GHL paints these #607179, which vanishes on a dark top bar, so we
 * recolour them for contrast whenever a top bar colour is set. Confirmed from live
 * DOM: the title and the tabs both live inside `.topmenu-nav`.
 *
 * Deliberately NOT `.hl_header *` - that would repaint the icon row's coloured
 * pills (Ask AI, notifications, avatar), which already carry their own contrast.
 */
const TOP_BAR_TEXT_SELECTOR = ".hl_header .topmenu-nav, .hl_header .topmenu-nav *";

/**
 * WCAG relative luminance of a #rgb / #rrggbb colour, or null if unparseable.
 * Used to decide whether text over that colour should be light or dark.
 */
function relativeLuminance(hex: string): number | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whichever of white / near-black contrasts better against `bg`, by WCAG contrast
 * ratio. Falls back to null when the colour can't be parsed, so the caller can skip
 * the rule instead of guessing wrong and making text unreadable.
 */
function contrastingTextColor(bg: string): string | null {
  const lum = relativeLuminance(bg);
  if (lum === null) return null;
  const onWhite = 1.05 / (lum + 0.05);
  const onBlack = (lum + 0.05) / 0.05;
  return onWhite >= onBlack ? "#ffffff" : "#1f2937";
}

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
  sidebarIconColor?: string | null;
  buttonShape?: string | null;
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
const BUTTON_SHAPE_SELECTOR = ".hl-btn, button, .btn, .n-button";
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

function locationScope(rawLocationId: string): Scope {
  // GHL location ids are alphanumeric; strip anything else so the id can't break out
  // of the attribute/class selectors below and corrupt scoping or the whole bundle.
  const locationId = rawLocationId.replace(/[^A-Za-z0-9_-]/g, "");
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

/**
 * Sanitize a value dropped inside url("..."). We keep it inside double quotes, so the
 * only characters that can break out are the double-quote, backslash, angle brackets,
 * braces, and newlines - strip exactly those. Crucially we must NOT strip ; : / + =
 * because data: URLs (from uploaded logos/images: "data:image/png;base64,...") depend
 * on them; stripping ";" turned every uploaded image into a broken URL.
 */
function cssUrl(value: string): string {
  return value.replace(/["\\{}<>]/g, "").replace(/[\r\n]+/g, " ").trim();
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
export function renderRules(scope: Scope, theme: VisualTheme): string[] {
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
  // Icons default to the accent color. GHL renders them as <svg> (usually
  // fill/stroke: currentColor) or <i>, so set `color` (drives currentColor) plus a
  // best-effort fill/stroke on the svg paths.
  const iconSel = scope.bases.flatMap((b) => [`${b} a i`, `${b} a svg`]).join(", ");
  rules.push(`${iconSel} { color: ${accent} !important; }`);

  // Sidebar menu text color. Scoped to inactive links (`:not(.active)`) so active
  // items keep the white contrast color set against the accent background above.
  if (theme.sidebarTextColor) {
    const txt = cssColor(theme.sidebarTextColor);
    const sel = scope.bases
      .flatMap((b) => [`${b} a:not(.active)`, `${b} a:not(.active) .nav-title`])
      .join(", ");
    rules.push(`${sel} { color: ${txt} !important; }`);
  }

  // Dedicated sidebar icon color, delivered as a `filter` chain rather than
  // color/fill/stroke. Applies to inactive items only so the active item keeps its
  // white-on-accent contrast.
  //
  // Verified against the live GHL sidebar - the colour properties CANNOT work here:
  //   - `color`: the SVGs don't use currentColor. `#sidebar-v2 * { color: magenta }`
  //     recoloured every label and left every icon untouched.
  //   - `fill`/`stroke`: reach the <svg> icons but not `span.ask-ai-sparkle-icon`
  //     and friends, which are <span>s painted with a CSS background-image.
  //   - `mask`: would need each icon's source URL, which we don't have.
  // `filter` operates on rendered pixels, so it recolours all of them identically
  // and doesn't depend on GHL's internal markup - see services/iconColorFilter.ts.
  //
  // Deliberately NOT scoped to `a:not(.active) …`. Confirmed live: with the anchor
  // requirement, `span.ask-ai-sparkle-icon` recoloured (it IS inside an <a>) while
  // every sub-account nav <svg> stayed untouched - those icons are not descendants
  // of the nav anchor. `#sidebar-v2 svg` does match them, so we hang the filter off
  // the sidebar itself and switch it back off for the active item instead.
  if (theme.sidebarIconColor) {
    const filter = cssFilterForColor(cssColor(theme.sidebarIconColor));
    // Unparseable colour -> emit nothing rather than a broken rule.
    if (filter) {
      // `img` is in the list because a chunk of the agency sidebar (AI Suite, Agency
      // Dashboard, Sub-Accounts, Account Snapshots, Reselling, Add-Ons, Partners,
      // SaaS Education, GHL Swag, Ideas, Mobile App) draws its icons as <img>, not
      // <svg> - confirmed by outlining `#sidebar-v2 img` live, which boxed exactly
      // those items and nothing else. The agency logo is also an <img> and must be
      // excluded, or an agency that hasn't uploaded its own logo gets it recoloured.
      const sel = scope.bases
        .flatMap((b) => [`${b} svg`, `${b} i`, `${b} span[class*="icon"]`, `${b} img:not(.agency-logo)`])
        .join(", ");
      rules.push(`${sel} { filter: ${filter} !important; }`);

      // The active item is painted white on the accent background - leave its icon
      // alone so it keeps that contrast.
      const activeSel = scope.bases
        .flatMap((b) => [
          `${b} .active svg`,
          `${b} .active i`,
          `${b} .active span[class*="icon"]`,
          `${b} .active img`,
        ])
        .join(", ");
      rules.push(`${activeSel} { filter: none !important; }`);
    }
  }

  // Font family (applies to the whole scoped subtree; for global, to sidebar + body).
  // Sanitize to a safe identifier charset FIRST - an unescaped quote/brace here would
  // otherwise break out of the declaration and inject arbitrary (unscoped) CSS.
  const fontFamily = theme.fontFamily ? theme.fontFamily.replace(/[^a-zA-Z0-9 _-]/g, "").trim() : "";
  if (fontFamily) {
    const stack = `'${fontFamily}', sans-serif`;
    if (scope.prefix) {
      rules.push(`${scope.prefix} { font-family: ${stack} !important; }`);
    } else {
      rules.push(`body, #sidebar-v2, #sidebar-v2 * { font-family: ${stack} !important; }`);
    }
  }

  // Top bar color, plus an auto-contrast text colour so the page title and tabs
  // stay readable on a dark bar (GHL's own #607179 disappears against one).
  if (theme.topBarColor) {
    const bar = cssColor(theme.topBarColor);
    rules.push(`${scoped(scope, TOP_BAR_SELECTOR)} { background: ${bar} !important; }`);
    const text = contrastingTextColor(bar);
    if (text) {
      rules.push(`${scoped(scope, TOP_BAR_TEXT_SELECTOR)} { color: ${text} !important; }`);
    }
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

  // Button shape preset - overrides the button radius specifically (emitted after the
  // general corner radius so it wins on buttons). Whitelisted values only.
  const BUTTON_SHAPE_RADIUS: Record<string, string> = { square: "0", rounded: "10px", pill: "999px" };
  const shapeRadius = theme.buttonShape ? BUTTON_SHAPE_RADIUS[theme.buttonShape] : undefined;
  if (shapeRadius) {
    rules.push(`${scoped(scope, BUTTON_SHAPE_SELECTOR)} { border-radius: ${shapeRadius} !important; }`);
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

  // NOTE: content-area background/text theming was removed - GHL renders card/body
  // text in elements we can't reliably recolor, so the background changed but text
  // stayed dark (unreadable). Same reason dark mode was dropped. Sidebar/logo/colors/
  // fonts/buttons remain the reliable, CSS-only surface.

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
/** Agency-level login-page branding (rendered globally; login is pre-sub-account). */
interface LoginTheme {
  loginBgColor?: string | null;
  loginBgImage?: string | null;
  loginGradientEnabled?: boolean | null;
  loginGradientColor?: string | null;
  loginGradientAngle?: number | null;
  loginCardColor?: string | null;
  loginButtonColor?: string | null;
  loginLogoUrl?: string | null;
}

// Confirmed against live GHL DOM: the login page uses .hl_login (section),
// .hl_login--header / --body, and a centered .card / .card-body. The outer
// .sidebar-v2-agency wrapper fills the viewport, so it carries the full background.
const LOGIN_BG_SELECTOR = ".sidebar-v2-agency, .hl_login, .hl_login--header, .hl_login--body";
const LOGIN_CARD_SELECTOR = ".hl_login .card, .hl_login .card-body";
const LOGIN_BUTTON_SELECTOR =
  ".hl_login .card-body button, .hl_login button[type='submit'], .hl_login .btn, .hl_login .n-button--primary-type";
const LOGIN_HEADER_SELECTOR = ".hl_login--header";

export function renderLoginRules(t: LoginTheme): string[] {
  const rules: string[] = [];

  // Full-page background: image wins, then gradient, then solid color.
  if (t.loginBgImage) {
    rules.push(
      `${LOGIN_BG_SELECTOR} { background-image: url("${cssUrl(t.loginBgImage)}") !important; background-size: cover !important; background-position: center !important; background-repeat: no-repeat !important; }`
    );
  } else if (t.loginGradientEnabled && t.loginGradientColor && t.loginBgColor) {
    const angle = typeof t.loginGradientAngle === "number" ? t.loginGradientAngle : 135;
    rules.push(
      `${LOGIN_BG_SELECTOR} { background: linear-gradient(${angle}deg, ${cssColor(t.loginBgColor)}, ${cssColor(t.loginGradientColor)}) !important; }`
    );
  } else if (t.loginBgColor) {
    rules.push(`${LOGIN_BG_SELECTOR} { background: ${cssColor(t.loginBgColor)} !important; }`);
  }

  if (t.loginCardColor) {
    rules.push(`${LOGIN_CARD_SELECTOR} { background: ${cssColor(t.loginCardColor)} !important; }`);
  }
  if (t.loginButtonColor) {
    const b = cssColor(t.loginButtonColor);
    rules.push(`${LOGIN_BUTTON_SELECTOR} { background-color: ${b} !important; border-color: ${b} !important; }`);
  }
  if (t.loginLogoUrl) {
    rules.push(
      `${LOGIN_HEADER_SELECTOR} { background-image: url("${cssUrl(t.loginLogoUrl)}") !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; min-height: 72px !important; }`
    );
  }
  return rules;
}

export async function generateThemeCssBundle(agencyInstallId: string): Promise<string> {
  const [defaultTheme, locations] = await Promise.all([
    prisma.agencyDefaultTheme.findUnique({ where: { agencyInstallId } }),
    prisma.locationInstall.findMany({
      where: { agencyInstallId, status: "active", enabled: true },
      include: { themeConfigs: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 } },
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
    const loginRules = renderLoginRules(defaultTheme as LoginTheme);
    if (loginRules.length) {
      blocks.push("/* Agency login page */\n" + loginRules.join("\n"));
    }
  }

  for (const { loc, theme } of locationThemes) {
    blocks.push(
      `/* ${loc.locationName ?? loc.ghlLocationId} */\n` +
        renderRules(locationScope(loc.ghlLocationId), theme as VisualTheme).join("\n")
    );
  }

  return blocks.join("\n\n");
}
