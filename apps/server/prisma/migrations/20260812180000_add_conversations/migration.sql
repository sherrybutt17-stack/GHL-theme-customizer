-- Widget conversations. Scoped by agency AND sub-account from day one; the untenanted
-- WebhookEvent table is the mistake not to repeat.

CREATE TYPE "ConversationStatus" AS ENUM ('open', 'resolved', 'escalated', 'abandoned');
CREATE TYPE "MessageRole" AS ENUM ('user', 'bot', 'agent', 'system');

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "locationInstallId" TEXT NOT NULL,
    -- The widget is unauthenticated (it runs on a GHL page with no login of its own),
    -- so a per-conversation bearer is what stops one client reading another's chat.
    -- Only the SHA-256 hash is stored, exactly like DeskSession.
    "accessTokenHash" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    -- The metric that decides support headcount. Recorded from day one.
    "deflected" BOOLEAN NOT NULL DEFAULT false,
    "csat" INTEGER,
    -- Gate telemetry; a rising leak rate is a per-agency regression signal.
    "brandLeakHits" INTEGER NOT NULL DEFAULT 0,
    "overlapRejects" INTEGER NOT NULL DEFAULT 0,
    "contextSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_accessTokenHash_key" ON "Conversation"("accessTokenHash");
CREATE INDEX "Conversation_agencyInstallId_idx" ON "Conversation"("agencyInstallId");
CREATE INDEX "Conversation_locationInstallId_idx" ON "Conversation"("locationInstallId");
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    -- INTERNAL provenance only. NEVER rendered into `body`, never sent to a client.
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_agencyInstallId_fkey"
    FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_locationInstallId_fkey"
    FOREIGN KEY ("locationInstallId") REFERENCES "LocationInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
