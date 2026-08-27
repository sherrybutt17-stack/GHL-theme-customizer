import { Router, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../services/prisma";
import { answerQuestion, isSupportEnabled, BotMessage } from "../services/supportBot";
import { resolveBrandMap } from "../services/brandTerms";
import { describeError } from "../services/security";
import { notifyDeskOfEscalation } from "../services/email";
import { visibleOutsideMosaic } from "../services/transcriptVisibility";
import { generateSupportWidgetScript } from "../services/supportWidgetScript";
import { connectHint } from "../services/businessHours";
import {
  agentSlots,
  capacitySnapshot,
  enterQueuePatch,
  estimateWaitSeconds,
  waitSentence,
  firstResponseStats,
  queuePosition,
} from "../services/deskQueue";

/**
 * The PUBLIC widget API, called from inside a client's GHL page.
 *
 * There is no login here and there cannot be: the widget runs on a page GHL renders,
 * with no credential of its own. Security therefore rests on three things:
 *
 *   1. Identity comes from the REQUEST, never from the widget. It sends only who it is
 *      (agency + location); the server looks up what that means. If the widget declared
 *      its own brand name or forbidden-terms list, anyone could forge a request with an
 *      empty list and read unfiltered answers.
 *   2. The location must actually belong to the agency in the path, and support must be
 *      enabled for BOTH.
 *   3. Continuing a conversation requires a per-conversation bearer token issued at
 *      creation, so one client cannot read another's chat by guessing an id.
 */
export const supportRouter = Router();

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY = 12;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Resolve and authorise (agency, location). Returns null after replying with an error. */
async function requireEnabledLocation(
  req: Request,
  res: Response
): Promise<{ agencyInstallId: string; locationInstallId: string; ghlLocationId: string } | null> {
  const { agencyInstallId, ghlLocationId } = req.params;
  const location = await prisma.locationInstall.findUnique({
    where: { ghlLocationId },
    select: { id: true, agencyInstallId: true },
  });

  // One message for "unknown location" and "wrong agency" alike: the agencyInstallId is
  // public (it sits in the pasted @import CSS), so distinguishing them would let anyone
  // enumerate which sub-accounts belong to which agency.
  if (!location || location.agencyInstallId !== agencyInstallId) {
    res.status(404).json({ error: "Support is not available here." });
    return null;
  }
  if (!(await isSupportEnabled(ghlLocationId))) {
    res.status(404).json({ error: "Support is not available here." });
    return null;
  }
  return { agencyInstallId, locationInstallId: location.id, ghlLocationId };
}

/**
 * Widget bootstrap: should the bubble render at all, and with what branding?
 *
 * Returns nothing sensitive - brand name, colours and greeting are all visible on the
 * client's own screen already. Notably it does NOT return forbiddenTerms or
 * allowedLinkDomains: those are enforced server-side and shipping them would tell an
 * attacker exactly what to work around.
 */
supportRouter.get(
  "/support/api/:agencyInstallId/:ghlLocationId/config",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;

    const [brand, config] = await Promise.all([
      resolveBrandMap(ctx.ghlLocationId),
      prisma.supportConfig.findUnique({ where: { agencyInstallId: ctx.agencyInstallId } }),
    ]);
    if (!brand) return res.status(404).json({ error: "Support is not available here." });

    const quickActions = Array.isArray(config?.quickActions)
      ? (config!.quickActions as unknown[]).filter((q): q is string => typeof q === "string").slice(0, 5)
      : [];

    res.json({
      enabled: true,
      brandName: brand.brandName,
      greeting: config?.greeting?.trim() || `Hi! Ask me anything about ${brand.brandName}.`,
      quickActions,
      businessHours: config?.businessHours ?? null,
    });
  }
);

/** Start a conversation. Returns an opaque token the widget must send with each message. */
supportRouter.post(
  "/support/api/:agencyInstallId/:ghlLocationId/conversation",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;

    const token = randomBytes(32).toString("base64url");
    // Context captured SILENTLY. The biggest advantage over a generic helpdesk is that
    // we already know who this is - never ask "which account are you in?".
    const contextSnapshot = {
      pageUrl: typeof req.body?.pageUrl === "string" ? req.body.pageUrl.slice(0, 500) : null,
      userAgent: (req.headers["user-agent"] ?? "").toString().slice(0, 300),
      cssApplied: typeof req.body?.cssApplied === "boolean" ? req.body.cssApplied : null,
      startedAt: new Date().toISOString(),
    };

    const conversation = await prisma.conversation.create({
      data: {
        agencyInstallId: ctx.agencyInstallId,
        locationInstallId: ctx.locationInstallId,
        accessTokenHash: hashToken(token),
        contextSnapshot,
      },
      select: { id: true },
    });

    res.status(201).json({ conversationId: conversation.id, token });
  }
);

