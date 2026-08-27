import axios from "axios";
import { prisma } from "./prisma";
import { sessionStorage } from "./ghlClient";
import { describeError } from "./security";
import { classifyRefreshFailure, REFRESH_REMEDY, type RefreshFailure } from "./tokenFailure";

/**
 * Proactively refreshes agency tokens before they expire, using a raw HTTP call
 * rather than the SDK's built-in refresh-on-401 path.
 *
 * Why: the SDK's automatic 401 retry (HighLevel.js's response interceptor) has a
 * real bug - hitting a real expired/near-expired token here caused hundreds of
 * "401 Unauthorized - Attempting token refresh" log lines in a tight loop rather
 * than refreshing once and moving on, even though the underlying refresh_token
 * and /oauth/token endpoint work perfectly when called directly (verified
 * manually). Rather than debug the SDK's interceptor internals further, we just
 * make sure the SDK's own token lookup (sessionStorage.getSession) always finds
 * an unexpired token in the first place, so its buggy retry path never triggers.
 */
const REFRESH_BUFFER_MS = 2 * 60 * 60 * 1000; // refresh anything expiring within 2h

export async function refreshAgencyTokenIfNeeded(agencyInstallId: string): Promise<void> {
  const agency = await prisma.agencyInstall.findUniqueOrThrow({ where: { id: agencyInstallId } });
  if (agency.tokenExpiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return; // still fresh enough
  }

  const session = await sessionStorage.getSession(agency.ghlCompanyId);
  if (!session?.refresh_token) {
    console.error(`No refresh token available for agency ${agency.id}, cannot proactively refresh`);
    return;
  }

  const res = await axios.post(
    "https://services.leadconnectorhq.com/oauth/token",
    new URLSearchParams({
      client_id: process.env.GHL_APP_CLIENT_ID as string,
      client_secret: process.env.GHL_APP_CLIENT_SECRET as string,
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
      user_type: "Company",
    }),
    { headers: { "content-type": "application/x-www-form-urlencoded" } }
  );

  await sessionStorage.setSession(agency.ghlCompanyId, res.data);
  console.log(`Proactively refreshed token for agency ${agency.id}`);
}

/**
 * Permanent failures already reported this process. A wrong key or a revoked grant
 * cannot fix itself, so saying so every 30 minutes buries the transient failures that
 * ARE worth reading. Per-process rather than persisted: a restart is the moment
 * somebody is looking, and that is a good time to say it again.
 */
const reportedPermanent = new Map<string, RefreshFailure>();

export async function refreshAllExpiringAgencyTokens(): Promise<void> {
  const agencies = await prisma.agencyInstall.findMany({
    where: { status: "active", tokenExpiresAt: { lt: new Date(Date.now() + REFRESH_BUFFER_MS) } },
    select: { id: true },
  });

  let attempted = 0;
  let decryptFailures = 0;

  for (const agency of agencies) {
    try {
      attempted++;
      await refreshAgencyTokenIfNeeded(agency.id);
      reportedPermanent.delete(agency.id); // recovered
    } catch (error) {
      const kind = classifyRefreshFailure(error);
      if (kind === "decrypt") decryptFailures++;
      if (kind !== "transient" && reportedPermanent.get(agency.id) === kind) continue;
      if (kind !== "transient") reportedPermanent.set(agency.id, kind);
      console.error(
        `[token-refresh] ${kind} failure for agency ${agency.id}: ${describeError(error)} — ${REFRESH_REMEDY[kind]}`
      );
    }
  }

  // EVERY agency failing to decrypt is not an agency problem, it is the key. Said once
  // per pass and separately, because one line per agency buries the only fact that
  // matters when the install is large.
  if (decryptFailures > 0 && decryptFailures === attempted) {
    console.error(
      `[token-refresh] ALL ${attempted} agencies failed to decrypt. This is TOKEN_ENCRYPTION_KEY, not the agencies. ${REFRESH_REMEDY.decrypt}`
    );
  }
}
