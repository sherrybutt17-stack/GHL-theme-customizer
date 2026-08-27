/**
 * What the editor should show for a field the agency has never set.
 *
 * Extracted for the same reason as `bulkEnableLogic` and `slaTone`: it is a decision that
 * changes what a client sees, and inline in `lookFrom` it can only be checked by opening
 * the editor, pressing Save, and then reading the generated stylesheet.
 *
 * THE RULE: where the SERVER has a fallback, this must be the same one. `renderRules` is
 * the authority on what a theme looks like, and a second answer here is the `QUEUE_ORDER`
 * failure — two definitions of one fact, four files apart, with nobody able to see both at
 * once.
 *
 * It went wrong exactly there. The server resolves the active menu item as
 *
 *     accentColor || primaryColor || "#4f46e5"
 *
 * and the editor resolved it as `accentColor ?? "#f59e0b"`. So a sub-account branded teal
 * with no accent chosen — the ordinary result of "Brand from websites", which only sets
 * colours — had a TEAL active menu item live, and the moment anybody opened the editor and
 * pressed Save (to change the logo, the brand name, anything at all) it became AMBER in
 * their client's CRM. Nobody chose amber; it was this file's placeholder.
 *
 * Measured, for `{primaryColor: "#0f766e", accentColor: null}`:
 *   live   #sidebar-v2 a.active { background: #0f766e }
 *   saved  #sidebar-v2 a.active { background: #f59e0b }
 */

/** Mirrors `renderRules`: the accent falls back to the primary before any hardcoded colour. */
export const FALLBACK_BRAND = "#4f46e5";

export function resolveAccentColor(initial: {
  accentColor?: string | null;
  primaryColor?: string | null;
} | null | undefined): string {
  return initial?.accentColor || initial?.primaryColor || FALLBACK_BRAND;
}

/* ------------------------------------------------------------------ login page */

/**
 * The login tab is the same pair one screen over — `LoginPreview` beside `renderLoginRules`
 * — and it had drifted in a way the sidebar preview had not: it invented branding for
 * fields the server delivers NOTHING for.
 *
 *   preview   base = bgColor || "#0f172a"     card = cardColor || "#ffffff"
 *   server    emits a background rule only IF bgColor is set, and none otherwise
 *
 * So an agency that had set nothing saw a dark-slate login screen with an indigo button in
 * the preview, and got GoHighLevel's own login page live. The panel's own copy says "Leave
 * a field blank to skip it", and the controls could neither express a blank nor show one:
 * an `<input type="color">` cannot be empty, so an unset background rendered as a slate
 * swatch, identical to somebody having chosen slate.
 *
 * These return **null for "the server emits no rule"**, which is a different answer from
 * any colour and is what the preview and the fields both have to say out loud.
 */
export interface LoginLook {
  bgColor: string;
  bgImage: string;
  gradientEnabled: boolean;
  gradientColor: string;
  gradientAngle: number;
  cardColor: string;
  buttonColor: string;
}

/**
 * What the login background will actually be, or null if the stylesheet leaves it alone.
 * Image > gradient > solid, exactly as `renderLoginRules` orders them — INCLUDING that the
 * gradient needs a base colour as well. The preview required only the gradient colour and
 * substituted its own base, so a theme with the gradient on and no base painted a gradient
 * on screen while the server emitted no background rule at all.
 */
export function resolveLoginBackground(l: LoginLook): string | null {
  if (l.bgImage) return `url("${l.bgImage}") center / cover no-repeat`;
  if (l.gradientEnabled && l.gradientColor && l.bgColor) {
    const angle = typeof l.gradientAngle === "number" ? l.gradientAngle : 135;
    return `linear-gradient(${angle}deg, ${l.bgColor}, ${l.gradientColor})`;
  }
  if (l.bgColor) return l.bgColor;
  return null;
}

/** Both are plain "set or not" on the server, and null means GHL's own. */
export const resolveLoginCard = (cardColor: string): string | null => cardColor || null;
export const resolveLoginButton = (buttonColor: string): string | null => buttonColor || null;

/**
 * The parts of the login page this agency is NOT branding, named the way the panel names
 * them. Shown under the preview, because a mock that quietly paints its own placeholder is
 * a mock that tells the agency their login page is branded when it is not.
 */
export function unbrandedLoginParts(l: LoginLook & { logoUrl: string }): string[] {
  const out: string[] = [];
  if (resolveLoginBackground(l) === null) out.push("background");
  if (!l.cardColor) out.push("login box");
  if (!l.buttonColor) out.push("button");
  if (!l.logoUrl) out.push("logo");
  return out;
}

/* --------------------------------------------------------------- content area */

/**
 * The content area — GHL's own screens, behind the sidebar and top bar chrome.
 *
 * The third pair this file exists to keep honest, and the one that had drifted furthest:
 * it did not disagree with the server, it had NO counterpart there at all.
 * `contentBgColor` and `contentTextColor` appeared nowhere outside `schema.prisma`, and
 * `darkMode` was accepted by the PUT, stored on three models, carried through presets and
 * threaded into `Look` while rendering not one byte of CSS.
 *
 * Mirrors `server/src/services/contentTheme.ts`. `verify-preview-truth` compares the two
 * implementations over synthetic themes — which is what has caught every previous drift,
 * because a unit test on either side alone will happily agree with itself.
 */
export const DARK_CONTENT_BG = "#111827";

export interface ContentLook {
  contentBgColor?: string | null;
  contentTextColor?: string | null;
  darkMode?: boolean | null;
}

/** Null for "the stylesheet leaves the content area alone" — not a colour. */
export function resolveContentTheme(
  t: ContentLook | null | undefined
): { bg: string | null; text: string | null } | null {
  const chosenBg = t?.contentBgColor?.trim() || "";
  const chosenText = t?.contentTextColor?.trim() || "";
  const dark = !!t?.darkMode;

  if (!chosenBg && !chosenText && !dark) return null;

  // Dark mode resolves the CANVAS only. A `color` on the canvas inherits into GHL's
  // own cards and panels, which the stylesheet does not repaint — so a derived light
  // text would land on their white backgrounds and disappear. See the server's
  // `contentTheme.ts` for the argument in full; the two must not disagree.
  const bg = chosenBg || (dark ? DARK_CONTENT_BG : "");

  return { bg: bg || null, text: chosenText || null };
}
