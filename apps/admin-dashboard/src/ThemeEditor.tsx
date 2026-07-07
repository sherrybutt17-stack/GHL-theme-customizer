import { useEffect, useState } from "react";
import {
  fetchSidebarFeatures,
  type SidebarFeature,
  type ThemeInput,
  type ThemePreset,
  type VisualTheme,
} from "./api";
import { LookFields, type Look } from "./LookFields";

interface Props {
  title: string;
  initial: (Partial<VisualTheme> & { brandName?: string | null }) | null;
  showBrandName: boolean;
  presets: ThemePreset[];
  onSave: (theme: ThemeInput) => Promise<void>;
  onSaveAsPreset: (name: string, look: Look) => Promise<void>;
  onCancel: () => void;
}

function lookFrom(initial: Props["initial"]): Look {
  return {
    primaryColor: initial?.primaryColor ?? "#4f46e5",
    accentColor: initial?.accentColor ?? "#f59e0b",
    fontFamily: initial?.fontFamily ?? "",
    gradientEnabled: initial?.gradientEnabled ?? false,
    gradientColor: initial?.gradientColor ?? "#1e293b",
    gradientAngle: initial?.gradientAngle ?? 135,
    topBarColor: initial?.topBarColor ?? "#ffffff",
  };
}

export function ThemeEditorModal({
  title,
  initial,
  showBrandName,
  presets,
  onSave,
  onSaveAsPreset,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<"branding" | "features">("branding");
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [look, setLook] = useState<Look>(lookFrom(initial));
  const [hidden, setHidden] = useState<Set<string>>(new Set(initial?.hiddenFeatures ?? []));
  const [labels, setLabels] = useState<Record<string, string>>(initial?.menuLabelOverrides ?? {});
  const [features, setFeatures] = useState<SidebarFeature[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSidebarFeatures().then(setFeatures);
  }, []);

  const patchLook = (p: Partial<Look>) => setLook((l) => ({ ...l, ...p }));

  function applyPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setLook({
      primaryColor: p.primaryColor ?? look.primaryColor,
      accentColor: p.accentColor ?? look.accentColor,
      fontFamily: p.fontFamily ?? "",
      gradientEnabled: p.gradientEnabled,
      gradientColor: p.gradientColor ?? "#1e293b",
      gradientAngle: p.gradientAngle,
      topBarColor: p.topBarColor ?? "#ffffff",
    });
  }

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
        ...(showBrandName ? { brandName } : {}),
        logoUrl,
        primaryColor: look.primaryColor,
        secondaryColor: look.primaryColor,
        accentColor: look.accentColor,
        fontFamily: look.fontFamily,
        gradientEnabled: look.gradientEnabled,
        gradientColor: look.gradientColor,
        gradientAngle: look.gradientAngle,
        topBarColor: look.topBarColor === "#ffffff" ? "" : look.topBarColor,
        hiddenFeatures: [...hidden],
        menuLabelOverrides: cleanedLabels,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAsPreset() {
    const name = prompt("Name this preset (e.g. “Dark Gold”):");
    if (!name) return;
    await onSaveAsPreset(name, look);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onCancel} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "branding" ? "active" : ""}`} onClick={() => setTab("branding")}>
            Branding &amp; colors
          </button>
          <button className={`tab ${tab === "features" ? "active" : ""}`} onClick={() => setTab("features")}>
            Menu &amp; features
          </button>
        </div>

        <div className="modal-body">
          {tab === "branding" && (
            <>
              {presets.length > 0 && (
                <div className="preset-apply">
                  <label>Start from a preset</label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      applyPreset(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="" disabled>
                      Choose a preset…
                    </option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showBrandName && (
                <div className="field">
                  <label>Brand name</label>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Acme Marketing"
                  />
                </div>
              )}

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

              <LookFields value={look} onChange={patchLook} />

              <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={handleSaveAsPreset}>
                + Save this look as a preset
              </button>
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
