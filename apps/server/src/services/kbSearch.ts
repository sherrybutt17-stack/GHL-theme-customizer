import { prisma } from "./prisma";

/**
 * Retrieval over the knowledge base.
 *
 * Postgres full-text search, not a vector database. GHL help content is keyword-dense
 * ("how do I create a pipeline"), so tsvector + ts_rank handles it with no embeddings
 * vendor, no extra infrastructure and no per-query cost. Reach for pgvector only if
 * this measurably underperforms on real queries - and measure first.
 *
 * Two filters here are not optimisations, they are correctness:
 *   - status = 'ready'      quarantined articles must never reach a client
 *   - hiddenFeatures        never explain a feature this client cannot see
 */

export interface SearchOptions {
  query: string;
  /** Feature keys hidden for THIS sub-account. Matching articles are excluded. */
  hiddenFeatures?: string[];
  /**
   * Relevance floor for the LOOSE pass (see `searchKb`). Ignored by the strict pass,
   * where matching every term is evidence enough on its own.
   *
   * Raise it for callers where a false positive is visible to the client — the
   * hidden-feature detector says "that isn't part of your plan", which is a bad thing
   * to say to somebody who asked about something else entirely.
   */
  minRank?: number;
  /** Skip the loose pass entirely. Precision over recall. */
  strictOnly?: boolean;
  /**
   * The inverse, and it is a DETECTION tool, not a retrieval one: return ONLY articles
   * touching these features. Used to answer "did they just ask about something they
   * don't have?" — a hit here means yes, whatever words they used.
   *
   * Nothing it returns may reach the model. Kept as a separate call precisely so the
   * exclusion above stays a single SQL guarantee that no caller can forget to apply.
   */
  onlyFeatures?: string[];
  /** Include this agency's own articles; they outrank GHL-derived content. */
  agencyInstallId?: string | null;
  limit?: number;
}

export interface SearchHit {
  id: string;
  source: "ghl" | "agency";
  titleNormalized: string;
  bodyNormalized: string;
  featureTags: string[];
  /** INTERNAL provenance. Never rendered to a client or an agent. */
  sourceUrl: string | null;
  rank: number;
}

/**
 * Turn user text into a tsquery.
 *
 * websearch_to_tsquery is the right primitive: it accepts what people actually type
 * ("how do I add a contact", quoted phrases, OR) and - critically - never throws on
 * malformed input. plainto_/to_tsquery raise a syntax error on stray operators, which
 * would turn a user typing "pipeline & " into a 500.
 *
 * The text is passed as a bound PARAMETER, never interpolated, so it cannot be SQL.
 */
const MAX_QUERY_CHARS = 500;

/**
 * Measured floor for the loose pass, from 18 probe questions against the seeded corpus.
 *
 *   covered topics, phrased as a client types them   0.14 - 0.58
 *   plainly off-topic ("capital city of portugal",
 *   "replace the alternator on a transit van")       0.06 - 0.08
 *
 * 0.10 sits in that gap. It is a heuristic, not a guarantee, and it is deliberately on
 * the permissive side: a covered question wrongly scored below the floor retrieves
 * nothing and hands a solved problem to a human, which is the failure this whole change
 * exists to remove.
 *
 * RE-MEASURED at 253 articles (from 150) and left unchanged: off-topic controls still
 * return nothing, hidden-feature detection still 4/4, and no covered question retrieves
 * zero rows. Worth re-running whenever the corpus grows substantially — more articles
 * means more chances for an off-topic question to find two matching terms, and if that
 * fail-safe erodes, genuinely unanswerable questions stop reaching a human.
 */
const DEFAULT_MIN_RANK = 0.1;

