-- Desk routing and queueing.
--
-- Written by hand rather than by `prisma migrate dev`, like every migration in this
-- repo: `migrate dev` regenerates from the datamodel and drops the raw-SQL objects
-- Prisma cannot express (the generated `searchVector` column and its GIN index).

-- `away` is a ROUTING state, not an access state. DeskUserStatus.disabled already
-- exists and kills live sessions; collapsing the two would mean a lunch break logged
-- you out, and a departure merely stopped new assignments.
CREATE TYPE "DeskAvailability" AS ENUM ('available', 'away');

ALTER TABLE "DeskUser"
  ADD COLUMN "availability"  "DeskAvailability" NOT NULL DEFAULT 'available',
  ADD COLUMN "maxConcurrent" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "tier"          INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Conversation"
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "tier"     INTEGER NOT NULL DEFAULT 1;

-- Backfill the wait clock for conversations that are ALREADY escalated. Without this
-- every existing ticket has queuedAt = NULL and reads as "waiting since forever" (or,
-- worse, gets sorted arbitrarily against the ones that have it). lastMessageAt is the
-- closest honest approximation of when it landed on the desk.
UPDATE "Conversation"
   SET "queuedAt" = "lastMessageAt"
 WHERE "status" = 'escalated' AND "queuedAt" IS NULL;

-- The queue pop: unclaimed escalations within an agent's tier, best-first. The desk's
-- "take next" and the client's "you are 3rd in line" read the same order through it.
CREATE INDEX "Conversation_status_assignedToId_tier_priority_queuedAt_idx"
  ON "Conversation" ("status", "assignedToId", "tier", "priority", "queuedAt");
