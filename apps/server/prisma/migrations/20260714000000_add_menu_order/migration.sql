-- Sidebar menu ordering: an array of feature keys, top-to-bottom.
ALTER TABLE "ThemeConfig" ADD COLUMN "menuOrder" JSONB;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "menuOrder" JSONB;
ALTER TABLE "ThemePreset" ADD COLUMN "menuOrder" JSONB;
