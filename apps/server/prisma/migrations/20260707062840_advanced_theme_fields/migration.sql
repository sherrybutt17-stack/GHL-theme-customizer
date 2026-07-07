-- AlterTable
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN     "buttonColor" TEXT,
ADD COLUMN     "cornerRadius" INTEGER,
ADD COLUMN     "customCss" TEXT,
ADD COLUMN     "darkMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hideUpgrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scrollbarColor" TEXT,
ADD COLUMN     "sidebarImageUrl" TEXT;

-- AlterTable
ALTER TABLE "ThemeConfig" ADD COLUMN     "buttonColor" TEXT,
ADD COLUMN     "cornerRadius" INTEGER,
ADD COLUMN     "darkMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hideUpgrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scrollbarColor" TEXT,
ADD COLUMN     "sidebarImageUrl" TEXT;

-- AlterTable
ALTER TABLE "ThemePreset" ADD COLUMN     "buttonColor" TEXT,
ADD COLUMN     "cornerRadius" INTEGER,
ADD COLUMN     "darkMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scrollbarColor" TEXT;
