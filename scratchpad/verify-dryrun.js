/**
 * The go-live gate: does the dry run actually tell an agency the truth about THEIR setup?
 *
 * The generic fixtures prove the system is sound against a made-up agency. This proves
 * the dry run itself works against real rows — a real brand name, a real rename, a real
 * hidden feature — because those are the inputs a fixture can never cover, and a dry run
 * that always says "clean" is worse than no dry run at all.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();

// Snapshot every support policy before anything is written, so cleanup can put them back.
let __configsBefore = null;
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const made = { themeId: null, locationId: null };

const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${String(detail).slice(0, 300)}`); fail++; }
};

const VENDOR = /gohighlevel|high\s*level|\bghl\b|leadconnector|msgsndr/i;
const URL_RE = /https?:\/\//i;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  __configsBefore = await p.supportConfig.findMany();
  // Baseline for the "writes nothing" claim below — measured, never assumed to be zero.
  const rowsBefore = {
    conversations: await p.conversation.count(),
    messages: await p.message.count(),
  };
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, locationName: true },
  });
  made.locationId = loc.id;

  // A sub-account configured the way a real one is: their own brand, two renamed menu
  // items, one feature they didn't buy.
  const theme = await p.themeConfig.create({
    data: {
      locationInstallId: loc.id,
      brandName: "Harbour Suite",
      menuLabelOverrides: { opportunities: "Deals", contacts: "People" },
      hiddenFeatures: ["memberships"],
      version: 9700,
    },
  });
  made.themeId = theme.id;

  await p.supportConfig.upsert({
    where: { agencyInstallId: agency.id },
    update: { enabled: true, escalationEmails: ["ops@agency.test"] },
    create: { agencyInstallId: agency.id, enabled: true, escalationEmails: ["ops@agency.test"] },
  });

  console.log("\n== it refuses to run against a sub-account that isn't yours ==");
  const other = await p.locationInstall.findFirst({
    where: { agencyInstallId: { not: agency.id } },
    select: { id: true },
  });
  const stray = await api("POST", `/admin/api/${agency.id}/support/dry-run`, {
    locationInstallId: other?.id ?? "not-a-real-id",
  });
  check("400s on a sub-account this agency doesn't own", stray.status === 400, JSON.stringify(stray.json));
  const noBody = await api("POST", `/admin/api/${agency.id}/support/dry-run`, {});
  check("400s with no sub-account picked", noBody.status === 400, JSON.stringify(noBody.json));

  console.log("\n== six real questions, asked as this client ==");
  const t0 = Date.now();
  const r = await api("POST", `/admin/api/${agency.id}/support/dry-run`, { locationInstallId: loc.id });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 200) {
    check("dry run returns 200", false, `${r.status} ${JSON.stringify(r.json)}`);
    throw new Error("dry run did not run");
  }
  const body = r.json;
  console.log(`  (${secs}s, answered as "${body.brandName}" via ${body.brandNameSource})\n`);

  for (const res of body.results) {
    console.log(`  Q: ${res.question}`);
    console.log(`  A: ${(res.answer || `(error: ${res.error})`).replace(/\s+/g, " ").slice(0, 220)}`);
    console.log(`     clean=${res.clean} escalated=${res.escalated} refs=${res.usedReferences}\n`);
  }

  console.log("== what the agency is being told is actually true ==");
  check("shows the sub-account's own brand name", body.brandName === "Harbour Suite", body.brandName);
  /*
   * The fixture renames exactly TWO items, so this is the check that can see the bug the
   * old one could not: it asserted only that `opportunities` was in there, which was true
   * while the route was handing back all 51 labels and calling them "your names". Assert
   * the SIZE and the absence of an un-renamed item, or the screen whose whole job is to
   * show what differs is free to list everything that doesn't.
   */
  const renames = body.renamedLabels ?? [];
  check(
    "renames are reported as from → to pairs",
    renames.some((r) => r.key === "opportunities" && r.from === "Opportunities" && r.to === "Deals") &&
      renames.some((r) => r.key === "contacts" && r.from === "Contacts" && r.to === "People"),
    JSON.stringify(renames)
  );
  check(
    "  -> and ONLY the two the fixture renamed, not every label there is",
    renames.length === 2,
    `${renames.length} reported: ${renames.map((r) => r.to).join(", ")}`
  );
  check(
    "  -> an untouched menu item is absent, by name",
    !renames.some((r) => r.key === "calendars"),
    JSON.stringify(renames.find((r) => r.key === "calendars") ?? null)
  );
  check("shows the hidden feature", body.hiddenFeatures?.includes("memberships"), JSON.stringify(body.hiddenFeatures));
  check("ran every probe", body.results.length === 6, body.results.length);
  check("no probe errored", body.results.every((x) => !x.error), body.results.map((x) => x.error).join(" | "));

  /**
   * DID THE MODEL RUN? Every check below reads answer TEXT, and `answerQuestion` turns any
   * model failure into one polite hand-off — so with the OpenAI account out of credits this
   * suite reported a dozen failures about brand names and renamed labels, none of which were
   * about the product at all.
   *
   * The same blindness the screen had: `allClean` is computed from GATE findings, and a
   * sentence the model never wrote passes every gate. Throw with the real reason instead —
   * the `verify-session` 429 rule: when the failure mode is known, make the occurrence
   * self-documenting rather than leaving the next person to rediscover it.
   */
  console.log("\n== did the assistant actually answer? ==");
  check("the payload says whether the model ran at all", body.modelFailure !== undefined, "no `modelFailure` field — the route predates this check");
  if (body.modelFailure) {
    throw new Error(
      `the model answered ${body.modelFailure.of - body.modelFailure.rows} of ${body.modelFailure.of} probes ` +
        `(${body.modelFailure.kind}). ${body.modelFailure.remedy} ` +
        `Nothing below this line would be about the product.`
    );
  }
  check("…and `ready` is not just `allClean`", body.ready === (body.allClean && body.modelFailure === null), `ready=${body.ready} allClean=${body.allClean}`);
  check(
    "no row is a model failure dressed as an answer",
    body.results.every((x) => x.modelFailure === null),
    JSON.stringify(body.results.filter((x) => x.modelFailure).map((x) => [x.id, x.modelFailure]))
  );

  const byId = Object.fromEntries(body.results.map((x) => [x.id, x]));
  const all = body.results.map((x) => x.answer).join("\n");

  console.log("\n== the answers themselves ==");
  check("NO answer names the vendor", !VENDOR.test(all), all.match(VENDOR)?.[0]);
  check("NO answer contains a URL", !URL_RE.test(all), all.match(/https?:\/\/\S+/)?.[0]);
  check("identity probe names the client's brand", /harbour suite/i.test(byId.identity.answer), byId.identity.answer);
  check("\"is it a white label?\" holds the line", !VENDOR.test(byId["vendor-direct"].answer), byId["vendor-direct"].answer);
  check("pipeline answer uses the RENAMED label", /\bdeals\b/i.test(byId["renamed-menu"].answer), byId["renamed-menu"].answer);
  check("  -> and never the original", !/\bopportunit/i.test(byId["renamed-menu"].answer), byId["renamed-menu"].answer);
  check("contact answer uses the RENAMED label", /\bpeople\b/i.test(byId["add-contact"].answer), byId["add-contact"].answer);
  check("link request sends no link", !URL_RE.test(byId.link.answer), byId.link.answer);
  check("money question goes to a human", byId.money.escalated === true, JSON.stringify(byId.money));
  check("verdict reflects the probes", body.allClean === body.results.every((x) => x.clean), `${body.allClean}`);

  console.log("\n== a good answer is not a support failure ==");
  // These are answered from the prompt by design and retrieve nothing. Filing a ticket
  // for each would bury the desk queue in questions the bot got RIGHT, and record every
  // one of them against the deflection rate that decides headcount.
  check("\"what platform is this?\" does NOT file a ticket", byId.identity.escalated === false, JSON.stringify(byId.identity));
  check("\"is it a white label?\" does NOT file a ticket", byId["vendor-direct"].escalated === false, JSON.stringify(byId["vendor-direct"]));
  check("\"send me a link\" does NOT file a ticket", byId.link.escalated === false, JSON.stringify(byId.link));
  check("  -> all three still answered without reference material", [byId.identity, byId["vendor-direct"], byId.link].every((x) => x.usedReferences === 0));

  console.log("\n== a dry run is a TEST, not a client conversation ==");
  /**
   * NO NEW ROWS, not zero rows. Asserting `count() === 0` quietly required the whole
   * database to be empty of conversations — so a couple of real chats somebody had while
   * trying the widget failed this, and the failure read as the dry run writing transcripts.
   * The claim was always about the delta; a suite that can only be right on an empty
   * database is one that will be wrong on every database that has ever been used.
   */
  const convs = await p.conversation.count();
  check(
    "stores no conversation rows",
    convs === rowsBefore.conversations,
    `${convs} conversations now, ${rowsBefore.conversations} before the dry run`
  );
  const msgs = await p.message.count();
  check(
    "stores no messages",
    msgs === rowsBefore.messages,
    `${msgs} messages now, ${rowsBefore.messages} before the dry run`
  );

  console.log("\n== it works BEFORE support is switched on ==");
  // The whole point is to try it before enabling. If the dry run itself needed the
  // master switch on, the agency would have to expose the bot to clients to test it.
  await p.supportConfig.update({ where: { agencyInstallId: agency.id }, data: { enabled: false } });
  const offRun = await api("POST", `/admin/api/${agency.id}/support/dry-run`, { locationInstallId: loc.id });
  check("runs with the master switch OFF", offRun.status === 200, `${offRun.status} ${JSON.stringify(offRun.json)}`);
  check("  -> and still answers as their brand", offRun.json?.brandName === "Harbour Suite", offRun.json?.brandName);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    if (made.themeId) await p.themeConfig.delete({ where: { id: made.themeId } }).catch(() => {});
    /**
     * RESTORE, never `deleteMany({})`.
     *
     * That unscoped delete removes EVERY agency's support policy — greeting, blocked terms,
     * business hours, response targets, plan names — for agencies this script never touched.
     * Invisible on a one-agency dev database and destructive the moment there are two, which
     * is the same shape as a per-tenant check written as an aggregate. It is silent too: the
     * next symptom is the bot answering with the generic wording, weeks later.
     */
    await (async () => {
      const keep = __configsBefore || [];
      await p.supportConfig.deleteMany({});
      for (const row of keep) {
        const { id, createdAt, updatedAt, ...rest } = row;
        await p.supportConfig.create({ data: rest }).catch(() => {});
      }
    })();
    console.log(`cleanup: themeConfigs=${await p.themeConfig.count()} supportConfigs=${await p.supportConfig.count()} conversations=${await p.conversation.count()}`);
    await p.$disconnect();
    process.exit(fail ? 1 : 0);
  });
