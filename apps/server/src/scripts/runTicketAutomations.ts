import "../services/loadEnv";
import { prisma } from "../services/prisma";
import { runTicketAutomations } from "../services/ticketAutomations";

/**
 * Run the ticket automations once.
 *
 * A SCRIPT ON A SCHEDULE, not a timer in the server, for the two reasons that keep
 * `poll-feeds` out of the server process as well: the free Render web service sleeps
 * after ~15 minutes so an in-process interval simply stops, and more than one instance
 * would mean every instance running every pass against the same rows.
 *
 * Unlike feed polling, two concurrent runs here are HARMLESS by construction — every
 * pass claims its right to act with a conditional updateMany, so the loser matches zero
 * rows. The workflow still serialises runs, because doing the work twice is waste even
 * when it is safe.
 *
 *   npm run ticket-automations --workspace @ghl-theme-builder/server
 *   npm run ticket-automations --workspace @ghl-theme-builder/server -- --dry-run
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) console.log("DRY RUN — reporting what would happen, writing nothing.\n");

  const report = await runTicketAutomations({ dryRun });

  if (report.actions.length === 0) {
    console.log(`Nothing to do (${report.scanned} live conversations).`);
  } else {
    // Grouped by pass, because the question a reader has is "is one of these firing far
    // more than I expected", and a flat list of forty lines does not answer it.
    const byPass = new Map<string, typeof report.actions>();
    for (const a of report.actions) {
      const list = byPass.get(a.pass) ?? [];
      list.push(a);
      byPass.set(a.pass, list);
    }
    for (const [pass, items] of byPass) {
      console.log(`${pass}: ${items.length}`);
      for (const i of items) console.log(`  ${i.conversationId}  ${i.detail}`);
    }
    console.log(`\n${report.actions.length} action(s) over ${report.scanned} live conversations.`);
  }

  for (const e of report.errors) console.error(`  ! ${e}`);

  // A pass failing is a real failure and the scheduler should show it red — unlike a
  // missing DATABASE_URL, which the workflow treats as "not configured" and exits 0 for.
  // The difference matters: one means nobody set this up, the other means it is broken.
  if (report.errors.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
