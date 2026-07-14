-- Login page branding (agency-level only; the login page is shared, pre-sub-account).
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginBgColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginBgImage" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginGradientEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginGradientColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginGradientAngle" INTEGER NOT NULL DEFAULT 135;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginCardColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginButtonColor" TEXT;
ALTER TABLE "AgencyDefaultTheme" ADD COLUMN "loginLogoUrl" TEXT;
