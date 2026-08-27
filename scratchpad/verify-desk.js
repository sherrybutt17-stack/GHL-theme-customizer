/**
 * Live checks for the desk inbox API, against the local server + local Postgres.
 * Creates its own desk user, conversations and canned replies, and deletes them all.
 *
 * The headline check is the one the plan calls the important one: a Mosaic agent
 * answering as five brands is the primary leak risk in the system, so typing the vendor
 * name or a vendor URL into the compose box must be BLOCKED BEFORE SEND — not silently
 * rewritten, and not stored.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const { createHash, randomBytes, scryptSync } = require("node:crypto");

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0, cookie = "";

function check(name, ok, detail) {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); fail++; }
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-mosaic-desk": "1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const EMAIL = `desk-verify-${Date.now()}@mosaic.test`;
const PASSWORD = "correct horse battery staple";
const created = { userId: null, convA: null, convB: null, cannedShared: null, cannedAgencyA: null, locB: null };

/*
 * WHAT THIS SUITE OWNS AND MUST GIVE BACK.
 *
 * The teardown used to end with `supportConfig.deleteMany({ agencyInstallId: agency.id })`.
 * Scoped, so it read as the careful version of the unscoped delete this file's siblings
 * were caught doing - and CLAUDE.md's note on that fix says exactly why it is not:
 * "scoping fixes the neighbours, not the agency under test". `agency.id` here is
 * findFirst(), i.e. the only agency on a dev database, so every run destroyed that
 * agency's greeting, blocked terms, business hours, response targets and plan names. The
 * next symptom is the bot answering with generic wording weeks later.
 *
 * It also renames two REAL sub-accounts ("Acme Portal", "Beta Hub") through the theme
 * route, because that is the only write the brand-map cache honours - and left them
 * renamed, with a new version on each, for good.
 */
const restore = { supportConfig: null, hadSupportConfig: false, themeVersionFloor: {} };

function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N: 16384 });
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

(async () => {
  // ---- setup -------------------------------------------------------------
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const locations = await p.locationInstall.findMany({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, locationName: true },
    take: 2,
  });
  const [locA, locB] = locations;

  // Give the two sub-accounts DIFFERENT brand names so a cross-brand leak is visible.
  //
  // Saved through the ADMIN API rather than Prisma, and that is load-bearing for this
  // harness rather than a style choice. The brand map is cached in-process for 60s;
  // `createThemeVersion` invalidates it, a raw Prisma write does not. Written directly,
  // these rows land in the database while the running server keeps answering with
  // whatever brand it cached earlier — so run this straight after any suite that
  // touched the same sub-accounts and every brand assertion fails at once, which reads
  // exactly like a cross-brand leak and is really a stale cache.
  const saveTheme = async (loc, brandName, menuLabelOverrides) => {
    const res = await fetch(`${BASE}/admin/api/${agency.id}/locations/${loc.id}/theme`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandName, menuLabelOverrides }),
    });
    if (!res.ok) throw new Error(`theme save failed for ${loc.id}: ${res.status} ${await res.text()}`);
  };
  restore.supportConfig = await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id } });
  restore.hadSupportConfig = !!restore.supportConfig;
  for (const l of [locA, locB]) {
    const top = await p.themeConfig.findFirst({ where: { locationInstallId: l.id }, orderBy: { version: "desc" }, select: { version: true } });
    restore.themeVersionFloor[l.id] = top?.version ?? 0;
  }

  // A renames ONE menu item; B renames none. The banner has to tell those apart.
  await saveTheme(locA, "Acme Portal", { opportunities: "Deals" });
  await saveTheme(locB, "Beta Hub", {});
  created.locB = locB.id;

  const user = await p.deskUser.create({
    data: { email: EMAIL, name: "Verify Agent", passwordHash: hashPassword(PASSWORD), role: "mosaic_admin" },
  });
  created.userId = user.id;

  const mk = async (loc, text) => {
    const c = await p.conversation.create({
      data: {
        agencyInstallId: agency.id,
        locationInstallId: loc.id,
        accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
        status: "escalated",
        contextSnapshot: { pageUrl: "https://app.example.com/v2/location/x/contacts", cssApplied: true },
      },
    });
    await p.message.create({ data: { conversationId: c.id, role: "user", body: text } });
    return c.id;
  };
  created.convA = await mk(locA, "How do I create a pipeline?");
  created.convB = await mk(locB, "Where do I find my contacts?");

  /*
   * A bot answer carrying PLACEHOLDERED citation titles, which is how the corpus stores
   * every one of them — `kbNormalize` swaps the vendor and the nav labels out at ingest and
   * `renderForBrand` puts this client's words back at answer time.
   *
   * The desk rendered them raw. Measured by opening a real ticket in a browser: the
   * provenance row read "Troubleshooting Bulk Imports Via CSV: {{PLATFORM}} Support Portal".
   */
  await p.message.create({
    data: {
      conversationId: created.convA,
      role: "bot",
      body: "Open Deals from the left sidebar and choose a pipeline.",
      citations: [
        { id: "kb1", title: "Getting started with {{PLATFORM}}", sourceUrl: "mosaic:kb/getting-started" },
        { id: "kb2", title: "Adding files to {{FEATURE:contacts}}", sourceUrl: "mosaic:kb/files" },
      ],
    },
  });

  console.log(`\nsetup: agency=${agency.id.slice(0, 8)}… locA="${locA.locationName}" locB="${locB.locationName}"\n`);

  // ---- auth --------------------------------------------------------------
  console.log("== auth ==");
  let r = await call("GET", "/desk/api/inbox");
  check("inbox rejects an unauthenticated request", r.status === 401, `got ${r.status}`);

  r = await call("POST", "/desk/api/login", { email: EMAIL, password: PASSWORD });
