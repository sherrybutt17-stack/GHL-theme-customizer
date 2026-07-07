-- Remove top-nav and animation fields (feature removed)
ALTER TABLE "ThemeConfig" DROP COLUMN IF EXISTS "animateLoadIn", DROP COLUMN IF EXISTS "animateScroll", DROP COLUMN IF EXISTS "topNav";
ALTER TABLE "AgencyDefaultTheme" DROP COLUMN IF EXISTS "animateLoadIn", DROP COLUMN IF EXISTS "animateScroll", DROP COLUMN IF EXISTS "topNav";
ALTER TABLE "ThemePreset" DROP COLUMN IF EXISTS "animateLoadIn", DROP COLUMN IF EXISTS "animateScroll", DROP COLUMN IF EXISTS "topNav";
