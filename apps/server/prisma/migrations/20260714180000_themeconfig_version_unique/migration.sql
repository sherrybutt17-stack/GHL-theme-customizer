-- Enforce one ThemeConfig row per (locationInstallId, version). First dedupe any
-- existing collisions (from past races), keeping the newest by createdAt then id,
-- so the unique index can be created safely.
DELETE FROM "ThemeConfig" a
USING "ThemeConfig" b
WHERE a."locationInstallId" = b."locationInstallId"
  AND a."version" = b."version"
  AND (a."createdAt" < b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

CREATE UNIQUE INDEX "ThemeConfig_locationInstallId_version_key"
  ON "ThemeConfig" ("locationInstallId", "version");
