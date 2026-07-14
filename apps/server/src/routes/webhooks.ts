import { Router, Request, Response } from "express";
import { ghl } from "../services/ghlClient";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";
import { deleteMenuLinkForAgency } from "../services/customMenuLink";
import { describeError } from "../services/security";

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
  // reject anything else, blocking forged UninstallCompany/UninstallLocation events.
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
      data: { ghlEventId: id, eventType, payload: body, status: "processing" },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      const claim = await prisma.webhookEvent
        .updateMany({
          where: { ghlEventId: id, status: { in: ["received", "failed"] } },
          data: { status: "processing", payload: body },
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

async function handleLifecycle(eventType: string, body: any): Promise<void> {
  const companyId: string | undefined = body.companyId;
  const locationId: string | undefined = body.locationId;

  switch (eventType) {
    // A sub-account was created or updated - re-pull the agency's location list so
    // the dashboard reflects it. Cheap and self-correcting vs. tracking each delta.
    case "LocationCreate":
    case "LocationUpdate": {
      if (!companyId) return;
      const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
      if (agency) await syncLocationsForAgency(agency.id);
      return;
    }
    // A sub-account was deleted. A re-sync only upserts locations still PRESENT in
    // GHL's list, so it would never flip a vanished one to removed - its theme would
    // keep being emitted forever. Mark the specific location removed directly (same
    // soft-disable as UninstallLocation), then re-sync to catch any other changes.
    case "LocationDelete": {
      if (locationId) {
        await prisma.locationInstall.updateMany({
          where: { ghlLocationId: locationId },
          data: { status: "removed", enabled: false },
        });
      }
      if (companyId) {
        const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
        if (agency) await syncLocationsForAgency(agency.id);
      }
      return;
    }
    // App removed from a specific sub-account: soft-disable it so its theme stops
    // applying, without losing the saved config.
    case "UninstallLocation": {
      if (!locationId) return;
      await prisma.locationInstall.updateMany({
        where: { ghlLocationId: locationId },
        data: { status: "removed", enabled: false },
      });
      return;
    }
    // App removed from the whole agency: delete the Custom Menu Link (best-effort;
    // GHL may have already revoked our token) and mark the install uninstalled so
    // its themes stop being served.
    case "UninstallCompany": {
      if (!companyId) return;
      const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
      if (agency) {
        await deleteMenuLinkForAgency(agency.id).catch((e) =>
          console.error("Menu-link cleanup on uninstall failed:", e)
        );
        // Also deactivate the agency's sub-accounts so no location-scoped theme is
        // emitted even if the CSS endpoint is somehow reached (defense in depth).
        await prisma.locationInstall.updateMany({
          where: { agencyInstallId: agency.id },
          data: { status: "removed", enabled: false },
        });
      }
      await prisma.agencyInstall.updateMany({
        where: { ghlCompanyId: companyId },
        data: { status: "uninstalled" },
      });
      return;
    }
    default:
      return;
  }
}
