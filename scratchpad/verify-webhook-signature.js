/**
 * Webhook signature verification — the half that ONLY runs in production.
 *
 * Local dev has no WEBHOOK_SIGNATURE_PUBLIC_KEY, so the route takes its fail-open branch
 * and this code has never executed on this machine. In production env.ts refuses to boot
 * without the key, so it executes on every single delivery and has never been tested.
 *
 * The property being proved is not just "a bad signature is rejected". It is that
 * rejection happens BEFORE any database write: the route creates the WebhookEvent audit
 * row as its second act, so a flood of forged deliveries must not be able to write rows.
 *
 * Boots its own server on 3211 with a keypair generated here, so nothing about the dev
 * instance or the real app's key is involved.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const crypto = require("crypto");
const { spawn } = require("child_process");
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: DATABASE_URL must be localhost.");
  process.exit(1);
}

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const APP_ID = (process.env.GHL_APP_CLIENT_ID ?? "").split("-")[0];
const TAG = `sig${Date.now().toString(36)}`;

const p = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    console.log(`  ok    ${n}`);
    pass++;
  } else {
    console.log(`  FAIL  ${n}`);
    if (d !== undefined) console.log(`        ${String(d).slice(0, 250)}`);
    fail++;
  }
};

// A keypair standing in for GHL's. The private half never leaves this process.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const { privateKey: otherPrivate } = crypto.generateKeyPairSync("ed25519");

/**
 * The middleware verifies against `JSON.stringify(req.body)` — the RE-serialised parsed
 * body, not the raw bytes. So the signed string has to be the exact string we send, which
 * it is: V8 preserves insertion order for non-numeric keys through a parse/stringify
 * round trip.
 */
function sign(bodyString, key) {
  return crypto.sign(null, Buffer.from(bodyString, "utf8"), key).toString("base64");
}

