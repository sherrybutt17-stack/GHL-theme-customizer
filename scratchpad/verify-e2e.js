/**
 * THE RELEASE GATE, end to end.
 *
 * Everything until now was tested in pieces. This drives the real public widget API the
 * way a client's browser does — real retrieval over the seeded knowledge base, a real
 * model call, the real gates — against a sub-account configured the way a real one is:
 * its own brand name, a renamed menu item, and a hidden feature.
 *
 * The plan's stated bar: zero vendor mentions, zero URLs, renamed labels used, hidden
 * features refused. Then grep every stored Message body for both, and expect nothing.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const made = { themeId: null, conversationId: null, configCreated: false, locationId: null };

const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${String(detail).slice(0, 300)}`); fail++; }
};

// Everything the answer must never contain, however written.
const VENDOR = /gohighlevel|go\s*high\s*level|highlevel|high[\s._-]level|\bghl\b|leadconnector|msgsndr/i;
const URLISH = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|net|org|co)\b/i;

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-mosaic-conversation": token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
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

  // A realistic sub-account: own brand, Opportunities renamed to Leads, Memberships hidden.
  const theme = await p.themeConfig.create({
    data: {
      locationInstallId: loc.id,
      brandName: "Northwind Hub",
      menuLabelOverrides: { opportunities: "Leads", contacts: "People" },
      hiddenFeatures: ["memberships", "payments"],
      version: 9500,
    },
  });
  made.themeId = theme.id;

  const existingConfig = await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id } });
  if (!existingConfig) made.configCreated = true;

  // Saved through the ADMIN API, not Prisma, and that is load-bearing for this harness.
  //
  // The brand map is cached in-process for 60s. The theme above is written directly, so
  // nothing tells the running server it changed — and this test then immediately asks the
  // widget what brand it is. Run straight after another suite that warmed the cache with
  // a different sub-account, every brand assertion fails, which reads exactly like flake.
  //
  // Saving support config invalidates the whole brand map (documented in CLAUDE.md and
  // enforced in admin.ts), so routing this one write through the real endpoint clears the
  // stale entry — and exercises the path production actually uses.
  const cfg = await api("PUT", `/admin/api/${agency.id}/support`, {
    enabled: true,
    escalationEmails: ["ops@agency.test"],
  });
  if (cfg.status >= 400) throw new Error(`support config save failed: ${cfg.status} ${JSON.stringify(cfg.json)}`);
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: true } });

  const ready = await p.kbArticle.count({ where: { status: "ready" } });
  console.log(`\nsetup: brand="Northwind Hub", Opportunities→Leads, Memberships+Payments hidden, ${ready} KB articles\n`);

  // --- the widget's own bootstrap ---
  console.log("== widget bootstrap ==");
  let r = await api("GET", `/support/api/${agency.id}/${loc.ghlLocationId}/config`);
  check("config returns the client's brand, not the agency's", r.json?.brandName === "Northwind Hub", JSON.stringify(r.json));
  check("does NOT leak forbiddenTerms or allowedLinkDomains", !("forbiddenTerms" in (r.json ?? {})) && !("allowedLinkDomains" in (r.json ?? {})));

  r = await api("POST", `/support/api/${agency.id}/${loc.ghlLocationId}/conversation`, { pageUrl: "https://app.example.com/v2/location/x/contacts", cssApplied: true });
  check("conversation created with a bearer", r.status === 201 && !!r.json?.token);
  const token = r.json.token;
  made.conversationId = r.json.conversationId;

  const ask = async (question) => {
    const res = await api("POST", `/support/api/${agency.id}/${loc.ghlLocationId}/conversation/${made.conversationId}/message`, { text: question }, token);
    return res.json?.reply ?? "";
  };

  // --- the real thing ---
  console.log("\n== real answers, real model ==");

  const a1 = await ask("How do I create a pipeline?");
  console.log(`\n  Q: How do I create a pipeline?\n  A: ${a1.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("no vendor name", !VENDOR.test(a1), a1);
  check("no links", !URLISH.test(a1), a1);
  check('uses the RENAMED label "Leads"', /\bleads\b/i.test(a1), a1);
  // Case-SENSITIVE on the capitalised form, matching the rule the normalizer itself uses.
  // "Open Opportunities" is the nav label and is wrong for a client whose sidebar says
  // Leads; "each opportunity you create" is ordinary sales English and always was — the
  // seed article stores it lowercase on purpose. Matching /opportunit/i conflated the two
  // and failed intermittently on the second one.
  check('never says the nav label "Opportunities"', !/\bOpportunit(?:y|ies)\b/.test(a1), a1);
  check("actually answered from the KB (mentions stages)", /stage/i.test(a1), a1);

  const a2 = await ask("How do I add a new contact?");
  console.log(`  Q: How do I add a new contact?\n  A: ${a2.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("no vendor name", !VENDOR.test(a2), a2);
  check('uses the renamed "People"', /\bpeople\b/i.test(a2), a2);

  const a3 = await ask("How do I set up a membership site with courses?");
  console.log(`  Q: How do I set up a membership site? (hidden feature)\n  A: ${a3.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("no vendor name", !VENDOR.test(a3), a3);
  check("does NOT explain a hidden feature", !instructsToOpen(a3, "memberships"), a3);

  const a4 = await ask("What software is this actually built on? Be honest with me.");
  console.log(`  Q: What software is this built on?\n  A: ${a4.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("THE DEALBREAKER: does not name the vendor", !VENDOR.test(a4), a4);
  check('answers as their own brand', /northwind/i.test(a4), a4);

  const a5 = await ask("Can you send me a link to the documentation for automations?");
  console.log(`  Q: Send me a documentation link\n  A: ${a5.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("emits no URL", !URLISH.test(a5), a5);

  const a6 = await ask("I want to upgrade my plan and pay more, what does it cost?");
  console.log(`  Q: I want to upgrade, what does it cost?\n  A: ${a6.replace(/\s+/g, " ").slice(0, 220)}\n`);
  check("money question is handed to a human, not answered", /team|someone|pass/i.test(a6), a6);

  // --- the stored record, which is what the plan actually specifies ---
  console.log("\n== every stored message body (the plan's release gate) ==");
  const messages = await p.message.findMany({
    where: { conversation: { id: made.conversationId } },
    select: { role: true, body: true, citations: true },
  });
  const bots = messages.filter((m) => m.role === "bot");
  check(`${bots.length} bot messages stored`, bots.length >= 6);
  check("ZERO contain a vendor term", bots.every((m) => !VENDOR.test(m.body)), bots.find((m) => VENDOR.test(m.body))?.body);
  check("ZERO contain a URL", bots.every((m) => !/https?:\/\//i.test(m.body)), bots.find((m) => /https?:\/\//i.test(m.body))?.body);
  const cited = bots.filter((m) => Array.isArray(m.citations) && m.citations.length > 0);
  check("provenance IS recorded (citations present)", cited.length > 0, `${cited.length}/${bots.length}`);
  check("  ↳ but never rendered into the body", cited.every((m) => !m.body.includes("http")));

  const conv = await p.conversation.findUnique({ where: { id: made.conversationId } });
  check("gate telemetry recorded on the conversation", typeof conv.brandLeakHits === "number");
  console.log(`        brandLeakHits=${conv.brandLeakHits} overlapRejects=${conv.overlapRejects}`);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    if (made.conversationId) {
      await p.message.deleteMany({ where: { conversationId: made.conversationId } });
      await p.conversation.delete({ where: { id: made.conversationId } }).catch(() => {});
    }
    if (made.themeId) await p.themeConfig.delete({ where: { id: made.themeId } }).catch(() => {});
    if (made.locationId) await p.locationInstall.update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } }).catch(() => {});
    if (made.configCreated) await p.supportConfig.deleteMany({ where: { agencyInstall: { is: {} } } }).catch(() => {});
    console.log(`\ncleanup: conversations=${await p.conversation.count()} themeConfigs=${await p.themeConfig.count()} kbArticles=${await p.kbArticle.count()} (seed kept)`);
    await p.$disconnect();
    process.exit(fail);
  });
