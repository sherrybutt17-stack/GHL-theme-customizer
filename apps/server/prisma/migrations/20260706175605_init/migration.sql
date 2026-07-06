-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('pending', 'active', 'removed');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('received', 'processed', 'failed');

-- CreateTable
CREATE TABLE "AgencyInstall" (
    "id" TEXT NOT NULL,
    "ghlCompanyId" TEXT NOT NULL,
    "companyName" TEXT,
    "userId" TEXT,
    "userType" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationInstall" (
    "id" TEXT NOT NULL,
    "agencyInstallId" TEXT NOT NULL,
    "ghlLocationId" TEXT NOT NULL,
    "locationName" TEXT,
    "status" "LocationStatus" NOT NULL DEFAULT 'pending',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "userType" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "installedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeConfig" (
    "id" TEXT NOT NULL,
    "locationInstallId" TEXT NOT NULL,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "menuLabelOverrides" JSONB,
    "hiddenFeatures" JSONB,
    "customCssOverride" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomMenuLinkRegistration" (
    "id" TEXT NOT NULL,
    "locationInstallId" TEXT NOT NULL,
    "ghlMenuLinkId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomMenuLinkRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "ghlEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "WebhookStatus" NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyInstall_ghlCompanyId_key" ON "AgencyInstall"("ghlCompanyId");

-- CreateIndex
CREATE INDEX "AgencyInstall_status_idx" ON "AgencyInstall"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LocationInstall_ghlLocationId_key" ON "LocationInstall"("ghlLocationId");

-- CreateIndex
CREATE INDEX "LocationInstall_agencyInstallId_idx" ON "LocationInstall"("agencyInstallId");

-- CreateIndex
CREATE INDEX "LocationInstall_status_idx" ON "LocationInstall"("status");

-- CreateIndex
CREATE INDEX "ThemeConfig_locationInstallId_idx" ON "ThemeConfig"("locationInstallId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomMenuLinkRegistration_slug_key" ON "CustomMenuLinkRegistration"("slug");

-- CreateIndex
CREATE INDEX "CustomMenuLinkRegistration_locationInstallId_idx" ON "CustomMenuLinkRegistration"("locationInstallId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_ghlEventId_key" ON "WebhookEvent"("ghlEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_idx" ON "WebhookEvent"("eventType");

-- AddForeignKey
ALTER TABLE "LocationInstall" ADD CONSTRAINT "LocationInstall_agencyInstallId_fkey" FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeConfig" ADD CONSTRAINT "ThemeConfig_locationInstallId_fkey" FOREIGN KEY ("locationInstallId") REFERENCES "LocationInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomMenuLinkRegistration" ADD CONSTRAINT "CustomMenuLinkRegistration_locationInstallId_fkey" FOREIGN KEY ("locationInstallId") REFERENCES "LocationInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
