-- Undo for the agency default.
--
-- AgencyDefaultTheme is a single upserted row that styles EVERY sub-account, and it had
-- no history at all: one bad save, or one Reset, and the previous look was gone. Per
-- sub-account themes already have this (ThemeConfig is versioned + a History tab).
--
-- Hand-written deliberately: `prisma migrate dev` also wants to emit DROP INDEX on
-- KbArticle's GIN index and drop several array defaults, none of which belong in a
-- migration that adds one table. See the note on the desk-tickets migration.
CREATE TABLE "AgencyDefaultThemeVersion" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyDefaultThemeVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgencyDefaultThemeVersion_agencyInstallId_createdAt_idx"
    ON "AgencyDefaultThemeVersion"("agencyInstallId", "createdAt");

ALTER TABLE "AgencyDefaultThemeVersion"
    ADD CONSTRAINT "AgencyDefaultThemeVersion_agencyInstallId_fkey"
    FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
