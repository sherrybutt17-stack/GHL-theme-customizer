import type { SeedArticle } from "./types";
import { BASICS } from "./basics";
import { CONTACTS } from "./contacts";
import { CONVERSATIONS } from "./conversations";
import { CALENDARS } from "./calendars";
import { PIPELINES } from "./pipelines";
import { AUTOMATIONS } from "./automations";
import { MARKETING } from "./marketing";
import { SITES } from "./sites";
import { MEMBERSHIPS } from "./memberships";
import { PAYMENTS } from "./payments";
import { SETTINGS } from "./settings";
import { REPUTATION } from "./reputation";
import { REPORTING } from "./reporting";
import { AI } from "./ai";
import { TROUBLESHOOTING } from "./troubleshooting";
import { INTEGRATIONS } from "./integrations";
import { AUTOMATIONS_ADVANCED } from "./automationsAdvanced";
import { SITES_ADVANCED } from "./sitesAdvanced";
import { PAYMENTS_ADVANCED } from "./paymentsAdvanced";
import { CONTACTS_ADVANCED } from "./contactsAdvanced";
import { CALENDARS_ADVANCED } from "./calendarsAdvanced";
import { CONVERSATIONS_ADVANCED } from "./conversationsAdvanced";
import { SECURITY } from "./security";
import { SETTINGS_ADVANCED } from "./settingsAdvanced";
import { REPORTING_ADVANCED } from "./reportingAdvanced";

export type { SeedArticle } from "./types";

/**
 * The whole hand-written corpus, grouped by the area of the product it covers.
 *
 * Grouping is for us, not for retrieval — search is full-text over title and body and
 * does not know these files exist. It exists so that "what do we say about payments"
 * is answerable by opening one file, and so that adding coverage means adding to a list
 * rather than scrolling a three-thousand-line array.
 *
 * `TROUBLESHOOTING` is the one group organised by SYMPTOM rather than by feature, and
 * that is deliberate: somebody typing "my texts aren't sending" shares almost no
 * vocabulary with an article titled "Setting up calls and text messages", so a
 * feature-shaped corpus alone answers the setup question and misses the real one.
 */
export const AREAS: { area: string; articles: SeedArticle[] }[] = [
  { area: "Getting started", articles: BASICS },
  { area: "Contacts", articles: CONTACTS },
  { area: "Contacts — in depth", articles: CONTACTS_ADVANCED },
  { area: "Conversations", articles: CONVERSATIONS },
  { area: "Conversations — in depth", articles: CONVERSATIONS_ADVANCED },
  { area: "Calendars", articles: CALENDARS },
  { area: "Calendars — in depth", articles: CALENDARS_ADVANCED },
  { area: "Pipelines", articles: PIPELINES },
  { area: "Automations", articles: AUTOMATIONS },
  { area: "Automations — in depth", articles: AUTOMATIONS_ADVANCED },
  { area: "Marketing", articles: MARKETING },
  { area: "Sites and forms", articles: SITES },
  { area: "Sites — in depth", articles: SITES_ADVANCED },
  { area: "Memberships", articles: MEMBERSHIPS },
  { area: "Payments", articles: PAYMENTS },
  { area: "Payments — in depth", articles: PAYMENTS_ADVANCED },
  { area: "Integrations", articles: INTEGRATIONS },
  { area: "Settings", articles: SETTINGS },
  { area: "Settings — in depth", articles: SETTINGS_ADVANCED },
  { area: "Security and privacy", articles: SECURITY },
  { area: "Reputation", articles: REPUTATION },
  { area: "Reporting", articles: REPORTING },
  { area: "Reporting — in depth", articles: REPORTING_ADVANCED },
  { area: "AI features", articles: AI },
  { area: "Troubleshooting", articles: TROUBLESHOOTING },
];

export const ARTICLES: SeedArticle[] = AREAS.flatMap((a) => a.articles);

/**
 * Slugs are the corpus's primary key — a duplicate silently makes one article overwrite
 * another on every seed, which reads as "that article keeps disappearing".
 */
export function findDuplicateSlugs(articles: SeedArticle[] = ARTICLES): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const a of articles) {
    if (seen.has(a.slug)) dupes.add(a.slug);
    seen.add(a.slug);
  }
  return [...dupes];
}

/**
 * The synthetic source key that makes re-seeding idempotent.
 *
 * `ingestArticle` upserts on `sourceUrl` and plain-creates without one, so seed
 * articles used to duplicate the entire corpus on every run. It is a key, not a link:
 * `sourceUrl` is internal provenance and is never rendered to a client or an agent, and
 * the `mosaic:` scheme cannot collide with a crawled http(s) URL.
 */
export function seedKey(slug: string): string {
  return `mosaic:kb/${slug}`;
}
