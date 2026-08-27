import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyPreset,
  createPreset,
  deletePreset,
  fetchDefaultTheme,
  fetchLocations,
  fetchPresets,
  resetTheme,
  resetDefaultTheme,
  restoreDefaultThemeVersion,
  saveDefaultTheme,
  saveTheme,
  setEnabled,
  fetchSupportConfig,
  saveSupportConfig,
  setSupportEnabled,
  type AgencyDefaultTheme,
  type LocationRow,
  type SupportConfig,
  sessionExpiresAt,
  SESSION_EXPIRED_MESSAGE,
  type ThemeInput,
  type ThemePreset,
} from "./api";
import { summariseBulk } from "./bulkEnableLogic";
import { ThemeEditorModal } from "./ThemeEditor";
import { CssExportModal } from "./CssExportModal";
import { SupportSettingsModal } from "./SupportSettings";
import { BulkBrandModal } from "./BulkBrand";
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
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string; versions: number } | null>(null);
  const [resettingDefault, setResettingDefault] = useState(false);
  const [deletingPreset, setDeletingPreset] = useState<{ id: string; name: string } | null>(null);
  const [confirmDisableAll, setConfirmDisableAll] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null);
  const [editingDefault, setEditingDefault] = useState(false);
  const [showCssExport, setShowCssExport] = useState(false);
  const [showBulkBrand, setShowBulkBrand] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // Only the master switch is needed out here — it decides whether the per-row
  // support toggles do anything, so the row UI can say so instead of lying.
  const [supportOn, setSupportOn] = useState(false);
  // The whole config, not just the switch: the Plan column saves through the
  // support PUT, which clears any field it is not sent.
  const [supportConfig, setSupportConfig] = useState<SupportConfig | null>(null);
  /** Secondary resources that did not load. Empty is the normal case. */
  const [partialLoad, setPartialLoad] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPresetId, setBulkPresetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sessionDead, setSessionDead] = useState(false);

  /**
   * Watch our own session deadline.
   *
   * The token lasts 8 hours and this dashboard lives in a GHL tab people leave open, so
   * "come back the next morning and save" is the NORMAL way to meet this — not an edge
   * case. Before, the first sign was `Error: Missing or invalid dashboard token` after
   * clicking Save, in the same banner as every network hiccup, with the work already done.
   *
   * The expiry is plaintext inside the token (`agencyId.exp.sig`), so we can watch the
   * clock without the signing key. A null expiry means "unknown" and is deliberately NOT
   * treated as expired — with DASHBOARD_AUTH_ENABLED off there is no token at all, and
   * locking a dev session out of a working API would be a worse bug than the one this
   * fixes. The server remains the only thing that decides.
   */
  useEffect(() => {
    const expiresAt = sessionExpiresAt();
    if (expiresAt === null) return;
    const fire = () => setSessionDead(true);
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      fire();
      return;
    }
    // setTimeout clamps above ~24.8 days; the 8h TTL is far inside that.
    const timer = setTimeout(fire, remaining);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!agencyId) {
      setLoading(false);
      return;
    }
    /**
     * Load the four resources independently: a failure in a secondary one (presets, the
     * default theme, support) must not blank out the sub-account list, which is the core
     * of the page.
     *
     * That reasoning is right and it used to stop one step short — "surface an error only
     * if the essential locations call fails" — so the other three failed in COMPLETE
     * SILENCE. Measured, by blocking each endpoint and rendering: with the agency default,
     * the presets, or the support config failing, the page is indistinguishable from a
     * healthy one. Not blanking the page and not mentioning it are different decisions,
     * and only the first one was made.
     *
     * What each silence says, in the agency's words rather than ours:
     *   - the default theme reads as "you have never set one", and its editor then opens
     *     as if there were nothing there. A save from that state writes over a real
     *     agency-wide theme — recoverable, because `AgencyDefaultThemeVersion` snapshots
     *     before every save, but not something to discover afterwards.
     *   - the presets read as "you have no presets".
     *   - support reads as OFF, because `supportOn` starts false — a false statement about
     *     a switch that decides whether the widget appears in front of their clients.
     */
    Promise.allSettled([
      fetchLocations(agencyId),
      fetchDefaultTheme(agencyId),
      fetchPresets(agencyId),
      fetchSupportConfig(agencyId),
    ])
      .then(([locs, def, pre, sup]) => {
        if (locs.status === "fulfilled") {
          setLocations(locs.value);
          setError(null); // clear any stale error once the core list loads
        } else setError(locs.reason?.message ?? "Failed to load sub-accounts.");
        if (def.status === "fulfilled") setDefaultTheme(def.value);
        if (pre.status === "fulfilled") setPresets(pre.value);
        if (sup.status === "fulfilled") {
          setSupportOn(sup.value.config.enabled);
          setSupportConfig(sup.value.config);
        }
        // Named by what the reader would look for, not by the endpoint that failed.
        const missing: string[] = [];
        if (def.status === "rejected") missing.push("your agency default theme");
        if (pre.status === "rejected") missing.push("your saved presets");
        if (sup.status === "rejected") missing.push("your client support settings");
        setPartialLoad(missing);
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

  /**
   * Closes the editor on success so the restored look is visible immediately in the
   * table and the preview — leaving it open would show the pre-restore state in every
   * field, which reads as "the restore didn't work".
   */
  async function handleRestoreDefaultVersion(versionId: string) {
    setError(null);
    try {
      setDefaultTheme(await restoreDefaultThemeVersion(agencyId!, versionId));
      setEditingDefault(false);
    } catch (e) {
      setError((e as Error).message);
    }
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

  async function handleSupportToggle(locId: string, supportEnabled: boolean) {
    setError(null);
    setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, supportEnabled } : l)));
    try {
      await setSupportEnabled(agencyId!, locId, supportEnabled);
    } catch (e) {
      setLocations((prev) => prev.map((l) => (l.id === locId ? { ...l, supportEnabled: !supportEnabled } : l)));
      setError((e as Error).message);
    }
  }

  function handleSupportSaved(config: SupportConfig) {
    setSupportOn(config.enabled);
    setSupportConfig(config);
  }

  /**
   * What this client actually bought, so the bot can say "isn't included on your Starter
   * plan" instead of the vaguer "isn't part of your setup".
   *
   * It lives on `SupportConfig.planTiers` — one `{ locationInstallId: plan }` map for the
   * whole agency — but it is a per-sub-account fact, exactly like the Support toggle it
   * sits beside, so it belongs in the row rather than behind a modal.
   *
   * SAVED ON BLUR, never per keystroke: each save is a PUT of the entire support config,
   * so typing "Starter" would otherwise be seven round trips of the agency's whole policy.
   */
  async function handlePlanChange(locId: string, plan: string) {
    const cfg = supportConfig;
    /**
     * REFUSE rather than save a partial object. The support PUT is whole-object — it
     * clears any field it is not sent — so PUTting without the loaded config would wipe
     * the greeting, the blocked terms, the response targets and the hours. The config
     * load is deliberately allowed to fail without blanking this page (see the
     * allSettled above), which is exactly how we would get here with nothing loaded.
     */
    if (!cfg) {
      setError("Couldn't load your support settings, so plan names can't be saved right now. Reload and try again.");
      return;
    }
    const trimmed = plan.trim().slice(0, 60);
    const current = cfg.planTiers ?? {};
    if ((current[locId] ?? "") === trimmed) return;

    const next = { ...current };
    if (trimmed) next[locId] = trimmed;
    else delete next[locId];

    setError(null);
    setSupportConfig({ ...cfg, planTiers: next });
    try {
      const saved = await saveSupportConfig(agencyId!, { ...cfg, planTiers: next });
      setSupportConfig(saved);
    } catch (e) {
      setSupportConfig(cfg);
      setError((e as Error).message);
    }
  }

  // window.confirm is a no-op in GHL's cross-origin iframe, so use an in-app dialog.
  function handleReset(locId: string, name: string, versions: number) {
    setResetTarget({ id: locId, name, versions });
  }

  async function doReset() {
    if (!resetTarget) return;
    const { id: locId } = resetTarget;
    setResetTarget(null);
    setError(null);
    try {
      await resetTheme(agencyId!, locId);
      // `themeVersions` back to 0 as well, or a second Reset on the same row would still
      // offer to delete the history it just deleted.
      setLocations((prev) =>
        prev.map((l) => (l.id === locId ? { ...l, theme: null, themeVersions: 0 } : l))
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function doResetDefault() {
    setResettingDefault(false);
    setError(null);
    try {
      await resetDefaultTheme(agencyId!);
      setDefaultTheme(null);
      setEditingDefault(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /**
   * Asked first, like every other destructive action on this screen. Presets are NOT
   * versioned — unlike a sub-account theme, which has a History tab — so this is the one
   * thing here that cannot be undone, and it was the only one triggered by a bare click
   * on a small × with no prompt at all.
   */
  async function doRemovePreset() {
    const target = deletingPreset;
    setDeletingPreset(null);
    if (!target) return;
    setError(null);
    try {
      await deletePreset(agencyId!, target.id);
      setPresets((prev) => prev.filter((p) => p.id !== target.id));
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

  /**
   * Turn branding on or off for every selected sub-account.
   *
   * `Promise.allSettled`, not `Promise.all`, and then a REFETCH. With `all`, the first
   * rejection skipped the local state update entirely while the other requests carried on
   * committing — so the table showed nothing changed and the database had changed most of
   * them. `handleBulkApply` directly below already refetched for exactly this reason; this
   * one did not, and the two are twenty lines apart.
   *
   * The count is reported honestly rather than as a single pass/fail: "38 of 41" is
   * something the agency can act on, and re-running it for the three that failed is safe.
   */
  async function bulkSetEnabled(enabled: boolean) {
    if (selected.size === 0) return;
    setError(null);
    setBusy(true);
    const ids = [...selected];
    try {
      const results = await Promise.allSettled(ids.map((id) => setEnabled(agencyId!, id, enabled)));
      // The server is the truth either way, so ask it rather than patching rows locally
      // from an outcome that was only partly ours.
      setLocations(await fetchLocations(agencyId!));
      const { message } = summariseBulk(results as { status: "fulfilled" | "rejected"; reason?: { message?: string } }[]);
      if (message) setError(message);
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

  /** How many menu items the chosen preset would reorder — 0 when it carries no order. */
  const bulkOrderCount = (() => {
    const p = presets.find((x) => x.id === bulkPresetId);
    return Array.isArray(p?.menuOrder) ? p!.menuOrder.length : 0;
  })();

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
        {/*
          The COUNT is on the button, because "select all" spans every filtered page, not
          just the 25 on screen: on a 41-sub-account agency you can be looking at 25 rows
          with 41 selected. "Apply to N" already said so; these two said only "selected".
        */}
        <button className="pill-btn" disabled={!selected.size || busy} onClick={() => bulkSetEnabled(true)}>
          ✓ Enable {selected.size || ""}
        </button>
        <button
          className="pill-btn"
          disabled={!selected.size || busy}
          // Asked first, unlike enabling: this is the direction that takes branding away
          // from live clients, and it is visible in their CRM on the next page load.
          onClick={() => setConfirmDisableAll(true)}
        >
          ✕ Disable {selected.size || ""}
        </button>
        <button className="pill-btn" onClick={() => setEditingDefault(true)}>
          ⚙ Agency default
        </button>
        <button className="pill-btn" onClick={() => setShowBulkBrand(true)}>
          🎨 Brand from websites
        </button>
        <button className="pill-btn" onClick={() => setShowSupport(true)}>
          💬 Client support
          <span className={`pill-dot ${supportOn ? "on" : "off"}`} title={supportOn ? "On" : "Off"} />
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
        {/*
          A preset is understood as colours, and one saved from a reordered sub-account also
          carries that sidebar order — which the apply route now honours, because the editor
          always did and one action must not mean two things. Reordering somebody's menus is
          not what "apply preset" sounds like, so it is named before the click rather than
          discovered afterwards, the same rule as bulk disable naming how many sub-accounts
          are on another page.
        */}
        {bulkOrderCount > 0 && (
          <span className="pill-note">
            This preset also sets the sidebar order ({bulkOrderCount} items).
          </span>
        )}
      </div>

      {presets.length > 0 && (
        <div className="cp-presets">
          <span className="presets-label">Saved presets</span>
          {presets.map((p) => (
            <span className="preset-chip" key={p.id}>
              <span className="preset-dot" style={{ background: p.primaryColor ?? "#ccc" }} />
              {p.name}
              <button
                className="preset-remove"
                onClick={() => setDeletingPreset({ id: p.id, name: p.name })}
                title="Delete preset"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/*
        An expired session gets its OWN banner, not the generic red one. It is the only
        failure on this screen with a remedy the reader can carry out, and it needs to
        read as an instruction rather than as a fault. Every catch block already stores
        the SessionExpiredError's message, so no per-call handling is needed here — the
        text itself identifies it.
      */}
      {(sessionDead || error === SESSION_EXPIRED_MESSAGE) && (
        <div className="session-banner">
          <strong>Session expired.</strong> {SESSION_EXPIRED_MESSAGE}
        </div>
      )}
      {error && error !== SESSION_EXPIRED_MESSAGE && <div className="error-banner">Error: {error}</div>}

      {/**
        * Amber, not red, and it names what is missing rather than what broke.
        *
        * This is an instruction — reload — not a fault the reader caused, the same split
        * `App` already makes for an expired session. The list of names matters more than
        * the count: "some things didn't load" tells somebody to worry without telling them
        * what about, and the support line has to say what the screen is now claiming
        * WRONGLY, because a status dot reading "off" is worse than a blank one.
        */}
      {partialLoad.length > 0 && (
        <div className="session-banner">
          Couldn't load {partialLoad.join(", ").replace(/, ([^,]*)$/, " and $1")}. Reload the page to
          try again
          {partialLoad.some((m) => m.includes("support"))
            ? " — until then the support status shown here may be wrong, and plan names can't be saved."
            : partialLoad.some((m) => m.includes("default theme"))
              ? " — until then the agency default will look unset, and saving it would overwrite the real one."
              : "."}
        </div>
      )}

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
                  <th className="col-center" title="Show the support chat bubble in this sub-account">
                    Support
                  </th>
                  <th
                    className="col-center"
                    title="What this client bought. Used only to say &quot;isn't included on your Starter plan&quot; when they ask about something you don't offer them."
                  >
                    Plan
                  </th>
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
                        <label
                          className={`toggle${!supportOn ? " toggle-muted" : ""}`}
                          title={
                            supportOn
                              ? loc.supportEnabled
                                ? "Support chat is on for this sub-account"
                                : "Support chat is off for this sub-account"
                              : "Turn support on for the agency first (Client support)"
                          }
                        >
                          <input
                            type="checkbox"
                            checked={loc.supportEnabled}
                            onChange={(e) => handleSupportToggle(loc.id, e.target.checked)}
                          />
                          <span className="toggle-track" />
                        </label>
                      </td>
                      <td className="col-center">
                        {/* Uncontrolled: a controlled input would re-render every row on
                            each keystroke, and the value only leaves this cell on blur.
                            The KEY carries the stored plan, so the box is remounted from
                            the server's answer whenever one arrives. Without it
                            `handlePlanChange`'s rollback — which is written, and is the
                            whole reason a failed save is safe — could never reach the
                            DOM: a save that 401'd or was refused because the support
                            config had not loaded left the typed plan sitting in the cell
                            looking stored, while the client kept being told the feature
                            "isn't part of your setup". Same defect the desk's routing
                            limit had, in the other app. */}
                        <input
                          key={`plan:${loc.id}:${supportConfig?.planTiers?.[loc.id] ?? ""}`}
                          className="plan-input"
                          type="text"
                          defaultValue={supportConfig?.planTiers?.[loc.id] ?? ""}
                          placeholder={supportConfig ? "—" : ""}
                          disabled={!supportConfig}
                          maxLength={60}
                          title={
                            supportConfig
                              ? "e.g. Starter, Pro. Leave blank if they're not on a named plan."
                              : "Support settings didn't load, so plan names can't be edited."
                          }
                          onBlur={(e) => void handlePlanChange(loc.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
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
                            onClick={() =>
                              handleReset(loc.id, loc.locationName ?? loc.ghlLocationId, loc.themeVersions ?? 0)
                            }
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
          defaultHistory={{ agencyId: agencyId! }}
          onSave={handleSaveDefault}
          onSaveAsPreset={saveAsPreset}
          onCancel={() => setEditingDefault(false)}
          onReset={() => setResettingDefault(true)}
          onRestoreDefaultVersion={handleRestoreDefaultVersion}
        />
      )}

      {showCssExport && <CssExportModal agencyInstallId={agencyId} onClose={() => setShowCssExport(false)} />}

      {showBulkBrand && (
        <BulkBrandModal
          agencyId={agencyId}
          locations={locations}
          onClose={() => setShowBulkBrand(false)}
          onApplied={(updated) =>
            setLocations((prev) =>
              prev.map((l) => {
                const hit = updated.find((u) => u.locationInstallId === l.id);
                return hit ? { ...l, theme: hit.theme } : l;
              })
            )
          }
        />
      )}

      {showSupport && (
        <SupportSettingsModal
          agencyId={agencyId}
          locations={locations}
          onClose={() => setShowSupport(false)}
          onSaved={handleSupportSaved}
        />
      )}

      {resetTarget && (
        <ConfirmDialog
          title="Reset to agency default?"
          message={
            /*
             * Reset deletes EVERY version, not the current one — so the History tab, which
             * is the only way back from any other mistake in this editor, is emptied too.
             * The count is in our own database and is exactly what decides whether somebody
             * clicks: the same rule as the desk naming how many tickets a Disable releases,
             * and as bulk disable naming how many sub-accounts are on another page.
             */
            resetTarget.versions > 1
              ? `Reset "${resetTarget.name}" back to the agency default look? This removes its theme and all ${resetTarget.versions} saved versions — the History tab will be empty, and this cannot be undone.`
              : `Reset "${resetTarget.name}" back to the agency default look? Its custom theme will be removed and this cannot be undone.`
          }
          confirmLabel="Reset"
          danger
          onConfirm={doReset}
          onCancel={() => setResetTarget(null)}
        />
      )}

      {confirmDisableAll && (
        <ConfirmDialog
          title={`Turn off branding for ${selected.size} sub-account${selected.size === 1 ? "" : "s"}?`}
          // Says how many are OFF-SCREEN, because that is the number nobody can check by
          // looking. Select-all covers every page of the current filter.
          message={
            `Their clients go back to unbranded GoHighLevel on the next page load. Nothing is deleted — each theme is kept and comes back when you switch it on again.` +
            (selected.size > paged.filter((l) => selected.has(l.id)).length
              ? ` ${selected.size - paged.filter((l) => selected.has(l.id)).length} of them are on another page.`
              : "")
          }
          confirmLabel={`Turn off ${selected.size}`}
          danger
          onConfirm={() => {
            setConfirmDisableAll(false);
            void bulkSetEnabled(false);
          }}
          onCancel={() => setConfirmDisableAll(false)}
        />
      )}

      {deletingPreset && (
        <ConfirmDialog
          title="Delete this preset?"
          message={`"${deletingPreset.name}" will be gone for good — presets have no history to restore from. Sub-accounts you already applied it to keep their look.`}
          confirmLabel="Delete"
          danger
          onConfirm={doRemovePreset}
          onCancel={() => setDeletingPreset(null)}
        />
      )}

      {resettingDefault && (
        <ConfirmDialog
          title="Reset the agency default?"
          message="Clear the agency default look and go back to unthemed GoHighLevel. Sub-accounts with their own custom theme keep it — only the inherited look is removed."
          confirmLabel="Reset"
          danger
          onConfirm={doResetDefault}
          onCancel={() => setResettingDefault(false)}
        />
      )}
    </div>
  );
}
