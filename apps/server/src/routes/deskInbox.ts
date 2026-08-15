import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { requireDeskAuth, deskUser } from "../services/deskAuth";
import { resolveBrandMap } from "../services/brandTerms";
import { checkAgentDraft, GateFinding } from "../services/answerGuard";
import { renderForBrand } from "../services/kbNormalize";
import { draftAgentReply } from "../services/supportBot";
import { notifyAgencyOfHandoff } from "../services/email";
import { describeError } from "../services/security";
import { enterQueuePatch } from "../services/deskQueue";

/**
 * The desk inbox: every agency's escalated conversations in one list, worked by
 * Mosaic's own staff.
 *
 * The organising risk here is the inverse of the bot's. The bot has a clean context by
 * construction - kbNormalize strips the vendor at ingest, so it mostly cannot leak. A
 * human agent knows perfectly well what the platform is, is switching between five
 * brands in an afternoon, and types fast. So on this surface the human is the PRIMARY
 * leak risk, and three things follow:
 *
 *   1. Every outbound agent message passes the brand and link gates BEFORE it is
 *      stored or sent - `blocked`, never silently rewritten. Rewriting would mean the
 *      agent never learns and the stored record stops matching what they typed.
 *   2. The ticket payload leads with the brand context (brand name, renamed labels,
 *      hidden features, the agency's own forbidden terms, the support boundary) so the
 *      UI can pin it above the compose box rather than bury it in a sidebar.
 *   3. Canned replies are stored placeholdered and rendered per conversation, so a
 *      reply written for agency A cannot carry A's brand name into B's ticket.
 */
export const deskInboxRouter = Router();

const MAX_REPLY_CHARS = 4000;

/** Everything the agent must see before typing a word. */
async function brandContext(ghlLocationId: string, agencyInstallId: string) {
  const [brand, config] = await Promise.all([
    resolveBrandMap(ghlLocationId),
    prisma.supportConfig.findUnique({ where: { agencyInstallId } }),
  ]);
  return {
    brandName: brand?.brandName ?? null,
    brandNameSource: brand?.brandNameSource ?? null,
    // Only the renamed ones: an agent needs to know what differs from the default, not
    // read a 40-row table of things that are exactly what they look like.
    renamedLabels: brand?.featureLabels ?? {},
    hiddenFeatures: brand?.hiddenFeatures ?? [],
    forbiddenTerms: config?.forbiddenTerms ?? [],
    allowedLinkDomains: config?.allowedLinkDomains ?? [],
    supportBoundary: config?.supportBoundary ?? "how_to_only",
    boundaryNotes: config?.boundaryNotes ?? null,
    escalationEmails: config?.escalationEmails ?? [],
    userNoun: config?.userNoun ?? null,
  };
}

