import { prisma } from "./prisma";
import { featureSelector, isSettingsFeature, isKnownFeatureKey } from "./ghlSidebarFeatures";
import { cssFilterForColor } from "./iconColorFilter";
import { contrastingTextColor, resolveContentTheme } from "./contentTheme";

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
 * The page CANVAS — what sits behind GHL's own screens, once the sidebar and the top
 * bar are accounted for.
 *
 * Every other selector in this file is either confirmed against live DOM or a
 * best-effort guess at a GHL class name. This one is deliberately NEITHER, because
 * nothing in this repository knows what GHL calls its content container:
 * `check-live-dom.js` stops at `.hl_header` and the mock harness has no content-area
 * markup at all. So rather than invent `.hl_wrapper` and ship it in a render-blocking
 * stylesheet, every entry here is something that CANNOT be a guess:
 *
 *   body          - universal.
 *   #app          - an id, therefore unique on the page. It either exists or it does
 *                   not; it can never match the wrong element.
 *   main          - a standard element.
 *   [role=main]   - the ARIA equivalent, for an app that uses a <div> and labels it.
 *
 * What that buys is the failure mode. If GHL paints its content inside a private
 * container we do not name, these rules are a VISIBLE NO-OP: the agency picks a
 * colour, nothing changes, and they can clear it. They cannot break the layout (both
 * declarations are colours, never position/size/display), they cannot repaint the
 * sidebar or the header, and nobody who has not asked for a content theme pays a byte
 * — the whole block is gated on the fields being set.
 *
 * `check-live-dom.js` closes the gap when somebody next has a real GHL tab open: it
 * walks up from the content and reports which ancestors actually paint an opaque
 * background, which turns this constant from a safe default into a measured one.
 *
 * TEXT uses the same list and deliberately does NOT descend (`body *`). That is the
 * top-bar rule again, written down 30 lines above: blanket-repainting every
 * descendant would recolour the text inside GHL's own coloured pills and badges,
 * which already carry their own contrast. Body copy INHERITS from these containers
 * and picks the colour up; anything GHL colours on purpose keeps its colour.
 */
const CONTENT_SELECTOR = "body, #app, main, [role='main']";

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
  contentBgColor?: string | null;
  contentTextColor?: string | null;
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
 * Strip characters that could terminate a CSS value or rule (`; { } < > *` and
 * newlines). Valid colors never contain these, so this can't affect legitimate
 * input - it just stops a malformed/hostile color field from corrupting the whole
 * stylesheet. Raw power-user CSS still goes through the dedicated customCss path.
 *
 * `*` is in that set because of COMMENTS, which the original list missed and which are
 * the worst thing a colour field can carry. Measured in a real browser: a stored
 * `red/*` opened a comment that ran on until the next `*\/` anywhere in the file — and
 * this stylesheet is ONE file for the whole agency, so what it swallowed was the rest of
 * that sub-account's block and then the NEXT sub-account's. Six rules in, one out. The
 * neighbour's rules are not deleted, either: CSS error recovery re-parses them as NESTED
 * rules inside the broken one, so they are still in `cssText`, still name the right
 * location, and match nothing at all.
 *
 * `/` is deliberately NOT stripped — `rgb(0 0 0 / 50%)` is a real colour, and killing the
 * asterisk already closes both comment delimiters.
 */
