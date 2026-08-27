/**
 * Does naming the plan actually change the answer at the upsell moment?
 *
 * Asks the SAME question twice against the SAME sub-account — once with no plan set,
 * once with "Starter" — and compares. Also checks the boundary holds: the bot must not
 * quote a price or promise an upgrade just because it now knows the plan name.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const made = { themeId: null, convIds: [], locationId: null, configsBefore: null };

/**
 * A failure here is APPENDED to plan-failures.log, in full and untruncated.
 *
 * This suite asserts against live model output, so it fails intermittently — roughly
 * one run in ten — and only inside a back-to-back sweep, where the console scrolls past
 * before anyone reads it. Six isolated re-runs in a row came back clean, which is the
 * worst possible evidence: it tells you nothing and it teaches you to re-run. The next
 * occurrence leaves the actual answer on disk instead.
 */
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else {
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${String(detail).slice(0, 260)}`);
    try {
      require("node:fs").appendFileSync(
        `${__dirname}/plan-failures.log`,
        `\n=== ${new Date().toISOString()} ===\nCHECK: ${name}\nANSWER: ${String(detail ?? "(no detail)")}\n`
      );
    } catch { /* never let logging fail the run */ }
    fail++;
  }
};

const VENDOR = /gohighlevel|highlevel|\bghl\b|leadconnector/i;
const PRICE = /\$\s?\d|\d+\s?(?:dollars|usd|per month|\/mo)\b/i;

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "x-mosaic-conversation": token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function askOnce(agencyId, ghlLocationId, question) {
  const c = await api("POST", `/support/api/${agencyId}/${ghlLocationId}/conversation`, {});
  made.convIds.push(c.json.conversationId);
  const r = await api(
    "POST",
    `/support/api/${agencyId}/${ghlLocationId}/conversation/${c.json.conversationId}/message`,
    { text: question },
    c.json.token
  );
  return r.json?.reply ?? "";
}

/**
 * Does the answer actually TELL them to open a hidden feature?
 *
 * A bare /(open|click) memberships/ cannot tell an instruction from a refusal that
 * names what it is refusing. "Memberships isn't part of your setup, so you can't open
 * Memberships here" is the CORRECT answer and tripped this check — intermittently,
 * because the model phrases the refusal differently each run. An assertion that fails
 * about one run in five trains you to re-run rather than look, which is worse than no
 * assertion: it is a real failure you have taught yourself to ignore.
 *
 * So: find the imperative, then clear it if its own sentence negates it.
 */
function instructsToOpen(text, feature) {
  const NEGATED = /\b(can'?t|cannot|can not|isn'?t|is not|aren'?t|are not|won'?t|will not|unable|not available|not part of|not included|no longer|without)\b/i;
  for (const sentence of String(text).split(/(?<=[.!?])\s+/)) {
    if (!new RegExp(`\\b(open|go to|click|navigate to|head to|visit)\\s+(the\\s+)?${feature}\\b`, "i").test(sentence)) continue;
    if (NEGATED.test(sentence)) continue;
    return true;
  }
  return false;
}

(async () => {
  // Snapshot every support policy BEFORE touching anything, so cleanup can restore them.
  made.configsBefore = await p.supportConfig.findMany();

  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, supportEnabled: true },
  });
  made.locationId = loc.id;
  // Snapshotted, never assumed. Turning this back OFF is not restoring it: `supportEnabled`
  // is the agency's own per-sub-account switch, and hardcoding false silently withdraws the
  // client-facing widget from whichever real sub-account findFirst() happened to pick.
  made.supportWas = loc.supportEnabled;

  // BOTH writes go through the admin API, not Prisma, and that is what this suite was
  // getting wrong.
  //
  // The brand map is cached in-process for 60s. `hiddenFeatures` is resolved FROM it,
  // and the hidden-feature hand-off is detected by re-running retrieval scoped to those
  // features — so a stale map means hiddenFeatures reads EMPTY, nothing matches, and the
  // escalation silently never fires. The conversation just stays `open`.
  //
  // That is exactly what happened: this suite failed roughly one run in ten and ONLY
  // inside a back-to-back sweep, because it only broke when a preceding suite had warmed
  // the cache for the same sub-account inside the TTL. Six isolated re-runs came back
  // clean and told me nothing. The routes invalidate; a direct Prisma write does not.
  const themeRes = await fetch(`${BASE}/admin/api/${agency.id}/locations/${loc.id}/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Northwind Hub", hiddenFeatures: ["memberships"] }),
  });
  if (!themeRes.ok) throw new Error(`theme save failed: ${themeRes.status} ${await themeRes.text()}`);
  made.themeId = (await themeRes.json()).id;

  const cfgRes = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"], planTiers: {} }),
  });
  if (!cfgRes.ok) throw new Error(`support config save failed: ${cfgRes.status} ${await cfgRes.text()}`);
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: true } });

  const QUESTION = "A friend told me I can build a course area for my members. Can I do that here?";

  console.log("\n== no plan set (today's behaviour) ==");
  const before = await askOnce(agency.id, loc.ghlLocationId, QUESTION);
  console.log(`  A: ${before.replace(/\s+/g, " ").slice(0, 240)}\n`);
  check("refuses the hidden feature", !/\b(open|go to|click)\s+memberships\b/i.test(before), before);
  check("no vendor name", !VENDOR.test(before), before);
  check("does NOT name a plan it wasn't told about", !/\bstarter\b/i.test(before), before);

  console.log("== plan named as \"Starter\" ==");
  // Save through the API, not the DB: the route is what invalidates the server's
  // brand-map cache, and testing the DB write alone would miss that entirely.
  await api("PUT", `/admin/api/${agency.id}/support`, {
    enabled: true,
    escalationEmails: ["ops@agency.test"],
    planTiers: { [loc.id]: "Starter" },
  });

  /**
   * The DETERMINISTIC half, and it exists because the probabilistic half below lost an
   * afternoon. `planTiers` is written by a whole-object PUT, so the way it fails for real
   * is by being silently dropped — which this file records happening for months. Read it
   * back before asking the model anything, or a wording change in the answer is
   * indistinguishable from the column never having been stored.
   */
  const storedPlans = (await api("GET", `/admin/api/${agency.id}/support`)).json?.config?.planTiers;
  check("the plan is actually stored against this sub-account", storedPlans?.[loc.id] === "Starter", JSON.stringify(storedPlans));

  const after = await askOnce(agency.id, loc.ghlLocationId, QUESTION);
  console.log(`  A: ${after.replace(/\s+/g, " ").slice(0, 240)}\n`);
  /**
   * MODEL PROSE, not plumbing. It has come back without the word once — "isn't part of
   * your current setup", which is the pre-fix wording and so reads exactly like the plan
   * machinery being broken. The detail carries the stored value with it, so the entry in
   * plan-failures.log says which layer to look at instead of leaving it to be rediscovered.
   */
  check(
    "the model names the plan — the upsell moment reads correctly (model prose)",
    /\bstarter\b/i.test(after),
    `stored planTiers=${JSON.stringify(storedPlans)} (so the column is fine if this says Starter) — ANSWER: ${after}`
  );
  check("still refuses to explain the feature", !instructsToOpen(after, "memberships"), after);
  check("offers the team", /team|touch|connect|someone/i.test(after), after);
  check("BOUNDARY: quotes no price", !PRICE.test(after), after);
  check("no vendor name", !VENDOR.test(after), after);

  console.log("== a live agent actually picks it up ==");
  const escalated = await p.conversation.findMany({ where: { id: { in: made.convIds } }, select: { status: true } });
  check("both conversations landed in the desk queue", escalated.every((c) => c.status === "escalated"), JSON.stringify(escalated));
  check("  -> no button for the client to press first", escalated.length === 2);

  console.log("== a stray sub-account id can't have a plan written onto it ==");
  const other = await p.locationInstall.findFirst({ where: { agencyInstallId: { not: agency.id } }, select: { id: true } });
  const r = await api("PUT", `/admin/api/${agency.id}/support`, {
    enabled: true,
    escalationEmails: ["ops@agency.test"],
    planTiers: { [loc.id]: "Starter", "not-a-real-id": "Enterprise", ...(other ? { [other.id]: "Enterprise" } : {}) },
  });
  const stored = r.json?.planTiers ?? {};
  check("keeps the owned sub-account", stored[loc.id] === "Starter", JSON.stringify(stored));
  check("drops the unknown id", !("not-a-real-id" in stored), JSON.stringify(stored));

  /**
   * And the plan name survives an ordinary save of the support form.
   *
   * The PUT writes `planTiers` unconditionally, defaulting to `{}` — while the GET did
   * not return the column at all. The dashboard saves by PUTting back the object the GET
   * handed it, so changing the greeting, or one blocked term, or the master switch,
   * DELETED every plan name the agency had. Nothing said so, nothing could restore them
   * (no screen sets them), and the only visible symptom is the answer above quietly
   * reverting to the generic wording — months later, in a client's chat.
   */
  console.log("== and it survives the agency saving the support form ==");
  const asDashboard = await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json();
  check(
    "the GET hands the plan names back, or the form cannot round-trip them",
    asDashboard?.config?.planTiers?.[loc.id] === "Starter",
    JSON.stringify(asDashboard?.config?.planTiers)
  );
  // Exactly what the editor does: change one unrelated field, PUT the whole object back.
  await api("PUT", `/admin/api/${agency.id}/support`, { ...asDashboard.config, greeting: "Hi there!" });
  const afterSave = await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json();
  check(
    "  -> editing the greeting does not wipe the plan names",
    afterSave?.config?.planTiers?.[loc.id] === "Starter",
    JSON.stringify(afterSave?.config?.planTiers)
  );

  /**
   * ONE SHAPE, three ways of getting it.
   *
   * The dashboard stores the GET's config and the PUT's response into the SAME state
   * variable, typed `SupportConfig` — and they were different objects. Measured with the
   * targets column NULL, seconds apart, for one row: the GET answered the resolved policy
   * `{urgent:15,...}` and the PUT answered `null`. Nothing was losing data, because the
   * Plan cell's read-modify-write happened to re-send a null that was already null — it
   * survived on luck, and luck is what ran out when a nullable Json column reached
   * `ChipInput` and blanked the whole dashboard.
   *
   * A declared type is a promise the SERVER makes; nothing type-checks JSON crossing the
   * wire, so these three have to be asserted equal rather than assumed.
   */
  console.log("\n== the GET and the PUT describe the same resource ==");
  const cfgNow = (await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json()).config;
  // `api()` returns { status, json } — the body is on `.json`.
  const putBack = (await api("PUT", `/admin/api/${agency.id}/support`, cfgNow)).json;
  const getKeys = Object.keys(cfgNow).sort();
  const putKeys = Object.keys(putBack).sort();
  check(
    "the PUT answers with the same fields the GET does",
    JSON.stringify(getKeys) === JSON.stringify(putKeys),
    JSON.stringify({ onlyInGet: getKeys.filter((k) => !putKeys.includes(k)), onlyInPut: putKeys.filter((k) => !getKeys.includes(k)) })
  );

  // The case that actually differed: an agency who has never set response targets. The
  // GET resolves the column into a complete policy; the PUT used to hand back the raw
  // null, so one save turned a populated form into an empty one in the caller's state.
  await p.supportConfig.update({ where: { agencyInstallId: agency.id }, data: { slaFirstResponseMins: null } });
  const gNull = (await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json()).config;
  const pNull = (await api("PUT", `/admin/api/${agency.id}/support`, { ...gNull, slaFirstResponseMins: null })).json;
  check(
    "with the targets column NULL, both still answer the resolved policy",
    JSON.stringify(pNull.slaFirstResponseMins) === JSON.stringify(gNull.slaFirstResponseMins) &&
      pNull.slaFirstResponseMins?.urgent > 0,
    JSON.stringify({ get: gNull.slaFirstResponseMins, put: pNull.slaFirstResponseMins })
  );

  /**
   * And the branch nobody develops against: an agency with NO row at all. It used to be a
   * hand-written object listing the same thirteen fields, so adding a column and wiring it
   * into the PUT while forgetting this list binds a fresh agency's control to `undefined`
   * — invisible on any database that already has a row, which is every database anybody
   * works on.
   */
  const keep = await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id } });
  await p.supportConfig.delete({ where: { agencyInstallId: agency.id } });
  const gEmpty = (await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json()).config;
  check(
    "an agency with no config row gets the SAME shape, not a hand-listed subset",
    JSON.stringify(Object.keys(gEmpty).sort()) === JSON.stringify(getKeys.filter((k) => k in gEmpty).sort()) &&
      getKeys.every((k) => k in gEmpty || ["id", "agencyInstallId", "createdAt", "updatedAt"].includes(k)),
    JSON.stringify({ missing: getKeys.filter((k) => !(k in gEmpty)) })
  );
  check(
    "  -> including the defaults the automation will actually enforce",
    gEmpty.slaFirstResponseMins?.urgent > 0 && Array.isArray(gEmpty.quickActions) && gEmpty.planTiers !== undefined,
    JSON.stringify({ sla: gEmpty.slaFirstResponseMins, quick: gEmpty.quickActions, plans: gEmpty.planTiers })
  );
  const { id: _drop, createdAt: _c, updatedAt: _u, ...restore } = keep;
  await p.supportConfig.create({ data: restore });

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    for (const id of made.convIds) {
      await p.message.deleteMany({ where: { conversationId: id } });
      await p.conversation.delete({ where: { id } }).catch(() => {});
    }
    if (made.themeId) await p.themeConfig.delete({ where: { id: made.themeId } }).catch(() => {});
    if (made.locationId) await p.locationInstall.update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } }).catch(() => {});
    /**
     * RESTORE what was here, do not `deleteMany({})`.
     *
     * That is what this line used to be, and it deletes EVERY agency's support policy on
     * a shared dev database — greeting, blocked terms, business hours, response targets
     * and the plan names, for agencies this suite never touched. It is also silent: the
     * next thing to notice is the bot answering with the generic wording, or readiness
     * reporting a support config that "was never set up".
     *
     * The suite has to own the config while it runs (it PUTs its own policy through the
     * route, which is the only thing that invalidates the brand-map cache), so it snapshots
     * every row first and puts them all back afterwards.
     */
    if (made.configsBefore) {
      await p.supportConfig.deleteMany({});
      for (const row of made.configsBefore) {
        const { id, createdAt, updatedAt, ...rest } = row;
        await p.supportConfig.create({ data: rest }).catch(() => {});
      }
    }
    console.log(`\ncleanup: conversations=${await p.conversation.count()} supportConfigs=${await p.supportConfig.count()} themeConfigs=${await p.themeConfig.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
