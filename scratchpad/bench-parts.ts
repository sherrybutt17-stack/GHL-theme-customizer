/**
 * Which half of a queue poll is expensive, measured directly against the services.
 *
 * Going through HTTP put this behind the 60/min `/support/api` limiter, and a 429 is
 * cheap to serve — so the timings came back FASTER as the dataset grew, which is the
 * shape of a benchmark measuring its own rejections.
 */
import "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/loadEnv";
import { prisma } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/prisma";
import {
  agentSlots,
  firstResponseStats,
  queuePosition,
} from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/deskQueue";
import { createHash, randomBytes } from "node:crypto";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not local.");
  process.exit(1);
}

const HISTORY = Number(process.argv[2] ?? 2000);
const WAITING = Number(process.argv[3] ?? 40);

async function time(label: string, fn: () => Promise<unknown>, n = 30): Promise<number> {
  await fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  console.log(`  ${label.padEnd(30)} ${ms.toFixed(2).padStart(8)} ms`);
  return ms;
}

(async () => {
  const agency = await prisma.agencyInstall.findFirst({ select: { id: true } });
  const location = await prisma.locationInstall.findFirst({
    where: { agencyInstallId: agency!.id, status: "active" },
    select: { id: true },
  });

  const rows: any[] = [];
  for (let i = 0; i < HISTORY; i++) {
    rows.push({
      agencyInstallId: agency!.id,
      locationInstallId: location!.id,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "resolved" as const,
      startedAt: new Date(Date.now() - 3 * 86400000),
      queuedAt: new Date(Date.now() - 3 * 86400000 + 60000),
      firstAgentReplyAt: new Date(Date.now() - 3 * 86400000 + 300000),
    });
  }
  for (let i = 0; i < WAITING; i++) {
    rows.push({
      agencyInstallId: agency!.id,
      locationInstallId: location!.id,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "escalated" as const,
      queuedAt: new Date(Date.now() - (i + 1) * 60000),
    });
  }
  await prisma.conversation.createMany({ data: rows });

  const waiting = await prisma.conversation.findFirst({
    where: { status: "escalated", assignedToId: null },
    select: { id: true },
  });

  console.log(`\n${HISTORY} settled + ${WAITING} waiting\n`);
  const a = await time("agentSlots()", () => agentSlots());
  const b = await time(`firstResponseStats(7d)`, () => firstResponseStats(7));
  const c = await time("queuePosition()", () => queuePosition(waiting!.id));
  console.log(`\n  total per poll ≈ ${(a + b + c).toFixed(2)} ms — samples is ${((b / (a + b + c)) * 100).toFixed(0)}% of it\n`);

  await prisma.conversation.deleteMany({
    where: { locationInstallId: location!.id, OR: [{ status: "resolved" }, { status: "escalated" }] },
  });
  console.log(`cleanup: conversations=${await prisma.conversation.count()}`);
  await prisma.$disconnect();
})();
