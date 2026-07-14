import { useEffect, useState } from "react";
import {
  fetchSidebarFeatures,
  fetchThemeVersions,
  scanBrandWebsite,
  type SidebarFeature,
  type ThemeConfig,
  type ThemeInput,
  type ThemePreset,
  type VisualTheme,
} from "./api";
import { LookFields, type Look } from "./LookFields";
import { MosaicPreview } from "./MosaicPreview";
import { paletteFromImage } from "./colorUtils";

interface Props {
  title: string;
  initial:
    | (Partial<VisualTheme> & {
        brandName?: string | null;
        customCss?: string | null;
        customCssOverride?: string | null;
      })
    | null;
  showBrandName: boolean;
  presets: ThemePreset[];
  /** Agency install id — needed for the "brand from website" server call. */
  agencyId?: string;
  /** When set (per-location editing), enables the version-history tab. */
  history?: { agencyId: string; locationInstallId: string };
  onSave: (theme: ThemeInput) => Promise<void>;
  onSaveAsPreset: (name: string, look: Look) => Promise<void>;
  onCancel: () => void;
}

/**
 * Read an uploaded image file, shrink it to at most `maxDim` px on its longest
 * side, and return a compact data: URL. Embedding the logo as a data URL means
 * no external file hosting is needed - it rides along in the theme CSS.
 */
interface UploadedImage {
  dataUrl: string;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
}

function fileToDownscaledDataUrl(file: File, maxDim = 512): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          width: w,
          height: h,
          origWidth: img.width,
          origHeight: img.height,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
    buttonColor: initial?.buttonColor ?? "#4f46e5",
    cornerRadius: initial?.cornerRadius ?? 8,
    scrollbarColor: initial?.scrollbarColor ?? "#94a3b8",
    sidebarTextColor: initial?.sidebarTextColor ?? "#ffffff",
    contentBgColor: initial?.contentBgColor ?? "",
    contentTextColor: initial?.contentTextColor ?? "",
    darkMode: initial?.darkMode ?? false,
  };
}

