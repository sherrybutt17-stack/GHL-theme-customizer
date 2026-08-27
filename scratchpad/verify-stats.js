/**
 * Live checks for the agency-facing support stats.
 *
 * Two things matter here beyond the arithmetic: an agency must never see another
 * agency's numbers, and "deflection rate" has to mean what the dashboard claims it
 * means — otherwise it's a number that drives headcount decisions and is wrong.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const { createHash, randomBytes } = require("node:crypto");

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const made = { conversations: [], agencyA: null, agencyB: null, agencyC: null, locationB: null, locationC: null };

const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); fail++; }
};

const get = (path) => fetch(BASE + path).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

async function mkConversation(agencyInstallId, locationInstallId, opts) {
  const c = await p.conversation.create({
    data: {
      agencyInstallId,
      locationInstallId,
      accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      status: opts.status,
      deflected: !!opts.deflected,
      csat: opts.csat ?? null,
      startedAt: opts.startedAt ?? new Date(),
      // When the bot handed over. The wait an agency is shown is measured from HERE,
      // not from startedAt, so the fixtures below set the two apart on purpose.
      queuedAt: opts.queuedAt ?? null,
      firstAgentReplyAt: opts.firstAgentReplyAt ?? null,
      handedToAgencyAt: opts.handedToAgency ? new Date() : null,
      ticketType: opts.ticketType ?? null,
    },
  });
  made.conversations.push(c.id);
  if (opts.clientMessages) {
    for (let i = 0; i < opts.clientMessages; i++) {
      await p.message.create({ data: { conversationId: c.id, role: "user", body: `q${i}` } });
    }
  }
  return c;
}

(async () => {
  // A DEDICATED agency, not the local dev one.
  //
  // These assertions pin absolute counts — "7 conversations", "3 of 6 settled" — and
  // the stats endpoint aggregates per agency, so ANY row left behind by another suite
  // on the shared dev agency lands inside them. That produced five failures at once in
  // a back-to-back run, from two stray conversations that had nothing to do with stats;
  // five red checks in the wrong suite is a worse outcome than the leak itself, because
  // it sends you reading the aggregation code.
  const agencyA = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `verify-stats-a-${Date.now()}`,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Stats Agency",
    },
  });
  made.agencyA = agencyA.id;
  const locs = [];
  for (let i = 0; i < 2; i++) {
    locs.push(await p.locationInstall.create({
      data: {
        agencyInstallId: agencyA.id,
        ghlLocationId: `verify-stats-loc-${Date.now()}-${i}`,
        status: "active",
        locationName: `Stats Sub ${i}`,
      },
    }));
  }

  // A SECOND agency with its own conversation — the scoping control.
  const agencyB = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `verify-stats-${Date.now()}`,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Other Agency",
    },
  });
  made.agencyB = agencyB.id;
  const locB = await p.locationInstall.create({
    data: { agencyInstallId: agencyB.id, ghlLocationId: `verify-loc-${Date.now()}`, status: "active", locationName: "Other Sub" },
  });
  made.locationB = locB.id;

  // Agency A: 3 deflected, 2 escalated, 1 still open, 1 handed to the agency.
  const hourAgo = new Date(Date.now() - 3600_000);
  await mkConversation(agencyA.id, locs[0].id, { status: "resolved", deflected: true, csat: 1, clientMessages: 2 });
  await mkConversation(agencyA.id, locs[0].id, { status: "resolved", deflected: true, csat: 1, clientMessages: 1 });
  await mkConversation(agencyA.id, locs[1].id, { status: "resolved", deflected: true, clientMessages: 1 });
  // Chatted to the bot for 15 min, THEN handed over, THEN answered 20 min later.
  // Measured from the hand-off that is a 20-minute wait; measured from startedAt it
  // would read as 35 — the bot being useful making the desk look slow.
  await mkConversation(agencyA.id, locs[0].id, {
    status: "escalated", csat: 0, clientMessages: 3,
    startedAt: hourAgo,
    queuedAt: new Date(hourAgo.getTime() + 15 * 60000),
    firstAgentReplyAt: new Date(hourAgo.getTime() + 35 * 60000),
  });
  await mkConversation(agencyA.id, locs[1].id, {
    status: "escalated", clientMessages: 1,
    startedAt: hourAgo,
    queuedAt: new Date(hourAgo.getTime() + 5 * 60000),
    firstAgentReplyAt: new Date(hourAgo.getTime() + 45 * 60000), // 40 min after hand-off
    handedToAgency: true,
  });
  // Answered by an agent but never queued — nothing to measure, must not count as a
  // zero-minute wait and drag the median to the floor.
  await mkConversation(agencyA.id, locs[0].id, {
    status: "resolved", clientMessages: 1,
    startedAt: hourAgo, firstAgentReplyAt: new Date(hourAgo.getTime() + 90 * 60000),
  });
  await mkConversation(agencyA.id, locs[0].id, { status: "open", clientMessages: 1 });

  await mkConversation(agencyB.id, locB.id, { status: "resolved", deflected: true, clientMessages: 5 });

  /**
   * A THIRD agency, purely for the hand-off breakdown.
   *
   * Its fixtures have to be conversations that reached a person, which necessarily moves
   * totals, settled counts and the deflection rate — and agency A's checks are built on
   * deliberately round numbers ("3 of 6 settled = 50%"). Rewriting those to match new
   * fixtures would be changing the assertions to fit the data, which is how a suite stops
   * meaning anything. Its own agency instead.
   */
  const agencyC = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `verify-stats-c-${Date.now()}`,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Handoff Agency",
    },
  });
  made.agencyC = agencyC.id;
  const locC = await p.locationInstall.create({
    data: { agencyInstallId: agencyC.id, ghlLocationId: `verify-stats-c-loc-${Date.now()}`, status: "active", locationName: "Handoff Sub" },
  });
  made.locationC = locC.id;

  const q = (mins) => new Date(hourAgo.getTime() + mins * 60000);
  // Two billing, still escalated.
  await mkConversation(agencyC.id, locC.id, { status: "escalated", clientMessages: 1, startedAt: hourAgo, queuedAt: q(1), ticketType: "billing" });
  await mkConversation(agencyC.id, locC.id, { status: "escalated", clientMessages: 1, startedAt: hourAgo, queuedAt: q(2), ticketType: "billing" });
  // Reached a person and has since been RESOLVED — must still count. The question is what
  // needed a human in this window, not what still does.
  await mkConversation(agencyC.id, locC.id, { status: "resolved", clientMessages: 1, startedAt: hourAgo, queuedAt: q(3), firstAgentReplyAt: q(9), ticketType: "bug_report" });
  // Reached a person, nobody categorised it.
  await mkConversation(agencyC.id, locC.id, { status: "resolved", clientMessages: 1, startedAt: hourAgo, queuedAt: q(4), firstAgentReplyAt: q(8) });
  // NEVER queued, though an agent did reply. Must not appear at all.
  await mkConversation(agencyC.id, locC.id, { status: "resolved", clientMessages: 1, startedAt: hourAgo, firstAgentReplyAt: q(20), ticketType: "how_to" });
  // Settled by the bot alone: no hand-off, so nothing here either.
  await mkConversation(agencyC.id, locC.id, { status: "resolved", deflected: true, clientMessages: 1 });

  console.log("\n== totals ==");
  let r = await get(`/admin/api/${agencyA.id}/support/stats?days=30`);
  check("endpoint responds", r.status === 200, `got ${r.status}`);
  const s = r.json;
  check("counts all 7 conversations", s.totals.conversations === 7, `got ${s.totals.conversations}`);
  check("counts client questions, not bot replies", s.totals.clientMessages === 10, `got ${s.totals.clientMessages}`);
  check("counts escalations", s.totals.escalated === 2, `got ${s.totals.escalated}`);
  check("counts hand-offs to the agency", s.totals.handedToAgency === 1, `got ${s.totals.handedToAgency}`);

  console.log("\n== deflection rate means what the dashboard says ==");
  // 3 deflected of 6 SETTLED (3 resolved+deflected, 2 escalated, 1 resolved by an agent).
  // The still-open one is excluded — counting it as "not deflected" would drop the rate
  // every time someone is mid-chat, which is noise.
  check("3 of 6 settled = 50%, the OPEN one excluded from both halves", Math.round(s.deflectionRate * 100) === 50, `got ${s.deflectionRate}`);

  console.log("\n== responsiveness and satisfaction ==");
  check(
    "wait is timed from the HAND-OFF, not the start of the chat (20 and 40 → 30)",
    s.firstReply.medianMinutes === 30,
    `got ${s.firstReply.medianMinutes} — 35 would mean it is still counting time spent with the bot`
  );
  check(
    "a reply with no hand-off is excluded, not counted as instant",
    s.firstReply.sampleCount === 2,
    `got ${s.firstReply.sampleCount}`
  );
  check("the slow tail is reported too", s.firstReply.p90Minutes === 40, `got ${s.firstReply.p90Minutes}`);
  check("CSAT counts 2 positive / 1 negative", s.csat.positive === 2 && s.csat.negative === 1);
  check("CSAT rate is 67%", Math.round(s.csat.rate * 100) === 67, `got ${s.csat.rate}`);

  console.log("\n== breakdowns ==");
  check("per-sub-account rows returned", s.byLocation.length === 2, `got ${s.byLocation.length}`);
  check("sorted busiest first", s.byLocation[0].conversations >= s.byLocation[1].conversations);
  check("daily series is zero-filled to 30 points", s.daily.length === 30, `got ${s.daily.length}`);
  check("today's bucket has the new conversations", s.daily[s.daily.length - 1].conversations >= 4);

  console.log("\n== what needed a person ==");
  /**
   * The complement to `topTopics`, which is built from the tags of articles the bot CITED
   * and therefore only ever describes questions the knowledge base already answered. The
   * ones that beat the bot cite nothing and are invisible there.
   */
  const rc = await get(`/admin/api/${agencyC.id}/support/stats?days=30`);
  const h = rc.json.handoffTypes;
  check(
    "counts every conversation that reached a person",
    h.total === 4,
    `got ${h.total} — 2 escalated + 1 resolved-after-hand-off + 1 untyped`
  );
  check(
    "  -> INCLUDING one since RESOLVED, because the work still happened",
    h.types.some((t) => t.key === "bug_report" && t.count === 1),
    `${JSON.stringify(h.types)} — counting by current status would drop exactly the work that got done`
  );
  check(
    "  -> and NOT an agent reply on a chat that never reached the queue",
    !h.types.some((t) => t.key === "how_to"),
    `${JSON.stringify(h.types)} — the how_to fixture has firstAgentReplyAt but no queuedAt`
  );
  check(
    "  -> nor a conversation the bot settled alone",
    h.total === 4 && rc.json.totals.conversations === 6,
    `${h.total} of ${rc.json.totals.conversations} conversations reached a person`
  );

  /**
   * AND THE TILE HAS TO RENDER IN THE STATE EVERY INSTALL STARTS IN.
   *
   * `handoffTypes` is correct on the server whether or not anything has been categorised —
   * `{ total: 2, untyped: 2, types: [] }` is a true and useful answer. The dashboard gated
   * the whole tile on `types.length > 0`, so in that state it rendered NOTHING: an agency
   * with hand-offs and no categories was shown no number, and no hint that categorising
   * would produce one. Types are set by hand on the desk, so that is not an edge case, it
   * is day one of every install — and it hid its own reason, which an empty tile does not.
   *
   * A source check, like the one pinning `slaTone`'s thresholds, and with the same known
   * limit: it proves the CONDITION, not the pixels. `shoot-dashboard.mjs` is the witness
   * that the tile actually appears, and it is what found this.
   */
  const activitySrc = require("fs").readFileSync(`${ROOT}/apps/admin-dashboard/src/SupportActivity.tsx`, "utf8");
  check(
    "the hand-off tile does not hide itself when nothing is categorised yet",
    !/handoffTypes\.total > 0 && stats\.handoffTypes\.types\.length > 0/.test(activitySrc),
    "SupportActivity gates the tile on types.length again — day one of every install renders nothing"
  );
  check(
    "  -> and says so in words rather than showing an empty box",
    /types\.length === 0 \?/.test(activitySrc) && /none have been\s*\n?\s*categorised yet/.test(activitySrc.replace(/\s+/g, " ")),
    "no all-untyped branch in the hint — the tile would render with nothing in it"
  );
  check("commonest first", h.types[0].key === "billing" && h.types[0].count === 2, JSON.stringify(h.types));
  check("labels are resolved, not raw keys", h.types[0].label === "Billing or plan", h.types[0].label);
  check(
    "the uncategorised ones are REPORTED, not quietly dropped",
    h.untyped === 1,
    `got ${h.untyped} — a breakdown of only the typed ones describes a subset while looking like the whole`
  );
  check(
    "  -> and the parts add up to the total",
    h.types.reduce((n, t) => n + t.count, 0) + h.untyped === h.total,
    JSON.stringify(h)
  );

  console.log("\n== tenant scoping ==");
  const rb = await get(`/admin/api/${agencyB.id}/support/stats?days=30`);
  check("agency B sees only its own 1 conversation", rb.json.totals.conversations === 1, `got ${rb.json.totals.conversations}`);

  check("agency B's client messages are its own", rb.json.totals.clientMessages === 5, `got ${rb.json.totals.clientMessages}`);
  check("agency A's total excludes agency B", s.totals.conversations === 7);

  console.log("\n== range clamping ==");
  r = await get(`/admin/api/${agencyA.id}/support/stats?days=99999`);
  check("absurd range clamps to 90 days", r.json.days === 90, `got ${r.json.days}`);
  r = await get(`/admin/api/${agencyA.id}/support/stats?days=-5`);
  check("negative range falls back to 30", r.json.days === 30, `got ${r.json.days}`);
  r = await get(`/admin/api/${agencyA.id}/support/stats?days=7`);
  check("7-day range returns 7 points", r.json.daily.length === 7);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.message); fail++; })
  .finally(async () => {
    for (const id of made.conversations) {
      await p.message.deleteMany({ where: { conversationId: id } });
      await p.conversation.delete({ where: { id } }).catch(() => {});
    }
    // Locations FIRST. LocationInstall does NOT cascade from AgencyInstall (unlike the
    // support-era models, which all do), so deleting the agency while its sub-accounts
    // exist fails on the foreign key — and a swallowed .catch() leaves the agency behind
    // for the next run to trip over. Not a product bug: nothing ever deletes an
    // AgencyInstall (uninstall sets status), and cascading there would let one stray
    // delete take every sub-account's theme history with it.
    for (const agencyId of [made.agencyC, made.agencyB, made.agencyA].filter(Boolean)) {
      await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } }).catch(() => {});
      await p.agencyInstall.delete({ where: { id: agencyId } }).catch(() => {});
    }
    console.log(`\ncleanup: conversations=${await p.conversation.count()} agencies=${await p.agencyInstall.count()} locations=${await p.locationInstall.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
