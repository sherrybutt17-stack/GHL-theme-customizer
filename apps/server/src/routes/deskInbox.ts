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
import { normalizeTicketType, ticketTypeLabel, TICKET_TYPES } from "../services/ticketTypes";
import { slaStatusFor, serialiseSla } from "../services/slaStatus";
import { notifyDeskOfEscalation } from "../services/email";

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
    // read a 40-row table of things that are exactly what they look like. This line said
    // exactly that and then passed the whole 51-row table anyway, so the banner showed six
    // ordinary labels and "+45" - and the one word that actually differs is whichever the
    // slice happens to drop.
    renamedLabels: brand?.renamedLabels ?? {},
    hiddenFeatures: brand?.hiddenFeatures ?? [],
    forbiddenTerms: config?.forbiddenTerms ?? [],
    allowedLinkDomains: config?.allowedLinkDomains ?? [],
    supportBoundary: config?.supportBoundary ?? "how_to_only",
    boundaryNotes: config?.boundaryNotes ?? null,
    escalationEmails: config?.escalationEmails ?? [],
    userNoun: config?.userNoun ?? null,
  };
}

/**
 * Citation titles, in the CLIENT'S OWN WORDS.
 *
 * Article titles are stored placeholdered like everything else in the corpus, and both
 * places that hand them to an agent passed `c.title` straight through. Measured by
 * rendering a real ticket 2026-08-26, the provenance row read:
 *
 *   from: Troubleshooting Bulk Imports Via CSV: {{PLATFORM}} Support Portal,
 *         Adding Files To {{FEATURE:contacts}} using a Custom Field
 *
 * `renderForBrand`'s own doc comment says an unmapped key falls back to its default label
 * "rather than leaving a raw placeholder on screen" — the function written to stop exactly
 * this was not called on the one field the desk renders.
 *
 * It is not only untidy. The whole point of showing provenance to a rep is that they read
 * it and sometimes quote it, and `{{PLATFORM}}` is neither a vendor name nor a link, so
 * `checkAgentDraft` waves it through: an agent pasting that title sends our template syntax
 * into a customer's chat. CLAUDE.md already noticed the shape from the other side, listing
 * `"Text-To-Pay Links: {{PLATFORM}} Support Portal"` as a reason to strip crawled chrome.
 */
function citationTitles(raw: unknown, brand: { brandName?: string | null; featureLabels?: Record<string, string> } | null) {
  if (!Array.isArray(raw)) return null;
  const name = brand?.brandName ?? "your dashboard";
  const features = brand?.featureLabels ?? {};
  return (raw as any[]).map((c) => ({
    // Never a URL: a link visible to a support rep is a link that gets pasted into a reply.
    title: typeof c?.title === "string" ? renderForBrand(c.title, name, features) : null,
  }));
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
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return null;
  }
  return conversation;
}

/**
 * Sub-accounts an agent can raise a ticket against — a typeahead, not a full list.
 *
 * It returns the BRAND name as well as the sub-account name, and that is not cosmetic:
 * `Inbox.tsx` already leads every row with the client's brand for a documented reason,
 * and the moment somebody is choosing who a ticket belongs to is exactly when picking
 * the agency's name instead of the client's turns into a cross-brand slip.
 *
 * Deliberately does NOT require `supportEnabled`. That switch decides whether CLIENTS
 * get a widget; refusing to let staff log a phone call because the agency has not
 * switched the widget on would block the case this whole feature exists for.
 */