export function cssColor(value: string): string {
  return value.replace(/[;{}<>*\\]/g, "").replace(/[\r\n]+/g, " ").trim();
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

/**
 * Escape a value that is going INSIDE a CSS string — `content: "…"`.
 *
 * This existed twice, written out by hand at the two call sites (the renamed menu label
 * and the alert banner), and the two copies disagreed. The label folded `[\r\n]+`; the
 * alert matched `\s*\n\s*`, which needs an actual LF — so a bare CR survived it, and a
 * FORM FEED survived both. CSS ends a string at any newline, and its definition of one is
 * LF, CR, CRLF *and* FF: measured in a browser, an alert message pasted out of a PDF took
 * the neighbouring sub-account's branding down with it.
 *
 * The `QUEUE_ORDER` rule again — one definition of a thing, read by everything that uses
 * it. Two copies of "the same" escaping is how they end up escaping different sets.
 */
function cssString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f\v\u0085\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Text going inside a `/* … *\/` comment. The block label is the sub-account's name, which
 * the AGENCY types into GHL — so a `*\/` in it closes the comment early and the rest of the
 * name is parsed as CSS, unscoped, in front of every other sub-account's block. Measured:
 * a name of `Acme *\/ #sidebar-v2:has(…another sub-account…) { background: red } /*`
 * repainted that other client's sidebar.
 *
 * The value is nobody's input to trust and nothing renders it, so the whole delimiter goes
 * rather than one character of it.
 */
function cssComment(value: string): string {
  return value.replace(/\*\//g, "").replace(/[\r\n]+/g, " ");
}

/**
 * A font family, reduced to a charset that cannot break out of either place it is used:
 * the `font-family` declaration and the Google Fonts `@import` at the top of the file.
 * ONE definition, because those two had their own and the loose one shipped first — see
 * `fontImports`.
 */
function safeFontFamily(value: string | null | undefined): string {
  return value ? value.replace(/[^a-zA-Z0-9 _-]/g, "").trim() : "";
}

function sidebarBackground(primary: string, theme: VisualTheme): string {
  if (theme.gradientEnabled && theme.gradientColor) {
    const angle = typeof theme.gradientAngle === "number" ? theme.gradientAngle : 135;
    return `linear-gradient(${angle}deg, ${primary}, ${cssColor(theme.gradientColor)})`;
  }
  return primary;
}

/**
 * Read a quoted string starting at `i`, returning it verbatim. CSS ends a string at a raw
 * newline, so an unterminated one stops there rather than eating the rest of the sheet.
 */
function readString(css: string, i: number): { text: string; next: number } {
  const quote = css[i];
  let out = quote;
  let j = i + 1;
  while (j < css.length) {
    const ch = css[j];
    if (ch === "\\" && j + 1 < css.length) { out += ch + css[j + 1]; j += 2; continue; }
    out += ch;
    j++;
    if (ch === quote) break;
    if (ch === "\n" || ch === "\r" || ch === "\f") break;
  }
  return { text: out, next: j };
}

/** Read the balanced `{ … }` starting at `i`, returning what is INSIDE it. */
function readBlock(css: string, i: number): { text: string; next: number } {
  let depth = 0;
  let j = i;
  let start = i + 1;
  while (j < css.length) {
    const ch = css[j];
    if (ch === "/" && css[j + 1] === "*") { const e = css.indexOf("*/", j + 2); j = e < 0 ? css.length : e + 2; continue; }
    if (ch === '"' || ch === "'") { j = readString(css, j).next; continue; }
    if (ch === "{") { depth++; j++; continue; }
    if (ch === "}") { depth--; j++; if (depth === 0) return { text: css.slice(start, j - 1), next: j }; continue; }
    j++;
  }
  // Unbalanced — take the remainder rather than dropping it.
  return { text: css.slice(start), next: css.length };
}

/** Split a stylesheet into top-level `prelude { block }` pairs, plus statements. */
function splitTopLevel(css: string): { prelude: string; block: string | null }[] {
  const parts: { prelude: string; block: string | null }[] = [];
  let prelude = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e < 0 ? css.length : e + 2; continue; }
    if (ch === '"' || ch === "'") { const s = readString(css, i); prelude += s.text; i = s.next; continue; }
    if (ch === ";") { parts.push({ prelude, block: null }); prelude = ""; i++; continue; }
    if (ch === "{") { const b = readBlock(css, i); parts.push({ prelude, block: b.text }); prelude = ""; i = b.next; continue; }
    prelude += ch;
    i++;
  }
  if (prelude.trim()) parts.push({ prelude, block: null });
  return parts;
}

/** At-rules whose block holds ordinary rules, so the prefix belongs INSIDE them. */
const NESTING_AT_RULE = /^@(-\w+-)?(media|supports|container|layer|scope)\b/i;
/**
 * At-rules whose block does NOT hold selectors. `@keyframes`'s `from`/`to`/`50%` are
 * keyframe selectors, not element selectors, and prefixing them silently kills the
 * animation; `@font-face` and `@page` have no selector at all.
 */
