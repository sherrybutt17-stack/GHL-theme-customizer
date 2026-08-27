import { prisma } from "./prisma";
import {
  GHL_SIDEBAR_FEATURES,
  GHL_AGENCY_SIDEBAR_FEATURES,
  GHL_SETTINGS_SIDEBAR_FEATURES,
  isKnownFeatureKey,
} from "./ghlSidebarFeatures";

/**
 * Resolve what ONE sub-account's client actually sees, so the bot can speak their
 * vocabulary rather than GHL's.
 *
 * This is the per-client half of the bot: the knowledge base holds one brand-neutral
 * copy, and this map turns it into that client's words at answer time. It is DERIVED,
 * never stored - a second copy of theme data would be a second source of truth, and
 * stale brand data is precisely the failure that breaks the white label.
 *
 * The resolution rules below mirror how the CSS bundle actually behaves, because the
 * bot must describe the UI the client is really looking at:
 *
 *   LABELS  location overrides agency. Location rules are emitted SCOPED (more
 *           specific), so for that sub-account the location's rename wins; the
 *           agency's rename applies wherever the location has none.
 *
 *   HIDDEN  UNION of agency + location. Agency-level `display:none` is emitted
 *           UNSCOPED and nothing ever emits an un-hide rule, so a location cannot
 *           bring back something the agency hid. Anything hidden at either level is
 *           genuinely invisible to this client, and the bot must not explain it.
 */

const ALL_FEATURES = [
  ...GHL_SIDEBAR_FEATURES,
  ...GHL_AGENCY_SIDEBAR_FEATURES,
  ...GHL_SETTINGS_SIDEBAR_FEATURES,
];

/** GHL's own labels, used whenever the agency hasn't renamed something. */
const DEFAULT_LABELS: Record<string, string> = Object.fromEntries(
  ALL_FEATURES.map((f) => [f.key, f.label.replace(/\s*\(.*\)$/, "").trim()])
);

/** Last-resort platform name. Generic, and can never leak a vendor. */
export const GENERIC_PLATFORM_NAME = "your dashboard";

export interface BrandMap {
  agencyInstallId: string;
  locationInstallId: string;
  ghlLocationId: string;
  /** What THIS client calls the platform. Substituted for {{PLATFORM}}. */
  brandName: string;
  /**
   * Feature key → the label this client sees. Substituted for {{FEATURE:key}}.
   *
   * COMPLETE, and it has to be: every {{FEATURE:key}} placeholder must resolve whether
   * or not the agency renamed that item. Do not narrow this to the renames — use
   * `renamedLabels` for that, which exists precisely so nobody is tempted to.
   */
  featureLabels: Record<string, string>;
  /**
   * ONLY what differs from the platform's own label, as the PAIR it actually is.
   *
   * Two surfaces exist to answer "what does this client call things", and both were
   * handed `featureLabels` instead: the desk's brand banner above the compose box, and
   * the dry run's verdict. Both then reported all 51 labels as the agency's renames - so
   * a sub-account that had renamed NOTHING was described as having renamed everything,
   * and one that had renamed exactly one item buried it among fifty that are exactly
   * what they look like. The banner shows six and "+45", so the single word an agent
   * needs can be the one it omits, which is the cross-brand slip that banner prevents.
   *
   * Compared BY VALUE, not by key presence: an agency who typed "Contacts" into the
   * Contacts box has renamed nothing, and an override map can carry such an entry. A key
   * with no platform default is a rename by definition - there is nothing for it to
   * match, so `from` falls back to the key.
   *
   * A pair rather than key → label, because `to` alone is only half the fact. An agent
   * reading "Deals" still has to guess what it replaced, and the whole job of the banner
   * is that they can move between the client's words and the platform's. It was written
   * label-only when the list was 51 entries long and a pair would not have fitted; at
   * nought to three it does.
   */
  renamedLabels: Array<{ key: string; from: string; to: string }>;
  /** Feature keys invisible to this client. Matching articles are dropped. */
  hiddenFeatures: string[];
  /** Where brandName came from, for debugging "why is it calling itself that?". */
  brandNameSource: "location" | "agency-default" | "company-name" | "generic";
  /**
   * What this client actually BOUGHT, as the agency named it ("Starter", "Pro").
   *
   * Null unless the agency has said. This is deliberately not inferred: `hiddenFeatures`
   * says what is switched off in the sidebar, which is a PROXY for the plan and a
   * wrong one in both directions - an agency may hide something merely to declutter, or
   * sell a lower tier with nothing hidden. And nothing in GHL knows this: it is the
   * agency's own commercial arrangement with their client.
   *
   * When set, the bot can say "that isn't included on your Starter plan" instead of the
   * vaguer "isn't part of your setup" - accurate rather than a guess.
   */
  planName: string | null;
}

/**
 * The brand-name fallback chain, as a pure function.
 *
 * Extracted from the DB path deliberately: this is the single most important string in
 * the product - it is what the client is told they are using - and it must be testable
 * exhaustively without arranging live rows for every branch.
 *
 * Ordered most-specific first. Every rung falls back to something that CANNOT name a
 * vendor, so an agency that configures nothing gets a vague bot, never a leaky one.
 * `companyName` ranks last among the real values because it is the AGENCY's own name -
 * a reasonable final guess, but not the white-label name their clients are meant to see.
 */
