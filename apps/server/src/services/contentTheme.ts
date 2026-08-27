/**
 * What the CONTENT AREA looks like — the page canvas behind GHL's own screens, as
 * opposed to the sidebar and top bar, which have their own rules.
 *
 * Three columns have carried this since the schema was written and NONE of them
 * rendered a byte: `contentBgColor` and `contentTextColor` were never referenced
 * outside `schema.prisma`, and `darkMode` was accepted by the PUT, stored on all
 * three models, carried through presets and threaded into the editor's `Look` — and
 * read by not one line of the stylesheet. `audit-fields.js` has reported them every
 * run. This is the resolver they were missing.
 *
 * It lives in its own module, dependency-free, for the `QUEUE_ORDER` reason: the
 * dashboard's live preview is a SECOND opinion about what a theme looks like, and
 * this file already records that pair drifting three times (unlisted menu items,
 * the accent colour, the login page). The preview mirrors this in
 * `admin-dashboard/src/themeDefaults.ts` and `verify-preview-truth` compares the two
 * implementations directly — which is the only thing that has ever caught the drift.
 */

/** WCAG relative luminance of a #rgb / #rrggbb colour, or null if unparseable. */
export function relativeLuminance(hex: string): number | null {
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
 * ratio. Null when the colour cannot be parsed, so the caller skips the rule instead
 * of guessing wrong and making text unreadable.
 */
export function contrastingTextColor(bg: string): string | null {
  const lum = relativeLuminance(bg);
  if (lum === null) return null;
  const onWhite = 1.05 / (lum + 0.05);
  const onBlack = (lum + 0.05) / 0.05;
  return onWhite >= onBlack ? "#ffffff" : "#1f2937";
}

/**
 * What `darkMode: true` MEANS, in the absence of a chosen colour. A boolean that
 * renders nothing is not a feature; a boolean that resolves to a canvas is.
 *
 * Slate-900, and it resolves the CANVAS ONLY — never the text. That asymmetry is the
 * whole design and it is forced by CSS inheritance rather than chosen:
 *
 *   - A background on the canvas changes only what sits BEHIND GHL's screens. Its
 *     cards, tables, modals and inputs keep painting their own light backgrounds on
 *     top, and the text inside them keeps GHL's own colour. So a canvas colour cannot
 *     make anything unreadable that was readable before. That is the property that
 *     makes an unconfirmed selector safe to ship at all.
 *   - A `color` on the canvas INHERITS into every one of those components, and we do
 *     not repaint them, because nothing here knows what GHL calls them. So light text
 *     derived from a dark canvas would land on GHL's white cards and disappear.
 *
 * There is no CSS that says "colour only the text sitting directly on my background",
 * so deriving the text from the background is a guess that breaks half the screen
 * whichever way it goes. It is therefore never derived — see `resolveContentTheme`.
 */
export const DARK_CONTENT_BG = "#111827";

export interface ContentThemeInput {
  contentBgColor?: string | null;
  contentTextColor?: string | null;
  darkMode?: boolean | null;
}

/** Resolved canvas colours, or null for "the stylesheet leaves the content area alone". */
export interface ContentTheme {
  bg: string | null;
  text: string | null;
}

/**
 * Resolve the content area, or null when nothing has been asked for.
 *
 * Precedence, and each part of it is a decision:
 *  - An explicitly chosen background ALWAYS wins over `darkMode`. The toggle is a
 *    shortcut for a colour, not an override of one, so an agency who turns dark mode
 *    on and then picks their own charcoal keeps their charcoal.
 *  - The TEXT colour is honoured only when it was explicitly set. It is never derived
 *    from the background and never from `darkMode`, for the inheritance reason above:
 *    a derived colour would reach inside GHL's own cards and panels, which we do not
 *    repaint. Auto-contrast is right for the top bar, where we paint every surface the
 *    text sits on. It is wrong here, where we paint one surface out of many.
 *  - Neither, and no dark mode -> null, and NOTHING is emitted. An agency that has
 *    not asked for a content theme must not pay for one in a render-blocking
 *    stylesheet, and must not have GHL's own screens repainted on a guess.
 */
export function resolveContentTheme(t: ContentThemeInput | null | undefined): ContentTheme | null {
  const chosenBg = t?.contentBgColor?.trim() || "";
  const chosenText = t?.contentTextColor?.trim() || "";
  const dark = !!t?.darkMode;

  if (!chosenBg && !chosenText && !dark) return null;

  const bg = chosenBg || (dark ? DARK_CONTENT_BG : "");

  return { bg: bg || null, text: chosenText || null };
}
