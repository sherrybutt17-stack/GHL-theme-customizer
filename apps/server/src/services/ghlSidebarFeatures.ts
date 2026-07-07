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

/** key -> explicit selector, built from any features that declare one. */
const SELECTOR_BY_KEY: Record<string, string> = Object.fromEntries(
  [...GHL_SIDEBAR_FEATURES, ...GHL_AGENCY_SIDEBAR_FEATURES]
    .filter((f) => f.selector)
    .map((f) => [f.key, f.selector as string])
);

/** CSS selector (relative to a location-scoped wrapper) for a feature's nav link. */
export function featureSelector(key: string): string {
  // Explicit selector (agency items) wins; otherwise the confirmed #sb_/meta pattern.
  return SELECTOR_BY_KEY[key] ?? `#sb_${key}, a[meta="${key}"]`;
}
