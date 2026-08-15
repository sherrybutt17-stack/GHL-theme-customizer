import { Router, Request, Response } from "express";
import { ghl } from "../services/ghlClient";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";
import { deleteMenuLinkForAgency, ensureAgencyAdminMenuLink } from "../services/customMenuLink";
import { describeError } from "../services/security";
import { auditPayload, classifyWebhookEvent } from "../services/webhookEvents";

export const webhooksRouter = Router();

/**
 * ghl.webhooks.subscribe() validates the signature and, for INSTALL/UNINSTALL events,
 * auto-generates/removes tokens via our PrismaSessionStorage before this runs. We then
 * log the event (idempotently, keyed by ghlEventId) and drive lifecycle side effects:
 * keep the sub-account list in sync as locations are added/removed/updated.
 */
webhooksRouter.post("/webhooks/ghl", ghl.webhooks.subscribe(), async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const eventId = body.webhookId ?? body.id ?? `${body.type ?? "unknown"}-${Date.now()}`;
  const eventType: string = body.type ?? "unknown";

  const sigValid = (req as any).isSignatureValid as boolean | undefined;
  const signatureConfigured = !!process.env.WEBHOOK_SIGNATURE_PUBLIC_KEY?.trim();

  // SECURITY: verify the signature BEFORE touching the database. Rejecting here
  // (rather than after persisting an audit row) means a flood of forged/unsigned
  // requests can't write rows at all - no unauthenticated DB writes, no storage
  // amplification. Once a public key is configured we require a positive result and
  // reject anything else, blocking a forged UNINSTALL from un-branding a live agency.
  if (signatureConfigured && sigValid !== true) {
    console.warn(`Rejected webhook ${eventType} (${eventId}): signature verification failed`);
    return res.status(401).json({ success: false, error: "invalid webhook signature" });
  }
  if (!signatureConfigured) {
    // No key configured: we can't verify. Process but warn loudly - setting the key
    // is the documented go-live step (see docs/submission-checklist.md).
    console.warn(
      `WEBHOOK_SIGNATURE_PUBLIC_KEY is not set - processing ${eventType} WITHOUT signature verification. ` +
        `Set it to the app's Ed25519 public key to secure this endpoint.`
    );
  }

  // Idempotency + ATOMIC claim. Create the audit row directly as "processing"; a
  // concurrent duplicate delivery hits the ghlEventId unique constraint (P2002) and
  // can only re-claim if a prior attempt is still "received" (legacy) or "failed" (a
  // genuine GHL retry). This prevents two concurrent deliveries from both running the
  // handler, while still letting failed events be retried.
  const id = String(eventId);
  try {
    await prisma.webhookEvent.create({
      data: { ghlEventId: id, eventType, payload: auditPayload(eventType, body) as any, status: "processing" },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      const claim = await prisma.webhookEvent
        .updateMany({
          where: { ghlEventId: id, status: { in: ["received", "failed"] } },
          data: { status: "processing", payload: auditPayload(eventType, body) as any },
        })
        .catch(() => ({ count: 0 }));
      if (claim.count === 0) return res.json({ success: true, deduped: true });
    } else {
      // A logging failure (not a duplicate) shouldn't drop a valid event - process it.
      console.error("Failed to persist webhook event:", describeError(e));
    }
  }

  try {
    await handleLifecycle(eventType, body);
    await prisma.webhookEvent
      .update({ where: { ghlEventId: String(eventId) }, data: { status: "processed", processedAt: new Date() } })
      .catch(() => {});
  } catch (error: any) {
    console.error(`Webhook ${eventType} handling failed: ${describeError(error)}`);
    await prisma.webhookEvent
      .update({ where: { ghlEventId: String(eventId) }, data: { status: "failed", errorMessage: describeError(error) } })
      .catch(() => {});
  }

  res.json({ success: true });
});

/**
 * Remove the app from ONE sub-account: soft-disable it so its theme stops applying,
 * without losing the saved config.
 */
async function removeLocation(locationId: string): Promise<void> {
  await prisma.locationInstall.updateMany({
    where: { ghlLocationId: locationId },
    // The reason matters: a sub-account removed on its own is gone for good and a later
    // re-sync must never resurrect it, even while GHL still lists it. See locationSync.
    data: { status: "removed", enabled: false, removedReason: "location-delete" },
  });
}

/**
 * Remove the app from the whole agency: delete the Custom Menu Link (best-effort;
 * GHL may have already revoked our token) and mark the install uninstalled so its
 * themes, its support widget and its brand terms all stop being served.
 */
async function removeAgency(companyId: string): Promise<void> {
  const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
  if (agency) {
    await deleteMenuLinkForAgency(agency.id).catch((e) =>
      console.error("Menu-link cleanup on uninstall failed:", describeError(e))
    );
    /**
     * Also deactivate the agency's sub-accounts so no location-scoped theme is emitted
     * even if the CSS endpoint is somehow reached (defense in depth).
     *
     * Stamped as a CASCADE, not a deletion, because a reinstall has to be able to tell
     * them apart: GHL still has these sub-accounts, so they must come back — and until
     * this column existed they did not, leaving a reinstalled agency with zero working
     * sub-accounts and no way to recover short of hand-written SQL. See locationSync.
     *
     * `enabled` is deliberately NOT touched. It is the agency's own per-sub-account
     * switch in the dashboard, and overwriting a user's setting as a side effect of an
     * uninstall destroys a choice we then cannot restore. Nothing is served on a
     * `removed` row regardless — every serving path gates on `status`.
     */
    await prisma.locationInstall.updateMany({
      where: { agencyInstallId: agency.id, status: { not: "removed" } },
      data: { status: "removed", removedReason: "agency-uninstall" },
    });
  }
  await prisma.agencyInstall.updateMany({
    where: { ghlCompanyId: companyId },
    data: { status: "uninstalled" },
  });
}

