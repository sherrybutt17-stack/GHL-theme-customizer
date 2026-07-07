/** The visual "look" a theme, agency-default, or preset can carry. */
export interface Look {
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  gradientEnabled: boolean;
  gradientColor: string;
  gradientAngle: number;
  topBarColor: string;
}

export const GOOGLE_FONTS = [
  "",
  "Inter",
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Lato",
  "Nunito",
  "Raleway",
  "Work Sans",
  "DM Sans",
  "Manrope",
];

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
