-- Mosaic support desk accounts. Single-tenant: these rows are MOSAIC's own support
-- staff, who answer on behalf of every agency. Agencies never get rows here - they
-- keep the ?k= Custom Menu Link dashboard.

CREATE TYPE "DeskRole" AS ENUM ('mosaic_agent', 'mosaic_admin');
CREATE TYPE "DeskUserStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "DeskUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "DeskRole" NOT NULL DEFAULT 'mosaic_agent',
    "status" "DeskUserStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeskUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeskUser_email_key" ON "DeskUser"("email");
CREATE INDEX "DeskUser_status_idx" ON "DeskUser"("status");

-- Only the SHA-256 hash of a session token is stored, so a database leak yields no
-- usable sessions. Sessions live in the DB (rather than being stateless signed
-- tokens like the agency dashboard's) specifically so they can be REVOKED: a support
-- agent who leaves must lose access immediately, not whenever their token expires.
CREATE TABLE "DeskSession" (
    "id" TEXT NOT NULL,
    "deskUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeskSession_tokenHash_key" ON "DeskSession"("tokenHash");
CREATE INDEX "DeskSession_deskUserId_idx" ON "DeskSession"("deskUserId");
-- Supports pruning expired rows without a sequential scan.
CREATE INDEX "DeskSession_expiresAt_idx" ON "DeskSession"("expiresAt");

ALTER TABLE "DeskSession" ADD CONSTRAINT "DeskSession_deskUserId_fkey"
    FOREIGN KEY ("deskUserId") REFERENCES "DeskUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
