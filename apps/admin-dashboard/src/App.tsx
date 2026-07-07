import { useEffect, useState } from "react";
import {
  applyPreset,
  createPreset,
  deletePreset,
  fetchDefaultTheme,
  fetchLocations,
  fetchPresets,
  resetTheme,
  saveDefaultTheme,
  saveTheme,
  setEnabled,
  type AgencyDefaultTheme,
  type LocationRow,
  type ThemeInput,
  type ThemePreset,
} from "./api";
import { ThemeEditorModal } from "./ThemeEditor";
import { CssExportModal } from "./CssExportModal";
import type { Look } from "./LookFields";

function agencyIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path.length > 0 ? path : null;
}

export function App() {
  const agencyId = agencyIdFromUrl();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [defaultTheme, setDefaultTheme] = useState<AgencyDefaultTheme | null>(null);
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null);
  const [editingDefault, setEditingDefault] = useState(false);
  const [showCssExport, setShowCssExport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPresetId, setBulkPresetId] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!agencyId) {
      setLoading(false);
      return;
    }
    Promise.all([fetchLocations(agencyId), fetchDefaultTheme(agencyId), fetchPresets(agencyId)])
      .then(([locs, def, pre]) => {
        setLocations(locs);
        setDefaultTheme(def);
        setPresets(pre);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agencyId]);

  if (!agencyId) {
    return (
      <div className="page">
        <div className="error-banner">Missing agency id in the URL.</div>
      </div>
    );
  }

  async function saveAsPreset(name: string, look: Look) {
    const p = await createPreset(agencyId!, { name, ...look });
    setPresets((prev) => [...prev, p]);
  }

  async function handleSaveLocation(locId: string, theme: ThemeInput) {
    const updated = await saveTheme(agencyId!, locId, theme);
    setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, theme: updated } : l)));
    setEditingLocation(null);
  }

  async function handleSaveDefault(theme: ThemeInput) {
    const updated = await saveDefaultTheme(agencyId!, theme);
    setDefaultTheme(updated);
    setEditingDefault(false);
  }

  async function handleToggle(locId: string, enabled: boolean) {
    setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, enabled } : l)));
    await setEnabled(agencyId!, locId, enabled);
  }

  async function handleReset(locId: string, name: string) {
    if (!confirm(`Reset "${name}" back to the agency default look? Its custom theme will be removed.`)) return;
    await resetTheme(agencyId!, locId);
    setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, theme: null } : l)));
  }

  async function removePreset(id: string) {
    await deletePreset(agencyId!, id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  function toggleSelected(locId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(locId) ? next.delete(locId) : next.add(locId);
      return next;
    });
  }

  async function handleBulkApply() {
    if (!bulkPresetId || selected.size === 0) return;
    setApplying(true);
    try {
      await applyPreset(agencyId!, bulkPresetId, [...selected]);
      const fresh = await fetchLocations(agencyId!);
      setLocations(fresh);
      setSelected(new Set());
      setBulkPresetId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span /><span /><span /><span />
          </div>
          <div>
            <h1>Mosaic</h1>
            <p>Give every sub-account its own brand.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => setEditingDefault(true)}>
            Agency default
          </button>
          <button className="btn btn-primary" onClick={() => setShowCssExport(true)}>
            Get embed code
          </button>
        </div>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      {presets.length > 0 && (
        <div className="presets-bar">
          <span className="presets-label">Presets</span>
          {presets.map((p) => (
            <span className="preset-chip" key={p.id}>
              <span
                className="preset-dot"
                style={{ background: p.primaryColor ?? "#ccc" }}
              />
              {p.name}
              <button className="preset-remove" onClick={() => removePreset(p.id)} title="Delete preset">
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">
          Sub-accounts
          <span className="card-subtitle">
            {defaultTheme
              ? "Each inherits your agency default unless given its own theme below."
              : "Set an Agency default for a baseline look, or theme each individually."}
          </span>
        </div>

        {loading && <div className="empty-state">Loading sub-accounts&hellip;</div>}
        {!loading && !error && locations.length === 0 && (
          <div className="empty-state">No sub-accounts found for this agency yet.</div>
        )}

        {selected.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selected.size} selected</span>
            <select value={bulkPresetId} onChange={(e) => setBulkPresetId(e.target.value)}>
              <option value="" disabled>
                {presets.length ? "Apply preset…" : "No presets saved yet"}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={!bulkPresetId || applying}
              onClick={handleBulkApply}
            >
              {applying ? "Applying…" : `Apply to ${selected.size}`}
            </button>
            <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {locations.map((loc) => (
          <div className="location-row" key={loc.id}>
            <input
              type="checkbox"
              className="location-select"
              checked={selected.has(loc.id)}
              onChange={() => toggleSelected(loc.id)}
              title="Select for bulk preset apply"
            />
            <div className="location-name">{loc.locationName ?? loc.ghlLocationId}</div>

            <label className="toggle" title={loc.enabled ? "Enabled" : "Disabled"}>
              <input type="checkbox" checked={loc.enabled} onChange={(e) => handleToggle(loc.id, e.target.checked)} />
              <span className="toggle-track" />
            </label>

            <div className={`brand-name ${loc.theme ? "" : "unset"}`}>
              {loc.theme ? loc.theme.brandName || "Custom theme" : "Inherits default"}
            </div>

            <div className="swatches">
              {[loc.theme?.primaryColor, loc.theme?.accentColor].filter(Boolean).map((c, i) => (
                <span key={i} className="swatch" style={{ background: c as string }} />
              ))}
            </div>

            <div className="row-actions">
              {loc.theme && (
                <button
                  className="btn btn-ghost"
                  onClick={() => handleReset(loc.id, loc.locationName ?? loc.ghlLocationId)}
                  title="Remove this sub-account's custom theme and inherit the agency default"
                >
                  Reset
                </button>
              )}
              <button className="btn" onClick={() => setEditingLocation(loc)}>
                Edit theme
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingLocation && (
        <ThemeEditorModal
          title={`Theme — ${editingLocation.locationName ?? editingLocation.ghlLocationId}`}
          initial={editingLocation.theme}
          showBrandName
          presets={presets}
          onSave={(t) => handleSaveLocation(editingLocation.id, t)}
          onSaveAsPreset={saveAsPreset}
          onCancel={() => setEditingLocation(null)}
        />
      )}

      {editingDefault && (
        <ThemeEditorModal
          title="Agency default theme"
          initial={defaultTheme}
          showBrandName={false}
          presets={presets}
          onSave={handleSaveDefault}
          onSaveAsPreset={saveAsPreset}
          onCancel={() => setEditingDefault(false)}
        />
      )}

      {showCssExport && <CssExportModal agencyInstallId={agencyId} onClose={() => setShowCssExport(false)} />}
    </div>
  );
}
