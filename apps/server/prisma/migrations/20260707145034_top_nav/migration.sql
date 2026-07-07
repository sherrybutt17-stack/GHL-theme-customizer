-- AlterTable
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN     "topNav" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ThemeConfig" ADD COLUMN     "topNav" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ThemePreset" ADD COLUMN     "topNav" BOOLEAN NOT NULL DEFAULT false;
