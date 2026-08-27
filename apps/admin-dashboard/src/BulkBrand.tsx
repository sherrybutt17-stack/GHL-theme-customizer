import { useEffect, useMemo, useState } from "react";
import { saveTheme, scanBrandWebsite, SESSION_EXPIRED_MESSAGE, type LocationRow, type ThemeConfig, type ThemeInput } from "./api";
import { ConfirmDialog } from "./Dialog";
import { summariseBulk } from "./bulkEnableLogic";
import { downscaleDataUrl, paletteFromImage } from "./colorUtils";
import { bulkBrandDirty, mergedTheme, parseRows, type RowState } from "./bulkBrandLogic";

/**
 * Brand many sub-accounts from one pasted list of `sub-account, website` rows.
 *
 * Onboarding an agency is the moment Mosaic either saves a day or costs one: 41
 * sub-accounts, each needing its client's own logo and colours. Everything needed
 * already exists per-sub-account (the server's SSRF-guarded brand scan, and the same
 * canvas palette extractor the editor uses) — what was missing was doing it in bulk.
 *
 * Three rules shape this, all learned from what the underlying pieces actually do:
 *
 *  1. NEVER GUESS WHICH SUB-ACCOUNT A ROW MEANS. Branding the wrong client is worse
 *     than branding none: it is invisible to us and obvious to them. A row matches on
 *     an exact GHL location id, or an exact (case-insensitive) name. Anything else —
 *     no match, or two sub-accounts sharing a name — is reported and skipped.
 *  2. SEND THE WHOLE THEME, NOT JUST THE COLOURS. The server carries forward the logo,
 *     hidden features, renames and menu order when a key is absent, but `visualFields`
 *     resets the rest: a partial payload would silently clear a chosen font, corner
 *     radius, top-bar colour and alert banner on every sub-account it touched.
 *  3. SCAN, SHOW, THEN APPLY. Nothing is written until the agency has seen each colour
 *     pair next to the client it belongs to. A scan is a guess about someone's brand;
 *     it should be reviewed once rather than undone 41 times.
 */

