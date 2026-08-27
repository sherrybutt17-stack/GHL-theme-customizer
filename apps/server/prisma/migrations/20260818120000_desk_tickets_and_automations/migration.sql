-- Desk-raised tickets, bot pause, snooze, and the automation claim columns.
--
-- HAND-WRITTEN, not `prisma migrate dev` output. That command wanted to reset the whole
-- development database (an earlier migration folder was renamed after it had been applied
-- - see CLAUDE.md), and `prisma migrate diff` emits three statements that are Prisma's
-- datamodel being unable to express raw SQL rather than anything that should ship:
--
--   DROP INDEX "KbArticle_searchVector_idx"                  -- the GIN index
--   ALTER "KbArticle" ALTER "searchVector"/"featureTags" DROP DEFAULT
--   ALTER "SupportConfig" ALTER <String[] columns> DROP DEFAULT
--
-- Running those would drop the index every full-text search depends on. They are omitted
-- deliberately; only the statements below are real changes.

-- CreateEnum
CREATE TYPE "ConversationOrigin" AS ENUM ('widget', 'desk');

-- AlterTable: Conversation
--
-- `accessTokenHash` drops NOT NULL because a desk-raised ticket has no widget session.
-- It stays UNIQUE: Postgres treats NULLs as distinct in a unique index, so real sessions
-- keep the constraint while desk tickets simply hold no credential at all.
ALTER TABLE "Conversation"
  ADD COLUMN "origin" "ConversationOrigin" NOT NULL DEFAULT 'widget',
  ADD COLUMN "ticketType" TEXT,
  ADD COLUMN "createdByDeskUserId" TEXT,
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "botPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "slaBreachedAt" TIMESTAMP(3),
  ADD COLUMN "idleWarnedAt" TIMESTAMP(3),
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactName" TEXT,
  ALTER COLUMN "accessTokenHash" DROP NOT NULL;

-- AlterTable: SupportConfig
ALTER TABLE "SupportConfig" ADD COLUMN "slaFirstResponseMins" JSONB;

-- CreateIndex
CREATE INDEX "Conversation_status_firstAgentReplyAt_idx" ON "Conversation"("status", "firstAgentReplyAt");
CREATE INDEX "Conversation_snoozedUntil_idx" ON "Conversation"("snoozedUntil");
CREATE INDEX "Conversation_createdByDeskUserId_idx" ON "Conversation"("createdByDeskUserId");

-- AddForeignKey
--
-- SET NULL, never CASCADE: offboarding a member of staff must not delete a client's
-- ticket. Same reasoning as the existing assignee relation.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdByDeskUserId_fkey"
  FOREIGN KEY ("createdByDeskUserId") REFERENCES "DeskUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
