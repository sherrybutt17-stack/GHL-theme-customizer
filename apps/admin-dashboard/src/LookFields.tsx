import { useEffect } from "react";
import { suggestGradients, suggestAccents } from "./colorUtils";
import { DARK_CONTENT_BG } from "./themeDefaults";

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
  sidebarIconColor: string;
  buttonShape: string;
  darkMode: boolean;
  contentBgColor: string;
  contentTextColor: string;
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

/**
 * One colour control.
 *
 * `unsetPlaceholder` makes the row able to say NOTHING IS CHOSEN, which an
 * `<input type="color">` cannot express on its own — it always renders some swatch, so a
 * field nobody has set looks byte for byte like one somebody picked. Every row here except
 * the icons is materialised by `lookFrom`, so only that one can be empty; the option exists
 * because the next unset field would otherwise borrow a colour too.
 *
 * The login tab's `LoginColorRow` in ThemeEditor.tsx is the twin of this, built for the same
 * reason on 2026-08-25 and kept separate only because those rows carry per-field
 * placeholders. If a third one appears, make it one component.
 */
function ColorRow({
  label,
  hint,
  value,
  unsetPlaceholder,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  /** When given, an empty `value` means "not set" rather than "this colour". */
  unsetPlaceholder?: string;
  onChange: (v: string) => void;
}) {
  const unset = unsetPlaceholder !== undefined && !value;
  return (
    <div className="look-color-row">
      <input
        type="color"
        className={`look-swatch${unset ? " look-swatch-unset" : ""}`}
        value={value || unsetPlaceholder || "#000000"}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="look-color-meta">
        <div className="look-color-label">{label}</div>
        <div className="look-color-hint">{hint}</div>
      </div>
      <code className="look-hex">{unset ? "not set" : value}</code>
      {unsetPlaceholder !== undefined && value && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange("")}>
          Clear
        </button>
      )}
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

      {/*
        This row used to borrow the accent colour for its swatch under a hint promising the
        icons "default to the accent color". The stylesheet has no such fallback — it emits
        an icon rule ONLY when this field is set — so the swatch showed a colour the icons
        were not, the hex under it named that colour, and saving never made it true, because
        the field stays empty through a save. Both halves said the work was already done.
      */}
      <ColorRow
        label="Sidebar icons"
        hint="Color of the menu icons. Left unset, they keep the colours they came with."
        value={value.sidebarIconColor}
        unsetPlaceholder={value.accentColor || "#f59e0b"}
        onChange={(v) => onChange({ sidebarIconColor: v })}
      />

      {/*
        THE CONTENT AREA. Three columns carried this since the schema was written and
        rendered nothing: `contentBgColor` and `contentTextColor` existed nowhere outside
        `schema.prisma`, and `darkMode` was accepted by the PUT, stored on all three
        models, carried through presets and threaded into this very `Look` — with no
        control anywhere and not one line of the stylesheet reading it. `audit-fields.js`
        reported all three every run.

        The hint says what it paints and what it does not, because this is the one theme
        field whose selector is not confirmed against live GHL DOM. If GHL wraps its
        screens in a container we do not name, setting a colour here does nothing — which
        the agency will see immediately, and can clear.
      */}
      <div className="look-toggle-row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={value.darkMode}
            onChange={(e) => onChange({ darkMode: e.target.checked })}
          />
          <span className="toggle-track" />
        </label>
        <div>
          <div className="look-color-label">Dark content area</div>
          <div className="look-color-hint">
            A dark canvas behind the platform's own screens. Cards and tables keep their
            own background, so this frames them rather than inverting them.
          </div>
        </div>
      </div>

      <ColorRow
        label="Content background"
        hint="The page behind the screens, not the sidebar or top bar. Left unset, it stays as it comes."
        value={value.contentBgColor}
        unsetPlaceholder={value.darkMode ? DARK_CONTENT_BG : "#f8fafc"}
        onChange={(v) => onChange({ contentBgColor: v })}
      />

      <ColorRow
        label="Content text"
        hint="Body copy on the canvas. It also inherits into cards and tables, which keep their own background — so pick one that suits those too."
        value={value.contentTextColor}
        unsetPlaceholder="#1f2937"
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