export function ThemeEditorModal({
  title,
  initial,
  showBrandName,
  presets,
  agencyId,
  history,
  onSave,
  onSaveAsPreset,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<"branding" | "features" | "advanced" | "history">("branding");
  const [versions, setVersions] = useState<ThemeConfig[] | null>(null);
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [faviconUrl, setFaviconUrl] = useState(initial?.faviconUrl ?? "");
  const [look, setLook] = useState<Look>(lookFrom(initial));
  const [hidden, setHidden] = useState<Set<string>>(new Set(initial?.hiddenFeatures ?? []));
  const [labels, setLabels] = useState<Record<string, string>>(initial?.menuLabelOverrides ?? {});
  const [menuOrder, setMenuOrder] = useState<string[]>(
    Array.isArray(initial?.menuOrder) ? (initial!.menuOrder as string[]) : []
  );
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [sidebarImageUrl, setSidebarImageUrl] = useState(initial?.sidebarImageUrl ?? "");
  const [hideUpgrade, setHideUpgrade] = useState(initial?.hideUpgrade ?? false);
  const [customCss, setCustomCss] = useState(initial?.customCssOverride ?? initial?.customCss ?? "");
  const [alertMessage, setAlertMessage] = useState(initial?.alertMessage ?? "");
  const [alertColor, setAlertColor] = useState(initial?.alertColor ?? "#4f46e5");
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [logoDims, setLogoDims] = useState<{ w: number; h: number; ow: number; oh: number } | null>(null);
  const [features, setFeatures] = useState<SidebarFeature[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickingColors, setPickingColors] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  useEffect(() => {
    // Editing the agency default (no brand name) → show the agency sidebar items;
    // editing a sub-account → show the sub-account items.
    fetchSidebarFeatures(showBrandName ? undefined : "agency").then(setFeatures);
  }, [showBrandName]);

  useEffect(() => {
    if (tab === "history" && history && versions === null) {
      fetchThemeVersions(history.agencyId, history.locationInstallId)
        .then(setVersions)
        .catch(() => setVersions([]));
    }
  }, [tab, history, versions]);

  const patchLook = (p: Partial<Look>) => setLook((l) => ({ ...l, ...p }));

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoErr(null);
    try {
      const img = await fileToDownscaledDataUrl(file);
      setLogoUrl(img.dataUrl);
      setLogoDims({ w: img.width, h: img.height, ow: img.origWidth, oh: img.origHeight });
    } catch (e) {
      setLogoErr((e as Error).message);
    }
  }

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
      buttonColor: p.buttonColor ?? look.buttonColor,
      cornerRadius: p.cornerRadius ?? look.cornerRadius,
      scrollbarColor: p.scrollbarColor ?? look.scrollbarColor,
      sidebarTextColor: p.sidebarTextColor ?? look.sidebarTextColor,
      contentBgColor: p.contentBgColor ?? look.contentBgColor,
      contentTextColor: p.contentTextColor ?? look.contentTextColor,
      darkMode: p.darkMode,
    });
  }

  function toggleHidden(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function applyLogoColors() {
    if (!logoUrl) return;
    setLogoErr(null);
    setPickingColors(true);
    try {
      const pal = await paletteFromImage(logoUrl);
      if (pal) patchLook({ primaryColor: pal.primary, accentColor: pal.accent });
      else setLogoErr("Couldn't read colors from this image — try uploading it instead of a URL.");
    } finally {
      setPickingColors(false);
    }
  }

  // "Brand from website": the server fetches the site and returns its theme-color
  // and/or best brand image (as a data: URL); we then run the same palette extractor
  // used for logo uploads. The image half only works if the agencyId is known.
  async function scanWebsite() {
    const raw = websiteUrl.trim();
    if (!raw || !agencyId) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setScanMsg(null);
    setScanning(true);
    try {
      const res = await scanBrandWebsite(agencyId, url);
      let primary = res.themeColor;
      let accent: string | undefined;
      if (res.imageDataUrl) {
        const pal = await paletteFromImage(res.imageDataUrl);
        if (pal) {
          primary = primary || pal.primary;
          accent = pal.accent;
        }
      }
      if (!primary && !accent) {
        setScanMsg("Found the site, but couldn't read a usable brand color from it.");
        return;
      }
      patchLook({
        ...(primary ? { primaryColor: primary } : {}),
        ...(accent ? { accentColor: accent } : {}),
      });
      setScanMsg(`Applied colors from ${res.siteName || url}. Tweak them below if needed.`);
    } catch (e) {
      setScanMsg((e as Error).message || "Couldn't scan that website.");
    } finally {
      setScanning(false);
    }
  }

  // Load an older version's values back into the form. Saving then writes a NEW
  // version (history stays append-only; a restore is itself an auditable version).
  function loadVersion(v: ThemeConfig) {
    setLook(lookFrom(v));
    setBrandName(v.brandName ?? "");
    setLogoUrl(v.logoUrl ?? "");
    setFaviconUrl(v.faviconUrl ?? "");
    setHidden(new Set(v.hiddenFeatures ?? []));
    setLabels((v.menuLabelOverrides as Record<string, string>) ?? {});
    setMenuOrder(Array.isArray(v.menuOrder) ? v.menuOrder : []);
    setSidebarImageUrl(v.sidebarImageUrl ?? "");
    setHideUpgrade(v.hideUpgrade ?? false);
    setCustomCss(v.customCssOverride ?? "");
    setAlertMessage(v.alertMessage ?? "");
    setAlertColor(v.alertColor ?? "#4f46e5");
    setTab("branding");
  }

  // Main sidebar features, sorted by the saved order (unlisted keep natural order).
  function mainFeaturesInOrder(): SidebarFeature[] {
    const main = features.filter((f) => f.group !== "settings");
    const pos = new Map(menuOrder.map((k, i) => [k, i]));
    return [...main].sort((a, b) => (pos.get(a.key) ?? 999) - (pos.get(b.key) ?? 999));
  }

  function reorderMenu(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const keys = mainFeaturesInOrder().map((f) => f.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    setMenuOrder(keys);
  }

  function renderFeatureRow(f: SidebarFeature) {
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
          // Stop password managers (1Password/LastPass) injecting an inline icon
          // into the focused field — as a DOM sibling it stole a grid cell and
          // bumped the "Visible" toggle onto its own line.
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
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
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const cleanedLabels = Object.fromEntries(
        Object.entries(labels).filter(([, v]) => v && v.trim())
      );
      await onSave({
        ...(showBrandName ? { brandName } : {}),
        logoUrl,
        faviconUrl,
        primaryColor: look.primaryColor,
        secondaryColor: look.primaryColor,
        accentColor: look.accentColor,
        fontFamily: look.fontFamily,
        gradientEnabled: look.gradientEnabled,
        gradientColor: look.gradientColor,
        gradientAngle: look.gradientAngle,
        topBarColor: look.topBarColor === "#ffffff" ? "" : look.topBarColor,
        buttonColor: look.buttonColor,
        cornerRadius: look.cornerRadius,
        scrollbarColor: look.scrollbarColor,
        sidebarTextColor: look.sidebarTextColor,
        contentBgColor: look.contentBgColor,
        contentTextColor: look.contentTextColor,
        darkMode: look.darkMode,
        sidebarImageUrl,
        hideUpgrade,
        customCss,
        alertMessage,
        alertColor,
        hiddenFeatures: [...hidden],
        menuLabelOverrides: cleanedLabels,
        menuOrder,
      });
    } catch (e) {
      // Surface the failure inside the modal instead of closing it (the caller only
      // closes on success), so the agency never assumes an unsaved theme was saved.
      setSaveError((e as Error).message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAsPreset() {
    const name = prompt("Name this preset (e.g. “Dark Gold”):");
    if (!name) return;
    try {
      await onSaveAsPreset(name, look);
    } catch (e) {
      setSaveError((e as Error).message || "Could not save preset.");
    }
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
          <button className={`tab ${tab === "advanced" ? "active" : ""}`} onClick={() => setTab("advanced")}>
            Advanced
          </button>
          {history && (
            <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
              History
            </button>
          )}
        </div>

        <div className="modal-body editor-body">
          <div className="editor-panes">
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
                <label>Logo</label>
                <input
                  type="url"
                  value={logoUrl.startsWith("data:") ? "" : logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="Paste an image URL…"
                />
                <div className="logo-upload-row">
                  <label className="btn btn-ghost logo-upload-btn">
                    Upload from computer
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleLogoFile(e.target.files?.[0])}
                    />
                  </label>
                  {logoUrl.startsWith("data:") && <span className="logo-uploaded">Uploaded image ✓</span>}
                </div>
                <p className="logo-hint">
                  Recommended: a <strong>wide/horizontal</strong> logo around <strong>200×50&nbsp;px</strong>{" "}
                  (or a transparent PNG). Larger images are automatically shrunk to fit 512&nbsp;px.
                </p>
                {logoDims && (
                  <p className="logo-dims">
                    Uploaded {logoDims.ow}×{logoDims.oh}px → stored at {logoDims.w}×{logoDims.h}px
                  </p>
                )}
                {logoErr && <div className="field-error">{logoErr}</div>}
                {logoUrl && (
                  <div className="logo-preview" style={{ marginTop: 8 }}>
                    <img src={logoUrl} alt="logo preview" />
                    <span>Preview</span>
                  </div>
                )}
              </div>

              {logoUrl && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                  onClick={applyLogoColors}
                  disabled={pickingColors}
                >
                  {pickingColors ? "Reading logo…" : "🎨 Use colors from logo"}
                </button>
              )}

              {agencyId && (
                <div className="field">
                  <label>Brand from website</label>
                  <div className="logo-upload-row">
                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="yourclient.com"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          scanWebsite();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={scanWebsite}
                      disabled={scanning || !websiteUrl.trim()}
                    >
                      {scanning ? "Scanning…" : "🌐 Fetch colors"}
                    </button>
                  </div>
                  <p className="logo-hint">
                    Paste a client's website and we'll pull their logo &amp; brand color to prefill{" "}
                    <strong>primary</strong> and <strong>accent</strong>. You can fine-tune after.
                  </p>
                  {scanMsg && <div className="field-error">{scanMsg}</div>}
                </div>
              )}

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
                Drag <span className="drag-handle-inline">⠿</span> to reorder, or hide/rename items.
              </p>
              <div className="feature-list">
                {mainFeaturesInOrder().map((f) => (
                  <div
                    key={f.key}
                    className={`feature-drag-row ${dragKey === f.key ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragKey(f.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragKey) reorderMenu(dragKey, f.key);
                      setDragKey(null);
                    }}
                    onDragEnd={() => setDragKey(null)}
                  >
                    <span className="drag-handle" title="Drag to reorder">⠿</span>
                    {renderFeatureRow(f)}
                  </div>
                ))}
              </div>

              {features.some((f) => f.group === "settings") && (
                <>
                  <label style={{ marginTop: 20 }}>Settings menu items</label>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                    The sidebar shown inside Settings (Business Profile, My Staff, Calendars…).
                  </p>
                  <div className="feature-list">
                    {features
                      .filter((f) => f.group === "settings")
                      .map((f) => renderFeatureRow(f))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "advanced" && (
            <>
              <div className="field">
                <label>Account alert banner</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>
                  Shows a floating message at the bottom of {showBrandName ? "this sub-account's" : "every sub-account's"} screens
                  (e.g. “Payment overdue” or “Scheduled maintenance Sunday”). Leave blank for none.
                </p>
                <input
                  type="text"
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  placeholder="e.g. Your account is past due — please update billing."
                />
                {alertMessage.trim() && (
                  <div className="alert-color-row">
                    <input type="color" value={alertColor} onChange={(e) => setAlertColor(e.target.value)} />
                    <span>Banner color</span>
                    <span className="alert-preview" style={{ background: alertColor }}>
                      {alertMessage.slice(0, 40)}
                    </span>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Sidebar background image URL</label>
                <input
                  type="url"
                  value={sidebarImageUrl}
                  onChange={(e) => setSidebarImageUrl(e.target.value)}
                  placeholder="https://… (optional, layered over the sidebar color)"
                />
              </div>

              <div className="look-toggle-row">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={hideUpgrade}
                    onChange={(e) => setHideUpgrade(e.target.checked)}
                  />
                  <span className="toggle-track" />
                </label>
                <div>
                  <div className="look-color-label">Hide upgrade &amp; billing prompts</div>
                  <div className="look-color-hint">
                    Removes “Upgrade”/billing banners for a cleaner white-labeled client view.
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Custom CSS (advanced)</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>
                  Raw CSS applied {showBrandName ? "to this sub-account only" : "agency-wide"}. Use for
                  anything the controls above don’t cover — your rules are auto-scoped to this client.
                  Keep to flat rules (no <code>@media</code>) when scoping to one sub-account.
                </p>
                <textarea
                  className="custom-css"
                  rows={8}
                  spellCheck={false}
                  value={customCss}
                  onChange={(e) => setCustomCss(e.target.value)}
                  placeholder=".some-ghl-class { color: red !important; }"
                />
              </div>
            </>
          )}

          {tab === "history" && (
            <div className="field">
              <label>Version history</label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Every save is a version. Load an older one into the editor, review it in the
                preview, then <strong>Save changes</strong> to restore it as a new version.
              </p>
              {versions === null ? (
                <div className="empty-state">Loading history…</div>
              ) : versions.length === 0 ? (
                <div className="empty-state">No saved versions yet.</div>
              ) : (
                <div className="version-list">
                  {versions.map((v, i) => (
                    <div key={v.id} className="version-row">
                      <div>
                        <div className="version-title">
                          Version {v.version}
                          {i === 0 && <span className="version-current"> · current</span>}
                        </div>
                        <div className="version-date">
                          {v.createdAt ? new Date(v.createdAt).toLocaleString() : `v${v.version}`}
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        disabled={i === 0}
                        onClick={() => loadVersion(v)}
                      >
                        {i === 0 ? "Current" : "Load this version"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
          <MosaicPreview
            look={look}
            logoUrl={logoUrl}
            brandName={showBrandName ? brandName : undefined}
            features={features}
            hidden={hidden}
            labels={labels}
            order={menuOrder}
          />
        </div>

        <div className="modal-footer">
          {saveError && (
            <span style={{ fontSize: 13, color: "#b91c1c", marginRight: "auto" }}>{saveError}</span>
          )}
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