/** Load a conversation by its bearer token, or reply with an error and return null. */
/**
 * The only roles a CLIENT may ever be shown — and the definition lives in
 * `transcriptVisibility.ts` rather than here, because there is a SECOND door out of
 * Mosaic (the tier-3 hand-off email to the agency) which had no filter at all.
 */

async function requireConversation(req: Request, res: Response, conversationId: string) {
  const token = (req.headers["x-mosaic-conversation"] as string | undefined) ?? "";
  if (!token) {
    res.status(401).json({ error: "Missing conversation token" });
    return null;
  }
  const conversation = await prisma.conversation.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
  });
  // Check the token FIRST, then that it matches the id in the path - so a valid token
  // for conversation A cannot be used to read conversation B.
  if (!conversation || conversation.id !== conversationId) {
    res.status(401).json({ error: "Invalid conversation token" });
    return null;
  }
  return conversation;
}

/** Ask a question. Buffered end to end - a leak caught mid-stream is already on screen. */
supportRouter.post(
  "/support/api/:agencyInstallId/:ghlLocationId/conversation/:conversationId/message",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;

    const conversation = await requireConversation(req, res, req.params.conversationId);
    if (!conversation) return;
    if (conversation.locationInstallId !== ctx.locationInstallId) {
      return res.status(401).json({ error: "Invalid conversation token" });
    }

    const text = String(req.body?.text ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) return res.status(400).json({ error: "Message is empty" });

    await prisma.message.create({ data: { conversationId: conversation.id, role: "user", body: text } });

    /**
     * A HUMAN HAS THIS ONE — the bot must not answer over the top of them.
     *
     * Until this check existed, `answerQuestion` ran unconditionally: an agent could
     * claim a ticket, reply, and have the bot answer the client's very next message on
     * top of them. It could contradict the agent, or cheerfully re-offer a hand-off for
     * a conversation a person was already handling. Everything stored correctly and the
     * client experienced something nobody intended — the same shape as the desk being
     * write-only, one layer along.
     *
     * The client is told a person has it rather than being met with silence, and the
     * message is still stored and still updates `lastMessageAt`, so it reaches the desk
     * and the assignee's reminders keep running against it.
     */
    if (conversation.botPaused) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
      return res.json({
        reply: null,
        canEscalate: false,
        handedToHuman: true,
      });
    }

    const history: BotMessage[] = conversation.messages
      .filter((m) => m.role === "user" || m.role === "bot")
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.body }));

    let answer;
    try {
      answer = await answerQuestion({ ghlLocationId: ctx.ghlLocationId, question: text, history });
    } catch (e) {
      console.error(`[support] answer failed: ${describeError(e)}`);
      return res.status(503).json({
        reply: "Sorry — I can't answer right now. Would you like me to pass this to the team?",
        canEscalate: true,
      });
    }

    // Citations are stored but NEVER returned to the client: a link to someone else's
    // documentation blows the white label as surely as naming the vendor.
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "bot",
        body: answer.text,
        citations: answer.citations.length ? (answer.citations as unknown as object) : undefined,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        brandLeakHits: { increment: answer.findings.filter((f) => f.gate === "brand").length },
        overlapRejects: { increment: answer.findings.filter((f) => f.gate === "overlap").length },
        // Escalating here puts it straight into the desk queue for a live agent - the
        // client is not asked to opt in first. Someone asking about a feature they don't
        // have is the most commercially interesting message this widget receives, and it
        // must not end at "no".
        //
        // enterQueuePatch, not a bare status write: `queuedAt` is the clock the desk
        // orders by and the client's position is counted from, so a hand-off that sets
        // the status without it enters the queue with no place in it.
        ...(answer.shouldEscalate ? enterQueuePatch(conversation) : {}),
      },
    });

    if (answer.shouldEscalate) {
      const brand = await resolveBrandMap(ctx.ghlLocationId);
      void notifyDeskOfEscalation({
        brandName: brand?.brandName ?? "their platform",
        locationName: null,
        agencyName: null,
        question: text,
        conversationId: conversation.id,
        reason: answer.escalationReason ?? "the assistant handed this over",
      }).catch(() => {});
    }

    res.json({
      reply: answer.text,
      // The button is offered generously; the hand-off is not. `canEscalate` only shows
      // "talk to a person"; `handedToHuman` says one is already coming, so the widget can
      // state it rather than making the client find and press anything.
      canEscalate: answer.shouldEscalate || answer.offerHuman === true,
      handedToHuman: answer.shouldEscalate,
    });
  }
);

