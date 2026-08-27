-- Per-agency support policy, plus the per-sub-account widget toggle.

CREATE TYPE "SupportBoundary" AS ENUM ('how_to_only', 'how_to_and_account', 'custom');

-- The toggle the agency flips in their Mosaic dashboard. A column on the existing row
-- rather than a per-location config table: the dashboard only needs on/off, and this
-- reuses the enable/disable UI that already exists.
ALTER TABLE "LocationInstall" ADD COLUMN "supportEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SupportConfig" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "greeting" TEXT,
    "quickActions" JSONB,
    "businessHours" JSONB,
    "escalationEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "supportBoundary" "SupportBoundary" NOT NULL DEFAULT 'how_to_only',
    "boundaryNotes" TEXT,
    -- Agency additions to the global brand blocklist.
    "forbiddenTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Gate 2 allowlist. EMPTY is the default AND the safe value: strip every link.
    "allowedLinkDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "voiceTone" TEXT,
    "userNoun" TEXT,
    "planTiers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportConfig_agencyInstallId_key" ON "SupportConfig"("agencyInstallId");

ALTER TABLE "SupportConfig" ADD CONSTRAINT "SupportConfig_agencyInstallId_fkey"
    FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