/**
 * Recast a question as an OR of its terms.
 *
 * websearch_to_tsquery understands the literal word "or" between terms, so the loose
 * query is built as text and handed to the same never-throws parser - no to_tsquery, no
 * interpolation, nothing that can be turned into SQL or into a syntax error.
 *
 * Tokens are cleaned of the operators websearch_to_tsquery would otherwise honour: a
 * leading "-" means NOT, and quotes open a phrase. A stray one of either from ordinary
 * typing would silently invert or narrow the search.
 */
export function looseTerms(query: string): string[] {
  return (
    query
      .replace(/["']/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^[-+]+/, "").replace(/[^\p{L}\p{N}]+$/u, ""))
      // 3 chars minimum, and drop the words that are themselves operators.
      .filter((w) => w.length > 2 && !["and", "or", "not"].includes(w.toLowerCase()))
      // Bound the term count: a pasted paragraph would otherwise OR eighty terms
      // together and match the entire corpus at a uniformly meaningless rank.
      .slice(0, 24)
  );
}

export function toLooseQuery(query: string): string {
  return looseTerms(query).join(" or ");
}

/**
 * How many distinct query terms an article has to contain to count as a loose match.
 *
 * This is the honest version of "is this article actually about what they asked". A
 * rank threshold alone cannot tell one strong incidental hit from real relevance:
 * "who won the football last night" matched an article on deal status through the
 * single word "won", and scored above a floor set to admit genuine matches.
 *
 * Requiring two distinct terms separates them cleanly, because an article that is
 * really about the subject shares more than one word with the question, while noise
 * shares exactly one. Only applied to questions long enough for it to mean something -
 * a two-word question has no second term to spare.
 */
const MIN_LOOSE_TERM_HITS = 2;
const MIN_TERMS_FOR_HIT_RULE = 3;

/**
 * Retrieve in TWO passes, strict then loose.
 *
 * THE BUG THIS FIXES, because it is not obvious from the outside: websearch_to_tsquery
 * joins bare terms with AND. "how do i copy my whole setup into a new client account"
 * becomes `copy & whole & setup & new & client & account` and requires one article to
 * contain all six - so it matched NOTHING. Measured on the seeded corpus, 23 of 30
 * realistically-phrased questions returned zero rows, and zero rows is precisely what
 * `supportBot` treats as thin retrieval and hands to a human. The bot therefore looked
 * like it "didn't know anything" while sitting on an article that answered the question,
 * and adding more articles could never have fixed it.
 *
 * Strict first because an article containing every term is a genuinely strong match and
 * deserves to outrank anything the loose pass finds. The loose pass only runs when
 * strict came up short, and applies a relevance floor so that a single incidental word
 * ("van" matching an article about media storage) is not mistaken for knowledge - the
 * escalation fail-safe depends on "we found nothing" still being reachable.
 *
 * Two filters here are not optimisations, they are correctness:
 *   - status = 'ready'      quarantined articles must never reach a client
 *   - hiddenFeatures        never explain a feature this client cannot see
 * Both are applied identically to both passes; there is one code path building the SQL
 * so a future edit cannot secure one and forget the other.
 */
export async function searchKb(opts: SearchOptions): Promise<SearchHit[]> {
  const query = opts.query.trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return [];

  const limit = Math.min(opts.limit ?? 5, 25);
  const hidden = (opts.hiddenFeatures ?? []).filter((f) => typeof f === "string" && f.length > 0);
  const only = (opts.onlyFeatures ?? []).filter((f) => typeof f === "string" && f.length > 0);
  const agencyId = opts.agencyInstallId ?? null;
  const minRank = opts.minRank ?? DEFAULT_MIN_RANK;

  // Notes on the SQL:
  //  - `featureTags && $hidden` is the array-overlap operator: exclude an article if it
  //    touches ANY hidden feature. Tagging is deliberately over-inclusive upstream, so
  //    this errs toward hiding a tangential article rather than explaining a feature
  //    the client cannot see.
  //  - The agency filter keeps shared GHL rows (agencyInstallId IS NULL) plus this
  //    agency's own, and never another tenant's.
  //  - Agency-authored content gets a rank bonus: it is unambiguously theirs, answers
  //    "how do I use YOUR process", and needs no substitution.
  const run = (text: string, floor: number, terms: string[], take: number) =>
    prisma.$queryRaw<Array<SearchHit & { rank: number }>>`
      SELECT
        "id",
        "source"::text AS "source",
        "titleNormalized",
        "bodyNormalized",
        "featureTags",
        "sourceUrl",
        (
          ts_rank("searchVector", websearch_to_tsquery('english', ${text}))
          * CASE WHEN "source" = 'agency' THEN 1.5 ELSE 1.0 END
        )::float8 AS "rank"
      FROM "KbArticle"
      WHERE
        "status" = 'ready'
        AND "searchVector" @@ websearch_to_tsquery('english', ${text})
        AND ts_rank("searchVector", websearch_to_tsquery('english', ${text})) >= ${floor}
        -- Distinct-term coverage. Empty array (the strict pass, where every term
        -- matches by definition) short-circuits on the cardinality check.
        AND (
          cardinality(${terms}::text[]) < ${MIN_TERMS_FOR_HIT_RULE}
          OR (
            SELECT count(*)
            FROM unnest(${terms}::text[]) AS t(term)
            WHERE "searchVector" @@ websearch_to_tsquery('english', t.term)
          ) >= ${MIN_LOOSE_TERM_HITS}
        )
        AND (
          cardinality(${hidden}::text[]) = 0
          OR NOT ("featureTags" && ${hidden}::text[])
        )
        AND (
          cardinality(${only}::text[]) = 0
          OR ("featureTags" && ${only}::text[])
        )
        AND ("agencyInstallId" IS NULL OR "agencyInstallId" = ${agencyId})
      ORDER BY "rank" DESC, "updatedAt" DESC
      LIMIT ${take}
    `;

  const strict = await run(query, 0, [], limit);
  if (opts.strictOnly || strict.length >= limit) return strict;

  const terms = looseTerms(query);
  const loose = terms.join(" or ");
  // Nothing left to OR (a one-word question, or all terms too short) - the strict pass
  // already WAS that query, so a second identical round trip would buy nothing.
  if (!loose || loose === query) return strict;

  const seen = new Set(strict.map((h) => h.id));
  const extra = (await run(loose, minRank, terms, limit)).filter((h) => !seen.has(h.id));

  // Strict hits stay first: their ranks come from a different query and are not
  // comparable, and matching every term is the better evidence.
  return [...strict, ...extra].slice(0, limit);
}

/**
 * Articles a human needs to look at: normalization left something brand-shaped behind,
 * so they are quarantined and unreachable by search until reviewed.
 *
 * A growing count here is a signal, not noise - it means the corpus contains a phrasing
 * the brand lexicon does not yet know about.
 */
export async function listQuarantined(limit = 50) {
  return prisma.kbArticle.findMany({
    where: { status: "needs_review" },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      sourceUrl: true,
      titleNormalized: true,
      residualLeaks: true,
      featureTags: true,
      updatedAt: true,
    },
  });
}

/** Corpus health at a glance, for the desk's admin view. */
export async function kbStats() {
  const [byStatus, bySource, total, oldest] = await Promise.all([
    prisma.kbArticle.groupBy({ by: ["status"], _count: true }),
    prisma.kbArticle.groupBy({ by: ["source"], _count: true }),
    prisma.kbArticle.count(),
    prisma.kbArticle.findFirst({
      where: { status: "ready", lastCrawledAt: { not: null } },
      orderBy: { lastCrawledAt: "asc" },
      select: { lastCrawledAt: true, sourceUrl: true },
    }),
  ]);
  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count])),
    // Staleness matters: GHL ships UI changes constantly, and a bot confidently giving
    // last year's instructions is worse than one that says it doesn't know.
    stalestCrawl: oldest?.lastCrawledAt ?? null,
  };
}
