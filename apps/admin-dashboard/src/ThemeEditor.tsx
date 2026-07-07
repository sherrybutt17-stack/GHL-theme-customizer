import { useEffect, useState } from "react";
import { fetchSidebarFeatures, type SidebarFeature, type ThemeConfig, type ThemeInput } from "./api";

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
  const [tab, setTab] = useState<"branding" | "features">("branding");
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? "#4f46e5");
  const [secondaryColor, setSecondaryColor] = useState(initial?.secondaryColor ?? "#64748b");
  const [accentColor, setAccentColor] = useState(initial?.accentColor ?? "#f59e0b");
  const [hidden, setHidden] = useState<Set<string>>(new Set(initial?.hiddenFeatures ?? []));
  const [labels, setLabels] = useState<Record<string, string>>(initial?.menuLabelOverrides ?? {});
  const [features, setFeatures] = useState<SidebarFeature[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSidebarFeatures().then(setFeatures);
  }, []);

  function toggleHidden(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const cleanedLabels = Object.fromEntries(
        Object.entries(labels).filter(([, v]) => v && v.trim())
      );
      await onSave({
        brandName,
        logoUrl,
        primaryColor,
        secondaryColor,
        accentColor,
        hiddenFeatures: [...hidden],
        menuLabelOverrides: cleanedLabels,
      });
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

        <div className="tabs">
          <button
            className={`tab ${tab === "branding" ? "active" : ""}`}
            onClick={() => setTab("branding")}
          >
            Branding
          </button>
          <button
            className={`tab ${tab === "features" ? "active" : ""}`}
            onClick={() => setTab("features")}
          >
            Menu &amp; features
          </button>
        </div>

        <div className="modal-body">
          {tab === "branding" && (
            <>
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
            </>
          )}

          {tab === "features" && (
            <div className="field">
              <label>Sidebar menu items</label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Hide items this client shouldn't see, or rename them.
              </p>
              <div className="feature-list">
                {features.map((f) => {
                  const isHidden = hidden.has(f.key);
                  return (
                    <div className="feature-row" key={f.key}>
                      <span className={`feature-name ${isHidden ? "hidden" : ""}`}>{f.label}</span>
                      <input
                        className="feature-rename"
                        placeholder="Rename…"
                        value={labels[f.key] ?? ""}
                        disabled={isHidden}
                        onChange={(e) => setLabels((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                      <button
                        className={`btn ${isHidden ? "" : "btn-ghost"}`}
                        onClick={() => toggleHidden(f.key)}
                        title={isHidden ? "Hidden — click to show" : "Visible — click to hide"}
                      >
                        {isHidden ? "Hidden" : "Visible"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
