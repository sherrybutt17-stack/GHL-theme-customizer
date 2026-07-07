-- AlterTable
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN     "alertColor" TEXT,
ADD COLUMN     "alertMessage" TEXT;

-- AlterTable
ALTER TABLE "ThemeConfig" ADD COLUMN     "alertColor" TEXT,
ADD COLUMN     "alertMessage" TEXT;
