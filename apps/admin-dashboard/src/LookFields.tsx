import { useEffect } from "react";
import { suggestGradients, suggestAccents } from "./colorUtils";

/** The visual "look" a theme, agency-default, or preset can carry. */
export interface Look {
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  gradientEnabled: boolean;
  gradientColor: string;
  gradientAngle: number;
  topBarColor: string;
  buttonColor: string;
  cornerRadius: number;
  scrollbarColor: string;
  sidebarTextColor: string;
  contentBgColor: string;
  contentTextColor: string;
  buttonShape: string;
  darkMode: boolean;
}

export const GOOGLE_FONTS = [
  "",
  // Sans-serif — modern / geometric
  "Inter",
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Lato",
  "Nunito",
  "Nunito Sans",
  "Raleway",
  "Work Sans",
  "DM Sans",
  "Manrope",
  "Rubik",
  "Mulish",
  "Karla",
  "Sora",
  "Space Grotesk",
  "Plus Jakarta Sans",
  "Figtree",
  "Outfit",
  "Quicksand",
  "Barlow",
  "Source Sans 3",
  "PT Sans",
  "Josefin Sans",
  // Serif / display
  "Playfair Display",
  "Merriweather",
  "Roboto Slab",
  "Lora",
  "Bricolage Grotesque",
];

// Fonts already loaded by index.html; everything else is fetched on demand the
// first time it's previewed so the editor sample matches what GHL will render.
const PRELOADED_FONTS = new Set(["Inter"]);
const loadedFonts = new Set<string>();

/** Inject a Google Fonts stylesheet for `family` once, so the preview renders it. */
function ensureFontLoaded(family: string) {
  if (!family || PRELOADED_FONTS.has(family) || loadedFonts.has(family)) return;
  if (typeof document === "undefined") return;
  loadedFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function ColorRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="look-color-row">
      <input
        type="color"
        className="look-swatch"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="look-color-meta">
        <div className="look-color-label">{label}</div>
        <div className="look-color-hint">{hint}</div>
      </div>
      <code className="look-hex">{value}</code>
    </div>
  );
}