/*
 * A 429 here is the 10/min bucket on `/desk/api/login`, not a product failure — and it is
 * the single most misleading thing this suite can print. Unhardened, the login `check`
 * failed and every assertion after it failed too, as `401 Not signed in`: "the session
 * cookie is HttpOnly" and "an admin can disable them" both read as a security regression.
 *
 * `verify-session` and `verify-offboard` already throw with the real reason. The rule is
 * the plan-failures one: when the failure mode is known, make the occurrence
 * self-documenting rather than leaving the next person to rediscover it. Space desk suites
 * about a minute apart.
 */
  if (r.status === 429) {
    throw new Error(
      "rate-limited by /desk/api/login (10/min per IP), not a product failure. " +
        "Another desk suite ran in the same minute — wait one and re-run."
    );
  }
  check("login succeeds", r.status === 200, JSON.stringify(r.json));

  // ---- inbox -------------------------------------------------------------
  console.log("\n== inbox ==");
  r = await call("GET", "/desk/api/inbox");
  check("inbox lists escalated conversations", r.status === 200 && r.json.conversations.length >= 2);
  const rowA = r.json.conversations.find((c) => c.id === created.convA);
  const rowB = r.json.conversations.find((c) => c.id === created.convB);
  check('row shows the CLIENT brand ("Acme Portal"), not the agency name', rowA?.brandName === "Acme Portal", `got ${rowA?.brandName}`);
  check("a second sub-account shows its own brand", rowB?.brandName === "Beta Hub", `got ${rowB?.brandName}`);
  check("counts are returned for the sidebar", typeof r.json.counts?.escalated === "number");

  // ---- ticket view -------------------------------------------------------
  console.log("\n== ticket view ==");
  r = await call("GET", `/desk/api/conversations/${created.convA}`);
  const t = r.json;
  check("brand context is in the payload, not buried", t.context?.brandName === "Acme Portal");
  check("the support boundary travels with the ticket", !!t.context?.supportBoundary);
  /*
   * The banner names what this client CALLS things, and it is the last thing read before
   * an agent types. It used to be handed the whole 51-entry label table, so a sub-account
   * that had renamed nothing was described as having renamed everything - and the banner
   * renders six of them plus "+45", which means the one word that genuinely differs is
   * whichever the slice happens to drop. Assert the pair AND the size.
   */
  check(
    "renames reach the agent as from → to",
    t.context?.renamedLabels?.length === 1 &&
      t.context.renamedLabels[0].from === "Opportunities" &&
      t.context.renamedLabels[0].to === "Deals",
    JSON.stringify(t.context?.renamedLabels)
  );
  /*
   * Provenance in the CLIENT'S OWN WORDS. `renderForBrand`'s doc says an unmapped key falls
   * back to its default label "rather than leaving a raw placeholder on screen", and the
   * desk was the one consumer that never called it — so an agent read our template syntax,
   * and quoting a title would have sent `{{PLATFORM}}` into a customer's chat, past the
   * gates, which look for vendor names and links and know nothing about braces.
   */
  const cited = (t.messages ?? []).flatMap((m) => m.citations ?? []).map((c) => c.title);
  check("the bot answer's citations reach the agent (positive control)", cited.length === 2, JSON.stringify(cited));
  check(
    "no citation title shows a raw placeholder",
    cited.every((x) => typeof x === "string" && !x.includes("{{")),
    JSON.stringify(cited)
  );
  check(
    "  -> {{PLATFORM}} reads as THIS client's brand name",
    cited.some((x) => x === "Getting started with Acme Portal"),
    JSON.stringify(cited)
  );
  check(
    "  -> and {{FEATURE:key}} as the label they see in their sidebar",
    cited.some((x) => x === "Adding files to Contacts"),
    JSON.stringify(cited)
  );
  check(
    "  -> and still NO source URL, which is the older rule",
    (t.messages ?? []).flatMap((m) => m.citations ?? []).every((c) => Object.keys(c).join(",") === "title"),
    JSON.stringify((t.messages ?? []).flatMap((m) => m.citations ?? []))
  );

  const rB = await call("GET", `/desk/api/conversations/${created.convB}`);
  check(
    "  -> a sub-account that renamed NOTHING reports no renames",
    Array.isArray(rB.json.context?.renamedLabels) && rB.json.context.renamedLabels.length === 0,
    `${rB.json.context?.renamedLabels?.length} reported: ${(rB.json.context?.renamedLabels ?? []).map((x) => x.to).join(", ")}`
  );
  check("auto-captured context snapshot is present", !!t.contextSnapshot?.pageUrl);
  // The client's question plus the bot answer planted above. An absolute count here breaks
  // the moment the fixture grows a message, which is what it just did — say what is
  // expected instead of how many.
  check(
    "transcript is included",
    Array.isArray(t.messages) && t.messages.some((m) => m.role === "user") && t.messages.some((m) => m.role === "bot"),
    JSON.stringify((t.messages ?? []).map((m) => m.role))
  );

  // ---- THE human-leak test ----------------------------------------------
  console.log("\n== agent compose box: blocked before send ==");
  const leak = "Sure — this is just how GoHighLevel works, see https://help.gohighlevel.com/pipelines for more.";

  r = await call("POST", `/desk/api/conversations/${created.convA}/check`, { text: leak });
  check("live check flags it while typing", r.json?.blocked === true);
  check("  ↳ names the vendor mention", r.json.findings.some((f) => f.gate === "brand"));
  check("  ↳ names the link", r.json.findings.some((f) => f.gate === "link"));

  const beforeReply = await p.message.count({ where: { conversationId: created.convA } });
  r = await call("POST", `/desk/api/conversations/${created.convA}/reply`, { text: leak });
  check("SEND IS REFUSED (422)", r.status === 422, `got ${r.status}`);
  check("  ↳ tells the agent what to say instead", (r.json.reasons ?? []).some((s) => s.includes("Acme Portal")));

  const stored = await p.message.findMany({ where: { conversationId: created.convA } });
  // Measured against what the fixture put there, not against 1: the claim is that the
  // refused reply added NOTHING, and an absolute count says that only by coincidence.
  check(
    "  ↳ the blocked reply was NOT stored",
    stored.length === beforeReply,
    `${stored.length} messages, was ${beforeReply}`
  );
  check("  ↳ text was not silently rewritten and sent", !stored.some((m) => m.role === "agent"));

  const convAfter = await p.conversation.findUnique({ where: { id: created.convA } });
  check("  ↳ the near-miss is counted as a metric", convAfter.brandLeakHits > 0);

  // ---- a clean reply goes through ----------------------------------------
  console.log("\n== a clean reply sends ==");
  r = await call("POST", `/desk/api/conversations/${created.convA}/reply`, {
    text: "Sure — open Opportunities from the sidebar, then the pipelines tab. You can add and reorder stages there.",
  });
  check("accepted", r.status === 201, JSON.stringify(r.json));
  check("stored as an agent message", r.json?.role === "agent");
  const conv2 = await p.conversation.findUnique({ where: { id: created.convA } });
  check("firstAgentReplyAt recorded (the coverage metric)", !!conv2.firstAgentReplyAt);
  check("auto-assigned to the replying agent", conv2.assignedToId === created.userId);

  // ---- internal notes ----------------------------------------------------
  r = await call("POST", `/desk/api/conversations/${created.convA}/reply`, {
    text: "Client seems to be on an old snapshot.",
    internal: true,
  });
  check("internal note is stored as system, never agent", r.json?.role === "system");

  // ---- canned replies ----------------------------------------------------
  console.log("\n== canned replies: placeholdered, rendered per ticket ==");
  r = await call("POST", "/desk/api/canned-replies", {
    title: "Pipeline how-to",
    body: "Happy to help! In {{PLATFORM}}, open {{FEATURE:opportunities}} and pick the pipelines tab.",
  });
  check("a placeholdered reply is accepted", r.status === 201, JSON.stringify(r.json));
  created.cannedShared = r.json?.id;

  r = await call("POST", "/desk/api/canned-replies", {
    title: "Bad one",
    body: "In GoHighLevel, open Opportunities.",
  });
  check("a reply containing the vendor name is REFUSED", r.status === 422, `got ${r.status}`);
  check("  ↳ suggests the placeholder instead", (r.json.reasons ?? []).some((s) => s.includes("{{PLATFORM}}")));

  r = await call("POST", `/desk/api/conversations/${created.convA}/canned-replies/${created.cannedShared}/render`);
  check('renders "Acme Portal" on sub-account A', r.json?.body?.includes("Acme Portal"), r.json?.body);

  r = await call("POST", `/desk/api/conversations/${created.convB}/canned-replies/${created.cannedShared}/render`);
  check('the SAME reply renders "Beta Hub" on sub-account B', r.json?.body?.includes("Beta Hub"), r.json?.body);
  check("  ↳ and carries no trace of the other brand", !r.json?.body?.includes("Acme"), r.json?.body);

  // ---- assignment / status ----------------------------------------------
  console.log("\n== assignment and status ==");
  r = await call("POST", `/desk/api/conversations/${created.convB}/assign`, {});
  check("claiming a ticket assigns it to me", r.json?.assignedTo?.id === created.userId);

  r = await call("POST", `/desk/api/conversations/${created.convB}/assign`, { assigneeId: "does-not-exist" });
  check("assigning to a non-existent user is refused", r.status === 400);

  r = await call("PATCH", `/desk/api/conversations/${created.convB}`, { status: "resolved", priority: "high" });
  check("status and priority update", r.json?.status === "resolved" && r.json?.priority === "high");

  // ---- tier-3 hand-off ---------------------------------------------------
  console.log("\n== tier-3: hand off to the agency ==");
  /*
   * ARRANGE the no-address state; do not assume it.
   *
   * This check went straight from the fixtures to asserting a 400, which is only true on
   * an agency that has never configured support - and configuring it is required before
   * the master switch will even turn on, so the assumption is false on every real install.
   * On this database it 200'd and reported a safety refusal as MISSING, which sends the
   * next reader hunting a bug in the guard rather than in the harness.
   *
   * "Assumes an empty database" is now a FOUR-time failure here (verify-routing's
   * percentiles, verify-dryrun's row count, verify-tickets' global passes, and this) and
   * it is the sharpest of them: the other three misreported a number, this one misreports
   * the refusal that stops a client hand-off going nowhere.
   *
   * Restored below, so the agency's real address survives the run.
   */
  console.log(`  (this agency's real escalation address: ${JSON.stringify(restore.supportConfig?.escalationEmails ?? null)} - cleared for this section, restored at teardown)`);
  if (restore.hadSupportConfig) {
    await p.supportConfig.update({ where: { agencyInstallId: agency.id }, data: { escalationEmails: [] } });
  }

  r = await call("POST", `/desk/api/conversations/${created.convA}/hand-to-agency`, { note: "They're asking about their invoice." });
  check("refused when the agency has no escalation email", r.status === 400, `got ${r.status}: ${JSON.stringify(r.json)}`);

  await p.supportConfig.upsert({
    where: { agencyInstallId: agency.id },
    update: { escalationEmails: ["ops@agency.test"] },
    create: { agencyInstallId: agency.id, escalationEmails: ["ops@agency.test"] },
  });
  r = await call("POST", `/desk/api/conversations/${created.convA}/hand-to-agency`, { note: "Invoice question." });
  check("accepted once an escalation address exists", r.status === 200, JSON.stringify(r.json));
  check("  ↳ returns who it goes to", (r.json?.recipients ?? []).includes("ops@agency.test"));
  const conv3 = await p.conversation.findUnique({ where: { id: created.convA } });
  check("  ↳ recorded on the conversation", !!conv3.handedToAgencyAt);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.message); fail++; })
  .finally(async () => {
    // ---- teardown --------------------------------------------------------
    const agency = await p.agencyInstall.findFirst({ select: { id: true } });
    for (const id of [created.convA, created.convB].filter(Boolean)) {
      await p.message.deleteMany({ where: { conversationId: id } });
      await p.conversation.delete({ where: { id } }).catch(() => {});
    }
    await p.cannedReply.deleteMany({ where: { title: { in: ["Pipeline how-to", "Bad one"] } } });
    await p.themeConfig.deleteMany({ where: { version: 9001 } });
    // Put back every theme version this run added, so two real sub-accounts do not stay
    // branded "Acme Portal" and "Beta Hub" forever.
    let themesDropped = 0;
    for (const [locationInstallId, floor] of Object.entries(restore.themeVersionFloor)) {
      const d = await p.themeConfig.deleteMany({ where: { locationInstallId, version: { gt: floor } } });
      themesDropped += d.count;
    }
    // Put the config back rather than deleting it - see the note beside `restore`.
    if (restore.hadSupportConfig) {
      const { id, agencyInstallId, createdAt, updatedAt, ...fields } = restore.supportConfig;
      await p.supportConfig.upsert({
        where: { agencyInstallId },
        update: fields,
        create: { agencyInstallId, ...fields },
      });
    } else {
      await p.supportConfig.deleteMany({ where: { agencyInstallId: agency.id } });
    }
    if (created.userId) {
      await p.deskSession.deleteMany({ where: { deskUserId: created.userId } });
      await p.deskUser.delete({ where: { id: created.userId } }).catch(() => {});
    }
    const left = await p.conversation.count();
    const cannedLeft = await p.cannedReply.count();
    const usersLeft = await p.deskUser.count({ where: { email: EMAIL } });
    const cfgBack = await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id }, select: { greeting: true, escalationEmails: true, planTiers: true } });
    console.log(`\ncleanup: conversations=${left} cannedReplies=${cannedLeft} testUsers=${usersLeft} themeVersionsDropped=${themesDropped}`);
    console.log(`  agency support config restored: ${JSON.stringify(cfgBack)}`);
    await p.$disconnect();
    process.exit(fail);
  });
