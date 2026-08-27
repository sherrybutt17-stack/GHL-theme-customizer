/**
 * Plant just enough state for the QUEUE BOARD's wait line to render, then remove it.
 *
 * `estimatedWaitText` is null below five measured responses or with nobody on the desk —
 * deliberately, because "someone will be with you in 2 minutes" while nobody is on the
 * desk is the worst version of that promise. Which means the line CANNOT be seen on an
 * ordinary dev database, and a conditional that never renders is one nobody has looked at.
 *
 *   npx tsx scratchpad/seed-queue-demo.ts plant
 *   npx tsx scratchpad/seed-queue-demo.ts clear
 */
import "../apps/server/src/services/loadEnv";
import { prisma } from "../apps/server/src/services/prisma";
import { createHash, randomBytes } from "node:crypto";

const MARK = "queue-demo";

async function plant() {
  const agency = await prisma.agencyInstall.findFirst({ where: { status: "active" } });
  const loc = await prisma.locationInstall.findFirst({
    where: { agencyInstallId: agency!.id, status: "active" },
  });
  // Six settled hand-offs answered between 2 and 20 minutes: past MIN_SAMPLES_FOR_ESTIMATE,
  // and spread so the median is a real number rather than a single point repeated.
  for (const mins of [2, 4, 6, 9, 14, 20]) {
    await prisma.conversation.create({
      data: {
        agencyInstallId: agency!.id,
        locationInstallId: loc!.id,
        accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
        subject: MARK,
        status: "resolved",
        startedAt: new Date(Date.now() - 7200_000),
        queuedAt: new Date(Date.now() - 3600_000),
        firstAgentReplyAt: new Date(Date.now() - 3600_000 + mins * 60_000),
        lastMessageAt: new Date(),
      },
    });
  }
  // And two people actually waiting, so the board has depth to show.
  for (const waited of [3, 11]) {
    await prisma.conversation.create({
      data: {
        agencyInstallId: agency!.id,
        locationInstallId: loc!.id,
        accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
        subject: MARK,
        status: "escalated",
        priority: waited > 10 ? "high" : "normal",
        startedAt: new Date(Date.now() - waited * 60_000 - 60_000),
        queuedAt: new Date(Date.now() - waited * 60_000),
        lastMessageAt: new Date(Date.now() - waited * 60_000),
      },
    });
  }
  await prisma.deskUser.updateMany({ where: { status: "active" }, data: { availability: "available" } });
  console.log("planted 6 settled + 2 waiting");
}

async function clear() {
  const rows = await prisma.conversation.findMany({ where: { subject: MARK }, select: { id: true } });
  for (const r of rows) {
    await prisma.message.deleteMany({ where: { conversationId: r.id } });
    await prisma.conversation.delete({ where: { id: r.id } }).catch(() => {});
  }
  console.log(`cleared ${rows.length}`);
}

/**
 * A realistic TICKET to open, because the ticket pane is the densest screen in the desk
 * and none of it can be looked at without a conversation that has actually been through
 * the pipeline: a client question, a bot answer with citations, an escalation, an agent
 * reply, and the internal rows that must NEVER reach the client.
 */
async function ticket() {
  const agency = await prisma.agencyInstall.findFirst({ where: { status: "active" } });
  const loc = await prisma.locationInstall.findFirst({
    where: { agencyInstallId: agency!.id, status: "active" },
  });
  const agent = await prisma.deskUser.findFirst({ where: { status: "active" } });
  const conv = await prisma.conversation.create({
    data: {
      agencyInstallId: agency!.id,
      locationInstallId: loc!.id,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      subject: MARK,
      status: "escalated",
      priority: "high",
      ticketType: "not_working",
      startedAt: new Date(Date.now() - 40 * 60_000),
      queuedAt: new Date(Date.now() - 25 * 60_000),
      lastMessageAt: new Date(Date.now() - 2 * 60_000),
      assignedToId: agent?.id ?? null,
      assignedAt: new Date(Date.now() - 20 * 60_000),
    },
  });
  const rows: { role: string; body: string; citations?: { title: string }[]; ago: number }[] = [
    { role: "user", body: "My texts aren't sending to any of my contacts since this morning. Nothing in the outbox moves.", ago: 40 },
    {
      role: "bot",
      body: "Sorry about that. Messages usually stall for one of three reasons: the number isn't verified yet, the contact has opted out, or a sending limit has been reached. Open Conversations and check whether the message shows as queued or failed — that tells us which one it is.",
      citations: [{ title: "Why messages stop sending" }, { title: "Checking a number's status" }],
      ago: 39,
    },
    { role: "user", body: "It says failed on all of them. I need this fixed today, we have a launch.", ago: 26 },
    { role: "system", body: "[escalated to tier 1 — client asked for a person]", ago: 25 },
    { role: "system", body: "[internal] check their billing — the account looks suspended on our side", ago: 24 },
    { role: "agent", body: "Hi — I can see the failures on our side and I'm looking at it now. I'll come back to you within the hour with either a fix or a clear reason.", ago: 2 },
  ];
  for (const r of rows) {
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: r.role,
        body: r.body,
        citations: r.citations ?? [],
        createdAt: new Date(Date.now() - r.ago * 60_000),
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { firstAgentReplyAt: new Date(Date.now() - 2 * 60_000) },
  });
  console.log("planted 1 ticket with a full transcript:", conv.id);
}

const mode = process.argv[2];
(mode === "clear" ? clear() : mode === "ticket" ? ticket() : plant()).finally(() => prisma.$disconnect());
