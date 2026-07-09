import { Router, Request, Response } from "express";
import { ghl } from "../services/ghlClient";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";

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

  // Idempotency: if we've already processed this exact event, do nothing.
  const existing = await prisma.webhookEvent
    .findUnique({ where: { ghlEventId: String(eventId) } })
    .catch(() => null);
  if (existing?.status === "processed") {
    return res.json({ success: true, deduped: true });
  }

  // Record every event for the audit trail, even ones we're about to reject.
  await prisma.webhookEvent
    .upsert({
      where: { ghlEventId: String(eventId) },
      update: {},
      create: {
        ghlEventId: String(eventId),
        eventType,
        payload: body,
        status: sigValid === false ? "failed" : "received",
      },
    })
    .catch((e) => console.error("Failed to persist webhook event:", e));

  // SECURITY: never run lifecycle side effects (uninstall, disable, forced GHL
  // API calls) on a payload we can't trust. Once a public key is configured we
  // require a positive verification result and reject anything else (this is what
  // blocks forged UninstallCompany/UninstallLocation requests). When no key is
  // configured we cannot verify at all, so we process but warn loudly - setting
  // the key is the documented go-live step (see docs/submission-checklist.md).
  if (signatureConfigured && sigValid !== true) {
    console.warn(`Rejected webhook ${eventType} (${eventId}): signature verification failed`);
    return res.status(401).json({ success: false, error: "invalid webhook signature" });
  }
  if (!signatureConfigured) {
    console.warn(
      `WEBHOOK_SIGNATURE_PUBLIC_KEY is not set - processing ${eventType} WITHOUT signature verification. ` +
        `Set it to the app's Ed25519 public key to secure this endpoint.`
    );
  }

  try {
    await handleLifecycle(eventType, body);
    await prisma.webhookEvent
      .update({ where: { ghlEventId: String(eventId) }, data: { status: "processed", processedAt: new Date() } })
      .catch(() => {});
  } catch (error: any) {
    console.error(`Webhook ${eventType} handling failed:`, error);
    await prisma.webhookEvent
      .update({ where: { ghlEventId: String(eventId) }, data: { status: "failed", errorMessage: String(error?.message ?? error) } })
      .catch(() => {});
  }

  res.json({ success: true });
});

async function handleLifecycle(eventType: string, body: any): Promise<void> {
  const companyId: string | undefined = body.companyId;
  const locationId: string | undefined = body.locationId;

  switch (eventType) {
    // A sub-account was created/updated/removed - re-pull the agency's location
    // list so the dashboard reflects it. Cheap and self-correcting vs. tracking
    // each delta by hand.
    case "LocationCreate":
    case "LocationUpdate":
    case "LocationDelete": {
      if (!companyId) return;
      const agency = await prisma.agencyInstall.findUnique({ where: { ghlCompanyId: companyId } });
      if (agency) await syncLocationsForAgency(agency.id);
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
    // App removed from the whole agency: mark the install uninstalled.
    case "UninstallCompany": {
      if (!companyId) return;
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
