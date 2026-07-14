import type { Look } from "./LookFields";
import type { SidebarFeature } from "./api";

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
  // Content area reflects the custom content background (default light). Dark mode
  // was removed, so there's no preset fallback - the custom color is the only driver.
  const canvasBg = look.contentBgColor || "#f8fafc";
  const cardBg = look.contentBgColor || "#ffffff";
  const contentText = look.contentTextColor || (look.contentBgColor ? "#e5e5e5" : "#334155");
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
                  <span
                    className="mp-icon"
                    style={{ color: active ? "#fff" : look.accentColor }}
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
        <div className="mp-canvas" style={{ background: canvasBg }}>
          <div className="mp-topbar" style={{ background: look.topBarColor || "#ffffff" }} />
          <div
            className="mp-card"
            style={{
              background: cardBg,
              borderRadius: radius,
              // When a custom content bg makes the card match the canvas, add a hairline
              // so the card stays visible in the preview.
              border: look.contentBgColor ? `1px solid ${contentText}33` : undefined,
            }}
          >
            <div className="mp-line" style={{ width: "60%", background: contentText, opacity: 0.85 }} />
            <div className="mp-line" style={{ width: "85%", background: contentText, opacity: 0.55 }} />
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
