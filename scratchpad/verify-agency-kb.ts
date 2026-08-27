/**
 * The agency's own content, on the ticket — GET /desk/api/conversations/:id/agency-kb.
 *
 * A Mosaic agent answers for many brands in an afternoon and had no way to see what THIS
 * agency has written down. The bot has ranked their own articles above the shared corpus
 * since retrieval was built; the desk only ever saw the titles the bot happened to CITE,
 * and only on messages the bot answered — so on a ticket the bot got nothing for, which is
 * most of the ones that reach a human, the agent saw nothing at all.
 *
 * What is asserted here is not "the panel lists articles". It is the four ways this could
 * be worse than not shipping it:
 *   - one agency's content reaching another agency's ticket;
 *   - our own {{PLATFORM}} template syntax reaching an agent, which is neither a vendor
 *     name nor a link and so passes every gate on the way into a customer's chat;
 *   - a quarantined article — text we already believe names the vendor — being offered;
 *   - `sourceUrl` travelling, when "a link visible to a support rep is a link that gets
 *     pasted into a client reply".
 *
 * Throwaway agencies of its own, and a throwaway desk account: this writes KB rows, and
 * CLAUDE.md records both a suite leaving a real sub-account at version 30 and a harness
 * leaving a LIVE desk credential behind.
 *
 *   npx tsx scratchpad/verify-agency-kb.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
const p = new PrismaClient();
const STAMP = Date.now();

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail === undefined ? "" : "   " + String(detail).slice(0, 260)}`); }
};

const made: { agencies: string[]; deskEmail: string | null } = { agencies: [], deskEmail: null };
async function teardown(): Promise<void> {
  for (const id of made.agencies) {
    await p.kbArticle.deleteMany({ where: { agencyInstallId: id } }).catch(() => {});
    await p.message.deleteMany({ where: { conversation: { agencyInstallId: id } } }).catch(() => {});
    await p.conversation.deleteMany({ where: { agencyInstallId: id } }).catch(() => {});
    await p.supportConfig.deleteMany({ where: { agencyInstallId: id } }).catch(() => {});
    await p.locationInstall.deleteMany({ where: { agencyInstallId: id } }).catch(() => {});
    await p.agencyInstall.deleteMany({ where: { id } }).catch(() => {});
  }
  if (made.deskEmail) {
    const u = await p.deskUser.findUnique({ where: { email: made.deskEmail } }).catch(() => null);
    if (u) {
      await p.deskSession.deleteMany({ where: { deskUserId: u.id } }).catch(() => {});
      const n = await p.deskUser.deleteMany({ where: { id: u.id } }).catch(() => ({ count: -1 }));
      // Loud on failure: a leftover desk account is a live credential to every agency's
      // conversations, which is exactly why readiness now reports reserved test domains.
      if (n.count !== 1) console.error(`\n!! COULD NOT DELETE ${made.deskEmail} — delete it by hand.`);
    }
  }
  made.agencies = []; made.deskEmail = null;
  console.log("\ncleanup: throwaway agencies and desk account removed");
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { void teardown().then(() => process.exit(130)); });
}

let cookie = "";
async function desk(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-mosaic-desk": "1", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const txt = await r.text();
  let json: any = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, txt };
}

async function makeAgency(tag: string) {
  const a = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `agencykb-${tag}-${STAMP}`,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: `Agency ${tag}`,
    },
  });
  made.agencies.push(a.id);
  const loc = await p.locationInstall.create({
    data: { agencyInstallId: a.id, ghlLocationId: `agencykb-${tag}-${STAMP}`, status: "active", enabled: true, locationName: `Client ${tag}` },
  });
  return { agency: a, loc };
}

async function main(): Promise<void> {
  const A = await makeAgency("a");
  const B = await makeAgency("b");

  // Written through the ROUTE, so the real ingest pipeline placeholders them — a raw
  // Prisma insert would store the vendor name verbatim and the brand-rendering check
  // below would then be measuring the harness rather than the product.
  const write = (agencyId: string, title: string, body: string) =>
    fetch(`${BASE}/admin/api/${agencyId}/kb`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body }),
    }).then((r) => r.json());

  const own = await write(A.agency.id,
    "Refund steps in GoHighLevel",
    "Our team handles refunds ourselves rather than through GoHighLevel. Open Contacts, find the record, and tag it refund-requested. Wait for accounting before promising the client any date.");
  const neighbour = await write(B.agency.id,
    "Another agency private runbook",
    "This belongs to a different agency entirely and must never appear on somebody else's ticket. Open Contacts and check the escalation rota before acting on it.");

  check("agency A's article stored placeholdered", String(own.title).includes("{{PLATFORM}}"), own.title);
  check("agency B's article stored", !!neighbour.id, JSON.stringify(neighbour).slice(0, 120));

  // A quarantined article: the defanged scan catches a homoglyph the lexicon cannot replace.
  const held = await write(A.agency.id,
    "Held article about GoHighLeveI",
    "This mentions GoHighLeveI with a capital i, which survives normalisation, so the row is quarantined and retrieval skips it. Open Contacts to see the effect for yourself today.");
  const heldRow = await p.kbArticle.findUnique({ where: { id: held.id } }).catch(() => null);
  check("…and a homoglyph article is quarantined by the pipeline", heldRow?.status === "needs_review", heldRow?.status);

  const conv = await p.conversation.create({
    data: { agencyInstallId: A.agency.id, locationInstallId: A.loc.id, status: "escalated", queuedAt: new Date() },
  });

  console.log("\n== it needs a desk session ==");
  const anon = await fetch(`${BASE}/desk/api/conversations/${conv.id}/agency-kb`);
  check("refused without a session", anon.status === 401 || anon.status === 403, anon.status);

  made.deskEmail = `agencykb-${STAMP}@mosaic.test`;
  const pw = randomBytes(18).toString("base64url");
  execFileSync("npx", ["tsx", "apps/server/src/scripts/createDeskUser.ts",
    "--email", made.deskEmail, "--name", "KB Probe", "--role", "mosaic_admin", "--password", pw],
    { stdio: "pipe" });
  const login = await desk("POST", "/desk/api/login", { email: made.deskEmail, password: pw });
  if (login.status === 429) throw new Error("rate-limited by /desk/api/login (10/min per IP) — another desk suite ran in the same minute. Wait one and re-run.");
  check("signed in", login.status === 200, login.status);

  console.log("\n== the agency's own content, rendered for this client ==");
  const r = await desk("GET", `/desk/api/conversations/${conv.id}/agency-kb`);
  check("the route answers", r.status === 200, r.txt.slice(0, 120));
  const blob = JSON.stringify(r.json ?? {});
  const titles: string[] = (r.json?.articles ?? []).map((a: any) => a.title);

  check("agency A's own article is listed", titles.some((t) => /Refund steps/.test(t)), titles.join(" | "));
  check("NO raw {{ }} template syntax reaches the agent", !blob.includes("{{"), blob.match(/.{0,40}\{\{.{0,30}/)?.[0]);
  check("…the vendor name is gone from titles AND bodies", !/gohighlevel/i.test(blob), blob.match(/.{0,40}[Gg]o[Hh]igh.{0,20}/)?.[0]);
  check("no sourceUrl travels", !blob.includes("sourceUrl") && !blob.includes("mosaic:kb/"), blob.slice(0, 120));
  check("no link of any kind", !/https?:\/\//.test(blob));

  console.log("\n== containment ==");
  check("the OTHER agency's article is absent", !titles.some((t) => /private runbook/i.test(t)) && !/private runbook/i.test(blob), titles.join(" | "));
  check(
    "…and the shared corpus is not dumped in",
    (r.json?.articles ?? []).length <= 2,
    `${(r.json?.articles ?? []).length} articles — the shared corpus is ~1,500`
  );

  console.log("\n== what is NOT shown is stated, not silent ==");
  check("the quarantined article is withheld", !titles.some((t) => /Held article/i.test(t)), titles.join(" | "));
  check("…and COUNTED, so an empty panel is never ambiguous", r.json?.heldForReview === 1, r.json?.heldForReview);
  check("not truncated at this size", r.json?.truncated === false, r.json?.truncated);

  console.log("\n== an agent cannot reach a ticket that is not there ==");
  const missing = await desk("GET", `/desk/api/conversations/does-not-exist-${STAMP}/agency-kb`);
  check("404 for an unknown conversation", missing.status === 404, missing.status);

  console.log("\n== agency B's ticket sees only agency B's ==");
  const convB = await p.conversation.create({
    data: { agencyInstallId: B.agency.id, locationInstallId: B.loc.id, status: "escalated", queuedAt: new Date() },
  });
  const rb = await desk("GET", `/desk/api/conversations/${convB.id}/agency-kb`);
  const titlesB: string[] = (rb.json?.articles ?? []).map((a: any) => a.title);
  check("B's own article is listed on B's ticket", titlesB.some((t) => /private runbook/i.test(t)), titlesB.join(" | "));
  check("…and A's is not", !titlesB.some((t) => /Refund steps/i.test(t)), titlesB.join(" | "));
  // The control: the scoping is by the CONVERSATION, so the same agent sees different
  // content on the two tickets. A route that ignored scoping would pass the A checks alone.
  check("the same agent got different content on the two tickets",
    JSON.stringify(titles) !== JSON.stringify(titlesB), `${titles.join(",")} vs ${titlesB.join(",")}`);
}

main()
  .catch((e) => { fail++; console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    await teardown();
    await p.$disconnect();
    console.log(`\n${"-".repeat(60)}\n  ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