deskInboxRouter.get("/desk/api/locations", requireDeskAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim().slice(0, 80);

  const locations = await prisma.locationInstall.findMany({
    where: {
      status: "active",
      agencyInstall: { status: "active" },
      ...(q
        ? {
            OR: [
              { locationName: { contains: q, mode: "insensitive" as const } },
              { ghlLocationId: { contains: q, mode: "insensitive" as const } },
              { agencyInstall: { companyName: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: {
      ghlLocationId: true,
      locationName: true,
      supportEnabled: true,
      agencyInstall: { select: { id: true, companyName: true } },
    },
    orderBy: { locationName: "asc" },
    take: 25,
  });

  // Brand names come from the cached map, one call each. Capped at 25 above precisely so
  // this stays a fixed small number of cache reads rather than growing with the estate.
  const rows = await Promise.all(
    locations.map(async (l) => {
      const brand = await resolveBrandMap(l.ghlLocationId);
      return {
        ghlLocationId: l.ghlLocationId,
        locationName: l.locationName,
        agencyInstallId: l.agencyInstall.id,
        agencyName: l.agencyInstall.companyName,
        brandName: brand?.brandName ?? null,
        // Shown as a note, never as a block: it tells the agent the client has no widget
        // to receive a reply in, which changes how they follow up.
        supportEnabled: l.supportEnabled,
      };
    })
  );

  res.json({ locations: rows });
});

/**
 * The ticket-type vocabulary, served rather than duplicated in the desk bundle.
 *
 * A copy in the front end is a copy that drifts, and the half that matters is the
 * SERVER's — it is what validation and every report read. A stale list in the UI would
 * silently offer a key the server then normalises to null, so the agent picks a type and
 * the ticket records none.
 */
deskInboxRouter.get("/desk/api/ticket-types", requireDeskAuth, async (_req: Request, res: Response) => {
  res.json({ types: TICKET_TYPES });
});

/**
 * Raise a ticket from the desk, for a client who reached us some other way.
 *
 * Until this existed the desk was read-and-mutate-only: `prisma.conversation.create`
 * appeared exactly once in the repo, in the widget route. So a client who phoned, or was
 * reported by their agency, could not be recorded at all, and the only way work entered
 * the desk was a client using the widget and escalating.
 *
 * There is deliberately no new table. A conversation already IS a ticket — the schema
 * comment on the model says so — and "a ticket raised without ever using the bot is just
 * a Conversation whose first Message has role=user" is implemented here literally.
 */
deskInboxRouter.post("/desk/api/conversations", requireDeskAuth, async (req: Request, res: Response) => {
  const me = deskUser(req);
  if (!me) return res.status(401).json({ error: "Not signed in" });

  const ghlLocationId = String(req.body?.ghlLocationId ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim().slice(0, 200);
  const body = String(req.body?.body ?? "").trim().slice(0, MAX_REPLY_CHARS);
  const channel = String(req.body?.channel ?? "").trim().slice(0, 40) || "another channel";

  if (!ghlLocationId) return res.status(400).json({ error: "Choose which sub-account this is for." });
  if (!subject) return res.status(400).json({ error: "Give the ticket a subject." });
  if (!body) return res.status(400).json({ error: "Write down what they asked." });

  const location = await prisma.locationInstall.findUnique({
    where: { ghlLocationId },
    select: { id: true, agencyInstallId: true, agencyInstall: { select: { status: true } } },
  });
  if (!location || location.agencyInstall.status !== "active") {
    return res.status(404).json({ error: "That sub-account isn't available." });
  }

  const PRIORITIES = ["low", "normal", "high", "urgent"];
  const priority = PRIORITIES.includes(req.body?.priority) ? req.body.priority : "normal";
  const ticketType = normalizeTicketType(req.body?.ticketType);

  const contactEmail = (() => {
    const raw = String(req.body?.contactEmail ?? "").trim();
    if (!raw) return null;
    // Same shape as the agency-facing validation in admin.ts. A bad address is refused
    // rather than stored, because the whole point of holding one is to reach them later
    // and a typo discovered then is a ticket nobody can follow up.
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw)) {
      return { error: "That email address doesn't look right." } as const;
    }
    return raw.slice(0, 200);
  })();
  if (contactEmail && typeof contactEmail !== "string") {
    return res.status(400).json({ error: contactEmail.error });
  }

  const now = new Date();

  /**
   * THE OPENING MESSAGE IS NOT GATED, and that is deliberate rather than an omission.
   *
   * It is stored `role=user`: the agent is transcribing what the CLIENT said. The gates
   * exist for text travelling TO a client. Running `checkAgentDraft` here would refuse an
   * agent for accurately writing down that their client said "GoHighLevel" — which is
   * both the most likely thing a confused client says and exactly what the desk needs to
   * see. The agent's own REPLY is gated, on the same ticket, by the reply route.
   */
  const created = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        agencyInstallId: location.agencyInstallId,
        locationInstallId: location.id,
        // No widget session exists for this ticket, so there is no bearer to mint. NULL
        // says that; a token nobody holds would be a live credential we cannot reason
        // about. Unique still holds — Postgres treats NULLs as distinct.
        accessTokenHash: null,
        origin: "desk",
        status: "escalated",
        queuedAt: now,
        lastMessageAt: now,
        // A ticket a person typed in was never offered to the bot, so it must not count
        // against the deflection rate the agency is shown.
        deflected: false,
        // Nothing the assistant should ever answer: a human raised it and a human owns it.
        botPaused: true,
        subject,
        priority,
        ticketType,
        contactEmail: typeof contactEmail === "string" ? contactEmail : null,
        contactName: String(req.body?.contactName ?? "").trim().slice(0, 120) || null,
        createdByDeskUserId: me.id,
        contextSnapshot: { raisedBy: me.name, raisedAt: now.toISOString(), channel },
      },
      select: { id: true },
    });

    await tx.message.create({
      data: { conversationId: conversation.id, role: "user", body },
    });
    // `system`, so the existing CLIENT_VISIBLE_ROLES allowlist keeps our own workflow off
    // the client's screen — and so it shows up in the ticket's automation history beside
    // every other thing that has happened to it.
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        role: "system",
        body: `[ticket raised by ${me.name} — ${channel}]`,
      },
    });

    return conversation;
  });

  // Assignment and the alert sit OUTSIDE the transaction on purpose: the ticket existing
  // is the thing that must not be lost, and neither of these failing should roll it back.
  let assigned = false;
  if (req.body?.assignToMe === true) {
    try {
      await prisma.conversation.update({
        where: { id: created.id },
        data: { assignedToId: me.id, assignedAt: new Date() },
      });
      assigned = true;
    } catch (e) {
      console.error(`[desk] could not self-assign new ticket: ${describeError(e)}`);
    }
  }

  const brand = await resolveBrandMap(ghlLocationId);
  void notifyDeskOfEscalation({
    brandName: brand?.brandName ?? "their platform",
    locationName: null,
    agencyName: null,
    question: body,
    conversationId: created.id,
    reason: `raised by ${me.name} from ${channel}`,
  }).catch(() => {});

  res.status(201).json({ id: created.id, assigned });
});

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
  if (req.query.createdByMe === "1" && me) where.createdByDeskUserId = me.id;
  if (typeof req.query.ticketType === "string" && req.query.ticketType) {
    where.ticketType = String(req.query.ticketType);
  }

  // One more than the page, so "there is more than this" is a FACT rather than the
  // inference "we got exactly the cap, so probably". A list that silently stops is a
  // list that quietly stops showing an agent work that exists.
  const PAGE = 100;
  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ priority: "desc" }, { lastMessageAt: "asc" }], // oldest waiting first
    take: PAGE + 1,
    include: {
      locationInstall: { select: { ghlLocationId: true, locationName: true } },
      agencyInstall: { select: { id: true, companyName: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const truncated = conversations.length > PAGE;
  if (truncated) conversations.length = PAGE;

  /**
   * Lateness against each agency's OWN target, resolved once for the page.
   *
   * Not computed in the browser, and not a fixed number of minutes. The desk used to
   * redden a row after an hour flat, which disagreed with the automations in both
   * directions — green for 59 minutes on a 15-minute urgent target, red by morning on an
   * overnight wait the target correctly ignores.
   */
  const sla = await slaStatusFor(conversations);

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
        origin: c.origin,
        ticketType: c.ticketType,
        ticketTypeLabel: ticketTypeLabel(c.ticketType),
        snoozedUntil: c.snoozedUntil,
        botPaused: c.botPaused,
        // What the client is paying for, when the agency has told us. Already resolved
        // for the bot's "isn't included on your Starter plan" line, so it is free here.
        planName: brand?.planName ?? null,
        /**
         * Whose turn is it?
         *
         * DERIVED from the newest message's role rather than stored. The alternative —
         * a status value and a "last message sender" column, which is what comparable
         * products carry — is two fields encoding one fact that the transcript beneath
         * them already answers, and any of the three can then disagree with the other
         * two. Nothing to migrate, nothing to keep in sync, and it cannot go stale.
         */
        awaitingReply: c.messages[0]?.role === "user",
        // How this stands against the agency's response target, or null when no clock is
        // running (never escalated, or a human has already replied).
        sla: serialiseSla(sla.get(c.id) ?? null),
      };
    })
  );

  res.json({ conversations: rows, counts: await inboxCounts(me?.id), truncated });
});

