import { useEffect, useMemo, useRef, useState } from "react";
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
import { ConfirmDialog } from "./Dialog";
import type { Look } from "./LookFields";

function agencyIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path.length > 0 ? path : null;
}

/**
 * Base URL of the GHL app for building "open this sub-account" links. Tries the
 * referring GHL page's origin (works with white-label domains); falls back to
 * the default GHL host.
 */
function ghlBaseUrl(): string {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    /* ignore */
  }
  return "https://app.gohighlevel.com";
}
const GHL_BASE = ghlBaseUrl();

/** How many sub-accounts to show per page in the table. */
const PAGE_SIZE = 25;

/**
 * Build a compact page list: always the first/last page, plus a window around the
 * current one, with "…" gaps so large agencies don't get 40 raw page buttons.
 */
function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

export function App() {
  const agencyId = agencyIdFromUrl();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [defaultTheme, setDefaultTheme] = useState<AgencyDefaultTheme | null>(null);
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null);
  const [editingDefault, setEditingDefault] = useState(false);
  const [showCssExport, setShowCssExport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPresetId, setBulkPresetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!agencyId) {
      setLoading(false);
      return;
    }
    // Load the three resources independently: a failure in a secondary one (presets
    // or the default theme) must not blank out the sub-account list, which is the
    // core of the page. Surface an error only if the essential locations call fails.
    Promise.allSettled([fetchLocations(agencyId), fetchDefaultTheme(agencyId), fetchPresets(agencyId)])
      .then(([locs, def, pre]) => {
        if (locs.status === "fulfilled") {
          setLocations(locs.value);
          setError(null); // clear any stale error once the core list loads
        } else setError(locs.reason?.message ?? "Failed to load sub-accounts.");
        if (def.status === "fulfilled") setDefaultTheme(def.value);
        if (pre.status === "fulfilled") setPresets(pre.value);
      })
      .finally(() => setLoading(false));
  }, [agencyId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((l) =>
      (l.locationName ?? l.ghlLocationId).toLowerCase().includes(q) ||
      l.ghlLocationId.toLowerCase().includes(q)
    );
  }, [locations, search]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Keep the current page in range as the filtered list shrinks/grows.
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount));
  }, [pageCount]);
  // A new search should start from the first page, and drop any selection so a
  // later bulk action can't silently target rows the new filter hides from view.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search]);

  const paged = useMemo(
    () => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visible, page]
  );

  if (!agencyId) {
    return (
      <div className="page">
        <div className="error-banner">Missing agency id in the URL.</div>
      </div>
    );
  }

  async function saveAsPreset(name: string, look: Look, menuOrder: string[]) {
    const p = await createPreset(agencyId!, { name, ...look, menuOrder });
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
    // Optimistic flip, rolled back if the server rejects so the UI never claims a
    // state the DB doesn't have.
    setError(null);
    setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, enabled } : l)));
    try {
      await setEnabled(agencyId!, locId, enabled);
    } catch (e) {
      setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, enabled: !enabled } : l)));
      setError((e as Error).message);
    }
  }

  // window.confirm is a no-op in GHL's cross-origin iframe, so use an in-app dialog.
  function handleReset(locId: string, name: string) {
    setResetTarget({ id: locId, name });
  }

  async function doReset() {
    if (!resetTarget) return;
    const { id: locId } = resetTarget;
    setResetTarget(null);
    setError(null);
    try {
      await resetTheme(agencyId!, locId);
      setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, theme: null } : l)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removePreset(id: string) {
    setError(null);
    try {
      await deletePreset(agencyId!, id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleSelected(locId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(locId) ? next.delete(locId) : next.add(locId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const allVisible = visible.every((l) => prev.has(l.id));
      if (allVisible) return new Set();
      return new Set(visible.map((l) => l.id));
    });
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      await Promise.all([...selected].map((id) => setEnabled(agencyId!, id, enabled)));
      setLocations((prev) => prev.map((l) => (selected.has(l.id) ? { ...l, enabled } : l)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkApply() {
    if (!bulkPresetId || selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      await applyPreset(agencyId!, bulkPresetId, [...selected]);
      const fresh = await fetchLocations(agencyId!);
      setLocations(fresh);
      setSelected(new Set());
      setBulkPresetId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  // Reflect a partial selection (some, not all) with the checkbox's indeterminate dash.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      const some = visible.some((l) => selected.has(l.id));
      selectAllRef.current.indeterminate = some && !allVisibleSelected;
    }
  }, [visible, selected, allVisibleSelected]);

  return (
    <div className="page cp">
      {/* Top bar */}
      <header className="cp-topbar">
        <div className="brand">
          <div className="brand-mark">
            <span /><span /><span /><span />
          </div>
          <div>
            <h1>Mosaic</h1>
            <p className="cp-topbar-sub">Control every sub-account's look from one place</p>
          </div>
        </div>
        <div className="cp-topbar-right">
          <span className="cp-license">Agency workspace</span>
          <button className="btn btn-primary" onClick={() => setShowCssExport(true)}>
            Get embed code
          </button>
        </div>
      </header>

      {/* Hero + search */}
      <section className="cp-hero">
        <h2>Manage sub-account branding with ease</h2>
        <p>A central control panel — colors, logo, fonts, alerts, and more, per client.</p>
        <div className="cp-search">
          <span className="cp-search-icon">⌕</span>
          <input
            placeholder="Search sub-accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </section>

      {/* Action buttons */}
      <div className="cp-actions">
        <button className="pill-btn" disabled={!selected.size || busy} onClick={() => bulkSetEnabled(true)}>
          ✓ Enable selected
        </button>
        <button className="pill-btn" disabled={!selected.size || busy} onClick={() => bulkSetEnabled(false)}>
          ✕ Disable selected
        </button>
        <button className="pill-btn" onClick={() => setEditingDefault(true)}>
          ⚙ Agency default
        </button>
        <div className="pill-apply">
          <select value={bulkPresetId} onChange={(e) => setBulkPresetId(e.target.value)} disabled={!presets.length}>
            <option value="">{presets.length ? "Apply preset…" : "No presets yet"}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="pill-btn pill-btn-solid"
            disabled={!bulkPresetId || !selected.size || busy}
            onClick={handleBulkApply}
          >
            Apply to {selected.size || 0}
          </button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="cp-presets">
          <span className="presets-label">Saved presets</span>
          {presets.map((p) => (
            <span className="preset-chip" key={p.id}>
              <span className="preset-dot" style={{ background: p.primaryColor ?? "#ccc" }} />
              {p.name}
              <button className="preset-remove" onClick={() => removePreset(p.id)} title="Delete preset">
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="error-banner">Error: {error}</div>}

      {/* Table */}
      <div className="card table-card">
        {loading && <div className="empty-state">Loading sub-accounts&hellip;</div>}
        {!loading && !error && locations.length === 0 && (
          <div className="empty-state">No sub-accounts found for this agency yet.</div>
        )}
        {!loading && locations.length > 0 && (
          <div className="table-scroll">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                  </th>
                  <th>Sub-account</th>
                  <th className="col-center">Enabled</th>
                  <th className="col-center">Theme</th>
                  <th className="col-center">Logo</th>
                  <th className="col-center">Alert</th>
                  <th className="col-center">Colors</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paged.map((loc) => {
                  const t = loc.theme;
                  return (
                    <tr key={loc.id} className={selected.has(loc.id) ? "row-selected" : ""}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selected.has(loc.id)}
                          onChange={() => toggleSelected(loc.id)}
                        />
                      </td>
                      <td>
                        <div className="acc-name">
                          {loc.locationName ?? "Untitled"}
                          <a
                            className="acc-open"
                            href={`${GHL_BASE}/v2/location/${loc.ghlLocationId}/dashboard`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open this sub-account in GHL"
                          >
                            ↗
                          </a>
                        </div>
                        <div className="acc-id">{loc.ghlLocationId}</div>
                      </td>
                      <td className="col-center">
                        <label className="toggle" title={loc.enabled ? "Enabled" : "Disabled"}>
                          <input
                            type="checkbox"
                            checked={loc.enabled}
                            onChange={(e) => handleToggle(loc.id, e.target.checked)}
                          />
                          <span className="toggle-track" />
                        </label>
                      </td>
                      <td className="col-center">
                        <button className="cell-btn" onClick={() => setEditingLocation(loc)}>
                          <span className={`status-badge ${t ? "on" : "off"}`}>
                            {t ? t.brandName || "Custom" : "Default"}
                          </span>
                          <span className="cell-gear">⚙</span>
                        </button>
                      </td>
                      <td className="col-center">
                        <button className="cell-btn" onClick={() => setEditingLocation(loc)}>
                          {t?.logoUrl ? (
                            <img className="logo-thumb" src={t.logoUrl} alt="logo" />
                          ) : (
                            <span className="cell-link">↥ Upload</span>
                          )}
                        </button>
                      </td>
                      <td className="col-center">
                        <button className="cell-btn" onClick={() => setEditingLocation(loc)}>
                          <span className={`status-badge ${t?.alertMessage ? "on" : "off"}`}>
                            {t?.alertMessage ? "On" : "—"}
                          </span>
                        </button>
                      </td>
                      <td className="col-center">
                        <div className="swatches">
                          {[t?.primaryColor, t?.accentColor].filter(Boolean).map((c, i) => (
                            <span key={i} className="swatch" style={{ background: c as string }} />
                          ))}
                          {!t && <span className="acc-muted">—</span>}
                        </div>
                      </td>
                      <td className="col-actions">
                        {t && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleReset(loc.id, loc.locationName ?? loc.ghlLocationId)}
                            title="Reset to agency default"
                          >
                            Reset
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={() => setEditingLocation(loc)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && <div className="empty-state">No sub-accounts match “{search}”.</div>}
          </div>
        )}
        {!loading && pageCount > 1 && (
          <div className="cp-pagination">
            <span className="cp-pagination-info">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <div className="cp-pagination-controls">
              <button
                className="pill-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹ Prev
              </button>
              {pageItems(page, pageCount).map((n, i) =>
                n === "…" ? (
                  <span key={`gap-${i}`} className="cp-page-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    className={`pill-btn cp-page-num${n === page ? " cp-page-active" : ""}`}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                className="pill-btn"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>

      {editingLocation && (
        <ThemeEditorModal
          title={`Theme — ${editingLocation.locationName ?? editingLocation.ghlLocationId}`}
          initial={editingLocation.theme}
          showBrandName
          presets={presets}
          agencyId={agencyId!}
          history={{ agencyId: agencyId!, locationInstallId: editingLocation.id }}
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
          isAgencyDefault
          presets={presets}
          agencyId={agencyId!}
          onSave={handleSaveDefault}
          onSaveAsPreset={saveAsPreset}
          onCancel={() => setEditingDefault(false)}
        />
      )}

      {showCssExport && <CssExportModal agencyInstallId={agencyId} onClose={() => setShowCssExport(false)} />}

      {resetTarget && (
        <ConfirmDialog
          title="Reset to agency default?"
          message={`Reset "${resetTarget.name}" back to the agency default look? Its custom theme will be removed.`}
          confirmLabel="Reset"
          danger
          onConfirm={doReset}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}
