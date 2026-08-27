import "../services/loadEnv";

import { prisma } from "../services/prisma";
import { checkAgentDraft } from "../services/answerGuard";

/**
 * Starter reply templates for the desk.
 *
 *   npm run seed-canned-replies --workspace @ghl-theme-builder/server
 *   npm run seed-canned-replies --workspace @ghl-theme-builder/server -- --dry-run
 *
 * WHY THIS EXISTS. Canned replies were fully built — stored placeholdered, rendered per
 * conversation, gated on create, scoped so one agency's reply cannot be used on another's
 * ticket — and there were ZERO of them, with no way to make one: the desk's create
 * endpoint had no caller anywhere in the UI. `Ticket.tsx` renders the row only
 * `if (canned.length > 0)`, so the whole feature was invisible from every screen. The same
 * shape as the write-only review queue: a correct mechanism with nothing feeding it.
 *
 * THE TEMPLATES ARE PLACEHOLDERED, AND THAT IS THE POINT. A Mosaic agent works five
 * brands in an afternoon. A template that says "the Acme Portal team" is the single most
 * likely cross-brand leak in daily use, because it is the one piece of text an agent
 * reuses without rereading. `{{PLATFORM}}` is substituted per conversation at render time,
 * so the same template says "Harbour Suite" on one ticket and "Beta Hub" on the next, and
 * getting it wrong is mechanically impossible rather than something anyone must remember.
 *
 * These are SHARED (agencyInstallId NULL) because they name no agency. An agency-specific
 * template is created from the desk and scoped there.
 *
 * Idempotent by title: re-running updates the body rather than duplicating, the same
 * reasoning as seeding the KB by slug.
 */

interface Starter {
  title: string;
  body: string;
}

/**
 * Deliberately short. A template long enough to feel finished is one an agent sends
 * without editing, and a support reply that reads as boilerplate is worse than a slower
 * human one. Each of these is an opening the agent then makes specific.
 */
const STARTERS: Starter[] = [
  {
    title: "Introduction",
    body: "Hi — thanks for reaching out. I'm on the {{PLATFORM}} support team and I'll take it from here.",
  },
  {
    title: "Looking into it",
    body: "Thanks for the detail. I'm looking into this now and will come back to you shortly.",
  },
  {
    title: "Need a bit more",
    body: "Happy to help with this. So I can point you at the right thing — what were you doing just before it went wrong, and what did you see?",
  },
  {
    title: "Where to find it",
    body: "You'll find this under {{FEATURE:settings}} in the left sidebar. Open that and it's on the main panel.",
  },
  {
    title: "Fixed",
    body: "That should be sorted now — give it a try and let me know if anything still looks off.",
  },
  {
    title: "Passing to your account team",
    body: "This one is about your account rather than how {{PLATFORM}} works, so I'm passing it to the team who look after that. They'll be in touch.",
  },
  {
    title: "Following up",
    body: "Just checking in on this — are you all set, or is there anything still outstanding?",
  },
  {
    title: "Closing",
    body: "I'll close this off here. If it comes back or anything else crops up, just start a new chat and we'll pick it up.",
  },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Seeding ${STARTERS.length} shared reply templates${dryRun ? "   DRY RUN - nothing will be written" : ""}\n`);

  let created = 0;
  let updated = 0;
  let refused = 0;

  for (const s of STARTERS) {
    /**
     * Run the SAME gate the create route runs, with the SAME empty link allowlist. A
     * template belongs to no single agency, so no agency's allowlist applies to it — and
     * seeding through a side door that skipped the check would put the one text an agent
     * reuses most beyond the guarantee that covers everything they type by hand.
     */
    const gate = checkAgentDraft(s.body, { allowedLinkDomains: [] });
    if (gate.blocked) {
      refused++;
      console.log(`  REFUSED  ${s.title}`);
      for (const f of gate.findings) console.log(`           ${f.gate}: ${f.detail}`);
      continue;
    }

    const existing = await prisma.cannedReply.findFirst({
      where: { title: s.title, agencyInstallId: null },
      select: { id: true, body: true },
    });

    if (existing) {
      if (existing.body === s.body) {
        console.log(`  unchanged  ${s.title}`);
        continue;
      }
      if (!dryRun) await prisma.cannedReply.update({ where: { id: existing.id }, data: { body: s.body } });
      updated++;
      console.log(`  updated    ${s.title}`);
    } else {
      if (!dryRun) await prisma.cannedReply.create({ data: { title: s.title, body: s.body, agencyInstallId: null } });
      created++;
      console.log(`  created    ${s.title}`);
    }
  }

  console.log(`\n  created ${created} · updated ${updated} · refused ${refused}`);
  if (refused > 0) {
    console.log(
      `\n⚠  A template was refused by the outbound gate — that is the fail-safe working, not a bug.\n` +
        `   Write {{PLATFORM}} where a brand name goes, and no links at all.`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Seeding reply templates failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
