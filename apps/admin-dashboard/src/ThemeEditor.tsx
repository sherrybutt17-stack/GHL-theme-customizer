import { useEffect, useRef, useState } from "react";
import {
  fetchDefaultThemeVersions,
  type DefaultThemeVersion,
  fetchSidebarFeatures,
  fetchThemeVersions,
  scanBrandWebsite,
  type LoginBranding,
  type SidebarFeature,
  type ThemeConfig,
  type ThemeInput,
  type ThemePreset,
  type VisualTheme,
} from "./api";
import { LookFields, type Look } from "./LookFields";
import { MosaicPreview } from "./MosaicPreview";
import { LoginPreview } from "./LoginPreview";
import { ConfirmDialog, PromptDialog } from "./Dialog";
import { paletteFromImage } from "./colorUtils";

interface Props {
  title: string;
  initial:
    | (Partial<VisualTheme> & Partial<LoginBranding> & {
        brandName?: string | null;
        customCss?: string | null;
        customCssOverride?: string | null;
      })
    | null;
  showBrandName: boolean;
  /** True for the agency default theme editor — unlocks the Login page section. */
  isAgencyDefault?: boolean;
  presets: ThemePreset[];
  /** Agency install id — needed for the "brand from website" server call. */
  agencyId?: string;
  /** When set (per-location editing), enables the version-history tab. */
  history?: { agencyId: string; locationInstallId: string };
  /**
   * Agency-default editing: enables the same tab, backed by snapshots instead of
   * versions. The agency default is one upserted row rather than an append-only chain,
   * so "restore" is a single server call rather than load-into-editor-then-save.
   */
  defaultHistory?: { agencyId: string };
  /** Agency default only. Resolves once the restored look is live. */
  onRestoreDefaultVersion?: (versionId: string) => Promise<void>;
  onSave: (theme: ThemeInput) => Promise<void>;
  onSaveAsPreset: (name: string, look: Look, menuOrder: string[]) => Promise<void>;
  onCancel: () => void;
  /** Agency default only — clears the whole default look. Omit to hide the button. */
  onReset?: () => void;
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
  /** What the encoder actually produced — "webp" unless the browser refused. */
  format: "webp" | "png";
  /** Encoded byte count, for showing the agency what rides in their stylesheet. */
  bytes: number;
}

/**
 * Encode the canvas as WebP, falling back to PNG, and keep whichever is SMALLER.
 *
 * This matters more here than it looks. Logos are base64-inlined into the theme
 * stylesheet — one per sub-account — and that stylesheet is fetched by `@import` from
 * GHL's Custom CSS field, which browsers treat as RENDER-BLOCKING. So every kilobyte is
 * paid on every page load of every themed sub-account. WebP typically lands 5–10×
 * smaller than PNG at visually identical quality, and base64 adds a further 33% on top
 * of whatever we choose.
 *
 * Two things this must not assume:
 *  - **That WebP is supported.** `toDataURL` with an unrecognised type does not throw;
 *    it silently returns PNG. So check the mime of what came BACK rather than trusting
 *    the request.
 *  - **That WebP is always smaller.** For a tiny flat-colour logo, PNG sometimes wins.
 *    Encoding both and comparing costs microseconds and removes the guess.
 */
