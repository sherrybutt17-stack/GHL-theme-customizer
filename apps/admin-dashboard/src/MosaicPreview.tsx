import type { Look } from "./LookFields";
import type { SidebarFeature } from "./api";
import { resolveContentTheme } from "./themeDefaults";

interface Props {
  look: Look;
  logoUrl: string;
  brandName?: string;
  features: SidebarFeature[];
  hidden: Set<string>;
  labels: Record<string, string>;
  /** Optional explicit menu order (feature keys). Feature #2 fills this in. */
  order?: string[];
}

// Simple glyphs so the mock reads as a real nav without pulling an icon font.
const GLYPHS = ["◧", "✦", "◑", "▣", "◈", "❖", "◐", "▤", "◭", "⬡", "◅", "▧"];

/**
 * A lightweight mock of the GHL sidebar that mirrors the current theme so agencies
 * see their changes without switching into a sub-account. Purely presentational -
 * it reads the same `look` / hidden / labels / order state the editor collects.
 */
export function MosaicPreview({ look, logoUrl, brandName, features, hidden, labels, order }: Props) {
  const bg =
    look.gradientEnabled && look.gradientColor
      ? `linear-gradient(${look.gradientAngle ?? 135}deg, ${look.primaryColor}, ${look.gradientColor})`
      : look.primaryColor;
  const font = look.fontFamily ? `'${look.fontFamily}', sans-serif` : "inherit";
  const textColor = look.sidebarTextColor || "#ffffff";
  const radius = typeof look.cornerRadius === "number" ? look.cornerRadius : 8;
  /*
    The canvas was a hardcoded `#f8fafc` — a fourth place with its own idea of what a
    theme looks like, beside the accent colour, the login page and the menu order, all
    three of which this pair has already been caught disagreeing about.

    `resolveContentTheme` returning null means the stylesheet emits NOTHING and the
    agency gets GHL's own page background, so the literal survives as this mock's
    stand-in for exactly that — the same role white text plays for un-themed labels.

    `cardBg` stays white ON PURPOSE, and that is the preview telling the truth rather
    than flattering the feature: the stylesheet paints the canvas and does not repaint
    GHL's cards, so a dark content area really does frame white cards. An agency who
    would rather it did not can see that here, before saving.
  */
  const content = resolveContentTheme(look);
  const canvasBg = content?.bg ?? "#f8fafc";
  const cardBg = "#ffffff";
  const btnRadius =
    look.buttonShape === "square"
      ? 0
      : look.buttonShape === "pill"
        ? 999
        : look.buttonShape === "rounded"
          ? 10
          : radius;

  // Main sidebar items only; honor explicit order, then drop hidden ones.
  let items = features.filter((f) => f.group !== "settings");
  if (order && order.length) {
    const pos = new Map(order.map((k, i) => [k, i]));
    items = [...items].sort((a, b) => (pos.get(a.key) ?? 999) - (pos.get(b.key) ?? 999));
  }
  const visible = items.filter((f) => !hidden.has(f.key)).slice(0, 12);

  return (
    <div className="mp-wrap">
      <div className="mp-caption">Live preview</div>
      <div className="mp-frame">
        <div className="mp-sidebar" style={{ background: bg, fontFamily: font }}>
          <div className="mp-logo">
            {logoUrl ? (
              <img src={logoUrl} alt="" />
            ) : (
              <span style={{ color: textColor, fontWeight: 700, fontSize: 13 }}>
                {brandName || "Your Brand"}
              </span>
            )}
          </div>
          <div className="mp-nav">
            {visible.map((f, i) => {
              const active = i === 0;
              return (
                <div
                  key={f.key}
                  className="mp-item"
                  style={{
                    background: active ? look.accentColor : "transparent",
                    color: active ? "#fff" : textColor,
                    borderRadius: radius,
                  }}
                >
                  {/*
                    NOT `|| look.accentColor`. `renderRules` emits an icon rule only
                    `if (theme.sidebarIconColor)` — there is no accent fallback anywhere in
                    the bundle — so borrowing the accent here painted the preview in a colour
                    the icons would not be. It is the same lie the field beside it told, and
                    this is the half an agency actually looks at while deciding.

                    Unset means the icons keep the colours they came with, which in a mock
                    with no GHL icons is the tone of the labels next to them.
                  */}
                  <span
                    className="mp-icon"
                    style={{ color: active ? "#fff" : look.sidebarIconColor || textColor }}
                  >
                    {GLYPHS[i % GLYPHS.length]}
                  </span>
                  <span className="mp-label">{labels[f.key]?.trim() || f.label}</span>
                </div>
              );
            })}
            {features.length > 0 && visible.length === 0 && (
              <div className="mp-empty">All items hidden</div>
            )}
          </div>
        </div>
        <div className="mp-canvas" style={{ background: canvasBg, color: content?.text ?? undefined }}>
          <div className="mp-topbar" style={{ background: look.topBarColor || "#ffffff" }} />
          <div className="mp-card" style={{ background: cardBg, borderRadius: radius }}>
            {/*
              These bars stand for body copy, so they carry the content text colour —
              on the WHITE card, because that is where it lands. A preview that showed
              it only against the canvas would hide the one consequence worth seeing.
            */}
            <div className="mp-line" style={{ width: "60%", background: content?.text ?? undefined }} />
            <div className="mp-line" style={{ width: "85%", background: content?.text ?? undefined }} />
            <button
              className="mp-btn"
              style={{ background: look.buttonColor || look.primaryColor, borderRadius: btnRadius }}
            >
              Button
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