/** "Did this help?" — the deflection signal that decides support headcount. */
supportRouter.post(
  "/support/api/:agencyInstallId/:ghlLocationId/conversation/:conversationId/feedback",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;
    const conversation = await requireConversation(req, res, req.params.conversationId);
    if (!conversation) return;

    const helpful = req.body?.helpful === true;
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: helpful
        ? { status: "resolved", deflected: true, resolvedAt: new Date(), csat: 1 }
        : { csat: 0 },
    });
    res.json({ ok: true });
  }
);

/**
 * Ask for a human. Always available - never make someone fight a bot to reach support.
 * The ticket itself lands in Step 5; for now this marks the conversation and captures
 * what the client was trying to do.
 */
supportRouter.post(
  "/support/api/:agencyInstallId/:ghlLocationId/conversation/:conversationId/escalate",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;
    const conversation = await requireConversation(req, res, req.params.conversationId);
    if (!conversation) return;

    const note = String(req.body?.note ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (note) {
      await prisma.message.create({
        data: { conversationId: conversation.id, role: "system", body: `Escalation note: ${note}` },
      });
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { ...enterQueuePatch(conversation), deflected: false, lastMessageAt: new Date() },
    });

    // Tell Mosaic's team. Deliberately NOT awaited into the response path beyond this
    // point failing quietly: the conversation is already marked escalated and will show
    // in the desk queue regardless, so email is a convenience, not the mechanism.
    const brand = await resolveBrandMap(ctx.ghlLocationId);
    const lastQuestion = [...conversation.messages].reverse().find((m) => m.role === "user");
    void notifyDeskOfEscalation({
      brandName: brand?.brandName ?? "their platform",
      locationName: null,
      agencyName: null,
      question: note || lastQuestion?.body || "(no message)",
      conversationId: conversation.id,
      reason: "the client asked for a human",
    }).catch(() => {});

    res.json({
      ok: true,
      message: "Thanks — I've passed this to the team. Someone will get back to you shortly.",
    });
  }
);

/**
 * What has changed? — the widget's one polling endpoint.
 *
 * It answers TWO questions in a single request, and that is a rate-limit decision:
 * every /support/api route shares 60 req/min per IP with the chat itself, so a second
 * independent poller would double a waiting client's cost for no new information.
 *
 * 1. WHERE AM I IN THE QUEUE. Without it the widget says "someone from the team will
 *    pick this up" and then nothing moves on screen, which reads as broken long before
 *    it reads as busy.
 *
 * 2. HAS A PERSON REPLIED. This one is not a nicety. Without it the entire desk is
 *    WRITE-ONLY: an agent's reply passed all three gates, was stored, set
 *    `firstAgentReplyAt` and counted toward the response time the agency is shown — and
 *    the client never saw a word of it. No endpoint returned messages at all, so a
 *    reply reached somebody only if that client happened to send another message and
 *    read the bot's answer. The metric made it worse than silence: the dashboard
 *    reported how fast we answered people we had not actually answered.
 *
 * What it deliberately does NOT return:
 *   - anything about the desk (agent counts, capacity, staffing). Same reasoning that
 *     keeps `forbiddenTerms` out of the config endpoint: a client who can see the desk
 *     is thin is a client handed an argument.
 *   - `system` messages. Those are internal notes and routing records — "[internal]
 *     ...", "[transferred from Ada to Bo]", "[handed to agency by ...]" — carrying
 *     Mosaic staff names and our own workflow, and they live in the SAME table as the
 *     client's transcript. This filter is the only thing between an internal note and
 *     the customer's screen.
 *   - `citations`. Internal provenance, never rendered, not even as titles.
 */
