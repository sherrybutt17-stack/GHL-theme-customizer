-- Dedicated sidebar icon color (separate from accent, which colors the active item).
ALTER TABLE "ThemeConfig" ADD COLUMN "sidebarIconColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "sidebarIconColor" TEXT;
ALTER TABLE "ThemePreset" ADD COLUMN "sidebarIconColor" TEXT;
