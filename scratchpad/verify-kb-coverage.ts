/**
 * Does the corpus answer the question the way a CLIENT asks it?
 *
 * Retrieval is full-text, so an article is only reachable through the words that are
 * actually in it. Every probe below is deliberately phrased the way somebody types into
 * a chat box — not the way the article is titled — because a corpus that only matches
 * its own headings is a corpus that looks complete and retrieves nothing.
 *
 *   npx tsx <this file>
 */
import "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/loadEnv";
import { searchKb } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/kbSearch";
import { prisma } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/prisma";

/** [what a client types, the slug that should come back at or near the top] */
const PROBES: [string, string][] = [
  ["how do i point my own web address at my funnel", "connecting-your-own-domain"],
  ["my text messages arent going through to anyone", "texts-not-sending"],
  ["people keep not turning up to their appointments", "appointment-reminders"],
  ["can i charge a deposit before someone books a slot", "taking-payment-at-booking"],
  ["i want to bill a customer the same amount every month", "subscriptions-and-recurring-billing"],
  ["why does my email keep landing in junk", "why-emails-go-to-spam"],
  ["a customer got the exact same message twice", "an-automation-sent-twice"],
  ["i want enquiries shared out between three of my staff", "team-calendars-and-round-robin"],
  ["how do i copy my whole setup into a new client account", "copying-a-setup-into-another-account"],
  ["i want to give someone ten percent off at checkout", "coupons-and-discounts"],
  ["i need a client to sign an agreement electronically", "documents-and-contracts"],
  ["how can i tell which advert is actually producing customers", "where-leads-come-from"],
  ["what do i need to do before i can text american numbers", "a2p-registration"],
  ["my bookings are not showing up in my own diary", "appointments-not-syncing"],
  ["i want a staff member who can only see their own people", "permissions-in-detail"],
  ["how do i stop the follow up once somebody writes back", "goals-and-exiting-early"],
  ["they paid me and never received what they bought", "customer-paid-but-nothing-happened"],
  ["i want a little chat bubble on the corner of my site", "the-chat-widget-on-your-website"],
  ["how do i put a video lesson behind a login", "building-a-course"],
  ["the same person is in my list twice", "duplicate-contacts-appearing"],
  ["how do i save something i type out over and over", "message-templates-and-snippets"],
  ["i want to ask my customers to leave a google review", "getting-more-reviews"],
  ["how do i store an extra bit of info against each person", "custom-fields"],
  ["what happens if their card gets declined on renewal", "refunds-and-failed-payments"],
  ["i cannot get into my account", "cannot-log-in"],
  ["how do i send my leads over to another piece of software", "sending-data-to-another-system"],
  ["is there an app for my phone", "using-the-mobile-app"],
  ["how do i put a price and a picture on something i sell", "products-and-prices"],
  ["i want to schedule posts to facebook and instagram", "the-social-planner"],
  ["what is the difference between a website and a funnel", "funnels-versus-websites"],
];

(async () => {
  let top1 = 0;
  let top3 = 0;
  let missed = 0;

  for (const [question, expected] of PROBES) {
    // Same call the bot makes on the client path.
    const hits = await searchKb({ query: question, agencyInstallId: null, limit: 5 });
    const slugs = hits.map((h) => (h.sourceUrl ?? "").replace("mosaic:kb/", ""));
    const rank = slugs.indexOf(expected);

    if (rank === 0) top1++;
    else if (rank > 0 && rank < 3) top3++;
    else missed++;

    const mark = rank === 0 ? "  1st" : rank > 0 ? `  #${rank + 1}` : hits.length ? " MISS" : "EMPTY";
    console.log(`${mark}  ${question}`);
    if (rank !== 0) console.log(`        want ${expected}\n        got  ${slugs.slice(0, 3).join(", ") || "(nothing)"}`);
  }

  console.log(
    `\n${top1} first, ${top3} in top 3, ${missed} missed, of ${PROBES.length}.\n` +
      `A miss where the retrieved articles are still RELEVANT is fine — the bot reads five.\n` +
      `A miss returning nothing is a real gap: thin retrieval hands the client to a human.`
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
