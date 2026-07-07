const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3210";

export interface ThemeConfig {
  id: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  version: number;
}

export interface LocationRow {
  id: string;
  ghlLocationId: string;
  locationName: string | null;
  enabled: boolean;
  theme: ThemeConfig | null;
}

export interface ThemeInput {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function fetchLocations(agencyInstallId: string): Promise<LocationRow[]> {
  return fetch(`${API_BASE}/admin/api/${agencyInstallId}/locations`).then((r) => handle(r));
}

export function saveTheme(
  agencyInstallId: string,
  locationInstallId: string,
  theme: ThemeInput
): Promise<ThemeConfig> {
  return fetch(`${API_BASE}/admin/api/${agencyInstallId}/locations/${locationInstallId}/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(theme),
  }).then((r) => handle(r));
}

export interface EmbedInfo {
  importSnippet: string;
  fullCss: string;
}

export function fetchEmbedInfo(agencyInstallId: string): Promise<EmbedInfo> {
  return fetch(`${API_BASE}/admin/api/${agencyInstallId}/embed`).then((r) => handle(r));
}

export function setEnabled(
  agencyInstallId: string,
  locationInstallId: string,
  enabled: boolean
): Promise<{ id: string; enabled: boolean }> {
  return fetch(`${API_BASE}/admin/api/${agencyInstallId}/locations/${locationInstallId}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then((r) => handle(r));
}