const VERBATIM_AT_RULE = /^@(-\w+-)?(keyframes|font-face|page|counter-style|font-feature-values|property)\b/i;
/**
 * Only legal before any other rule in a stylesheet. A per-location block is emitted after
 * the agency default and after every earlier sub-account, so the browser would ignore
 * these wherever we put them — dropping them changes nothing and pretending otherwise
 * would be the worse answer.
 */
const TOP_ONLY_AT_RULE = /^@(import|charset|namespace)\b/i;

/**
 * Prefix each selector in a block of raw CSS so a location's custom rules only apply
 * within that sub-account's wrapper. Agency-default custom CSS uses an empty prefix and is
 * emitted verbatim, so everything works fully there.
 *
 * This was a single flat regex — `([^{}]+)\{([^{}]*)\}` — under a comment claiming it
 * "passes at-rules (@media/@keyframes) through untouched". It did the opposite, and both
 * failures are silent:
 *
 *   @media (max-width: 600px) { .hl_nav { display: none } }
 *     ->  [class~="LOC"] .hl_nav { display: none }
 *
 * The media query is GONE and the rule it guarded now applies at every width. Nothing
 * errors; the agency's mobile tweak simply also happens on the desktop their client uses
 * all day. `@keyframes pulse { from { opacity: 0 } … }` came out as
 * `[class~="LOC"] from { opacity: 0 }` — the animation deleted and two junk element
 * selectors emitted in its place.
 *
 * The regex could not see nesting at all: `[^{}]*` stops at the FIRST brace, so it matched
 * the inner rule and never the wrapper. It also stopped at a brace inside a STRING, so
 * `content: "}"` truncated the declaration and left an unterminated string — which in this
 * one-file-per-agency stylesheet is the next sub-account's problem, not this one's.
 *
 * Written down and walked into, in the same breath, for the sixth time in this file.
 */
function scopeCustomCss(css: string, prefix: string): string {
  if (!prefix.trim()) return css.trim();
  return scopeBlocks(css, prefix);
}