/** Load a conversation with everything the desk needs, or reply 404 and return null. */
async function loadConversation(res: Response, id: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      locationInstall: { select: { ghlLocationId: true, locationName: true } },
      agencyInstall: { select: { id: true, companyName: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return null;
  }
  return conversation;
}

/**
 * The inbox. Cross-agency on purpose - that IS the product; one agent works agency A's
 * ticket then agency B's, so there is no tenant partitioning inside the desk.
 */
deskInboxRouter.get("/desk/api/inbox", requireDeskAuth, async (req: Request, res: Response) => {
  const status = String(req.query.status ?? "escalated");
  const mine = req.query.mine === "1";
  const me = deskUser(req);

  const where: any = {};
  if (status !== "all") where.status = status;
  if (mine && me) where.assignedToId = me.id;
  if (req.query.agencyInstallId) where.agencyInstallId = String(req.query.agencyInstallId);
  if (req.query.unassigned === "1") where.assignedToId = null;

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ priority: "desc" }, { lastMessageAt: "asc" }], // oldest waiting first
    take: 100,
    include: {
      locationInstall: { select: { ghlLocationId: true, locationName: true } },
      agencyInstall: { select: { id: true, companyName: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // Brand names come from the theme rows, cached with a short TTL - so this is a cache
  // read per row, not a query per row.
  const rows = await Promise.all(
    conversations.map(async (c) => {
      const brand = await resolveBrandMap(c.locationInstall.ghlLocationId);
      return {
        id: c.id,
        status: c.status,
        priority: c.priority,
        tier: c.tier,
        queuedAt: c.queuedAt,
        subject: c.subject,
        // What the CLIENT calls the platform - the name the agent must answer as.
        brandName: brand?.brandName ?? null,
        agencyInstallId: c.agencyInstallId,
        agencyName: c.agencyInstall.companyName,
        locationName: c.locationInstall.locationName,
        assignedTo: c.assignedTo,
        lastMessageAt: c.lastMessageAt,
        startedAt: c.startedAt,
        firstAgentReplyAt: c.firstAgentReplyAt,
        handedToAgencyAt: c.handedToAgencyAt,
        preview: c.messages[0]?.body.slice(0, 160) ?? "",
        // Gate telemetry, surfaced so a rising leak rate is visible in daily work
        // rather than only in a dashboard nobody opens.
        brandLeakHits: c.brandLeakHits,
      };
    })
  );

  res.json({ conversations: rows, counts: await inboxCounts() });
});

async function inboxCounts() {
  const [escalated, open, unassigned] = await Promise.all([
    prisma.conversation.count({ where: { status: "escalated" } }),
    prisma.conversation.count({ where: { status: "open" } }),
    prisma.conversation.count({ where: { status: "escalated", assignedToId: null } }),
  ]);
  return { escalated, open, unassigned };
}

/** One conversation: transcript + the brand context the agent answers inside. */
deskInboxRouter.get(
  "/desk/api/conversations/:id",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const conversation = await loadConversation(res, req.params.id);
    if (!conversation) return;

    const context = await brandContext(
      conversation.locationInstall.ghlLocationId,
      conversation.agencyInstallId
    );

    res.json({
      id: conversation.id,
      status: conversation.status,
      priority: conversation.priority,
      tier: conversation.tier,
      queuedAt: conversation.queuedAt,
      subject: conversation.subject,
      agencyInstallId: conversation.agencyInstallId,
      agencyName: conversation.agencyInstall.companyName,
      locationName: conversation.locationInstall.locationName,
      ghlLocationId: conversation.locationInstall.ghlLocationId,
      assignedTo: conversation.assignedTo,
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      firstAgentReplyAt: conversation.firstAgentReplyAt,
      handedToAgencyAt: conversation.handedToAgencyAt,
      deflected: conversation.deflected,
      csat: conversation.csat,
      // Auto-captured at conversation start: page URL, user agent, whether Mosaic's CSS
      // actually applied. The agent opens the ticket already knowing what they would
      // otherwise spend three messages extracting.
      contextSnapshot: conversation.contextSnapshot,
      brandLeakHits: conversation.brandLeakHits,
      overlapRejects: conversation.overlapRejects,
      context,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        body: m.body,
        createdAt: m.createdAt,
        // Provenance is shown to STAFF as titles only. Never URLs, because a link
        // visible to a support rep is a link that gets pasted into a client reply.
        citations: Array.isArray(m.citations)
          ? (m.citations as any[]).map((c) => ({ title: c?.title ?? null }))
          : null,
      })),
    });
  }
);

/** Claim a ticket (or hand it to someone else). */
deskInboxRouter.post(
  "/desk/api/conversations/:id/assign",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const me = deskUser(req);
    const assigneeId = req.body?.assigneeId === null ? null : (req.body?.assigneeId ?? me?.id ?? null);

    if (assigneeId) {
      const target = await prisma.deskUser.findUnique({ where: { id: assigneeId } });
      // Assigning work to a disabled account silently parks the ticket where nobody
      // will see it, which is worse than refusing.
      if (!target || target.status !== "active") {
        return res.status(400).json({ error: "That desk user doesn't exist or is disabled." });
      }
    }

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { assignedToId: assigneeId, assignedAt: assigneeId ? new Date() : null },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
    res.json({ id: updated.id, assignedTo: updated.assignedTo });
  }
);

