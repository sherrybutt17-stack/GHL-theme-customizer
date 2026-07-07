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

/** CSS selector (relative to a location-scoped wrapper) for a feature's nav link. */
export function featureSelector(key: string): string {
  // Match either the id (#sb_key) or the meta attribute, since GHL has used both.
  return `#sb_${key}, a[meta="${key}"]`;
}
