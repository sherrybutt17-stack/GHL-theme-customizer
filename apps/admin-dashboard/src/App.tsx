import { useEffect, useState } from "react";
import { fetchLocations, saveTheme, setEnabled, type LocationRow, type ThemeInput } from "./api";
import { ThemeEditorModal } from "./ThemeEditor";
import { CssExportModal } from "./CssExportModal";

function getAgencyInstallIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path.length > 0 ? path : null;
}

export function App() {
  const agencyInstallId = getAgencyInstallIdFromUrl();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null);
  const [showCssExport, setShowCssExport] = useState(false);

  useEffect(() => {
    if (!agencyInstallId) {
      setLoading(false);
      return;
    }
    fetchLocations(agencyInstallId)
      .then(setLocations)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agencyInstallId]);

  if (!agencyInstallId) {
    return (
      <div className="page">
        <div className="error-banner">
          Missing agency install id in the URL. Expected something like{" "}
          <code>http://localhost:5173/&lt;agencyInstallId&gt;</code>.
        </div>
      </div>
    );
  }

  async function handleSaveTheme(locationInstallId: string, theme: ThemeInput) {
    const updated = await saveTheme(agencyInstallId!, locationInstallId, theme);
    setLocations((prev) =>
      prev.map((loc) => (loc.id === locationInstallId ? { ...loc, theme: updated } : loc))
    );
    setEditingLocation(null);
  }

  async function handleToggleEnabled(locationInstallId: string, enabled: boolean) {
    setLocations((prev) =>
      prev.map((loc) => (loc.id === locationInstallId ? { ...loc, enabled } : loc))
    );
    await setEnabled(agencyInstallId!, locationInstallId, enabled);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Mosaic</h1>
          <p>Give every sub-account its own brand — logo, colors, and name.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCssExport(true)}>
          Get embed CSS
        </button>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      <div className="card">
        {loading && <div className="empty-state">Loading sub-accounts&hellip;</div>}
        {!loading && !error && locations.length === 0 && (
          <div className="empty-state">No sub-accounts found for this agency yet.</div>
        )}
        {locations.map((loc) => (
          <div className="location-row" key={loc.id}>
            <div>
              <div className="location-name">{loc.locationName ?? loc.ghlLocationId}</div>
            </div>

            <label className="toggle" title={loc.enabled ? "Enabled" : "Disabled"}>
              <input
                type="checkbox"
                checked={loc.enabled}
                onChange={(e) => handleToggleEnabled(loc.id, e.target.checked)}
              />
              <span className="toggle-track" />
            </label>

            <div className={`brand-name ${loc.theme?.brandName ? "" : "unset"}`}>
              {loc.theme?.brandName || "not set"}
            </div>

            <div className="swatches">
              {[loc.theme?.primaryColor, loc.theme?.secondaryColor, loc.theme?.accentColor]
                .filter(Boolean)
                .map((c, i) => (
                  <span key={i} className="swatch" style={{ background: c as string }} />
                ))}
            </div>

            <button className="btn" onClick={() => setEditingLocation(loc)}>
              Edit theme
            </button>
          </div>
        ))}
      </div>

      {editingLocation && (
        <ThemeEditorModal
          locationName={editingLocation.locationName ?? editingLocation.ghlLocationId}
          initial={editingLocation.theme}
          onCancel={() => setEditingLocation(null)}
          onSave={(theme) => handleSaveTheme(editingLocation.id, theme)}
        />
      )}

      {showCssExport && (
        <CssExportModal agencyInstallId={agencyInstallId} onClose={() => setShowCssExport(false)} />
      )}
    </div>
  );
}