/**
 * Check a draft WITHOUT sending it — what the compose box calls as the agent types.
 *
 * Deliberately a separate endpoint from the send: the UI can show a leak the moment it
 * is typed, and the send path still re-runs the same gates server-side. A client-side
 * check alone would be advisory, and this text goes to a real client.
 */
deskInboxRouter.post(
  "/desk/api/conversations/:id/check",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { locationInstall: { select: { ghlLocationId: true } } },
    });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const context = await brandContext(
      conversation.locationInstall.ghlLocationId,
      conversation.agencyInstallId
    );
    const text = String(req.body?.text ?? "").slice(0, MAX_REPLY_CHARS);
    const result = checkAgentDraft(text, {
      forbiddenTerms: context.forbiddenTerms,
      allowedLinkDomains: context.allowedLinkDomains,
    });
    res.json({ blocked: result.blocked, findings: result.findings });
  }
);

/** Human-readable reasons, since the agent has to fix the text themselves. */
function explain(findings: GateFinding[], brandName: string | null): string[] {
  return findings.map((f) => {
    if (f.gate === "link") return `Links aren't allowed in client replies: "${f.sample}"`;
    if (f.detail === "agency-forbidden-term") return `This agency has asked us never to say "${f.sample}".`;
    return `"${f.sample}" names the platform vendor. Say ${brandName ? `"${brandName}"` : "their brand name"} instead.`;
  });
}

/**
 * Send an agent reply to the client. THE gate that matters on this surface.
 *
 * Blocked replies are not stored: the message never existed, so the transcript stays a
 * true record of what the client received.
 */
deskInboxRouter.post(
  "/desk/api/conversations/:id/reply",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const me = deskUser(req);
    const conversation = await loadConversation(res, req.params.id);
    if (!conversation) return;

    const text = String(req.body?.text ?? "").trim().slice(0, MAX_REPLY_CHARS);
    if (!text) return res.status(400).json({ error: "Reply is empty" });

    const context = await brandContext(
      conversation.locationInstall.ghlLocationId,
      conversation.agencyInstallId
    );

    const gate = checkAgentDraft(text, {
      forbiddenTerms: context.forbiddenTerms,
      allowedLinkDomains: context.allowedLinkDomains,
    });
    if (gate.blocked) {
      // 422, not 400: the request is well-formed, the CONTENT is refused. And it is
      // counted, because "how often do our own agents nearly leak" is a real metric.
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { brandLeakHits: { increment: gate.findings.filter((f) => f.gate === "brand").length } },
      });
      return res.status(422).json({
        blocked: true,
        findings: gate.findings,
        reasons: explain(gate.findings, context.brandName),
      });
    }

    const isInternal = req.body?.internal === true;
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        // An internal note is stored as `system` so it can never be mistaken for
        // something the client saw.
        role: isInternal ? "system" : "agent",
        body: isInternal ? `[internal] ${text}` : text,
      },
    });

    if (!isInternal) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          firstAgentReplyAt: conversation.firstAgentReplyAt ?? new Date(),
          assignedToId: conversation.assignedToId ?? me?.id ?? null,
          assignedAt: conversation.assignedAt ?? (me ? new Date() : null),
        },
      });
    }

    res.status(201).json({ id: message.id, role: message.role, body: message.body, createdAt: message.createdAt });
  }
);

/**
 * Ask the bot to draft the reply, through the full substitution pipeline and all three
 * gates.
 *
 * This is the throughput AND the safety mechanism at once: the agent edits a draft that
 * is already brand-correct rather than authoring a risky one from scratch.
 */
