-- Knowledge base for the support bot: ONE canonical, brand-neutral copy of each
-- article, shared by every agency and substituted per sub-account at answer time.

CREATE TYPE "KbSource" AS ENUM ('ghl', 'agency');
CREATE TYPE "KbArticleStatus" AS ENUM ('ready', 'needs_review', 'archived');

-- Agency-level fallback for {{PLATFORM}}. Without it the brand chain fell through to
-- AgencyInstall.companyName, which is the AGENCY's own name - not the white-label name
-- their clients are supposed to see.
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "brandName" TEXT;

CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "source" "KbSource" NOT NULL,
    "agencyInstallId" TEXT,
    "sourceUrl" TEXT,
    "titleNormalized" TEXT NOT NULL,
    "bodyNormalized" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "featureTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "KbArticleStatus" NOT NULL DEFAULT 'ready',
    "residualLeaks" JSONB,
    "lastCrawledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- Unique so a recrawl UPSERTS instead of duplicating. Postgres treats NULLs as
-- distinct in a unique index, which is exactly what lets authored agency articles
-- omit a source URL entirely while crawled ones stay deduplicated by it.
CREATE UNIQUE INDEX "KbArticle_sourceUrl_key" ON "KbArticle"("sourceUrl");
CREATE INDEX "KbArticle_agencyInstallId_idx" ON "KbArticle"("agencyInstallId");
CREATE INDEX "KbArticle_status_idx" ON "KbArticle"("status");
CREATE INDEX "KbArticle_source_idx" ON "KbArticle"("source");

ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_agencyInstallId_fkey"
    FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search. Postgres tsvector rather than a vector database: GHL help content
-- is keyword-dense, so ts_rank handles it with no embeddings vendor, no extra
-- infrastructure and no per-query embedding cost. Revisit pgvector only if this
-- measurably underperforms.
--
-- A GENERATED column, not a trigger: it can never drift out of sync with the text, and
-- there is no trigger to forget when inserting from a script. The two-argument
-- to_tsvector('english', ...) is IMMUTABLE, which is what makes it legal here - the
-- one-argument form depends on a session setting and would be rejected.
--
-- Weights: title matches (A) outrank body matches (B), so "How to create a pipeline"
-- beats an article that merely mentions pipelines in passing.
--
-- NOTE: this indexes the PLACEHOLDERED text, which is correct - {{PLATFORM}} and
-- {{FEATURE:x}} are stable tokens, and the words around them are what people search.
ALTER TABLE "KbArticle" ADD COLUMN "searchVector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce("titleNormalized", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("bodyNormalized", '')), 'B')
    ) STORED;

CREATE INDEX "KbArticle_searchVector_idx" ON "KbArticle" USING GIN ("searchVector");

-- Retrieval always filters on status='ready' (quarantined articles must never be
-- served), so index the common path rather than scanning and discarding.
CREATE INDEX "KbArticle_ready_idx" ON "KbArticle"("source") WHERE "status" = 'ready';
