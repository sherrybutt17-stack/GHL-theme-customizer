const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3210";

// Dashboard session token, minted at /admin-embed and delivered in the URL FRAGMENT
// (#t=...) so it never reaches a server log/Referer. (Older links used ?t= — still
// accepted for back-compat.) Stashed in sessionStorage so every API call carries it
// (verified server-side when DASHBOARD_AUTH_ENABLED=true) and survives in-app nav.
function readToken(): string {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const fromUrl = hashParams.get("t") ?? queryParams.get("t");
  if (fromUrl) {
    sessionStorage.setItem("mosaic_token", fromUrl);
    // Strip the token from the visible URL (address bar, history, copy-pasted links).
    hashParams.delete("t");
    queryParams.delete("t");
    const qs = queryParams.toString();
    const hs = hashParams.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + (hs ? `#${hs}` : "")
    );
    return fromUrl;
  }
  return sessionStorage.getItem("mosaic_token") ?? "";
}
const TOKEN = readToken();

function authHeaders(): Record<string, string> {
  return TOKEN ? { "x-mosaic-token": TOKEN } : {};
}

// Defined in its own module so it can be imported without pulling in `import.meta.env`
// (see sessionMessage.ts). Re-exported here because every existing caller imports it
// from this file.
export { SESSION_EXPIRED_MESSAGE } from "./sessionMessage";
import { SESSION_EXPIRED_MESSAGE } from "./sessionMessage";

