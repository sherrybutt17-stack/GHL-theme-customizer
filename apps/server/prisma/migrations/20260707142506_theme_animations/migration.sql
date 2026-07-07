-- AlterTable
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN     "animateLoadIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "animateScroll" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ThemeConfig" ADD COLUMN     "animateLoadIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "animateScroll" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ThemePreset" ADD COLUMN     "animateLoadIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "animateScroll" BOOLEAN NOT NULL DEFAULT false;