function encodeSmallest(canvas: HTMLCanvasElement): { dataUrl: string; format: "webp" | "png"; bytes: number } {
  const png = canvas.toDataURL("image/png");
  // Quality 0.85: visually lossless for flat logo art, well past the point of
  // diminishing returns on size.
  const webp = canvas.toDataURL("image/webp", 0.85);
  const webpSupported = webp.startsWith("data:image/webp");
  const chosen = webpSupported && webp.length < png.length ? webp : png;
  return {
    dataUrl: chosen,
    format: chosen === webp ? "webp" : "png",
    // Approximate decoded size from the base64 payload — close enough to display.
    bytes: Math.round(((chosen.length - chosen.indexOf(",") - 1) * 3) / 4),
  };
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
        const encoded = encodeSmallest(canvas);
        resolve({
          ...encoded,
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
    sidebarIconColor: initial?.sidebarIconColor ?? "",
    buttonShape: initial?.buttonShape ?? "",
    darkMode: initial?.darkMode ?? false,
  };
}

export function ThemeEditorModal({
  title,
  initial,
  showBrandName,
  isAgencyDefault,
  presets,
  agencyId,
  history,
  defaultHistory,
  onSave,
  onSaveAsPreset,
  onCancel,
  onReset,
  onRestoreDefaultVersion,
}: Props) {
  const [tab, setTab] = useState<"branding" | "features" | "login" | "advanced" | "history">("branding");
  const [versions, setVersions] = useState<ThemeConfig[] | null>(null);
  const [defaultVersions, setDefaultVersions] = useState<DefaultThemeVersion[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [previewingVersion, setPreviewingVersion] = useState<number | null>(null);
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [faviconUrl, setFaviconUrl] = useState(initial?.faviconUrl ?? "");
  const [faviconErr, setFaviconErr] = useState<string | null>(null);
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
  const [logoDims, setLogoDims] = useState<{ w: number; h: number; ow: number; oh: number; format: string; bytes: number } | null>(null);
  const [features, setFeatures] = useState<SidebarFeature[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickingColors, setPickingColors] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [presetPromptOpen, setPresetPromptOpen] = useState(false);
  // Login-page branding (agency default only).
  const [loginBgColor, setLoginBgColor] = useState(initial?.loginBgColor ?? "");
  const [loginBgImage, setLoginBgImage] = useState(initial?.loginBgImage ?? "");
  const [loginGradientEnabled, setLoginGradientEnabled] = useState(initial?.loginGradientEnabled ?? false);
  const [loginGradientColor, setLoginGradientColor] = useState(initial?.loginGradientColor ?? "#1e293b");
  const [loginGradientAngle, setLoginGradientAngle] = useState(initial?.loginGradientAngle ?? 135);
  const [loginCardColor, setLoginCardColor] = useState(initial?.loginCardColor ?? "");
  const [loginButtonColor, setLoginButtonColor] = useState(initial?.loginButtonColor ?? "");
  const [loginLogoUrl, setLoginLogoUrl] = useState(initial?.loginLogoUrl ?? "");

  const [featuresError, setFeaturesError] = useState<string | null>(null);
  useEffect(() => {
    // Editing the agency default (no brand name) → show the agency sidebar items;
    // editing a sub-account → show the sub-account items.
    setFeaturesError(null);
    fetchSidebarFeatures(showBrandName ? undefined : "agency")
      .then(setFeatures)
      .catch((e) => setFeaturesError((e as Error).message || "Couldn't load the sidebar items."));
  }, [showBrandName]);

  /**
   * "Have they changed anything", derived from the SAVE PAYLOAD rather than a flag.
   *
   * A hand-kept `dirty` boolean is the same class of bug this guard exists to close: one
   * more thing every future field has to remember to set, and silent when it is forgotten.
   * Fingerprinting exactly what Save would send means a new field is covered the moment it
   * is added to the payload — and if it is NOT in the payload, it is not a change worth
   * warning about, because saving would not persist it either.
   */
  const fingerprint = JSON.stringify({
    brandName,
    logoUrl,
    faviconUrl,
    look,
    sidebarImageUrl,
    hideUpgrade,
    customCss,
    alertMessage,
    alertColor,
    hidden: [...hidden].sort(),
    labels,
    menuOrder,
    login: isAgencyDefault
      ? [loginBgColor, loginBgImage, loginGradientEnabled, loginGradientColor, loginGradientAngle, loginCardColor, loginButtonColor, loginLogoUrl]
      : null,
  });
  const pristine = useRef<string | null>(null);
  if (pristine.current === null) pristine.current = fingerprint;
  const isDirty = pristine.current !== fingerprint;
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /**
   * Closing with unsaved work asks first.
   *
   * The overlay was already deliberately non-dismissable — "this is a big form and a
   * stray misclick would discard all unsaved edits" — and then Escape did precisely that,
   * instantly and silently. Escape is a reflex, especially inside an iframe where people
   * press it to dismiss whatever is on top, and the work at risk is an agency's careful
   * branding of one of their clients. The reasoning was right; one path bypassed it.
   */
  function requestClose() {
    if (isDirty) setConfirmDiscard(true);
    else onCancel();
  }

  // Escape closes the editor (unless a nested dialog is open, which handles its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !presetPromptOpen && !confirmDiscard) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (tab === "history" && history && versions === null) {
      fetchThemeVersions(history.agencyId, history.locationInstallId)
        .then(setVersions)
        .catch(() => setVersions([]));
    }
  }, [tab, history, versions]);

  useEffect(() => {
    if (tab === "history" && defaultHistory && defaultVersions === null) {
      fetchDefaultThemeVersions(defaultHistory.agencyId)
        .then(setDefaultVersions)
        .catch(() => setDefaultVersions([]));
    }
  }, [tab, defaultHistory, defaultVersions]);

  const patchLook = (p: Partial<Look>) => {
    setLook((l) => ({ ...l, ...p }));
    setPreviewingVersion(null); // any edit means we're no longer just viewing an old version
  };

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoErr(null);
    try {
      const img = await fileToDownscaledDataUrl(file);
      setLogoUrl(img.dataUrl);
      setLogoDims({ w: img.width, h: img.height, ow: img.origWidth, oh: img.origHeight, format: img.format, bytes: img.bytes });
    } catch (e) {
      setLogoErr((e as Error).message);
    }
  }

  /**
   * Favicons render at 16-32px, so 64 is already generous and keeps the data URL small.
   * Unlike the logo this does NOT ride in the render-blocking stylesheet - it is served
   * as JSON to the pasted JS bundle - but a fat base64 blob still costs every page load.
   */
  async function handleFaviconFile(file: File | undefined) {
    if (!file) return;
    setFaviconErr(null);
    try {
      const img = await fileToDownscaledDataUrl(file, 64);
      setFaviconUrl(img.dataUrl);
    } catch (e) {
      setFaviconErr((e as Error).message);
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
      sidebarIconColor: p.sidebarIconColor ?? look.sidebarIconColor,
      buttonShape: p.buttonShape ?? look.buttonShape,
      darkMode: p.darkMode,
    });
    // Presets can carry a saved sidebar order; apply it if present.
    if (Array.isArray(p.menuOrder)) setMenuOrder(p.menuOrder as string[]);
  }

  // Any edit means we're no longer just viewing an old version — drop the banner.
  const markEdited = () => setPreviewingVersion(null);

  function toggleHidden(key: string) {
    markEdited();
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleLoginBgFile(file: File | undefined) {
    if (!file) return;
    try {
      const img = await fileToDownscaledDataUrl(file, 1600);
      setLoginBgImage(img.dataUrl);
    } catch (e) {
      setLogoErr((e as Error).message);
    }
  }

  async function handleLoginLogoFile(file: File | undefined) {
    if (!file) return;
    try {
      const img = await fileToDownscaledDataUrl(file, 512);
      setLoginLogoUrl(img.dataUrl);
    } catch (e) {
      setLogoErr((e as Error).message);
    }
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
  function loadVersion(v: ThemeConfig, isCurrent = false) {
    setLook(lookFrom(v));
    setBrandName(v.brandName ?? "");
    setLogoUrl(v.logoUrl ?? "");
    setHidden(new Set(v.hiddenFeatures ?? []));
    setLabels((v.menuLabelOverrides as Record<string, string>) ?? {});
    setMenuOrder(Array.isArray(v.menuOrder) ? v.menuOrder : []);
    setSidebarImageUrl(v.sidebarImageUrl ?? "");
    setHideUpgrade(v.hideUpgrade ?? false);
    setCustomCss(v.customCssOverride ?? "");
    setAlertMessage(v.alertMessage ?? "");
    setAlertColor(v.alertColor ?? "#4f46e5");
    // Only show the "previewing an OLD version" banner for non-current versions.
    setPreviewingVersion(isCurrent ? null : v.version);
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
    if (from < 0 || keys.indexOf(toKey) < 0) return;
    // Remove first, THEN find the target's new index so the drop lands consistently
    // just before the target row regardless of drag direction (fixes off-by-one).
    const [item] = keys.splice(from, 1);
    keys.splice(keys.indexOf(toKey), 0, item);
    setMenuOrder(keys);
    markEdited();
  }

  function renderFeatureRow(f: SidebarFeature) {
    const isHidden = hidden.has(f.key);
    return (
      <div className="feature-row" key={f.key}>
        <span className={`feature-name ${isHidden ? "hidden" : ""}`}>{f.label}</span>
        {/* Wrap the input so any icon a password manager injects as a sibling stays
            INSIDE this cell (positioned over the field) instead of becoming a stray
            grid item that flows to a new row and bumps "Visible" down (the gap bug). */}
        <div className="feature-rename-wrap">
          <input
            className="feature-rename"
            placeholder="Rename…"
            value={labels[f.key] ?? ""}
            disabled={isHidden}
            onChange={(e) => {
              markEdited();
              setLabels((p) => ({ ...p, [f.key]: e.target.value }));
            }}
            // Belt-and-suspenders: also ask 1Password/LastPass/browser autofill to
            // skip this field so they don't inject their inline icon at all.
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
          />
        </div>
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
        // Agency level it's the fallback platform name, per-location it's the client's
        // own — same column, both worth sending.
        ...(showBrandName || isAgencyDefault ? { brandName } : {}),
        logoUrl,
        faviconUrl: faviconUrl || null,
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
        sidebarIconColor: look.sidebarIconColor,
        buttonShape: look.buttonShape,
        darkMode: look.darkMode,
        sidebarImageUrl,
        hideUpgrade,
        customCss,
        alertMessage,
        alertColor,
        hiddenFeatures: [...hidden],
        menuLabelOverrides: cleanedLabels,
        menuOrder,
        ...(isAgencyDefault
          ? {
              loginBgColor,
              loginBgImage,
              loginGradientEnabled,
              loginGradientColor,
              loginGradientAngle,
              loginCardColor,
              loginButtonColor,
              loginLogoUrl,
            }
          : {}),
      });
    } catch (e) {
      // Surface the failure inside the modal instead of closing it (the caller only
      // closes on success), so the agency never assumes an unsaved theme was saved.
      setSaveError((e as Error).message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // window.prompt is a no-op in GHL's cross-origin iframe → open an in-app dialog.
  async function doSaveAsPreset(name: string) {
    setPresetPromptOpen(false);
    try {
      await onSaveAsPreset(name, look, menuOrder);
    } catch (e) {
      setSaveError((e as Error).message || "Could not save preset.");
    }
  }

  return (
    <>
    {/* No overlay-click-to-close here: this is a big form and a stray misclick would
        discard all unsaved edits. Close only via the X or Cancel button. */}
    <div className="modal-overlay">
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          {isDirty && <span className="unsaved-dot" title="Unsaved changes">Unsaved changes</span>}
          <button className="btn btn-ghost" onClick={requestClose} aria-label="Close">
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
          {isAgencyDefault && (
            <button className={`tab ${tab === "login" ? "active" : ""}`} onClick={() => setTab("login")}>
              Login page
            </button>
          )}
          <button className={`tab ${tab === "advanced" ? "active" : ""}`} onClick={() => setTab("advanced")}>
            Advanced
          </button>
          {(history || defaultHistory) && (
            <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
              History
            </button>
          )}
        </div>

        <div className="modal-body editor-body">
          <div className="editor-panes">
          {tab === "branding" && (
            <>
              {previewingVersion !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    color: "#1e40af",
                    borderRadius: 8,
                    padding: "8px 12px",
                    marginBottom: 12,
                    fontSize: 13,
                  }}
                >
                  <span style={{ marginRight: "auto" }}>
                    👁️ Previewing <strong>version {previewingVersion}</strong> — <strong>Save changes</strong> to
                    restore it, or Cancel to discard.
                  </span>
                </div>
              )}
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

              {/*
                Agency level, this is the FALLBACK name — what a client is told they're
                using when their own sub-account hasn't been given a name. Left empty it
                falls through to your company name, which is your agency's name, not the
                white-label one their clients know.
              */}
              {isAgencyDefault && (
                <div className="field">
                  <label>Default platform name</label>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="What clients call the software"
                  />
                  <p className="field-hint">
                    Used for any sub-account you haven't named individually — in the browser tab and
                    in every answer the support assistant gives. Leave it blank and we'll fall back to
                    your own company name, which your clients aren't meant to see.
                  </p>
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
                    Uploaded {logoDims.ow}×{logoDims.oh}px → stored at {logoDims.w}×{logoDims.h}px as{" "}
                    {logoDims.format.toUpperCase()}, {(logoDims.bytes / 1024).toFixed(1)} KB
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

              {/*
                The browser tab is the one piece of branding that stays on screen when the
                client switches away, and it's the last place the vendor's icon survives.
                Needs the pasted JavaScript because CSS cannot set a favicon at all.
              */}
              <div className="field">
                <label>Browser tab icon</label>
                <input
                  type="url"
                  value={faviconUrl.startsWith("data:") ? "" : faviconUrl}
                  onChange={(e) => setFaviconUrl(e.target.value)}
                  placeholder="Paste an image URL…"
                />
                <div className="logo-upload-row">
                  <label className="btn btn-ghost logo-upload-btn">
                    Upload from computer
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleFaviconFile(e.target.files?.[0])}
                    />
                  </label>
                  {faviconUrl.startsWith("data:") && <span className="logo-uploaded">Uploaded image ✓</span>}
                  {faviconUrl && (
                    <button type="button" className="btn btn-ghost" onClick={() => setFaviconUrl("")}>
                      Clear
                    </button>
                  )}
                </div>
                <p className="field-hint">
                  A <strong>square</strong> image works best — it's shrunk to 64&nbsp;px. This one needs the
                  optional JavaScript from <strong>Get the code</strong>; CSS can't set a tab icon.
                  {isAgencyDefault && " Used by any sub-account without its own."}
                </p>
                {faviconErr && <div className="field-error">{faviconErr}</div>}
                {faviconUrl && (
                  <div className="logo-preview" style={{ marginTop: 8 }}>
                    <img src={faviconUrl} alt="tab icon preview" style={{ width: 32, height: 32, objectFit: "contain" }} />
                    <span>Preview</span>
                  </div>
                )}
              </div>

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

              <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => setPresetPromptOpen(true)}>
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
              {featuresError && <div className="field-error" style={{ marginBottom: 10 }}>{featuresError}</div>}
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

          {tab === "login" && isAgencyDefault && (
            <div>
              <label style={{ fontWeight: 600, fontSize: 14 }}>Login page</label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 14px" }}>
                Brands the GoHighLevel <strong>login screen</strong> for your whole agency (it's shared —
                there's one login before a sub-account is chosen). Leave a field blank to skip it.
              </p>

              <div className="look-color-row">
                <input
                  type="color"
                  value={loginBgColor || "#0f172a"}
                  onChange={(e) => setLoginBgColor(e.target.value)}
                />
                <div>
                  <div className="look-color-label">Background color</div>
                  <div className="look-color-hint">The full-page background behind the login box.</div>
                </div>
              </div>

              <div className="look-toggle-row" style={{ marginTop: 10 }}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={loginGradientEnabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setLoginGradientEnabled(on);
                      // The gradient needs a base color; if the picker was never
                      // touched (empty), seed it so the gradient actually renders.
                      if (on && !loginBgColor) setLoginBgColor("#0f172a");
                    }}
                  />
                  <span className="toggle-track" />
                </label>
                <div>
                  <div className="look-color-label">Gradient background</div>
                  <div className="look-color-hint">Blend the background color into a second color.</div>
                </div>
              </div>
              {loginGradientEnabled && (
                <>
                  <div className="look-color-row">
                    <input
                      type="color"
                      value={loginGradientColor || "#1e293b"}
                      onChange={(e) => setLoginGradientColor(e.target.value)}
                    />
                    <div>
                      <div className="look-color-label">Gradient — second color</div>
                    </div>
                  </div>
                  <div className="look-angle">
                    <label>Gradient angle: {loginGradientAngle}°</label>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={loginGradientAngle}
                      onChange={(e) => setLoginGradientAngle(Number(e.target.value))}
                    />
                  </div>
                </>
              )}

              <div className="field" style={{ marginTop: 10 }}>
                <label>Background image (overrides colors)</label>
                <input
                  type="url"
                  value={loginBgImage.startsWith("data:") ? "" : loginBgImage}
                  onChange={(e) => setLoginBgImage(e.target.value)}
                  placeholder="Paste an image URL…"
                />
                <div className="logo-upload-row">
                  <label className="btn btn-ghost logo-upload-btn">
                    Upload image
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleLoginBgFile(e.target.files?.[0])}
                    />
                  </label>
                  {loginBgImage && (
                    <>
                      <span className="logo-uploaded">Image set ✓</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setLoginBgImage("")}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="look-color-row">
                <input
                  type="color"
                  value={loginButtonColor || "#4f46e5"}
                  onChange={(e) => setLoginButtonColor(e.target.value)}
                />
                <div>
                  <div className="look-color-label">Sign-in button color</div>
                </div>
              </div>

              <div className="look-color-row">
                <input
                  type="color"
                  value={loginCardColor || "#ffffff"}
                  onChange={(e) => setLoginCardColor(e.target.value)}
                />
                <div>
                  <div className="look-color-label">Login box color</div>
                  <div className="look-color-hint">Background of the centered login card.</div>
                </div>
              </div>

              <div className="field" style={{ marginTop: 10 }}>
                <label>Login logo</label>
                <input
                  type="url"
                  value={loginLogoUrl.startsWith("data:") ? "" : loginLogoUrl}
                  onChange={(e) => setLoginLogoUrl(e.target.value)}
                  placeholder="Paste a logo URL…"
                />
                <div className="logo-upload-row">
                  <label className="btn btn-ghost logo-upload-btn">
                    Upload logo
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleLoginLogoFile(e.target.files?.[0])}
                    />
                  </label>
                  {loginLogoUrl && <span className="logo-uploaded">Logo set ✓</span>}
                </div>
                <p className="logo-hint">Shown above the login form. May need size tuning per theme.</p>
              </div>
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

          {tab === "history" && defaultHistory && (
            <div className="field">
              <label>Undo history</label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Your default look is saved here before every change, so you can always go back.
                Restoring is itself undoable — the look you have now gets saved first.
              </p>
              {defaultVersions === null ? (
                <div className="empty-state">Loading history&hellip;</div>
              ) : defaultVersions.length === 0 ? (
                <div className="empty-state">
                  Nothing to go back to yet. The next time you save, the look you have now is kept here.
                </div>
              ) : (
                <div className="version-list">
                  {defaultVersions.map((v) => (
                    <div key={v.id} className="version-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Show the look, not just a timestamp — "which one was that?" is
                            the actual question, and a date can't answer it. */}
                        <span
                          className="version-swatch"
                          style={{
                            background: `linear-gradient(135deg, ${v.primaryColor ?? "#cbd5e1"}, ${
                              v.accentColor ?? v.primaryColor ?? "#cbd5e1"
                            })`,
                          }}
                        />
                        <div>
                          <div className="version-title">
                            {v.brandName || "No brand name"}
                            {v.hasLogo && <span className="version-current"> · logo</span>}
                          </div>
                          <div className="version-date">
                            {new Date(v.createdAt).toLocaleString()}
                            {v.reason ? ` · ${v.reason}` : ""}
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        disabled={!!restoringId}
                        onClick={async () => {
                          if (!onRestoreDefaultVersion) return;
                          setRestoringId(v.id);
                          try {
                            await onRestoreDefaultVersion(v.id);
                          } finally {
                            setRestoringId(null);
                          }
                        }}
                      >
                        {restoringId === v.id ? "Restoring…" : "↩︎ Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "history" && history && (
            <div className="field">
              <label>Version history</label>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Every save is a version. Click <strong>View</strong> to load one into the editor and
                see it in the live preview, then <strong>Save changes</strong> to restore it as a new
                version.
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
                        onClick={() => loadVersion(v, i === 0)}
                      >
                        {i === 0 ? "View current" : "👁️ View"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
          {tab === "login" && isAgencyDefault ? (
            <LoginPreview
              bgColor={loginBgColor}
              bgImage={loginBgImage}
              gradientEnabled={loginGradientEnabled}
              gradientColor={loginGradientColor}
              gradientAngle={loginGradientAngle}
              cardColor={loginCardColor}
              buttonColor={loginButtonColor}
              logoUrl={loginLogoUrl}
            />
          ) : (
            <MosaicPreview
              look={look}
              logoUrl={logoUrl}
              brandName={showBrandName ? brandName : undefined}
              features={features}
              hidden={hidden}
              labels={labels}
              order={menuOrder}
            />
          )}
        </div>

        <div className="modal-footer">
          {/* Agency-level twin of the per-sub-account Reset in the table. Pushed to the
              left so it reads as a destructive escape hatch, not a primary action. */}
          {isAgencyDefault && onReset && (
            <button
              className="btn"
              style={{ marginRight: "auto", color: "#b91c1c" }}
              onClick={onReset}
              disabled={saving}
              title="Clear the agency default look (sub-account themes are kept)"
            >
              Reset to GHL default
            </button>
          )}
          {saveError && (
            <span style={{ fontSize: 13, color: "#b91c1c", marginRight: "auto" }}>{saveError}</span>
          )}
          <button className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
    {presetPromptOpen && (
      <PromptDialog
        title="Save as preset"
        label="Preset name"
        placeholder="e.g. Dark Gold"
        submitLabel="Save preset"
        onSubmit={doSaveAsPreset}
        onCancel={() => setPresetPromptOpen(false)}
      />
    )}
    {confirmDiscard && (
      <ConfirmDialog
        title="Discard your changes?"
        message="You've edited this theme but haven't saved it. Closing now discards those edits — the sub-account keeps the theme it had before."
        confirmLabel="Discard changes"
        danger
        onConfirm={onCancel}
        onCancel={() => setConfirmDiscard(false)}
      />
    )}
    </>
  );
}
