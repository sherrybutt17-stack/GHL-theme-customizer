-- Add sidebar menu text color to per-location themes, the agency default, and presets.
ALTER TABLE "ThemeConfig" ADD COLUMN "sidebarTextColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "sidebarTextColor" TEXT;
ALTER TABLE "ThemePreset" ADD COLUMN "sidebarTextColor" TEXT;