async function post(body, headers = {}) {
  const res = await fetch(`${BASE}/webhooks/ghl`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForBoot(ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

(async () => {
  if (!APP_ID) throw new Error("GHL_APP_CLIENT_ID is not set");

  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: `${ROOT}/apps/server`,
    env: {
      ...process.env,
      PORT: String(PORT),
      // Local origin, or env.ts demands the full production posture.
      APP_PUBLIC_URL: "https://localhost:3211",
      SUPPORT_DESK_URL: "http://localhost:5174",
      WEBHOOK_SIGNATURE_PUBLIC_KEY: publicPem,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(d.toString()));
  child.stderr.on("data", (d) => log.push(d.toString()));

  let agencyId = null;
  try {
    if (!(await waitForBoot())) {
      console.error(log.join("").slice(-2000));
      throw new Error("server did not boot on 3211");
    }

    const agency = await p.agencyInstall.create({
      data: {
        ghlCompanyId: `co_${TAG}`,
        companyName: "Signature Test Agency",
        accessTokenEnc: "not-a-real-token",
        refreshTokenEnc: "not-a-real-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        status: "active",
      },
    });
    agencyId = agency.id;

    const eventsFor = (id) => p.webhookEvent.count({ where: { ghlEventId: id } });

    console.log("\n== a correctly signed webhook is processed ==");
    const goodId = `evt_${TAG}_good`;
    const goodBody = JSON.stringify({
      type: "UNINSTALL",
      appId: APP_ID,
      webhookId: goodId,
      companyId: `co_${TAG}`,
    });
    const good = await post(goodBody, { "x-ghl-signature": sign(goodBody, privateKey) });
    check("accepted", good.status === 200 && good.json?.success === true, JSON.stringify(good.json));
    check("the lifecycle actually ran", (await p.agencyInstall.findUnique({ where: { id: agency.id } }))?.status === "uninstalled");
    check("and it was audited", (await eventsFor(goodId)) === 1);

    console.log("\n== an UNSIGNED webhook is refused ==");
    // This is the forged-uninstall case: no header at all, which is what an attacker who
    // knows only the public agencyInstallId can send.
    await p.agencyInstall.update({ where: { id: agency.id }, data: { status: "active" } });
    const bareId = `evt_${TAG}_bare`;
    const bare = await post(
      JSON.stringify({ type: "UNINSTALL", appId: APP_ID, webhookId: bareId, companyId: `co_${TAG}` })
    );
    check("401, not 200", bare.status === 401, `${bare.status} ${JSON.stringify(bare.json)}`);
    check("the agency is untouched", (await p.agencyInstall.findUnique({ where: { id: agency.id } }))?.status === "active");
    check("NO audit row was written — rejection precedes the first DB write", (await eventsFor(bareId)) === 0);

    console.log("\n== a signature from the WRONG key is refused ==");
    const wrongId = `evt_${TAG}_wrong`;
    const wrongBody = JSON.stringify({ type: "UNINSTALL", appId: APP_ID, webhookId: wrongId, companyId: `co_${TAG}` });
    const wrong = await post(wrongBody, { "x-ghl-signature": sign(wrongBody, otherPrivate) });
    check("401", wrong.status === 401, wrong.status);
    check("the agency is untouched", (await p.agencyInstall.findUnique({ where: { id: agency.id } }))?.status === "active");
    check("no audit row", (await eventsFor(wrongId)) === 0);

    console.log("\n== a body TAMPERED after signing is refused ==");
    // Sign a harmless event, then swap the payload for an uninstall — the replay an
    // attacker with a captured signature would attempt.
    const tamperId = `evt_${TAG}_tamper`;
    const signedBody = JSON.stringify({ type: "ContactCreate", appId: APP_ID, webhookId: tamperId, companyId: `co_${TAG}` });
    const sig = sign(signedBody, privateKey);
    const swapped = JSON.stringify({ type: "UNINSTALL", appId: APP_ID, webhookId: tamperId, companyId: `co_${TAG}` });
    const tampered = await post(swapped, { "x-ghl-signature": sig });
    check("401", tampered.status === 401, tampered.status);
    check("the agency is untouched", (await p.agencyInstall.findUnique({ where: { id: agency.id } }))?.status === "active");
    check("no audit row", (await eventsFor(tamperId)) === 0);

    console.log("\n== a webhook for a DIFFERENT app is refused, not silently accepted ==");
    // The SDK returns next() early on an appId mismatch WITHOUT setting isSignatureValid,
    // so it arrives at our route as `undefined`. That must read as "not verified".
    const otherAppId = `evt_${TAG}_otherapp`;
    const otherBody = JSON.stringify({ type: "UNINSTALL", appId: "someone-elses-app", webhookId: otherAppId, companyId: `co_${TAG}` });
    const otherApp = await post(otherBody, { "x-ghl-signature": sign(otherBody, privateKey) });
    check("401 — an unset verification flag is not a pass", otherApp.status === 401, otherApp.status);
    check("the agency is untouched", (await p.agencyInstall.findUnique({ where: { id: agency.id } }))?.status === "active");
    check("no audit row", (await eventsFor(otherAppId)) === 0);

    console.log("\n== the legacy x-wh-signature header alone is not enough ==");
    const legacyId = `evt_${TAG}_legacy`;
    const legacyBody = JSON.stringify({ type: "UNINSTALL", appId: APP_ID, webhookId: legacyId, companyId: `co_${TAG}` });
    const legacy = await post(legacyBody, { "x-wh-signature": "AAAA" });
    check("401 — WEBHOOK_PUBLIC_KEY is unset, so this path cannot verify", legacy.status === 401, legacy.status);
    check("no audit row", (await eventsFor(legacyId)) === 0);
  } finally {
    if (agencyId) {
      await p.webhookEvent.deleteMany({ where: { ghlEventId: { startsWith: `evt_${TAG}_` } } });
      await p.locationInstall.deleteMany({ where: { agencyInstallId: agencyId } });
      await p.agencyInstall.deleteMany({ where: { id: agencyId } });
    }
    child.kill("SIGTERM");
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.$disconnect();
  process.exit(1);
});
