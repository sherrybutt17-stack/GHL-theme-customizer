const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3210";

// Dashboard session token, minted at /admin-embed and passed as ?t=...
// We stash it so every API call carries it (verified server-side when
// DASHBOARD_AUTH_ENABLED=true). Persisted to sessionStorage so it survives
// in-app navigations that drop the query string.
function readToken(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("t");
  if (fromUrl) {
    sessionStorage.setItem("mosaic_token", fromUrl);
    // Strip the token from the visible URL so it doesn't linger in the address bar,
    // browser history, or any copy-pasted link. It lives in sessionStorage now.
    params.delete("t");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
    );
    return fromUrl;
  }
  return sessionStorage.getItem("mosaic_token") ?? "";
}
const TOKEN = readToken();

function authHeaders(): Record<string, string> {
  return TOKEN ? { "x-mosaic-token": TOKEN } : {};
}

/** The visual look fields shared by location themes, the agency default, and presets. */
export interface VisualTheme {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  gradientEnabled: boolean;
  gradientColor: string | null;
  gradientAngle: number;
  topBarColor: string | null;
  buttonColor: string | null;
  cornerRadius: number | null;
  sidebarImageUrl: string | null;
  scrollbarColor: string | null;
  sidebarTextColor: string | null;
  contentBgColor: string | null;
  contentTextColor: string | null;
  buttonShape: string | null;
  darkMode: boolean;
  hideUpgrade: boolean;
  alertMessage: string | null;
  alertColor: string | null;
  menuLabelOverrides: Record<string, string> | null;
  hiddenFeatures: string[] | null;
  menuOrder: string[] | null;
}

export interface ThemeConfig extends VisualTheme {
  id: string;
  brandName: string | null;
  customCssOverride: string | null;
  version: number;
  createdAt?: string;
}

export interface AgencyDefaultTheme extends VisualTheme {
  id: string;
  customCss: string | null;
}

export interface ThemePreset {
  id: string;
  name: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  gradientEnabled: boolean;
  gradientColor: string | null;
  gradientAngle: number;
  topBarColor: string | null;
  buttonColor: string | null;
  cornerRadius: number | null;
  scrollbarColor: string | null;
  sidebarTextColor: string | null;
  contentBgColor: string | null;
  contentTextColor: string | null;
  buttonShape: string | null;
  darkMode: boolean;
  menuOrder: string[] | null;
}

export interface LocationRow {
  id: string;
  ghlLocationId: string;
  locationName: string | null;
  enabled: boolean;
  theme: ThemeConfig | null;
}

export interface SidebarFeature {
  key: string;
  label: string;
  /** "main" (top-level sidebar) or "settings" (Settings-page sidebar). */
  group?: "main" | "settings";
}

/** Everything the theme editor collects. brandName only applies to a location. */
export interface ThemeInput {
  brandName?: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  gradientEnabled: boolean;
  gradientColor: string;
  gradientAngle: number;
  topBarColor: string;
  buttonColor: string;
  cornerRadius: number | null;
  sidebarImageUrl: string;
  scrollbarColor: string;
  sidebarTextColor: string;
  contentBgColor: string;
  contentTextColor: string;
  buttonShape: string;
  darkMode: boolean;
  hideUpgrade: boolean;
  alertMessage: string;
  alertColor: string;
  customCss: string;
  menuLabelOverrides: Record<string, string>;
  hiddenFeatures: string[];
  menuOrder: string[];
}

// Returns any so `.then(handle)` composes cleanly; each exported fn types its result.
async function handle(res: Response): Promise<any> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

const j = (method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", ...authHeaders() },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const g = () => ({ headers: authHeaders() });

export const fetchSidebarFeatures = (scope?: "agency"): Promise<SidebarFeature[]> =>
  fetch(`${API_BASE}/admin/api/sidebar-features${scope ? `?scope=${scope}` : ""}`, g()).then(handle);

export const fetchLocations = (a: string): Promise<LocationRow[]> =>
  fetch(`${API_BASE}/admin/api/${a}/locations`, g()).then(handle);

export const saveTheme = (a: string, loc: string, theme: ThemeInput): Promise<ThemeConfig> =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/theme`, j("PUT", theme)).then(handle);

export const fetchThemeVersions = (a: string, loc: string): Promise<ThemeConfig[]> =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/theme/versions`, g()).then(handle);

export const setEnabled = (a: string, loc: string, enabled: boolean) =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/enabled`, j("PUT", { enabled })).then(handle);

export const resetTheme = (a: string, loc: string): Promise<{ reset: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/theme`, j("DELETE")).then(handle);

export const fetchDefaultTheme = (a: string): Promise<AgencyDefaultTheme | null> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme`, g()).then(handle);

export const saveDefaultTheme = (a: string, theme: ThemeInput): Promise<AgencyDefaultTheme> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme`, j("PUT", theme)).then(handle);

export const fetchPresets = (a: string): Promise<ThemePreset[]> =>
  fetch(`${API_BASE}/admin/api/${a}/presets`, g()).then(handle);

export const createPreset = (a: string, preset: Partial<ThemePreset> & { name: string }): Promise<ThemePreset> =>
  fetch(`${API_BASE}/admin/api/${a}/presets`, j("POST", preset)).then(handle);

export const deletePreset = (a: string, id: string) =>
  fetch(`${API_BASE}/admin/api/${a}/presets/${id}`, j("DELETE")).then(handle);

export const applyPreset = (
  a: string,
  presetId: string,
  locationInstallIds: string[]
): Promise<{ applied: number }> =>
  fetch(`${API_BASE}/admin/api/${a}/presets/${presetId}/apply`, j("POST", { locationInstallIds })).then(
    handle
  );

export interface EmbedInfo {
  importSnippet: string;
  fullCss: string;
  jsUrl: string;
  jsSnippet: string;
}

export const fetchEmbedInfo = (a: string): Promise<EmbedInfo> =>
  fetch(`${API_BASE}/admin/api/${a}/embed`, g()).then(handle);

export interface BrandScanResult {
  sourceUrl: string;
  siteName?: string;
  themeColor?: string;
  imageDataUrl?: string;
}

export const scanBrandWebsite = (a: string, url: string): Promise<BrandScanResult> =>
  fetch(`${API_BASE}/admin/api/${a}/brand-scan`, j("POST", { url })).then(handle);
