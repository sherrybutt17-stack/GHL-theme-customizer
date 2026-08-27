const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();

// Snapshot every support policy before anything is written, so cleanup can put them back.
let __configsBefore = null;
const BASE = "http://localhost:3210";
(async () => {
  __configsBefore = await p.supportConfig.findMany();
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const loc = await p.locationInstall.findFirst({ where: { agencyInstallId: agency.id, status: "active" }, select: { id: true, ghlLocationId: true, supportEnabled: true } });
  // Snapshotted, never assumed — see the note in verify-e2e.js. Hardcoding false withdraws
  // the client-facing widget from a real sub-account the run did not own.
  const supportWas = loc.supportEnabled;
  const t = await p.themeConfig.create({ data: { locationInstallId: loc.id, brandName: "Northwind Hub", menuLabelOverrides: { opportunities: "Leads" }, version: 9900 } });
  await p.supportConfig.upsert({ where: { agencyInstallId: agency.id }, update: { enabled: true, escalationEmails: ["o@a.test"] }, create: { agencyInstallId: agency.id, enabled: true, escalationEmails: ["o@a.test"] } });
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: true } });
  const j = (m, b, tok) => ({ method: m, headers: { "Content-Type": "application/json", ...(tok ? { "x-mosaic-conversation": tok } : {}) }, body: JSON.stringify(b) });
  const c = await (await fetch(`${BASE}/support/api/${agency.id}/${loc.ghlLocationId}/conversation`, j("POST", {}))).json();
  const r = await (await fetch(`${BASE}/support/api/${agency.id}/${loc.ghlLocationId}/conversation/${c.conversationId}/message`, j("POST", { text: "How do I create a pipeline?" }, c.token))).json();
  console.log("FULL ANSWER:\n" + r.reply);
  console.log("\ncapitalised nav label present?", /\bOpportunit(y|ies)\b/.test(r.reply));
  console.log("lowercase common noun present?", /\bopportunit(y|ies)\b/.test(r.reply));
  await p.message.deleteMany({ where: { conversationId: c.conversationId } });
  await p.conversation.delete({ where: { id: c.conversationId } });
  await p.themeConfig.delete({ where: { id: t.id } });
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
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: supportWas } });
  await p.$disconnect();
})();