export function BulkBrandModal({
  agencyId,
  locations,
  onClose,
  onApplied,
}: {
  agencyId: string;
  locations: LocationRow[];
  onClose: () => void;
  onApplied: (updated: { locationInstallId: string; theme: ThemeConfig }[]) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const ready = useMemo(() => (rows ?? []).filter((r) => r.status === "ready"), [rows]);
  const saved = useMemo(() => (rows ?? []).filter((r) => r.status === "saved"), [rows]);

  /**
   * Closing with work on screen asks first — the same guard the theme editor and the
   * support settings modal already carry, and the comment that used to sit on the Escape
   * handler here said exactly this ("Never lose a long pasted list to a stray Escape")
   * while guarding only on `busy`, which is false for the entire time anybody is reading
   * the results. Measured before this existed: a five-line list vanished on Escape, and so
   * did five completed scans; reopening gave an empty box both times. Backdrop clicks did
   * the same.
   *
   * It is the sharpest version of that loss in the product. The theme editor risks typing
   * you can redo; this risks a SEQUENTIAL pass of fetches over other people's websites —
   * deliberately serial, so 41 clients is minutes — and redoing it means going back to
   * every one of those sites.
   *
   * Dirty means "closing throws away something that took effort and has not been applied":
   * scans that were read and not saved, or a pasted list nothing has come of yet. Once a
   * row is saved it is in the database and closing costs nothing, so a finished run does
   * not nag.
   */
  const dirty = bulkBrandDirty(rows, text);

  function requestClose() {
    if (busy) return; // mid-flight: there is nothing safe to do but wait
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the topmost thing on screen — without the guard it closes this
      // modal out from under the discard prompt, which answers the prompt for you.
      if (e.key === "Escape" && !confirmDiscard) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, confirmDiscard, dirty]);

  async function scanAll() {
    const parsed = parseRows(text, locations);
    setRows(parsed);
    if (!parsed.some((r) => r.status === "pending")) return;

    setBusy(true);
    setError(null);
    // Sequential on purpose: these are fetches to other people's websites, and a burst
    // of 41 at once is the kind of thing that gets an IP blocked.
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].status !== "pending") continue;
      setRows((prev) => prev!.map((r, j) => (i === j ? { ...r, status: "scanning" } : r)));
      try {
        const res = await scanBrandWebsite(agencyId, parsed[i].url);
        let primary = res.themeColor ?? undefined;
        let accent: string | undefined;
        if (res.imageDataUrl) {
          const pal = await paletteFromImage(res.imageDataUrl);
          if (pal) {
            primary = primary || pal.primary;
            accent = pal.accent;
          }
        }
        // Shrink the scraped logo before it can ever reach the stylesheet. Scans return
        // whatever the client's site serves; unprocessed, 41 of those are megabytes of
        // render-blocking CSS.
        const shrunk = res.imageDataUrl ? await downscaleDataUrl(res.imageDataUrl) : null;
        const found = !!(primary || accent);
        setRows((prev) =>
          prev!.map((r, j) =>
            i === j
              ? {
                  ...r,
                  status: found ? "ready" : "failed",
                  primary,
                  accent,
                  logoUrl: shrunk?.dataUrl,
                  logoBytes: shrunk?.bytes,
                  logoFormat: shrunk?.format,
                  note: found ? undefined : "Reached the site but found no usable brand colour.",
                }
              : r
          )
        );
      } catch (e) {
        setRows((prev) =>
          prev!.map((r, j) => (i === j ? { ...r, status: "failed", note: (e as Error).message } : r))
        );
      }
    }
    setBusy(false);
  }

  async function applyAll() {
    setBusy(true);
    setError(null);
    const applied: { locationInstallId: string; theme: ThemeConfig }[] = [];
    /**
     * Every attempt, settled, so the outcome can be SUMMARISED rather than left as badges
     * in a scrolling list of 41. Without this the only report of a partial failure was a
     * red word beside each row — reliably missed, and the one failure that has a remedy
     * (an expired session) was buried in 11px grey text as "Missing or invalid dashboard
     * token", which means nothing to an agency owner.
     */
    const settled: { status: "fulfilled" | "rejected"; reason?: { message?: string } }[] = [];
    const current = rows ?? [];
    for (let i = 0; i < current.length; i++) {
      const row = current[i];
      if (row.status !== "ready" || !row.location) continue;
      setRows((prev) => prev!.map((r, j) => (i === j ? { ...r, status: "saving" } : r)));
      try {
        const theme = await saveTheme(
          agencyId,
          row.location.id,
          mergedTheme(row.location.theme, {
            ...(row.primary ? { primaryColor: row.primary, secondaryColor: row.primary } : {}),
            ...(row.accent ? { accentColor: row.accent } : {}),
            // The logo is the client's own mark; only set it when we actually found one,
            // and never clear one they uploaded by hand.
            ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
          })
        );
        applied.push({ locationInstallId: row.location.id, theme });
        settled.push({ status: "fulfilled" });
        setRows((prev) => prev!.map((r, j) => (i === j ? { ...r, status: "saved" } : r)));
      } catch (e) {
        settled.push({ status: "rejected", reason: { message: (e as Error).message } });
        setRows((prev) =>
          prev!.map((r, j) => (i === j ? { ...r, status: "failed", note: (e as Error).message } : r))
        );
      }
    }
    setBusy(false);
    /**
     * The SAME summariser the bulk enable/disable uses, not a second one written here.
     * It states the successes ("38 of 41" rather than "3 failed", which leaves the reader
     * wondering about the other 38) and passes a session expiry through VERBATIM, which is
     * what lets the amber instruction banner below match on it. Two summarisers would
     * drift, and this is the screen where a wrong count means an agency believes a client
     * is branded when they are not.
     */
    setError(summariseBulk(settled).message);
    if (applied.length) onApplied(applied);
  }

  return (
    <>
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Brand many sub-accounts at once</h2>
        </div>

        <div className="modal-body">
          <p className="field-hint" style={{ marginTop: 0 }}>
            One line per client: <strong>sub-account name or location id</strong>, then their website.
            We'll read each site's logo and colours, show you what we found, and only save once you say so.
          </p>

          <textarea
            className="bulk-input"
            rows={7}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder={"190 Ranch, 190ranch.com\nAcme Dental, https://acmedental.com"}
          />

          <div className="dryrun-controls">
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={scanAll}>
              {busy && !saved.length ? "Reading sites…" : "Read these sites"}
            </button>
            {ready.length > 0 && (
              <button className="btn" disabled={busy} onClick={applyAll}>
                {busy ? "Saving…" : `Apply to ${ready.length} sub-account${ready.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>

          {error === SESSION_EXPIRED_MESSAGE ? (
            /* Amber, not red: an instruction, not a fault — and the only failure here the
               reader can actually act on, since the session cannot be renewed from inside
               the app. Same split App.tsx makes on the same constant. */
            <div className="session-banner">
              <strong>Session expired.</strong> {SESSION_EXPIRED_MESSAGE}
            </div>
          ) : (
            error && <div className="error-banner">{error}</div>
          )}

          {rows && (
            <div className="bulk-list">
              {rows.map((r, i) => (
                <div key={i} className={`bulk-row${r.status === "skipped" || r.status === "failed" ? " bad" : ""}`}>
                  <div className="bulk-swatches">
                    {r.primary && <span className="bulk-swatch" style={{ background: r.primary }} title={r.primary} />}
                    {r.accent && <span className="bulk-swatch" style={{ background: r.accent }} title={r.accent} />}
                    {r.logoUrl && <img className="bulk-logo" src={r.logoUrl} alt="" />}
                  </div>
                  <div className="bulk-row-main">
                    <div className="bulk-row-title">
                      {/* The MATCHED sub-account, not the typed text — so a row that
                          matched something unexpected is visible before anything saves. */}
                      {r.location?.locationName ?? r.input}
                      {r.location && r.input.toLowerCase() !== (r.location.locationName ?? "").toLowerCase() && (
                        <span className="bulk-matched"> · matched “{r.input}”</span>
                      )}
                    </div>
                    <div className="bulk-row-sub">
                      {r.note ?? r.url}
                      {r.location?.theme && r.status === "ready" && " · replaces its current colours"}
                      {/* Logos ride inside the render-blocking stylesheet, so the size is
                          shown at the moment the decision is made, as on the upload path. */}
                      {r.logoBytes !== undefined &&
                        ` · logo ${(r.logoBytes / 1024).toFixed(0)}KB ${r.logoFormat?.toUpperCase()}`}
                    </div>
                  </div>
                  <span className={`bulk-status ${r.status}`}>
                    {r.status === "ready" ? "found" : r.status === "saved" ? "saved ✓" : r.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {saved.length > 0 && (
            <p className="field-hint">
              {/* The COUNT, not just "saved". After a run over 41 rows the badges are in a
                  scrolling list, and "how many actually landed" is the only question the
                  agency has. Same reasoning as "38 of 41" on the bulk enable. */}
              Applied to {saved.length} sub-account{saved.length === 1 ? "" : "s"} — saved as a new
              version for each, so every one is reversible from that sub-account's History tab.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" disabled={busy} onClick={requestClose}>
            {saved.length ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>

    {confirmDiscard && (
      <ConfirmDialog
        title="Discard this run?"
        /* Names what is actually at risk. A fixed sentence about "your changes" would be
           wrong in one of the two cases, and a warning that describes the wrong thing is
           one people learn to click through. */
        message={
          dirty === "scans"
            ? `We've read ${ready.length} site${ready.length === 1 ? "" : "s"} and not applied ${ready.length === 1 ? "it" : "them"} yet. Closing loses the colours and logos we found, and reading them again means another pass over every one of those websites.`
            : "The list you pasted hasn't been read yet, so nothing you typed will be kept."
        }
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    )}
    </>
  );
}
