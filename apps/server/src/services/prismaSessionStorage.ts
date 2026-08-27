import { SessionStorage, type ISessionData } from "@gohighlevel/api-client";
import { prisma } from "./prisma";
import { encryptToken, decryptToken } from "./tokenCrypto";

/**
 * Persists GHL OAuth sessions (keyed by companyId or locationId, per the SDK's
 * SessionStorage contract) into AgencyInstall / LocationInstall rows instead of
 * the SDK's default in-memory map, so tokens survive restarts.
 */
export class PrismaSessionStorage extends SessionStorage {
  setClientId(_clientId: string): void {
    // no-op: clientId is only needed by the SDK's own Mongo/memory key-namespacing
  }

  async init(): Promise<void> {
    await prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await prisma.$disconnect();
  }

  async createCollection(_collectionName: string): Promise<void> {
    // no-op: Prisma migrations own schema creation, not the SDK
  }

  async getCollection(_collectionName: string): Promise<any> {
    return prisma;
  }

  async setSession(resourceId: string, sessionData: ISessionData): Promise<void> {
    const expiresAt = new Date(sessionData.expire_at ?? this.calculateExpireAt(sessionData.expires_in));
    const accessTokenEnc = sessionData.access_token ? encryptToken(sessionData.access_token) : undefined;
    const refreshTokenEnc = sessionData.refresh_token ? encryptToken(sessionData.refresh_token) : undefined;

    const isLocationSession = !!sessionData.locationId && resourceId === sessionData.locationId;

    if (isLocationSession) {
      const companyId = sessionData.companyId;
      if (!companyId) {
        throw new Error(`Cannot store location session for ${resourceId}: sessionData is missing companyId`);
      }
      const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
      if (!agency) {
        throw new Error(`Cannot store location session for ${resourceId}: no AgencyInstall found for companyId ${companyId}`);
      }
      await prisma.locationInstall.upsert({
        where: { ghlLocationId: resourceId },
        update: {
          accessTokenEnc,
          refreshTokenEnc,
          tokenExpiresAt: expiresAt,
          scopes: sessionData.scope,
          userId: sessionData.userId,
          userType: sessionData.userType,
          status: "active",
          enabled: true,
          activatedAt: new Date(),
        },
        create: {
          agencyInstallId: agency.id,
          ghlLocationId: resourceId,
          accessTokenEnc: accessTokenEnc!,
          refreshTokenEnc: refreshTokenEnc!,
          tokenExpiresAt: expiresAt,
          scopes: sessionData.scope,
          userId: sessionData.userId,
          userType: sessionData.userType,
          status: "active",
          enabled: true,
          installedAt: new Date(),
          activatedAt: new Date(),
        },
      });
      return;
    }

    await prisma.agencyInstall.upsert({
      where: { ghlCompanyId: resourceId },
      update: {
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt: expiresAt,
        scopes: sessionData.scope,
        userId: sessionData.userId,
        userType: sessionData.userType,
        status: "active",
      },
      create: {
        ghlCompanyId: resourceId,
        accessTokenEnc: accessTokenEnc!,
        refreshTokenEnc: refreshTokenEnc!,
        tokenExpiresAt: expiresAt,
        scopes: sessionData.scope,
        userId: sessionData.userId,
        userType: sessionData.userType,
        status: "active",
      },
    });
  }

  async getSession(resourceId: string): Promise<ISessionData | null> {
    const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: resourceId } });
    // Skip uninstalled installs: their stored tokens are revoked/stale, and no
    // caller should be making GHL API calls on their behalf.
    if (agency && agency.status !== "uninstalled") {
      return {
        access_token: decryptToken(agency.accessTokenEnc),
        refresh_token: decryptToken(agency.refreshTokenEnc),
        expire_at: agency.tokenExpiresAt.getTime(),
        scope: agency.scopes ?? undefined,
        userId: agency.userId ?? undefined,
        userType: agency.userType ?? undefined,
        companyId: agency.ghlCompanyId,
      };
    }

    const location = await prisma.locationInstall.findUnique({ where: { ghlLocationId: resourceId } });
    if (location && location.accessTokenEnc && location.refreshTokenEnc && location.tokenExpiresAt) {
      const parentAgency = await prisma.agencyInstall.findUnique({ where: { id: location.agencyInstallId } });
      return {
        access_token: decryptToken(location.accessTokenEnc),
        refresh_token: decryptToken(location.refreshTokenEnc),
        expire_at: location.tokenExpiresAt.getTime(),
        scope: location.scopes ?? undefined,
        userId: location.userId ?? undefined,
        userType: location.userType ?? undefined,
        companyId: parentAgency?.ghlCompanyId,
        locationId: location.ghlLocationId,
      };
    }

    return null;
  }

  async deleteSession(resourceId: string): Promise<void> {
    const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: resourceId } });
    if (agency) {
      await prisma.agencyInstall.update({ where: { id: agency.id }, data: { status: "uninstalled" } });
      return;
    }
    const location = await prisma.locationInstall.findUnique({ where: { ghlLocationId: resourceId } });
    if (location) {
      await prisma.locationInstall.update({
        where: { id: location.id },
        // Reached only when the SDK deletes a LOCATION session, i.e. this sub-account
        // removed the app itself — not a cascade, so a later re-sync must leave it alone.
        data: {
          status: "removed",
          enabled: false,
          removedReason: "location-delete",
          accessTokenEnc: null,
          refreshTokenEnc: null,
        },
      });
    }
  }

  async getAccessToken(resourceId: string): Promise<string | null> {
    const session = await this.getSession(resourceId);
    return session?.access_token ?? null;
  }

  async getRefreshToken(resourceId: string): Promise<string | null> {
    const session = await this.getSession(resourceId);
    return session?.refresh_token ?? null;
  }
}