export function LookFields({ value, onChange }: { value: Look; onChange: (patch: Partial<Look>) => void }) {
  // Load the picked font so the editor preview matches what GHL will render.
  useEffect(() => {
    ensureFontLoaded(value.fontFamily);
  }, [value.fontFamily]);

  return (
    <div className="look-fields">
      <ColorRow
        label="Primary — sidebar background"
        hint="The main color of the left navigation."
        value={value.primaryColor}
        onChange={(v) => onChange({ primaryColor: v })}
      />
      <ColorRow
        label="Accent — active item & icons"
        hint="Highlights the current page and the menu icons."
        value={value.accentColor}
        onChange={(v) => onChange({ accentColor: v })}
      />

      {/* Auto-suggestions derived from the primary color */}
      <div className="color-suggest">
        <div className="suggest-label">Suggested gradients — click to apply</div>
        <div className="suggest-row">
          {suggestGradients(value.primaryColor).map((g) => (
            <button
              key={g.label}
              type="button"
              className="suggest-grad"
              title={`${g.label} (${g.from} → ${g.to})`}
              style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
              onClick={() =>
                onChange({ gradientEnabled: true, gradientColor: g.to, gradientAngle: g.angle })
              }
            >
              <span>{g.label}</span>
            </button>
          ))}
        </div>
        <div className="suggest-label">Suggested accents — click to apply</div>
        <div className="suggest-row">
          {suggestAccents(value.primaryColor).map((c) => (
            <button
              key={c}
              type="button"
              className="suggest-swatch"
              title={c}
              style={{ background: c }}
              onClick={() => onChange({ accentColor: c })}
            />
          ))}
        </div>
      </div>

      <div className="look-toggle-row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={value.gradientEnabled}
            onChange={(e) => onChange({ gradientEnabled: e.target.checked })}
          />
          <span className="toggle-track" />
        </label>
        <div>
          <div className="look-color-label">Gradient sidebar</div>
          <div className="look-color-hint">Blend the sidebar from Primary into a second color.</div>
        </div>
      </div>

      {value.gradientEnabled && (
        <div className="look-gradient-detail">
          <ColorRow
            label="Gradient end color"
            hint="Primary fades into this."
            value={value.gradientColor || "#000000"}
            onChange={(v) => onChange({ gradientColor: v })}
          />
          <div className="look-angle">
            <label>Angle: {value.gradientAngle}&deg;</label>
            <input
              type="range"
              min={0}
              max={360}
              value={value.gradientAngle}
              onChange={(e) => onChange({ gradientAngle: Number(e.target.value) })}
            />
          </div>
          <div
            className="look-gradient-preview"
            style={{
              background: `linear-gradient(${value.gradientAngle}deg, ${value.primaryColor}, ${
                value.gradientColor || "#000"
              })`,
            }}
          />
        </div>
      )}

      <ColorRow
        label="Top bar — header background"
        hint="The bar across the top (Ask AI, notifications). Leave default to skip."
        value={value.topBarColor || "#ffffff"}
        onChange={(v) => onChange({ topBarColor: v })}
      />

      <ColorRow
        label="Buttons — primary action color"
        hint="Save / Add / primary buttons throughout the UI."
        value={value.buttonColor || "#4f46e5"}
        onChange={(v) => onChange({ buttonColor: v })}
      />

      <ColorRow
        label="Scrollbar"
        hint="The draggable scrollbar thumb color."
        value={value.scrollbarColor || "#94a3b8"}
        onChange={(v) => onChange({ scrollbarColor: v })}
      />

      <ColorRow
        label="Sidebar menu text"
        hint="Color of the sidebar menu labels. Pick a dark color if you use a light sidebar background."
        value={value.sidebarTextColor || "#ffffff"}
        onChange={(v) => onChange({ sidebarTextColor: v })}
      />

      <ColorRow
        label="Content background"
        hint="Background of the main content area + cards (Dashboard, lists). Text auto-adjusts to stay readable. Leave default to skip."
        value={value.contentBgColor || "#0f172a"}
        onChange={(v) => onChange({ contentBgColor: v })}
      />

      <ColorRow
        label="Content text"
        hint="Overrides the content text color. Leave default to let it auto-pick based on the background."
        value={value.contentTextColor || "#e2e8f0"}
        onChange={(v) => onChange({ contentTextColor: v })}
      />

      <div className="look-angle">
        <label>Corner radius: {value.cornerRadius}px</label>
        <input
          type="range"
          min={0}
          max={24}
          value={value.cornerRadius}
          onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
        />
        <div className="look-color-hint">Roundness of buttons, cards, and inputs. 0 = sharp corners.</div>
      </div>

      <div className="field">
        <label>Button shape</label>
        <select
          className="look-select"
          value={value.buttonShape || ""}
          onChange={(e) => onChange({ buttonShape: e.target.value })}
        >
          <option value="">Default (follow corner radius)</option>
          <option value="square">Square — sharp corners</option>
          <option value="rounded">Rounded — soft corners</option>
          <option value="pill">Pill — fully rounded</option>
        </select>
        <div className="look-color-hint">Overrides the shape of buttons specifically.</div>
      </div>

      <div className="field">
        <label>Font</label>
        <select
          className="look-select"
          value={value.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          {GOOGLE_FONTS.map((f) => (
            <option key={f} value={f}>
              {f === "" ? "Default (GHL font)" : f}
            </option>
          ))}
        </select>
        {value.fontFamily && (
          <div style={{ fontFamily: `'${value.fontFamily}', sans-serif`, marginTop: 8, fontSize: 15 }}>
            The quick brown fox &mdash; {value.fontFamily}
          </div>
        )}
      </div>
    </div>
  );
}
