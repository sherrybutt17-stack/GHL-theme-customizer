/**
 * The standard GHL sub-account sidebar items. Each nav link carries a stable
 * id of the form `#sb_<key>` and a `meta="<key>"` attribute (confirmed via live
 * DOM inspection, e.g. <a id="sb_dashboard" meta="dashboard">). We target these
 * for per-location feature hiding and menu-label renaming.
 *
 * `key` matches the sidebar element id suffix (#sb_<key>). `label` is the default
 * GHL label, shown in the admin UI so the agency knows what they're toggling.
 */
export interface SidebarFeature {
  key: string;
  label: string;
  /** Explicit selector override; when absent we use `#sb_<key>, a[meta="<key>"]`. */
  selector?: string;
}

export const GHL_SIDEBAR_FEATURES: SidebarFeature[] = [
  { key: "launchpad", label: "Launchpad" },
  { key: "dashboard", label: "Dashboard" },
  { key: "conversations", label: "Conversations" },
  { key: "calendars", label: "Calendars" },
  { key: "contacts", label: "Contacts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "payments", label: "Payments" },
  { key: "ai-agents", label: "AI Agents" },
  { key: "marketing", label: "Marketing" },
  { key: "automation", label: "Automation" },
  { key: "sites", label: "Sites" },
  { key: "memberships", label: "Memberships" },
  { key: "media-storage", label: "Media Storage" },
  { key: "reputation", label: "Reputation" },
  { key: "reporting", label: "Reporting" },
  { key: "app-marketplace", label: "App Marketplace" },
];

/**
 * The AGENCY-level sidebar items (shown when editing the Agency default theme).
 * These differ from the sub-account list above. Selectors follow the same
 * `#sb_<key>` / `meta="<key>"` pattern; keys are best-effort and can be refined
 * against a live agency-sidebar DOM dump if any prove off.
 */
export const GHL_AGENCY_SIDEBAR_FEATURES: SidebarFeature[] = [
  { key: "agency-prospecting", label: "Prospecting", selector: 'a[href*="/prospect"]' },
  { key: "agency-sub-accounts", label: "Sub-Accounts", selector: 'a[href*="/sub-account"], a[href*="/location-list"], a[href*="/agency/locations"]' },
  { key: "agency-snapshots", label: "Account Snapshots", selector: 'a[href*="/snapshot"]' },
  { key: "agency-reselling", label: "Reselling", selector: 'a[href*="/reselling"], a[href*="/resell"]' },
  { key: "agency-add-ons", label: "Add-Ons", selector: 'a[href*="/add-ons"], a[href*="/addons"]' },
  { key: "agency-affiliate", label: "Affiliate Portal", selector: 'a[href*="/affiliate"]' },
  { key: "agency-template-library", label: "Template Library", selector: 'a[href*="/template"]' },
  { key: "agency-partners", label: "Partners", selector: 'a[href*="/partners"]' },
  { key: "agency-university", label: "University", selector: 'a[href*="/university"]' },
  { key: "agency-saas-education", label: "SaaS Education", selector: 'a[href*="/saas"]' },
  { key: "agency-swag", label: "GHL Swag", selector: 'a[href*="/swag"]' },
  { key: "agency-ideas", label: "Ideas", selector: 'a[href*="/ideas"]' },
  { key: "agency-mobile-app", label: "Mobile App", selector: 'a[href*="/mobile"]' },
  { key: "agency-desktop-app", label: "Desktop App", selector: 'a[href*="/desktop"]' },
  { key: "agency-app-marketplace", label: "App Marketplace", selector: 'a[href*="/integration"], a[href*="/app-marketplace"]' },
];

/**
 * The SUB-ACCOUNT Settings-page sidebar items (Settings → Business Profile, My
 * Staff, Calendars, etc.) - a THIRD nav, distinct from the two main sidebars
 * above and only visible inside Settings.
 *
 * These links DO carry `#sb_<key>` / `meta="<key>"` like the main sidebar, but we
 * deliberately target them by their unique href fragment instead, because:
 *   1. Some keys COLLIDE with the main sidebar (e.g. Settings "Calendars" shares
 *      id="sb_calendars"/meta="calendars" with the main sidebar Calendars), so an
 *      id/meta selector would hit both navs.
 *   2. The href already embeds the locationId (/v2/location/<id>/settings/...),
 *      which gives us clean per-sub-account scoping (see themeCssBundle) - the
 *      Settings nav lives OUTSIDE the location-classed sidebar wrapper, so the
 *      ancestor-prefix scoping used for the main sidebar wouldn't reach it.
 *
 * Keys are prefixed `settings-` so they never clash with main-sidebar keys in the
 * stored hiddenFeatures/menuLabelOverrides maps. Fragments below are CONFIRMED via
 * live DOM inspection; the remaining Settings items can be appended the same way
 * once their hrefs are captured.
 */
export const GHL_SETTINGS_SIDEBAR_FEATURES: SidebarFeature[] = [
  // "Settings" subsection.
  // --- href slugs CONFIRMED via live DOM (190 Ranch sub-account) ---
  { key: "settings-my-staff", label: "My Staff", selector: 'a[href*="/settings/staff"]' },
  { key: "settings-opportunities", label: "Opportunities & Pipelines", selector: 'a[href*="/crm-settings"]' },
  { key: "settings-calendars", label: "Calendars (Settings)", selector: 'a[href*="/settings/calendars"]' },
  { key: "settings-email-services", label: "Email Services", selector: 'a[href*="/settings/smtp_service"]' },
  { key: "settings-phone-system", label: "Phone System", selector: 'a[href*="/settings/phone_system"]' },
  { key: "settings-whatsapp", label: "WhatsApp", selector: 'a[href*="/settings/whatsapp"]' },

  // "Other Settings" subsection.
  { key: "settings-objects", label: "Objects", selector: 'a[href*="/settings/objects"]' },
  // Custom Fields' href slug is `/settings/fields` (id sb_custom-fields-settings) — NOT `/custom_fields`.
  { key: "settings-custom-fields", label: "Custom Fields", selector: 'a[href*="/settings/fields"]' },
  { key: "settings-custom-values", label: "Custom Values", selector: 'a[href*="/settings/custom_values"]' },
  { key: "settings-import-data", label: "Import Data", selector: 'a[href*="/settings/import-data"]' },
  { key: "settings-manage-scoring", label: "Manage Scoring", selector: 'a[href*="/settings/scoring"]' },
  { key: "settings-preferences", label: "Preference Management", selector: 'a[href*="/settings/preferences"]' },

  // --- BEST-EFFORT: present in the live nav but their exact href slug wasn't in
  // the DOM dump; using the conventional `/settings/<slug>`. A non-matching
  // selector is a harmless no-op — correct any slug that proves off. ---
  { key: "settings-domains", label: "Domains & URL Redirects", selector: 'a[href*="/settings/domain"]' },
  { key: "settings-external-tracking", label: "External Tracking", selector: 'a[href*="/settings/external"]' },
  { key: "settings-integrations", label: "Integrations", selector: 'a[href*="/settings/integrations"]' },
  { key: "settings-private-integrations", label: "Private Integrations", selector: 'a[href*="/settings/private-integrations"]' },
  { key: "settings-tags", label: "Tags", selector: 'a[href*="/settings/tags"]' },
  { key: "settings-labs", label: "Labs", selector: 'a[href*="/settings/labs"]' },
  { key: "settings-audit-logs", label: "Audit Logs", selector: 'a[href*="/settings/audit"]' },
  { key: "settings-brand-boards", label: "Brand Boards", selector: 'a[href*="/settings/brand-boards"]' },
];

/** key -> explicit selector, built from any features that declare one. */
const SELECTOR_BY_KEY: Record<string, string> = Object.fromEntries(
  [...GHL_SIDEBAR_FEATURES, ...GHL_AGENCY_SIDEBAR_FEATURES, ...GHL_SETTINGS_SIDEBAR_FEATURES]
    .filter((f) => f.selector)
    .map((f) => [f.key, f.selector as string])
);

const SETTINGS_KEYS = new Set(GHL_SETTINGS_SIDEBAR_FEATURES.map((f) => f.key));

/** Every legitimate feature key across the three sidebars. */
const KNOWN_KEYS = new Set(
  [...GHL_SIDEBAR_FEATURES, ...GHL_AGENCY_SIDEBAR_FEATURES, ...GHL_SETTINGS_SIDEBAR_FEATURES].map((f) => f.key)
);

/**
 * Whether a key is a real, known sidebar feature. Used to reject arbitrary keys
 * from stored hiddenFeatures / menuLabelOverrides before they reach a CSS selector -
 * without this, a crafted key could break out of the `#sb_<key>` / `[meta="<key>"]`
 * fallback selector and inject arbitrary CSS rules into the bundle.
 */
export function isKnownFeatureKey(key: string): boolean {
  return KNOWN_KEYS.has(key);
}

/**
 * Whether a feature belongs to the Settings sidebar. Callers use this to switch
 * scoping strategy (href-based vs ancestor-prefix) and rename target (the link
 * itself vs a `.nav-title` child).
 */
export function isSettingsFeature(key: string): boolean {
  return SETTINGS_KEYS.has(key);
}

/** CSS selector (relative to a location-scoped wrapper) for a feature's nav link. */
export function featureSelector(key: string): string {
  // Explicit selector (agency + settings items) wins; else the confirmed #sb_/meta
  // pattern. Sanitize the interpolated key to a safe CSS-identifier charset as a
  // second line of defense so nothing user-influenced can terminate the selector.
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "");
  return SELECTOR_BY_KEY[key] ?? `#sb_${safe}, a[meta="${safe}"]`;
}
