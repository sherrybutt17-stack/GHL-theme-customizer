-- AlterTable
ALTER TABLE "ThemeConfig" ADD COLUMN     "fontFamily" TEXT,
ADD COLUMN     "gradientAngle" INTEGER NOT NULL DEFAULT 135,
ADD COLUMN     "gradientColor" TEXT,
ADD COLUMN     "gradientEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topBarColor" TEXT;

-- CreateTable
CREATE TABLE "AgencyDefaultTheme" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "fontFamily" TEXT,
    "gradientEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gradientColor" TEXT,
    "gradientAngle" INTEGER NOT NULL DEFAULT 135,
    "topBarColor" TEXT,
    "menuLabelOverrides" JSONB,
    "hiddenFeatures" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyDefaultTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemePreset" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "fontFamily" TEXT,
    "gradientEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gradientColor" TEXT,
    "gradientAngle" INTEGER NOT NULL DEFAULT 135,
    "topBarColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemePreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyDefaultTheme_agencyInstallId_key" ON "AgencyDefaultTheme"("agencyInstallId");

-- CreateIndex
CREATE INDEX "ThemePreset_agencyInstallId_idx" ON "ThemePreset"("agencyInstallId");

-- AddForeignKey
ALTER TABLE "AgencyDefaultTheme" ADD CONSTRAINT "AgencyDefaultTheme_agencyInstallId_fkey" FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemePreset" ADD CONSTRAINT "ThemePreset_agencyInstallId_fkey" FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