function scopeBlocks(css: string, prefix: string): string {
  const out: string[] = [];
  const loose: string[] = [];
  for (const { prelude, block } of splitTopLevel(css)) {
    /**
     * A stray `}` can only be somebody closing a block we never opened, and left in the
     * prelude it would close OURS — putting the rest of this sub-account's custom CSS, and
     * then the next sub-account's block, outside the scope entirely. The old regex dropped
     * it as a side effect of `[^{}]+`; here it has to be deliberate.
     */
    const head = prelude.replace(/[}]/g, " ").trim();
    if (block === null) {
      // No block: either a statement at-rule, or a bare declaration (the escape hatch's
      // documented fallback — somebody pasting `color: red` rather than a whole rule).
      if (!head) continue;
      if (head.startsWith("@")) { if (!TOP_ONLY_AT_RULE.test(head)) out.push(`${head};`); }
      else loose.push(head);
      continue;
    }
    if (head.startsWith("@")) {
      if (NESTING_AT_RULE.test(head)) out.push(`${head} {\n${scopeBlocks(block, prefix)}\n}`);
      else if (TOP_ONLY_AT_RULE.test(head)) continue;
      else if (VERBATIM_AT_RULE.test(head)) out.push(`${head} { ${block.trim()} }`);
      else out.push(`${head} {\n${scopeBlocks(block, prefix)}\n}`);
      continue;
    }
    if (!head) continue;
    const scopedSel = head
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `${prefix} ${s}`)
      .join(", ");
    out.push(`${scopedSel} { ${block.trim()} }`);
  }
  if (loose.length) out.push(`${prefix} { ${loose.join("; ")} }`);
  return out.join("\n");
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
  const fontFamily = safeFontFamily(theme.fontFamily);
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

  // The content area — the page canvas behind GHL's own screens, and the one part of
  // the product that had columns, a preset field, an editor state default and a PUT
  // whitelist entry while rendering nothing at all.
  //
  // Emitted ONLY when something was asked for. `resolveContentTheme` returns null for
  // a theme with no content colours and dark mode off, which is every theme that
  // exists today, so nobody pays for this in a render-blocking stylesheet until they
  // switch it on.
  //
  // `body` is an ANCESTOR of the location wrapper, not a descendant, so the usual
  // `scoped()` prefix cannot reach it — `[class~="LOC"] body` matches nothing. This
  // takes the alert banner's route instead and hangs the whole thing off
  // `html:has(<wrapper>)`, which scopes the page to sub-accounts whose wrapper is
  // present while keeping the selector an ancestor of body. It also keeps the
  // specificity ordering the rest of the file relies on: the location form outranks
  // the agency default on every entry in the list.
  const content = resolveContentTheme(theme);
  if (content) {
    const contentSel = scope.prefix
      ? `html:has(${scope.prefix}) :is(${CONTENT_SELECTOR})`
      : CONTENT_SELECTOR;
    if (content.bg) {
      rules.push(`${contentSel} { background-color: ${cssColor(content.bg)} !important; }`);
    }
    if (content.text) {
      rules.push(`${contentSel} { color: ${cssColor(content.text)} !important; }`);
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
  // flex column, so lower order floats higher. Unknown keys are ignored. No-op if the
  // nav isn't flex.
  //
  // The catch-all is load-bearing. `order` defaults to 0, so anything NOT in the saved
  // list used to tie with the FIRST item in it and land at the top of the sidebar — and
  // the list goes stale on its own: GHL adds a nav item, or a preset saved before we
  // knew about one gets applied, and that item jumps to position one. It also made the
  // live preview a liar, since the preview sorts unlisted items LAST (`?? 999`).
  // Every nav anchor carries `meta="<key>"`, so one rule sends them all to the back and
  // the per-key rules below override it — `#sb_<key>` outranks it outright, and
  // `a[meta="<key>"]` ties on specificity but wins on source order, hence emitting this
  // FIRST. (Non-anchor children like dividers keep order 0 and stay at the top, which
  // is what they already did before this.)
  const menuOrder = (Array.isArray(theme.menuOrder) ? (theme.menuOrder as string[]) : []).filter(
    isKnownFeatureKey
  );
  if (menuOrder.length) {
    rules.push(`${scope.prefix ? `${scope.prefix} ` : ""}a[meta] { order: 999 !important; }`);
    menuOrder.forEach((key, i) => {
      rules.push(`${featureSelectorsScoped(key, scope).join(", ")} { order: ${i} !important; }`);
    });
  }

  // Menu label renaming
  const labels =
    theme.menuLabelOverrides && typeof theme.menuLabelOverrides === "object"
      ? (theme.menuLabelOverrides as Record<string, string>)
      : {};
  for (const [key, label] of Object.entries(labels)) {
    // Same whitelist as feature-hiding: never let an unknown key reach a selector.
    if (!label || !isKnownFeatureKey(key)) continue;
    const safe = cssString(label);
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
    const safe = cssString(theme.alertMessage);
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

/**
 * Collect distinct Google Font families for the @import block at the top.
 *
 * Through `safeFontFamily`, and that is a fix rather than tidying. This built its URL with
 * `encodeURIComponent`, which does not escape `'`, `(` or `)` — so a font family with an
 * apostrophe in it closed the `url('…')` early. Measured in a real browser: the whole
 * stylesheet parsed to **ZERO rules**. Not the font, not that sub-account — every rule for
 * every sub-account of that agency, because `@import` sits at the top of the one file they
 * all share and the parser never recovers its footing.
 *
 * `renderRules` had been sanitising the same value to `[a-zA-Z0-9 _-]` four hundred lines
 * further down, with a comment saying exactly why. Two definitions of "what is a font
 * family", and the loose one ran first. They also disagreed in the BENIGN case: the import
 * asked Google for `Ev'il Sans` while the declaration referenced `'Evil Sans'`, so even
 * when nothing broke, the font that was fetched was not the font that was used.
 */
function fontImports(themes: VisualTheme[]): string {
  const families = new Set<string>();
  for (const t of themes) {
    const f = safeFontFamily(t.fontFamily);
    if (f) families.add(f);
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
      `/* ${cssComment(loc.locationName ?? loc.ghlLocationId)} */\n` +
        renderRules(locationScope(loc.ghlLocationId), theme as VisualTheme).join("\n")
    );
  }

  return blocks.join("\n\n");
}
