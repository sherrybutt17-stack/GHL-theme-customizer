import { useEffect, useState } from "react";
import {
  fetchSidebarFeatures,
  type SidebarFeature,
  type ThemeInput,
  type ThemePreset,
  type VisualTheme,
} from "./api";
import { LookFields, type Look } from "./LookFields";
import { MosaicPreview } from "./MosaicPreview";

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
    darkMode: initial?.darkMode ?? false,
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
  const [tab, setTab] = useState<"branding" | "features" | "advanced">("branding");
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [look, setLook] = useState<Look>(lookFrom(initial));
  const [hidden, setHidden] = useState<Set<string>>(new Set(initial?.hiddenFeatures ?? []));
  const [labels, setLabels] = useState<Record<string, string>>(initial?.menuLabelOverrides ?? {});
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

  useEffect(() => {
    // Editing the agency default (no brand name) → show the agency sidebar items;
    // editing a sub-account → show the sub-account items.
    fetchSidebarFeatures(showBrandName ? undefined : "agency").then(setFeatures);
  }, [showBrandName]);

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
        darkMode: look.darkMode,
        sidebarImageUrl,
        hideUpgrade,
        customCss,
        alertMessage,
        alertColor,
        hiddenFeatures: [...hidden],
        menuLabelOverrides: cleanedLabels,
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
                {features
                  .filter((f) => f.group !== "settings")
                  .map((f) => renderFeatureRow(f))}
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
          </div>
          <MosaicPreview
            look={look}
            logoUrl={logoUrl}
            brandName={showBrandName ? brandName : undefined}
            features={features}
            hidden={hidden}
            labels={labels}
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