deskInboxRouter.post(
  "/desk/api/conversations/:id/draft",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const conversation = await loadConversation(res, req.params.id);
    if (!conversation) return;

    // Draft against the last thing the CLIENT said, not the last message overall -
    // otherwise the bot answers our own agent.
    const lastClientMessage = [...conversation.messages].reverse().find((m) => m.role === "user");
    const question = String(req.body?.question ?? lastClientMessage?.body ?? "").trim();
    if (!question) return res.status(400).json({ error: "Nothing to draft from — the client hasn't said anything yet." });

    try {
      const draft = await draftAgentReply({
        ghlLocationId: conversation.locationInstall.ghlLocationId,
        question,
        history: conversation.messages
          .filter((m) => m.role === "user" || m.role === "bot" || m.role === "agent")
          .slice(-12)
          .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.body })),
      });
      res.json({
        draft: draft.text,
        // Titles only - see the citations note above.
        citations: draft.citations.map((c) => ({ title: c.title })),
        // Surfaced so the agent knows the draft is thin and checks it harder, rather
        // than trusting a confident-sounding paragraph built on nothing.
        thin: draft.citations.length === 0,
      });
    } catch (e) {
      console.error(`[desk] draft failed: ${describeError(e)}`);
      res.status(503).json({ error: "Couldn't draft a reply right now. Write one manually." });
    }
  }
);

/** Status / priority / subject changes. */
deskInboxRouter.patch(
  "/desk/api/conversations/:id",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const STATUSES = ["open", "resolved", "escalated", "abandoned"];
    const PRIORITIES = ["low", "normal", "high", "urgent"];
    const current = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { status: true, queuedAt: true },
    });
    if (!current) return res.status(404).json({ error: "Conversation not found" });

    const data: any = {};
    if (STATUSES.includes(req.body?.status)) {
      data.status = req.body.status;
      if (req.body.status === "resolved") data.resolvedAt = new Date();
      // Moving a ticket back to escalated by hand has to start its queue clock too, or
      // it sorts as if it had been waiting since the epoch and jumps the whole queue.
      if (req.body.status === "escalated") Object.assign(data, enterQueuePatch(current));
    }
    if (PRIORITIES.includes(req.body?.priority)) data.priority = req.body.priority;
    if (typeof req.body?.subject === "string") data.subject = req.body.subject.trim().slice(0, 200) || null;
    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const updated = await prisma.conversation.update({ where: { id: req.params.id }, data });
    res.json({ id: updated.id, status: updated.status, priority: updated.priority, subject: updated.subject });
  }
);

/**
 * Tier-3: hand off to the AGENCY.
 *
 * Mosaic's team answers product how-to. The agency's own business - billing, contracts,
 * custom work - is not ours to speak for, and this is where that boundary is actually
 * enforced rather than merely documented.
 */
deskInboxRouter.post(
  "/desk/api/conversations/:id/hand-to-agency",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const me = deskUser(req);
    const conversation = await loadConversation(res, req.params.id);
    if (!conversation) return;

    const context = await brandContext(
      conversation.locationInstall.ghlLocationId,
      conversation.agencyInstallId
    );
    if (context.escalationEmails.length === 0) {
      // Support cannot be enabled without one (the dashboard blocks it), so this only
      // fires if it was cleared afterwards. Say so plainly rather than silently dropping
      // the hand-off.
      return res.status(400).json({
        error: "This agency has no escalation email set, so there's nowhere to hand this to.",
      });
    }

    const note = String(req.body?.note ?? "").trim().slice(0, MAX_REPLY_CHARS);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "system",
        body: `[handed to agency by ${me?.name ?? "desk"}]${note ? ` ${note}` : ""}`,
      },
    });
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        handedToAgencyAt: new Date(),
        ...enterQueuePatch(conversation),
        lastMessageAt: new Date(),
      },
    });

    // Notify AFTER the record is written, and never let a mail failure fail the
    // hand-off: the conversation is already marked, so the worst case is an agency that
    // has to find it in their own time rather than a hand-off that silently vanished.
    const mail = await notifyAgencyOfHandoff({
      to: context.escalationEmails,
      brandName: context.brandName ?? "their platform",
      locationName: conversation.locationInstall.locationName,
      note,
      agentName: me?.name ?? "the Mosaic team",
      // Citations are dropped on the way out - internal provenance never leaves.
      messages: conversation.messages.map((m) => ({ role: m.role, body: m.body })),
    });

    res.json({
      id: updated.id,
      handedToAgencyAt: updated.handedToAgencyAt,
      recipients: context.escalationEmails,
      emailed: mail.sent,
      emailSkipped: mail.skipped ?? null,
    });
  }
);

