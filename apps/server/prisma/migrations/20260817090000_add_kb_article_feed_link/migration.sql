-- Record WHICH feed brought an article in.
--
-- Additive and nullable, with no backfill: rows that predate this column genuinely do not
-- know their origin, and guessing one by matching URL prefixes would invent provenance.
-- NULL reads as "hand-written, crawled, or from before we tracked it", which is honest.
--
-- ON DELETE SET NULL, not CASCADE. Removing a feed must never delete articles somebody
-- already read and approved — at that point they are part of the corpus, not the feed's
-- property, and a bot citing them would start 404ing on a decision about a subscription.
ALTER TABLE "KbArticle" ADD COLUMN "feedId" TEXT;

ALTER TABLE "KbArticle"
  ADD CONSTRAINT "KbArticle_feedId_fkey"
  FOREIGN KEY ("feedId") REFERENCES "KbFeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "KbArticle_feedId_idx" ON "KbArticle"("feedId");