supportRouter.get(
  "/support/api/:agencyInstallId/:ghlLocationId/conversation/:conversationId/updates",
  async (req: Request, res: Response) => {
    const ctx = await requireEnabledLocation(req, res);
    if (!ctx) return;
    const conversation = await requireConversation(req, res, req.params.conversationId);
    if (!conversation) return;
    if (conversation.locationInstallId !== ctx.locationInstallId) {
      return res.status(401).json({ error: "Invalid conversation token" });
    }

    // Only what the client has not been shown. `after` is the id of the last message
    // they already hold; an absent or unrecognised one returns NOTHING new rather than
    // the whole transcript, so a stale widget can never replay the conversation on top
    // of what is already on screen.
    const after = typeof req.query.after === "string" ? req.query.after : null;
    const cursor = after ? conversation.messages.find((m) => m.id === after) : null;

    // `replay=1` asks for the whole visible transcript, and ONLY a widget that has just
    // restored a stored session asks for it: after a page reload the panel is empty, so
    // "everything since your cursor" would redraw a conversation into a blank window
    // missing its own first half. It is a separate, explicit parameter rather than the
    // default for absent `after`, because the default has to stay "nothing" — that is
    // what stops a poller that lost its cursor from replaying the conversation on top
    // of what the client is already reading.
    const replay = req.query.replay === "1";
    const visible = visibleOutsideMosaic(conversation.messages);
    const fresh = replay
      ? visible
      : cursor
        ? visible.filter((m) => m.createdAt > cursor.createdAt)
        : [];

    const position = await queuePosition(conversation.id);
    const base = {
      // `resolved` / `abandoned` is how the widget knows to stop polling for good.
      status: conversation.status,
      // The cursor the widget should send next time. Returned even when `messages` is
      // empty, because that is what lets a widget with NO cursor sync to "everything so
      // far is already on my screen" without being handed the transcript to replay. A
      // first poll therefore delivers nothing and every poll after it delivers exactly
      // what arrived in between.
      cursor: conversation.messages.length
        ? conversation.messages[conversation.messages.length - 1].id
        : null,
      messages: fresh.map((m) => ({
        id: m.id,
        role: m.role,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };

    if (position === null) {
      // Not queued: nobody was ever called, or somebody has already picked it up. The
      // widget must KEEP polling in the second case — an agent replying is exactly what
      // happens after a ticket leaves the queue — so this reports "not waiting" without
      // ending the conversation.
      return res.json({
        ...base,
        waiting: false,
        position: null,
        estimatedWaitSeconds: null,
        estimatedWaitText: null,
      });
    }

    const [agents, stats, supportConfig] = await Promise.all([
      agentSlots(),
      firstResponseStats(7),
      prisma.supportConfig.findUnique({
        where: { agencyInstallId: ctx.agencyInstallId },
        select: { businessHours: true },
      }),
    ]);
    const capacity = capacitySnapshot(agents);
    const estimatedWaitSeconds = estimateWaitSeconds({
      position,
      medianSeconds: stats.medianSeconds,
      sampleCount: stats.count,
      free: capacity.free,
      capacity: capacity.capacity,
    });
    res.json({
      ...base,
      waiting: true,
      position,
      estimatedWaitSeconds,
      /**
       * The sentence itself, not just the number. The widget used to do its own
       * seconds-to-minutes arithmetic, which made a third definition of one wording and
       * left the desk's "what the client is told" line showing something the client is
       * not told. Built here so there is one.
       */
      estimatedWaitText: waitSentence(estimatedWaitSeconds),
      /**
       * What to say when there is no estimate — which is most of the time, since an
       * estimate needs five measured responses AND somebody on the desk. A client who
       * escalated at 9pm used to be shown "You're number 1 in line" and nothing else,
       * with no way to tell whether that meant minutes or Monday. This never predicts a
       * duration; it states a fact (the desk is staffed, or when it reopens) or stays
       * null. It carries no agent count, names and no staffing detail, for the same
       * reason the config endpoint withholds forbiddenTerms.
       */
      connectHint: connectHint({
        estimatedWaitSeconds,
        capacity: capacity.capacity,
        businessHours: supportConfig?.businessHours ?? null,
      }),
    });
  }
);

/**
 * The pasteable widget script.
 *
 * Served as JS the agency pastes into GHL's Custom JavaScript field - the same manual
 * paste the theme bundle uses, because GHL blocks remote script loading. Cached
 * briefly: the body only changes when this code is redeployed, and it is fetched on
 * every page load of the customer's CRM.
 */
supportRouter.get("/support/widget/:agencyInstallId.js", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({
    where: { id: req.params.agencyInstallId },
    select: { id: true, status: true },
  });

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");

  // Same posture as /theme-css on uninstall: return valid, inert JS rather than a 404.
  // A 404 in a pasted <script> is a console error on every page load of the customer's
  // CRM, which is worse than doing nothing.
  if (!agency || agency.status === "uninstalled") {
    return res.send("/* Mosaic support is not enabled for this install. */");
  }

  const apiBase = process.env.APP_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  res.send(generateSupportWidgetScript(agency.id, apiBase));
});
