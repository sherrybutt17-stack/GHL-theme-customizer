-- Custom content-area background + text colors (independent of the dark-mode preset).
ALTER TABLE "ThemeConfig" ADD COLUMN "contentBgColor" TEXT;
ALTER TABLE "ThemeConfig" ADD COLUMN "contentTextColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "contentBgColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "contentTextColor" TEXT;
ALTER TABLE "ThemePreset" ADD COLUMN "contentBgColor" TEXT;
ALTER TABLE "ThemePreset" ADD COLUMN "contentTextColor" TEXT;
