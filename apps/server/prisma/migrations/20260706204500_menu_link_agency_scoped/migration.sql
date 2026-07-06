-- DropForeignKey
ALTER TABLE "CustomMenuLinkRegistration" DROP CONSTRAINT "CustomMenuLinkRegistration_locationInstallId_fkey";

-- DropIndex
DROP INDEX "CustomMenuLinkRegistration_locationInstallId_idx";

-- AlterTable
ALTER TABLE "CustomMenuLinkRegistration" DROP COLUMN "locationInstallId",
ADD COLUMN     "agencyInstallId" TEXT NOT NULL,
ADD COLUMN     "targetLocationIds" JSONB NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CustomMenuLinkRegistration_agencyInstallId_key" ON "CustomMenuLinkRegistration"("agencyInstallId");

-- AddForeignKey
ALTER TABLE "CustomMenuLinkRegistration" ADD CONSTRAINT "CustomMenuLinkRegistration_agencyInstallId_fkey" FOREIGN KEY ("agencyInstallId") REFERENCES "AgencyInstall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