async function inboxCounts(deskUserId?: string) {
  /**
   * `awaitingReply` counts conversations whose NEWEST message came from the client.
   *
   * Expressed in SQL rather than by counting in JS, because the JS version would have to
   * pull every live conversation's last message across the wire to count them — the same
   * mistake `firstResponseStats` was already corrected for, where it measured at 97% of
   * the whole poll. The lateral join reads one row per conversation using the existing
   * Message(conversationId) index.
   */
  const [escalated, open, unassigned, awaiting, mine] = await Promise.all([
    prisma.conversation.count({ where: { status: "escalated" } }),
    prisma.conversation.count({ where: { status: "open" } }),
    prisma.conversation.count({ where: { status: "escalated", assignedToId: null } }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
        FROM "Conversation" c
        JOIN LATERAL (
          SELECT m."role"
            FROM "Message" m
           WHERE m."conversationId" = c."id"
           ORDER BY m."createdAt" DESC
           LIMIT 1
        ) last ON true
       WHERE c."status" IN ('open', 'escalated')
         AND last."role" = 'user'
    `,
    deskUserId
      ? prisma.conversation.count({
          where: { assignedToId: deskUserId, status: { in: ["escalated", "open"] } },
        })
      : Promise.resolve(0),
  ]);
  return {
    escalated,
    open,
    unassigned,
    awaitingReply: Number(awaiting[0]?.n ?? 0),
    mine,
  };
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
    // Cached in-process for 60s and already resolved by brandContext above, so this is a
    // map lookup rather than a second query. Kept separate because `context` is the payload
    // and `featureLabels` is deliberately not in it — only the RENAMED ones are.
    const brand = await resolveBrandMap(conversation.locationInstall.ghlLocationId);

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
      origin: conversation.origin,
      ticketType: conversation.ticketType,
      ticketTypeLabel: ticketTypeLabel(conversation.ticketType),
      snoozedUntil: conversation.snoozedUntil,
      botPaused: conversation.botPaused,
      contactEmail: conversation.contactEmail,
      contactName: conversation.contactName,
      createdBy: conversation.createdBy,
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
        // Provenance is shown to STAFF as titles only, in this client's own wording.
        citations: citationTitles(m.citations, brand),
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
      data: {
        assignedToId: assigneeId,
        assignedAt: assigneeId ? new Date() : null,
        // Taking a ticket stands the bot down; putting it back does not restart it.
        // Unassigning happens on escalation and on offboarding — both of which mean the
        // conversation still needs a PERSON, so letting the assistant resume answering
        // there would be the original bug arriving through the back door.
        ...(assigneeId ? { botPaused: true } : {}),
      },
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
          // Replying IS taking over. Set here rather than left to the agent pressing a
          // button, because the failure mode of forgetting is the bot answering the
          // client's next message on top of this reply — and nothing on screen would
          // say that had happened.
          botPaused: true,
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
        // Titles only, rendered for this client — see the citations note above.
        citations: citationTitles(draft.citations, await resolveBrandMap(conversation.locationInstall.ghlLocationId)),
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

/**
 * Status / priority / subject / type / snooze / bot-pause changes.
 *
 * This is also the "turn this chat into a ticket" endpoint. A conversation already IS a
 * ticket (see the schema comment on the model), so converting one is not a new record —
 * it is NAMING it: a subject, a type, a priority, and a place in the human queue.
 */
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
      // Finishing with a conversation hands it back to the bot, and the escape hatch
      // matters as much as the pause: without this, a client who returns weeks later to
      // a thread some long-departed agent paused gets silence from the assistant and no
      // indication why. Also clears the automation claims, so a genuinely new wait is
      // measured and alerted afresh rather than being suppressed by an old breach.
      if (req.body.status === "resolved" || req.body.status === "abandoned") {
        data.botPaused = false;
        data.snoozedUntil = null;
        data.lastReminderAt = null;
        data.slaBreachedAt = null;
        data.idleWarnedAt = null;
      }
    }
    if (PRIORITIES.includes(req.body?.priority)) data.priority = req.body.priority;
    if (typeof req.body?.subject === "string") data.subject = req.body.subject.trim().slice(0, 200) || null;

    // An unrecognised type is stored as null rather than refused: a type is a label on
    // work, never a permission, so the cost of getting it wrong is a missing facet in a
    // report — and rejecting the call would lose the status or reply change alongside it.
    if ("ticketType" in (req.body ?? {})) data.ticketType = normalizeTicketType(req.body.ticketType);

    if (typeof req.body?.botPaused === "boolean") data.botPaused = req.body.botPaused;

    if ("snoozedUntil" in (req.body ?? {})) {
      const raw = req.body.snoozedUntil;
      if (raw === null) {
        data.snoozedUntil = null;
      } else {
        const when = new Date(raw);
        if (Number.isNaN(when.getTime())) {
          return res.status(400).json({ error: "Snooze time is not a valid date." });
        }
        // A snooze in the past is almost certainly a timezone mistake on the client, and
        // storing it would make the ticket reappear instantly — which reads as the snooze
        // being broken rather than as bad input.
        if (when.getTime() <= Date.now()) {
          return res.status(400).json({ error: "Snooze until a time in the future." });
        }
        data.snoozedUntil = when;
      }
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const updated = await prisma.conversation.update({ where: { id: req.params.id }, data });
    res.json({
      id: updated.id,
      status: updated.status,
      priority: updated.priority,
      subject: updated.subject,
      ticketType: updated.ticketType,
      snoozedUntil: updated.snoozedUntil?.toISOString() ?? null,
      botPaused: updated.botPaused,
    });
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
      // Citations are dropped here; `system` rows are dropped by the mailer, which is
      // where that guarantee belongs — this line used to hand over the whole table, so
      // "[transferred from Ada to Bo]" reached the agency labelled "Note:".
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
