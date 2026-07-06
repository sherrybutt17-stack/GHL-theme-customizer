import { Router, Request, Response } from "express";
import { ghl } from "../services/ghlClient";
import { prisma } from "../services/prisma";

export const webhooksRouter = Router();

/**
 * ghl.webhooks.subscribe() validates the signature and, for INSTALL/UNINSTALL events,
 * auto-generates/removes tokens via our PrismaSessionStorage before this runs.
 * Full per-event-type lifecycle handling (LocationCreate/Update, idempotency) lands in Phase 5 -
 * for now we just log what arrives so install/uninstall can be verified end-to-end.
 */
webhooksRouter.post("/webhooks/ghl", ghl.webhooks.subscribe(), async (req: Request, res: Response) => {
  const eventId = req.body?.webhookId ?? req.body?.id ?? `${req.body?.type ?? "unknown"}-${Date.now()}`;
  const eventType = req.body?.type ?? "unknown";

  try {
    await prisma.webhookEvent.upsert({
      where: { ghlEventId: String(eventId) },
      update: {},
      create: {
        ghlEventId: String(eventId),
        eventType,
        payload: req.body ?? {},
        status: (req as any).isSignatureValid === false ? "failed" : "received",
      },
    });
  } catch (error) {
    console.error("Failed to persist webhook event:", error);
  }

  res.json({ success: true });
});
