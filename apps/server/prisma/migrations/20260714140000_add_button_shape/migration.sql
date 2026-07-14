-- Button shape preset: "square" | "rounded" | "pill" (null = leave GHL default).
ALTER TABLE "ThemeConfig" ADD COLUMN "buttonShape" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "buttonShape" TEXT;
ALTER TABLE "ThemePreset" ADD COLUMN "buttonShape" TEXT;