export class SessionExpiredError extends Error {
  readonly sessionExpired = true;
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

/**
 * There is deliberately NO `isSessionExpiredError` predicate, and one was removed.
 *
 * `App.tsx` decides between the amber instruction banner and the red error one by
 * comparing the stored message to SESSION_EXPIRED_MESSAGE, because every catch block
 * stores `e.message` rather than the error — and `summariseBulk` composes a SENTENCE, so
 * at the one call site that matters there is no error object left to test. A predicate
 * sitting here reads as the better branch and cannot be used for it; taking it would
 * silently drop the bulk path back to a red banner with no remedy in it.
 */

/**
 * When this session stops being accepted, read straight off the token.
 *
 * The token is `agencyInstallId.expiryMillis.signature` and the expiry is PLAINTEXT — it
 * is the signature that makes it trustworthy, not secrecy, so the dashboard can read its
 * own deadline without the signing key. That is the difference between telling somebody
 * their session has expired and telling them BEFORE they spend twenty minutes rebranding
 * a sub-account that cannot be saved. It is a hint, never a decision: the server verifies.
 *
 * Returns null when there is no token or it does not parse — callers must treat that as
 * "unknown", not "expired", or a dev session with auth disabled would be locked out.
 */
export function sessionExpiresAt(): number | null {
  const exp = Number(TOKEN.split(".")[1]);
  return Number.isFinite(exp) && exp > 0 ? exp : null;
}

/** Drop the stored token so a reload cannot keep retrying a credential we know is dead. */
export function clearSession(): void {
  try {
    sessionStorage.removeItem("mosaic_token");
  } catch {
    /* storage throws in private modes; the token is dead either way */
  }
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
  sidebarIconColor: string | null;
  buttonShape: string | null;
  darkMode: boolean;
  contentBgColor: string | null;
  contentTextColor: string | null;
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

/** Agency-level login-page branding (only on the agency default theme). */
export interface LoginBranding {
  loginBgColor: string | null;
  loginBgImage: string | null;
  loginGradientEnabled: boolean;
  loginGradientColor: string | null;
  loginGradientAngle: number;
  loginCardColor: string | null;
  loginButtonColor: string | null;
  loginLogoUrl: string | null;
}

export interface AgencyDefaultTheme extends VisualTheme, LoginBranding {
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
  sidebarIconColor: string | null;
  buttonShape: string | null;
  darkMode: boolean;
  contentBgColor: string | null;
  contentTextColor: string | null;
  menuOrder: string[] | null;
}

export interface LocationRow {
  id: string;
  ghlLocationId: string;
  locationName: string | null;
  enabled: boolean;
  /** Whether the support widget is offered in THIS sub-account (independent of theming). */
  supportEnabled: boolean;
  theme: ThemeConfig | null;
  /**
   * How many saved theme versions this sub-account has. Reset DELETES all of them, so this
   * is what the confirm dialog needs to state the blast radius — the same reason the desk's
   * Staff screen carries a Holding count beside Disable.
   */
  themeVersions: number;
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
  /** Browser-tab icon. Delivered by the pasted JS bundle — CSS cannot set a favicon. */
  faviconUrl?: string | null;
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
  sidebarIconColor: string;
  buttonShape: string;
  darkMode: boolean;
  contentBgColor: string;
  contentTextColor: string;
  hideUpgrade: boolean;
  alertMessage: string;
  alertColor: string;
  customCss: string;
  menuLabelOverrides: Record<string, string>;
  hiddenFeatures: string[];
  menuOrder: string[];
  // Login-page branding — only sent for the agency default theme.
  loginBgColor?: string;
  loginBgImage?: string;
  loginGradientEnabled?: boolean;
  loginGradientColor?: string;
  loginGradientAngle?: number;
  loginCardColor?: string;
  loginButtonColor?: string;
  loginLogoUrl?: string;
}

// Returns any so `.then(handle)` composes cleanly; each exported fn types its result.
async function handle(res: Response): Promise<any> {
  if (!res.ok) {
    // 401 is the ONE failure with a remedy the reader can carry out, and only the client
    // knows what it is — the session cannot be renewed from in here (the ?k= slug was
    // consumed at /admin-embed and never reaches this app), so the answer is always
    // "reopen Mosaic from the GHL sidebar". Clearing the token stops a reload silently
    // retrying a credential we already know is dead.
    if (res.status === 401) {
      clearSession();
      throw new SessionExpiredError();
    }
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

export const resetTheme = (
  a: string,
  loc: string
): Promise<{ reset: boolean; versionsDeleted: number }> =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/theme`, j("DELETE")).then(handle);

export const fetchDefaultTheme = (a: string): Promise<AgencyDefaultTheme | null> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme`, g()).then(handle);

export const saveDefaultTheme = (a: string, theme: ThemeInput): Promise<AgencyDefaultTheme> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme`, j("PUT", theme)).then(handle);

/** Clear the agency default look entirely (sub-account overrides are kept). */
export const resetDefaultTheme = (a: string): Promise<{ reset: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme`, j("DELETE")).then(handle);

/**
 * Undo history for the agency default. Per-sub-account themes have always had this
 * (ThemeConfig is versioned); the agency default is a single upserted row that styles
 * EVERY sub-account, so it needs it more, not less.
 */
export interface DefaultThemeVersion {
  id: string;
  createdAt: string;
  reason: string | null;
  brandName: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  topBarColor: string | null;
  hasLogo: boolean;
}

export const fetchDefaultThemeVersions = (a: string): Promise<DefaultThemeVersion[]> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme/versions`, g()).then(handle);

export const restoreDefaultThemeVersion = (a: string, versionId: string): Promise<AgencyDefaultTheme> =>
  fetch(`${API_BASE}/admin/api/${a}/default-theme/versions/${versionId}/restore`, j("POST", {})).then(handle);

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

// --- Support ---

export type SupportBoundary = "how_to_only" | "how_to_and_account" | "custom";

/** `[9, 17]` means 9am–5pm; null means closed that day. */
export type DaySlot = [number, number] | null;

export interface BusinessHours {
  tz: string;
  days: Record<string, DaySlot>;
}

export interface SupportConfig {
  enabled: boolean;
  greeting: string | null;
  quickActions: string[];
  businessHours: BusinessHours | null;
  /**
   * Minutes a client may wait for their first human reply, per priority.
   *
   * MUST be sent on every save: the PUT clears any field it is not sent (`?? DbNull`, the
   * same whole-object convention as businessHours), so a payload that omits this key
   * resets the targets to the defaults rather than leaving them alone. Measured, not
   * assumed — the editor's own save round-trips the GET's object, which already carried
   * the field, so the targets were never LOST here. They were simply unreachable: nothing
   * on any screen could change them, exactly like `faviconUrl` and the agency-level
   * `brandName` before it.
   */
  slaFirstResponseMins: Record<string, number> | null;
  /**
   * `{ locationInstallId: "Starter" }` — what each client actually bought, which turns
   * "isn't part of your setup" into "isn't included on your Starter plan".
   *
   * Carried here so the editor's save round-trips it. The PUT writes this column
   * unconditionally and defaults it to `{}`, so a config object without the key does not
   * leave the plan names alone — it deletes them.
   */
  planTiers: Record<string, string>;
  escalationEmails: string[];
  supportBoundary: SupportBoundary;
  boundaryNotes: string | null;
  forbiddenTerms: string[];
  allowedLinkDomains: string[];
  voiceTone: string | null;
  userNoun: string | null;
}

export interface SupportSettingsResponse {
  config: SupportConfig;
  locationsEnabled: number;
  locationsTotal: number;
}

export const fetchSupportConfig = (a: string): Promise<SupportSettingsResponse> =>
  fetch(`${API_BASE}/admin/api/${a}/support`, g()).then(handle);

export const saveSupportConfig = (a: string, config: SupportConfig): Promise<SupportConfig> =>
  fetch(`${API_BASE}/admin/api/${a}/support`, j("PUT", config)).then(handle);

export interface SupportStats {
  days: number;
  totals: {
    conversations: number;
    deflected: number;
    escalated: number;
    handedToAgency: number;
    clientMessages: number;
  };
  /** Share of FINISHED conversations the bot resolved alone. Null when there's no data. */
  deflectionRate: number | null;
  csat: { positive: number; negative: number; rate: number | null };
  /** Timed from the HAND-OFF, not the start of the chat — see supportStats.ts. */
  firstReply: { medianMinutes: number | null; p90Minutes: number | null; sampleCount: number };
  byLocation: {
    locationInstallId: string;
    locationName: string | null;
    conversations: number;
    deflected: number;
    escalated: number;
  }[];
  topTopics: { key: string; label: string; count: number }[];
  /**
   * What the conversations that needed a PERSON were about.
   *
   * The complement to `topTopics`, which is built from the tags of articles the bot cited
   * and therefore only ever describes questions the knowledge base already answered. The
   * ones that beat the bot cite nothing and are invisible there.
   */
  handoffTypes: {
    total: number;
    untyped: number;
    types: { key: string; label: string; count: number }[];
  };
  daily: { date: string; conversations: number; deflected: number }[];
}

export interface DryRunResult {
  id: string;
  question: string;
  /** What a correct answer has to do — shown so the agency can judge for themselves. */
  expect: string;
  answer: string;
  escalated: boolean;
  /** Whether the safety gates found anything. Not a judgement of answer quality. */
  clean: boolean;
  findings: { gate: string; detail: string }[];
  usedReferences: number;
  error?: string;
  /** Why this row is not an answer. Null for a real answer or a correct hand-off. */
  modelFailure: string | null;
}

export interface DryRunResponse {
  brandName: string;
  brandNameSource: string;
  locationName: string | null;
  /** Only the menu items this agency actually renamed, as from → to pairs. */
  renamedLabels: Array<{ key: string; from: string; to: string }>;
  hiddenFeatures: string[];
  results: DryRunResult[];
  /** The GATES found nothing. True of a bot that answered nothing at all — see `ready`. */
  allClean: boolean;
  /** Clean AND the model actually ran. This is the "safe to switch on" answer. */
  ready: boolean;
  /**
   * Why the assistant did not answer, when it did not. Null when it did.
   * `rows` of `of` because a correct pre-model hand-off (the money guard) is not a failure.
   */
  modelFailure: {
    kind: "not-configured" | "auth" | "no-credits" | "rate-limited" | "transient";
    rows: number;
    of: number;
    remedy: string;
    permanent: boolean;
  } | null;
}

export const runSupportDryRun = (a: string, locationInstallId: string): Promise<DryRunResponse> =>
  fetch(`${API_BASE}/admin/api/${a}/support/dry-run`, j("POST", { locationInstallId })).then(handle);

export interface KbArticle {
  id: string;
  title: string;
  /** Stored brand-neutral: {{PLATFORM}} where a brand name was written. */
  body: string;
  status: "ready" | "needs_review" | "archived";
  featureTags: string[];
  /** Terms that tripped the brand scan, so a quarantined article can be fixed. */
  residualLeaks: string[];
  updatedAt?: string;
  quarantined?: boolean;
}

export const fetchKbArticles = (a: string): Promise<{ articles: KbArticle[]; sharedArticles: number }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb`, g()).then(handle);

export const saveKbArticle = (a: string, article: { title: string; body: string }, id?: string): Promise<KbArticle> =>
  fetch(`${API_BASE}/admin/api/${a}/kb${id ? `/${id}` : ""}`, j(id ? "PUT" : "POST", article)).then(handle);

export const deleteKbArticle = (a: string, id: string): Promise<{ deleted: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/${id}`, j("DELETE")).then(handle);

/** Publish an article that was held for review. Refused (422) if a brand term survived. */
export const approveKbArticle = (a: string, id: string): Promise<{ approved: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/${id}/approve`, j("POST")).then(handle);

/** A syndication feed the agency has pointed us at — usually their own blog or help site. */
export interface KbFeed {
  id: string;
  url: string;
  title: string | null;
  enabled: boolean;
  /** Off until they have read a few items and decided the feed is worth trusting. */
  autoPublish: boolean;
  lastPolledAt?: string | null;
  lastItemAt?: string | null;
  lastError?: string | null;
  consecutiveErrors?: number;
  /**
   * The poller gave up on it — ten straight failures — as opposed to the agency pausing
   * it. Both are `enabled: false`, and only one of them is something we did.
   */
  gaveUp?: boolean;
}

export const fetchKbFeeds = (a: string): Promise<{ feeds: KbFeed[] }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/feeds`, g()).then(handle);

export const addKbFeed = (a: string, url: string): Promise<{ feed: KbFeed }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/feeds`, j("POST", { url })).then(handle);

export const updateKbFeed = (
  a: string,
  id: string,
  patch: { enabled?: boolean; autoPublish?: boolean }
): Promise<{ updated: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/feeds/${id}`, j("PUT", patch)).then(handle);

export const deleteKbFeed = (a: string, id: string): Promise<{ deleted: boolean }> =>
  fetch(`${API_BASE}/admin/api/${a}/kb/feeds/${id}`, j("DELETE")).then(handle);

export const fetchSupportStats = (a: string, days = 30): Promise<SupportStats> =>
  fetch(`${API_BASE}/admin/api/${a}/support/stats?days=${days}`, g()).then(handle);

/** Per-sub-account widget toggle. Separate from `setEnabled`, which is theming. */
export const setSupportEnabled = (a: string, loc: string, supportEnabled: boolean) =>
  fetch(`${API_BASE}/admin/api/${a}/locations/${loc}/support`, j("PUT", { supportEnabled })).then(handle);
