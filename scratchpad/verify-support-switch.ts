/**
 * The agency's MASTER support switch, and whether a missing key can turn it off.
 *
 * `PUT /admin/api/:agency/support` is whole-object: every field the body omits is
 * deleted. CLAUDE.md accepts that contract and states the mitigation — the GET must return
 * everything, which `serialiseSupportConfig` now guarantees. One field is not like the
 * others, and it is the one that decides whether a client-facing product runs:
 *
 *   the per-sub-account twin   `supportEnabled`  REFUSES a non-boolean (fixed 2026-08-22)
 *   the agency master switch   `enabled`         `!!body.enabled`
 *
 * Two switches on one product with opposite contracts, and the sharper one is unguarded:
 * it gates support for EVERY sub-account, not one. It has already cost something — this
 * file records `verify-sla-input`'s cleanup PUTting back the GET's ENVELOPE
 * (`{config, locationsEnabled, locationsTotal}`) instead of the bare config, at which point
 * "the route, being whole-object, saw no `enabled` and no `escalationEmails` and deleted
 * them". The harness was fixed; the route was not.
 *
 * Throwaway agency of its own, because this writes a support policy and CLAUDE.md records
 * six suites destroying a real agency's by doing exactly that.
 *
 *   npx tsx scratchpad/verify-support-switch.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This writes and deletes rows.");
  process.exit(1);
}
const p = new PrismaClient();

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

const stamp = Date.now();
const made = { agencyId: "" };
async function teardown(): Promise<void> {
  if (!made.agencyId) return;
  await p.supportConfig.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
  await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  console.log("\ncleanup: throwaway agency removed");
  made.agencyId = "";
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig as any, () => { teardown().finally(() => process.exit(130)); });
}

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}/admin/api/${made.agencyId}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}
const getConfig = async () => (await api("GET", "/support")).json;

/** The whole policy an agency has actually configured. */
const POLICY = {
  enabled: true,
  escalationEmails: ["owner@theagency.test"],
  greeting: "Hi! Ask me anything about your dashboard.",
  forbiddenTerms: ["competitorco"],
  allowedLinkDomains: ["theagency.test"],
  supportBoundary: "how_to_only",
  boundaryNotes: "Do not discuss their invoice.",
  quickActions: ["How do I add a contact?"],
  voiceTone: "friendly",
  userNoun: "client",
  planTiers: {},
  slaFirstResponseMins: { urgent: 15, high: 60, normal: 240, low: 480 },
  businessHours: { tz: "Europe/London", days: { mon: [9, 17], tue: [9, 17], wed: null, thu: null, fri: null, sat: null, sun: null } },
};

/** What survives, in the terms an agency would recognise. */
function describe(c: any) {
  return {
    enabled: c?.enabled,
    escalationEmails: c?.escalationEmails?.length ?? 0,
    greeting: c?.greeting ? "kept" : "GONE",
    forbiddenTerms: c?.forbiddenTerms?.length ?? 0,
    businessHours: c?.businessHours ? "kept" : "GONE",
  };
}

async function main(): Promise<void> {
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "switch-" + stamp,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Support Switch Probe",
    },
  });
  made.agencyId = agency.id;
  await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id, ghlLocationId: "switch-loc-" + stamp,
      status: "active", enabled: true, supportEnabled: true, locationName: "190 Ranch",
    },
  });

  console.log("== the agency configures support ==");
  const saved = await api("PUT", "/support", POLICY);
  check("the policy saved", saved.status === 200, `${saved.status} ${JSON.stringify(saved.json).slice(0, 200)}`);
  const before = (await getConfig()).config;
  check("support is ON", before.enabled === true);
  check("…with an escalation address, a greeting, a blocked term and hours",
    before.escalationEmails.length === 1 && !!before.greeting && before.forbiddenTerms.length === 1 && !!before.businessHours,
    JSON.stringify(describe(before)));

  /**
   * The exact mistake already recorded: the GET answers an ENVELOPE and the PUT takes the
   * bare config, so a caller that round-trips what it was handed sends a body with no
   * top-level `enabled` and no `escalationEmails` at all.
   */
  console.log("\n== a body that never mentions the switch ==");
  const envelope = await getConfig();
  const res = await api("PUT", "/support", envelope);
  const afterEnvelope = (await getConfig()).config;
  console.log(`  the route answered ${res.status}; the agency's policy now reads ${JSON.stringify(describe(afterEnvelope))}`);
  check(
    "a body with no `enabled` key is REFUSED, not read as 'switch it off'",
    res.status === 400,
    `answered ${res.status} — and support is now ${afterEnvelope.enabled ? "on" : "OFF"}`
  );
  check("…and nothing was written", afterEnvelope.enabled === true, JSON.stringify(describe(afterEnvelope)));
  check("…so the escalation address survives too", afterEnvelope.escalationEmails.length === 1, JSON.stringify(afterEnvelope.escalationEmails));
  check("…and the greeting, the blocked term and the hours",
    !!afterEnvelope.greeting && afterEnvelope.forbiddenTerms.length === 1 && !!afterEnvelope.businessHours,
    JSON.stringify(describe(afterEnvelope)));

  console.log("\n== other shapes that are not a decision ==");
  for (const [label, value] of [
    ["the string \"true\"", "true"],
    ["the string \"false\"", "false"],
    ["a number", 1],
    ["null", null],
  ] as const) {
    const r = await api("PUT", "/support", { ...POLICY, enabled: value });
    const now = (await getConfig()).config;
    check(`${label} is refused`, r.status === 400, `answered ${r.status}`);
    check(`…and left support on`, now.enabled === true, `enabled=${now.enabled}`);
  }

  /**
   * The control every guard here carries: a refusal that blocks the feature is not a fix.
   * Turning support off on purpose must still work, and turning it on must still demand
   * somewhere for a tier-3 hand-off to land.
   */
  console.log("\n== …and a real decision still goes through ==");
  const off = await api("PUT", "/support", { ...POLICY, enabled: false });
  check("an explicit `false` turns it off", off.status === 200 && (await getConfig()).config.enabled === false, off.status);
  const on = await api("PUT", "/support", POLICY);
  check("…and an explicit `true` turns it back on", on.status === 200 && (await getConfig()).config.enabled === true, on.status);
  const noAddress = await api("PUT", "/support", { ...POLICY, escalationEmails: [] });
  check("turning it on with nowhere to escalate is still refused", noAddress.status === 400, noAddress.status);
  check("…and that refusal did not switch anything off", (await getConfig()).config.enabled === true);

  /**
   * The twin, stated as the contrast that motivates all of this: the per-sub-account
   * switch has refused a non-boolean since 2026-08-22.
   */
  console.log("\n== the per-sub-account twin, for contrast ==");
  const loc = await p.locationInstall.findFirst({ where: { agencyInstallId: made.agencyId } });
  const locNoKey = await api("PUT", `/locations/${loc!.id}/support`, { enabled: true });
  check("it refuses a body with no `supportEnabled`", locNoKey.status === 400, locNoKey.status);
  const stillOn = await p.locationInstall.findUnique({ where: { id: loc!.id }, select: { supportEnabled: true } });
  check("…and the sub-account is still switched on", stillOn?.supportEnabled === true, stillOn?.supportEnabled);
}

main()
  .catch((e) => { console.error("\nFATAL", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown failed", e));
    await p.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