export function resolveBrandName(input: {
  locationBrandName?: string | null;
  agencyDefaultBrandName?: string | null;
  companyName?: string | null;
}): { brandName: string; source: BrandMap["brandNameSource"] } {
  const rungs: [string | null | undefined, BrandMap["brandNameSource"]][] = [
    [input.locationBrandName, "location"],
    [input.agencyDefaultBrandName, "agency-default"],
    [input.companyName, "company-name"],
  ];
  for (const [value, source] of rungs) {
    const trimmed = value?.trim();
    if (trimmed) return { brandName: trimmed, source };
  }
  return { brandName: GENERIC_PLATFORM_NAME, source: "generic" };
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Whitelist the key for the same reason the CSS bundle does: an unknown key here
    // would end up as a {{FEATURE:...}} substitution target we never intended.
    if (typeof v === "string" && v.trim() && isKnownFeatureKey(k)) out[k] = v.trim();
  }
  return out;
}

function asKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is string => typeof k === "string" && isKnownFeatureKey(k));
}

/**
 * Build the map for one sub-account. Prefer resolveBrandMap(), which caches.
 *
 * One query, with the agency default and the latest theme version pulled alongside.
 * The bot is on a user-facing path, so this must not become N round trips.
 */
export async function loadBrandMap(ghlLocationId: string): Promise<BrandMap | null> {
  const location = await prisma.locationInstall.findUnique({
    where: { ghlLocationId },
    include: {
      agencyInstall: {
        select: {
          id: true,
          companyName: true,
          status: true,
          defaultTheme: true,
          supportConfig: { select: { planTiers: true } },
        },
      },
      themeConfigs: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 },
    },
  });

  if (!location || location.status === "removed") return null;
  if (location.agencyInstall.status === "uninstalled") return null;

  const theme = location.themeConfigs[0] ?? null;
  const agencyDefault = location.agencyInstall.defaultTheme ?? null;

  const { brandName, source: brandNameSource } = resolveBrandName({
    locationBrandName: theme?.brandName,
    agencyDefaultBrandName: agencyDefault?.brandName,
    companyName: location.agencyInstall.companyName,
  });

  // Labels: GHL defaults, overlaid by agency renames, overlaid by location renames.
  const featureLabels: Record<string, string> = {
    ...DEFAULT_LABELS,
    ...asStringMap(agencyDefault?.menuLabelOverrides),
    ...asStringMap(theme?.menuLabelOverrides),
  };

  // What the agency actually CHANGED. Computed here rather than at each call site so the
  // desk banner and the dry run cannot arrive at two different answers - the same reason
  // QUEUE_ORDER and slaStatus have one definition apiece.
  const renamedLabels = Object.entries(featureLabels)
    .filter(([key, label]) => label !== DEFAULT_LABELS[key])
    .map(([key, label]) => ({ key, from: DEFAULT_LABELS[key] ?? key, to: label }));

  // Hidden: union, per the scoping note at the top of this file.
  const hiddenFeatures = [
    ...new Set([...asKeyList(agencyDefault?.hiddenFeatures), ...asKeyList(theme?.hiddenFeatures)]),
  ].sort();

  // planTiers is a { locationInstallId: "plan name" } map on the agency's SupportConfig.
  // Absent, malformed or blank all resolve to null, which just means the bot stays vague
  // rather than inventing a plan the client never bought.
  const tiers = location.agencyInstall.supportConfig?.planTiers;
  const rawPlan =
    tiers && typeof tiers === "object" && !Array.isArray(tiers)
      ? (tiers as Record<string, unknown>)[location.id]
      : undefined;
  const planName = typeof rawPlan === "string" && rawPlan.trim() ? rawPlan.trim().slice(0, 60) : null;

  return {
    agencyInstallId: location.agencyInstall.id,
    locationInstallId: location.id,
    ghlLocationId: location.ghlLocationId,
    brandName,
    featureLabels,
    renamedLabels,
    hiddenFeatures,
    brandNameSource,
    planName,
  };
}

// --- Cache ----------------------------------------------------------------------

/**
 * Short-TTL in-process cache.
 *
 * Deliberately short AND explicitly invalidated on theme save. A theme change that
 * doesn't reach the bot means it addresses a client by their old brand name - the
 * exact failure the product exists to prevent - so correctness beats hit rate here.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { at: number; map: BrandMap | null }>();

export async function resolveBrandMap(ghlLocationId: string): Promise<BrandMap | null> {
  const hit = cache.get(ghlLocationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  const map = await loadBrandMap(ghlLocationId);

  // Bound the map so a long-lived process can't grow it without limit. Cheapest
  // sufficient policy at this scale: drop the oldest insert.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ghlLocationId, { at: Date.now(), map });
  return map;
}

/**
 * Drop cached maps after a theme save. Call with the GHL location id when one
 * sub-account changed, or with nothing to clear everything (agency-default saves
 * affect every sub-account under that agency).
 */
export function invalidateBrandMap(ghlLocationId?: string): void {
  if (ghlLocationId) cache.delete(ghlLocationId);
  else cache.clear();
}

/** Test seam. */
export function __brandMapCacheSize(): number {
  return cache.size;
}