// --- Canned replies: stored placeholdered, rendered per conversation ---

deskInboxRouter.get("/desk/api/canned-replies", requireDeskAuth, async (req: Request, res: Response) => {
  const agencyInstallId = req.query.agencyInstallId ? String(req.query.agencyInstallId) : null;
  const replies = await prisma.cannedReply.findMany({
    // Shared replies (agencyInstallId NULL) plus this agency's own.
    where: agencyInstallId ? { OR: [{ agencyInstallId: null }, { agencyInstallId }] } : { agencyInstallId: null },
    orderBy: [{ usageCount: "desc" }, { title: "asc" }],
    take: 100,
  });
  res.json(replies.map((r) => ({ id: r.id, title: r.title, body: r.body, agencyInstallId: r.agencyInstallId })));
});

deskInboxRouter.post("/desk/api/canned-replies", requireDeskAuth, async (req: Request, res: Response) => {
  const me = deskUser(req);
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  const body = String(req.body?.body ?? "").trim().slice(0, MAX_REPLY_CHARS);
  if (!title || !body) return res.status(400).json({ error: "Title and body are both required." });

  // A canned reply is reused across agencies, so a brand term in it leaks repeatedly
  // rather than once. Check it with an EMPTY allowlist: the template is not tied to one
  // agency, so no agency's link allowlist applies to it.
  const gate = checkAgentDraft(body, { allowedLinkDomains: [] });
  if (gate.blocked) {
    return res.status(422).json({
      blocked: true,
      findings: gate.findings,
      reasons: explain(gate.findings, null).concat(
        "Write {{PLATFORM}} where the brand name goes — it's filled in per client when the reply is used."
      ),
    });
  }

  const created = await prisma.cannedReply.create({
    data: {
      title,
      body,
      agencyInstallId: req.body?.agencyInstallId ? String(req.body.agencyInstallId) : null,
      createdById: me?.id ?? null,
    },
  });
  res.status(201).json({ id: created.id, title: created.title, body: created.body });
});

/**
 * Render a canned reply for THIS conversation: {{PLATFORM}} → the client's brand name,
 * {{FEATURE:key}} → the label that client actually sees in their sidebar.
 */
deskInboxRouter.post(
  "/desk/api/conversations/:id/canned-replies/:replyId/render",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { locationInstall: { select: { ghlLocationId: true } } },
    });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const reply = await prisma.cannedReply.findUnique({ where: { id: req.params.replyId } });
    if (!reply) return res.status(404).json({ error: "Canned reply not found" });
    // A reply scoped to one agency must not be usable on another's ticket - that is the
    // exact cross-brand leak this model exists to prevent.
    if (reply.agencyInstallId && reply.agencyInstallId !== conversation.agencyInstallId) {
      return res.status(403).json({ error: "That reply belongs to a different agency." });
    }

    const brand = await resolveBrandMap(conversation.locationInstall.ghlLocationId);
    if (!brand) return res.status(404).json({ error: "Couldn't resolve this client's branding." });

    await prisma.cannedReply.update({ where: { id: reply.id }, data: { usageCount: { increment: 1 } } });
    res.json({ body: renderForBrand(reply.body, brand.brandName, brand.featureLabels) });
  }
);
