-- Desk workflow: a conversation IS the ticket (see schema.prisma), plus placeholdered
-- canned replies so agency A's wording can never reach agency B.
--
-- HAND-WRITTEN, and it must stay that way. `prisma migrate dev` additionally emitted:
--   DROP INDEX "KbArticle_searchVector_idx"          <- the GIN index KB search depends on
--   ALTER COLUMN "searchVector" DROP DEFAULT          <- fails: it is a GENERATED column
--   ALTER COLUMN "<array>" DROP DEFAULT   (x4)        <- drops the '{}' defaults
-- None of that is part of this change. Prisma cannot model a GENERATED tsvector
-- (it is Unsupported("tsvector")) or a DEFAULT on a scalar list, so it reads both as
-- drift and tries to "correct" them on every future migration. Always diff the generated
-- SQL against your intent before committing it.

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "firstAgentReplyAt" TIMESTAMP(3),
ADD COLUMN     "handedToAgencyAt" TIMESTAMP(3),
ADD COLUMN     "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "CannedReply" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CannedReply_agencyInstallId_idx" ON "CannedReply"("agencyInstallId");

-- CreateIndex
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_assignedToId_idx" ON "Conversation"("assignedToId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "DeskUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CannedReply" ADD CONSTRAINT "CannedReply_agencyInstallId_fkey" FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CannedReply" ADD CONSTRAINT "CannedReply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "DeskUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
