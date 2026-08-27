/**
 * One hand-written knowledge base article.
 *
 * WHY `slug` EXISTS. `ingestArticle` upserts on `sourceUrl` and plain-creates when
 * there isn't one — so seed articles, having no URL, duplicated the entire corpus every
 * time the seeder ran (11 articles became 32 exactly this way). The slug becomes a
 * synthetic `mosaic:kb/<slug>` source key: re-seeding now updates in place, an unchanged
 * article short-circuits on its content hash, and `--replace` stops being load-bearing.
 *
 * Slugs are permanent identity. Renaming one orphans the old row rather than updating
 * it; change the title freely, change the slug only deliberately.
 */
export interface SeedArticle {
  /** Stable identity. kebab-case, unique across the whole corpus. */
  slug: string;
  title: string;
  body: string;
}

/**
 * HOUSE STYLE, and it is not decoration — each rule maps to a mechanism.
 *
 * - **Name no vendor.** Not "GoHighLevel", not the abbreviation, not a branded
 *   sub-product ("LC Phone"). `kbNormalize` would placeholder most of them and
 *   `findBrandLeaks` quarantines whatever survives, but an article written clean never
 *   needs either. Write "the platform", or nothing at all.
 * - **No URLs, no email addresses.** They are stripped at ingest and the stripper then
 *   has to repair the stranded sentence around them. Never write the link in the first
 *   place.
 * - **Capitalise a nav label when you mean the nav item.** "Open Contacts" becomes
 *   `{{FEATURE:contacts}}` and renders as whatever that client's sidebar actually says.
 *   "your contacts arrive" is ordinary English and is left alone. This is the difference
 *   between a correct instruction and a wrong one.
 * - **Mention other features sparingly.** Feature detection is case-INSENSITIVE and
 *   deliberately over-eager, and every tag it adds is a reason retrieval will hide this
 *   article from a client who has that feature hidden. A payments article that name-drops
 *   memberships in passing disappears for every client without memberships.
 * - **Write prose, not a manual.** The body is fed to the model verbatim and the answer
 *   inherits its register. Short paragraphs, plain words, the failure mode named.
 * - **Say what goes wrong.** The sentence that earns its place is the one about the
 *   thing that silently doesn't work — an unpublished draft, an unverified domain, a
 *   re-entry rule. That is what people are actually asking about.
 */
export const HOUSE_STYLE_NOTE = true;