async function handleLifecycle(eventType: string, body: any): Promise<void> {
  const companyId: string | undefined = body.companyId;
  const locationId: string | undefined = body.locationId;
  /**
   * Dispatch through the SAME classifier the retention policy uses, so "what this app
   * acts on" has exactly one definition. Two copies would look right in review and
   * diverge the first time an event type is added to one of them — and the direction
   * that hurts is silent: the policy would discard the payload of an event that can
   * fail, leaving nothing to debug on the one delivery you needed it for.
   */
  const kind = classifyWebhookEvent(eventType);

  // App installed on an agency. The browser OAuth redirect (routes/oauth.ts) is what
  // normally creates the token and runs portal setup (location sync + Custom Menu
  // Link). But that redirect depends on the user's browser completing the round-trip;
  // if it times out (e.g. a cold-started instance), the install is left half-done:
  // token present but no menu link and no onboarding. This webhook is server-to-server
  // and GHL retries it, so we re-run the (idempotent) setup here to self-heal.
  //
  // NOTE: the webhook carries NO token - agency tokens only come from the OAuth code
  // exchange. So we can only COMPLETE setup once the AgencyInstall row exists (created
  // by that exchange). If it doesn't exist yet, we no-op and let the OAuth handler (or
  // a later webhook retry) do it. GHL's event type is "INSTALL"; the prefix match also
  // accepts a granular "Install*" form defensively, mirroring the uninstall branch below.
  if (kind === "install") {
    if (!companyId) return;
    const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
    // Only for a live agency install: no row yet -> OAuth hasn't created the token, so
    // there's nothing we can set up. Skip uninstalled installs (stale/revoked tokens).
    if (!agency || agency.status === "uninstalled") return;
    const appBaseUrl = process.env.APP_PUBLIC_URL;
    if (!appBaseUrl) {
      console.warn("INSTALL webhook: APP_PUBLIC_URL not set - skipping menu-link setup");
      return;
    }
    await syncLocationsForAgency(agency.id);
    await ensureAgencyAdminMenuLink(agency.id, appBaseUrl);
    return;
  }

  /**
   * UNINSTALL — the event GHL ACTUALLY sends, and the one this switch used not to have.
   *
   * The cases below were written as `UninstallCompany` / `UninstallLocation`, names that
   * appear nowhere except this file. GHL's own SDK switches on the bare string
   * `"UNINSTALL"` (see webhook-manager.js), so every real uninstall fell through to
   * `default:` and did NOTHING — while the audit row was still marked `processed` and the
   * response still said `success: true`. Silent from every angle.
   *
   * What actually happened on a real uninstall was decided entirely by a SIDE EFFECT of
   * the SDK middleware: its UNINSTALL case calls `sessionStorage.deleteSession`, and our
   * PrismaSessionStorage happens to flip the agency to `uninstalled` there. So the status
   * flip worked by luck, and everything only this handler does did not:
   *   - the Custom Menu Link was never deleted, so it sat in the agency's GHL nav
   *     pointing at us forever. `deleteMenuLinkForAgency` was written specifically to
   *     survive the SDK having already withheld the token — and was then never reached.
   *   - sub-accounts were never soft-removed.
   * And that luck only holds on the SIGNATURE-VERIFIED path: with no public key set the
   * SDK returns `next()` before its own switch runs, so nothing happened at all.
   *
   * Hence: dispatch on the real event, and never depend on the SDK's side effect again.
   * `locationId` wins over `companyId`, matching the SDK's own precedence — an
   * agency-level uninstall carries no locationId, and a sub-account one may carry both,
   * so this keeps our idea of "what was removed" identical to the SDK's.
   *
   * The granular names are kept as aliases. They cost one regex and mean a GHL that does
   * emit them is still handled.
   */
  if (kind === "uninstall") {
    if (locationId) return removeLocation(locationId);
    if (companyId) return removeAgency(companyId);
    return;
  }

  switch (eventType) {
    // A sub-account was created or updated - re-pull the agency's location list so
    // the dashboard reflects it. Cheap and self-correcting vs. tracking each delta.
    case "LocationCreate":
    case "LocationUpdate": {
      if (!companyId) return;
      const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
      // Skip an uninstalled agency EXPLICITLY, the way the install branch already does.
      // A sync would fail anyway — PrismaSessionStorage withholds tokens for an
      // uninstalled install, so the SDK throws — but that is a real protection and not
      // this decision; a handler that does the right thing only because an unrelated
      // component happens to stop it is the shape of the bug that sat in this same switch
      // for months. It also used to be TWO protections: the re-sync refused to revive any
      // `removed` location. It now revives the agency-uninstall cascade on purpose, which
      // is precisely why leaning on that second one would have aged badly.
      if (agency && agency.status !== "uninstalled") await syncLocationsForAgency(agency.id);
      return;
    }
    // A sub-account was deleted. A re-sync only upserts locations still PRESENT in
    // GHL's list, so it would never flip a vanished one to removed - its theme would
    // keep being emitted forever. Mark the specific location removed directly (same
    // soft-disable as UninstallLocation), then re-sync to catch any other changes.
    case "LocationDelete": {
      if (locationId) await removeLocation(locationId);
      if (companyId) {
        const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
        // Same explicit uninstalled guard as LocationUpdate above, and for the reason
        // given there rather than by analogy: a re-sync now deliberately revives the
        // agency-uninstall cascade, so this branch must not run for an agency that is
        // still uninstalled. It was previously safe only because the token fetch throws.
        if (agency && agency.status !== "uninstalled") await syncLocationsForAgency(agency.id);
      }
      return;
    }
    default:
      return;
  }
}
