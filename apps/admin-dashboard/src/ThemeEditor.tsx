import { useState } from "react";
import type { ThemeConfig, ThemeInput } from "./api";

interface Props {
  locationName: string;
  initial: ThemeConfig | null;
  onSave: (theme: ThemeInput) => Promise<void>;
  onCancel: () => void;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="color-field">
      <label>{label}</label>
      <input
        type="color"
        className="color-swatch-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="color-hex">{value}</div>
    </div>
  );
}

export function ThemeEditorModal({ locationName, initial, onSave, onCancel }: Props) {
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? "#4f46e5");
  const [secondaryColor, setSecondaryColor] = useState(initial?.secondaryColor ?? "#64748b");
  const [accentColor, setAccentColor] = useState(initial?.accentColor ?? "#f59e0b");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ brandName, logoUrl, primaryColor, secondaryColor, accentColor });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit theme &mdash; {locationName}</h2>
          <button className="btn btn-ghost" onClick={onCancel} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Brand name</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="e.g. Acme Marketing"
            />
          </div>

          <div className="field">
            <label>Logo URL</label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
            />
            {logoUrl && (
              <div className="logo-preview" style={{ marginTop: 8 }}>
                <img src={logoUrl} alt="logo preview" />
                <span>Preview</span>
              </div>
            )}
          </div>

          <div className="field">
            <label>Colors</label>
            <div className="color-fields">
              <ColorField label="Primary" value={primaryColor} onChange={setPrimaryColor} />
              <ColorField label="Secondary" value={secondaryColor} onChange={setSecondaryColor} />
              <ColorField label="Accent" value={accentColor} onChange={setAccentColor} />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
