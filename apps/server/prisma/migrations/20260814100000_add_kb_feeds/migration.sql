-- Syndication feeds polled for new knowledge base articles.
--
-- Items go through the SAME ingestArticle pipeline as everything else, so they inherit
-- brand normalization and the residual-leak quarantine. `autoPublish` defaults to FALSE
-- because those gates prove an item names no vendor, not that it is accurate, current, or
-- even a how-to — a changelog entry ingested as an article makes the bot answer "how do I
-- add a contact" with a release note.
--
-- Hand-written deliberately: `prisma migrate dev` also wants to emit DROP INDEX on
-- KbArticle's GIN index and drop several array defaults, none of which belong in a
-- migration that adds one table. See the note on the desk-tickets migration.
CREATE TABLE "KbFeed" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "source" "KbSource" NOT NULL DEFAULT 'ghl',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastItemAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbFeed_pkey" PRIMARY KEY ("id")
);

-- One row per feed URL. Adding the same feed twice is a mistake, not a use case: it
-- would double every poll and race two writers onto the same articles.
CREATE UNIQUE INDEX "KbFeed_url_key" ON "KbFeed"("url");

CREATE INDEX "KbFeed_agencyInstallId_idx" ON "KbFeed"("agencyInstallId");
CREATE INDEX "KbFeed_enabled_idx" ON "KbFeed"("enabled");

ALTER TABLE "KbFeed"
    ADD CONSTRAINT "KbFeed_agencyInstallId_fkey"
    FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
