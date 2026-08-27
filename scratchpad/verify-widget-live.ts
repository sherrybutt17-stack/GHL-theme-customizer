/**
 * The client's side of a conversation, RENDERED — not stubbed, not asserted over HTTP.
 *
 * `shoot-widget.mjs` loads the real pasted snippet and stops at the opened panel: bubble,
 * header, greeting, composer. Everything that happens AFTER the client types has only ever
 * been checked two ways, and neither of them is a browser:
 *
 *   `verify-delivery` (23) drives `/updates` over HTTP — which is exactly the suite that
 *   was 23/23 green while the widget never called the endpoint under test.
 *   `verify-widget-poll` (18) executes the snippet against a DOM STUB and a virtual clock,
 *   so it can prove a request was made and nothing about what anybody sees.
 *
 * So these claims had never been looked at:
 *
 *   - an agent's reply is styled EXACTLY like the assistant's. `addMessage` says why —
 *     "from the client's side this is all the platform's support, and a visible seam
 *     invites 'so I WAS talking to a robot', which is the one conversation the white label
 *     cannot have". That is a statement about pixels, in generated code.
 *   - internal notes, transfers and hand-offs live in the SAME Message table as the
 *     transcript and carry Mosaic staff names. `CLIENT_VISIBLE_ROLES` filters them; one
 *     missing filter puts our workflow in a customer's chat.
 *   - the thread survives a reload, and a restored widget must not replay internal rows
 *     into the window either.
 *
 * The escalation is triggered through `FRUSTRATION_RE`, which is matched BEFORE the model
 * runs — so this suite is deterministic and costs no model call, while still going through
 * the real route, the real gates and the real poller.
 *
 * SWITCHES: the widget needs BOTH the agency master switch and the sub-account toggle. This
 * turns the sub-account on THROUGH THE ROUTE (a raw write would not invalidate the brand-map
 * cache) and puts back the value it found — nine suites once left a real client's widget
 * switched off by hardcoding `false` here.
 *
 *   1. npm run dev:server  (3210, APP_PUBLIC_URL=https://localhost:3210)
 *   2. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1280,900
 *   3. npx tsx scratchpad/verify-widget-live.ts <agencyInstallId> <ghlLocationId> [out-dir]
 */
import "../apps/server/src/services/loadEnv";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../apps/server/src/services/prisma";

const [, , AGENCY, LOCATION, SHOTS] = process.argv;
if (!AGENCY || !LOCATION) {
  console.error("usage: npx tsx scratchpad/verify-widget-live.ts <agencyInstallId> <ghlLocationId> [out-dir]");
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}

const API = "http://localhost:3210";
const PORT = 4601;
const STAMP = Date.now();
const PW = "a perfectly fine passphrase";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}
const hashPassword = (pw: string) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
};

async function pageTarget(): Promise<any> {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = (list as any[]).find((t) => t.type === "page");
  if (found) return found;
  return await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
}
let ws: WebSocket;
let msgId = 0;
/** Every /updates response, so "did the widget poll" is a measurement rather than a guess. */
const wire: string[] = [];
const pending = new Map<number, (m: any) => void>();
async function connect(): Promise<void> {
  const page = await pageTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r as any));
  ws.onmessage = (e: any) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
    if (m.method === "Network.responseReceived" && /\/updates/.test(m.params.response.url)) {
      wire.push(`${m.params.response.status} ${m.params.response.url.split("/conversation/")[1] ?? ""}`);
    }
  };
}
const send = (method: string, params: any = {}) =>
  new Promise<any>((res, rej) => {
    const n = ++msgId;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Everything is inside a SHADOW ROOT — non-negotiable, or Mosaic's own !important theme CSS
 * would style Mosaic's own widget. A plain `document.querySelector` finds nothing here and
 * reads exactly like a widget that never rendered.
 *
 * `\s` is doubled: inside a template literal it otherwise collapses to `s` and silently eats
 * every "s" out of the text being normalised.
 */
const HELP = `
  const h=[...document.querySelectorAll("*")].find(e=>e.shadowRoot);
  const R=h&&h.shadowRoot;
  const flat=(e)=>((e&&e.textContent)||"").replace(/\\s+/g," ").trim();
  const rows=()=>R?[...R.querySelectorAll(".msg")]:[];
  const shape=(m)=>{const b=m.querySelector(".bub"),cs=getComputedStyle(b);
    return {cls:m.className, text:flat(b).slice(0,120),
            bg:cs.backgroundColor, border:cs.borderColor, radius:cs.borderBottomLeftRadius+"/"+cs.borderBottomRightRadius,
            color:cs.color, align:getComputedStyle(m).justifyContent};};
  const transcript=()=>rows().map(shape);
`;
async function ev(body: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression: `(()=>{${HELP}${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
}

/** Desk auth: a real sign-in, because the reply must go through the real gates. */
const jar = { cookie: "" };
async function desk(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", "x-mosaic-desk": "1", ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

let server: ReturnType<typeof createServer> | null = null;
let locationRowId: string | null = null;
let supportWas: boolean | null = null;
const madeUsers: string[] = [];
let tornDown = false;

async function teardown(reason: string): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  // The sub-account toggle goes back to what it WAS. `false` is not a safe default: it is
  // the off position of the agency's own client-facing switch.
  if (locationRowId && supportWas !== null) {
    await fetch(`${API}/admin/api/${AGENCY}/locations/${locationRowId}/support`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supportEnabled: supportWas }),
    }).catch(() => {});
  }
  const convs = await prisma.conversation.findMany({
    where: { locationInstall: { ghlLocationId: LOCATION }, startedAt: { gte: new Date(STAMP - 60_000) } },
    select: { id: true },
  }).catch(() => [] as { id: string }[]);
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } }).catch(() => {});
  await prisma.deskSession.deleteMany({ where: { deskUserId: { in: madeUsers } } }).catch(() => {});
  await prisma.deskUser.deleteMany({ where: { id: { in: madeUsers } } }).catch(() => {});
  server?.close();
  console.log(
    `cleanup (${reason}): sub-account support restored to ${supportWas}, ` +
      `${convs.length} conversation(s) and ${madeUsers.length} desk user(s) removed`
  );
  await prisma.$disconnect().catch(() => {});
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => { void teardown(sig).then(() => process.exit(130)); });
}

const NOTE = `[internal] check their billing before replying NOTE${STAMP}`;
const AGENT_REPLY = `I have looked at your account and the import is running now. AGENT${STAMP}`;

async function main(): Promise<void> {
  await connect();

  const loc = await prisma.locationInstall.findFirst({
    where: { ghlLocationId: LOCATION, status: "active" },
    select: { id: true, supportEnabled: true, locationName: true },
  });
  if (!loc) throw new Error(`no active LocationInstall for ${LOCATION}`);
  locationRowId = loc.id;
  supportWas = loc.supportEnabled;
  console.log(`\nsub-account ${loc.locationName}: support was ${supportWas} — restored to that at the end`);

  const on = await fetch(`${API}/admin/api/${AGENCY}/locations/${loc.id}/support`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supportEnabled: true }),
  });
  check("the sub-account switch goes on through the ROUTE", on.ok, on.status);

  const agent = await prisma.deskUser.create({
    data: { email: `widget-agent-${STAMP}@mosaic.test`, name: "Ada Agent", passwordHash: hashPassword(PW), role: "mosaic_agent" },
  });
  madeUsers.push(agent.id);

  console.log("\n== load the REAL paste ==");
  const embed = await (await fetch(`${API}/admin/api/${AGENCY}/embed`)).json();
  const RAW: string = embed.jsSnippet;
  const snippet = RAW.split("https://localhost:3210").join("http://localhost:3210");
  const rewrites = RAW.split("https://localhost:3210").length - 1;
  /**
   * The one edit made to the real paste, and it is a local-dev artefact: `env.ts` requires
   * APP_PUBLIC_URL to be https even locally while the dev server speaks http. Asserted to
   * touch the scheme and nothing else — otherwise this renders something that is not what
   * the agency pastes, which is the drift the harness page was retired for.
   */
  check(
    `the origin rewrite changes only the scheme (${rewrites} occurrence(s), ${RAW.length} bytes)`,
    snippet.length === RAW.length - rewrites
  );

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mock sub-account</title>
<style>body{margin:0;font:14px/1.5 system-ui;background:#f6f7fb;height:100vh}.pad{padding:28px;color:#334155}</style>
</head><body><div class="pad"><h2>Sub-account dashboard (mock)</h2>
<p>Standing in for the CRM page the widget is pasted into.</p></div>
<script>${snippet}</script></body></html>`;
  server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
  await new Promise<void>((r) => server!.listen(PORT, r));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/v2/location/${LOCATION}/dashboard` });
  await sleep(4000);

  check("the widget builds a shadow root", (await ev(`return !!R;`)) === true, "nothing rendered — is support on at BOTH levels?");
  await ev(`R.querySelector(".bubble").click(); return 1;`);
  await sleep(1500);
  check("the panel opens with a composer", (await ev(`return !!R.querySelector(".ft textarea")`)) === true);
  await shot("live-01-open");

  console.log("\n== the client asks for a person ==");
  /**
   * `FRUSTRATION_RE` is matched BEFORE the model runs, so this is deterministic and costs
   * no model call while still going through the real route.
   */
  await ev(`
    const t=R.querySelector(".ft textarea");
    const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;
    t.focus(); s.call(t,"I want to speak to a real person please"); t.dispatchEvent(new Event("input",{bubbles:true}));
    return 1;`);
  await sleep(300);
  await ev(`
    const t=R.querySelector(".ft textarea");
    t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    const b=R.querySelector(".ft button"); if(b) b.click();
    return 1;`);
  await sleep(4500);

  const afterSend = await ev(`return transcript();`);
  console.log("  transcript: " + JSON.stringify(afterSend, null, 1).slice(0, 900));
  const mine = afterSend?.find((m: any) => /real person/i.test(m.text));
  check("the client's own message is on screen", !!mine, JSON.stringify(afterSend?.map((m: any) => m.text)));
  check("  ↳ and is styled as theirs (msg u)", /\bu\b/.test(mine?.cls ?? ""), mine?.cls);
  /**
   * The ANSWER, by its words — not "some bubble that is not the client's".
   *
   * Written the loose way first, and it passed on a run where the conversation POST had
   * been rate-limited and the panel read "Sorry - something went wrong on my end": the
   * greeting is a bot bubble too, so "a bot row exists" is true before anybody has said
   * anything. `FRUSTRATION_RE` is matched before the model runs, so the sentence is fixed
   * and can be asserted exactly.
   */
  const botRow = afterSend?.find((m: any) => /someone from the team/i.test(m.text));
  check("the assistant answers, in the words the shortcut guarantees", !!botRow, JSON.stringify(afterSend?.map((m: any) => m.text)));

  const conv = await prisma.conversation.findFirst({
    where: { locationInstall: { ghlLocationId: LOCATION } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, queuedAt: true, accessTokenHash: true },
  });
  /**
   * Every /support/api route shares ONE limiter of 60 requests a minute PER IP — the same
   * budget the chat spends sending messages — so back-to-back runs of this suite starve
   * each other and the widget renders "something went wrong on my end". That reads like a
   * broken bot. Name it here rather than assert against it, the same principle as
   * verify-session throwing on a 429 instead of testing the error body.
   */
  if (!conv) {
    throw new Error(
      "no conversation was created — the widget could not reach /support/api. All of those " +
        "routes share 60 req/min per IP, so give it a minute between runs of this suite."
    );
  }
  check("the conversation reached the human queue", conv.status === "escalated" && !!conv.queuedAt, JSON.stringify(conv));
  await shot("live-02-escalated");

  console.log("\n== an agent replies, and writes an internal note ==");
  const login = await desk("POST", "/desk/api/login", { email: agent.email, password: PW });
  if (login.status === 429) throw new Error("rate-limited on /desk/api/login — another desk suite ran within the minute");
  check("the agent signs in to the desk", login.status === 200, login.status);
  const claimed = await desk("POST", `/desk/api/conversations/${conv.id}/assign`, { userId: agent.id });
  check("  ↳ and claims the ticket", claimed.status === 200, JSON.stringify(claimed.json));

  const noteRes = await desk("POST", `/desk/api/conversations/${conv.id}/reply`, {
    text: `check their billing before replying NOTE${STAMP}`, internal: true,
  });
  check("an internal note is accepted", noteRes.status < 300, `${noteRes.status} ${JSON.stringify(noteRes.json)}`);
  const replyRes = await desk("POST", `/desk/api/conversations/${conv.id}/reply`, { text: AGENT_REPLY });
  check("the agent's reply passes the gates", replyRes.status < 300, `${replyRes.status} ${JSON.stringify(replyRes.json)}`);

  console.log("\n== …and the client's window catches up on its own ==");
  /**
   * The poller widens 15s -> 60s and resets on activity, so this waits rather than nudging:
   * the point is that the WIDGET fetches, not that a driver can make it.
   */
  let arrived = false;
  for (let i = 0; i < 14; i++) {
    await sleep(2500);
    if (await ev(`return transcript().some(m=>m.text.indexOf("AGENT${STAMP}")>=0);`)) { arrived = true; break; }
  }
  check("the agent's reply reaches the client", arrived, "no /updates delivery in 35s");

  const finalRows = await ev(`return transcript();`);
  const agentRow = finalRows?.find((m: any) => m.text.includes(`AGENT${STAMP}`));
  const anyBot = finalRows?.find((m: any) => m !== agentRow && / b$| b /.test(m.cls) && !/real person/i.test(m.text));
  console.log("  agent row: " + JSON.stringify(agentRow));
  console.log("  bot row:   " + JSON.stringify(anyBot));
  check(
    "  ↳ styled EXACTLY like the assistant's — no visible seam",
    !!agentRow && !!anyBot &&
      agentRow.cls === anyBot.cls && agentRow.bg === anyBot.bg &&
      agentRow.border === anyBot.border && agentRow.color === anyBot.color && agentRow.radius === anyBot.radius,
    JSON.stringify({ agent: agentRow, bot: anyBot })
  );

  const leaked = await ev(`return R.innerHTML;`);
  check(`  ↳ the internal note is NOT delivered`, !String(leaked).includes(`NOTE${STAMP}`), "an internal note is in the client's chat");
  check("  ↳ no Mosaic staff name is anywhere in the panel", !/Ada Agent/.test(String(leaked)));
  check("  ↳ still zero vendor names", !/gohighlevel|highlevel|lead ?connector|msgsndr/i.test(String(leaked)));
  check("  ↳ still zero links out", (await ev(`return [...R.querySelectorAll("a[href]")].length`)) === 0);
  await shot("live-03-agent-reply");

  console.log("\n== a reload must restore the thread, and only the client's half of it ==");
  const beforeReload = await ev(`
    const out={}; for (let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); out[k]=String(sessionStorage.getItem(k)).slice(0,70);} return out;`);
  console.log("  sessionStorage BEFORE the reload: " + JSON.stringify(beforeReload));
  check(
    "the widget remembered the thread while the tab was open",
    Object.keys(beforeReload ?? {}).some((k) => k.indexOf("mosaic_support_thread_") === 0),
    JSON.stringify(beforeReload)
  );
  wire.length = 0;
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/v2/location/${LOCATION}/dashboard` });
  await sleep(4000);
  /**
   * THE point of building the panel at boot, and the property the first draft could not
   * see. `addMessage` appends to `state.els.body`, which does not exist until the client
   * clicks the bubble — so a restore at boot threw, and the retry-on-open path quietly
   * covered for it. What it cannot cover is this: the throw also stops the poller, so a
   * reply sent while the widget is CLOSED never arrives. A client who reloads and leaves
   * the bubble alone is the ordinary case, not an edge of one.
   */
  // The poller schedules a short first tick after a restore; give it well past that.
  await sleep(6000);
  console.log(`  /updates responses since the reload, panel never opened: ${JSON.stringify(wire)}`);
  check(
    "the widget goes on polling after a reload without being opened",
    wire.some((w) => w.startsWith("200") && !w.includes("replay=1")),
    `only these: ${JSON.stringify(wire)} — a reply sent while the panel is closed would never arrive`
  );

  const stored = await ev(`
    const out={}; for (let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); out[k]=String(sessionStorage.getItem(k)).slice(0,60);} return out;`);
  console.log("  sessionStorage after the reload: " + JSON.stringify(stored));
  await ev(`R.querySelector(".bubble").click(); return 1;`);
  // Restoring is a network round trip, so poll rather than guessing a sleep — a fixed wait
  // that is slightly too short reports a missing thread that was merely late.
  let restored: string[] = [];
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    restored = (await ev(`return transcript().map(m=>m.text);`)) ?? [];
    if (restored.length > 1) break;
  }
  console.log("  restored: " + JSON.stringify(restored));
  check("the client's own question comes back", (restored ?? []).some((t: string) => /real person/i.test(t)), JSON.stringify(restored));
  check(
    "  ↳ and the agent's reply with it",
    (restored ?? []).some((t: string) => t.includes(`AGENT${STAMP}`)),
    "a client who reloads while waiting loses the answer they were sent"
  );
  check(
    "  ↳ and the internal note is STILL absent from a replay",
    !(restored ?? []).some((t: string) => t.includes(`NOTE${STAMP}`)),
    "replay=1 put our own workflow in a customer's chat"
  );
  check("  ↳ and nothing is duplicated", new Set(restored ?? []).size === (restored ?? []).length, JSON.stringify(restored));
  await shot("live-04-reloaded");

  console.log("\n== a replay that cannot reach the server must not DISCARD the thread ==");
  /**
   * The other half, and the one that will actually happen in production: every
   * `/support/api` route shares 60 requests a minute per IP — several of a client's
   * colleagues sit behind one office NAT — and a sleeping free instance takes about fifty
   * seconds to wake. The catch used to clear the conversation id and the bearer on any
   * failure ("fall back to a fresh conversation rather than a dead one"), which starts a
   * NEW conversation while the agent goes on replying into the old one.
   *
   * Simulated by blocking the replay request rather than by reasoning about it.
   */
  await send("Network.setBlockedURLs", { urls: ["*replay=1*"] });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/v2/location/${LOCATION}/dashboard` });
  await sleep(4000);
  const kept = await ev(`
    const out={}; for (let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); out[k]=1;} return Object.keys(out);`);
  check(
    "a failed replay leaves the thread on disk",
    (kept ?? []).some((k: string) => k.indexOf("mosaic_support_thread_") === 0),
    `sessionStorage keys: ${JSON.stringify(kept)}`
  );

  await send("Network.setBlockedURLs", { urls: [] });
  await ev(`R.querySelector(".bubble").click(); return 1;`);
  let retried: string[] = [];
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    retried = (await ev(`return transcript().map(m=>m.text);`)) ?? [];
    if (retried.some((t) => t.includes(`AGENT${STAMP}`))) break;
  }
  check(
    "  ↳ and opening the panel picks the conversation back up",
    retried.some((t) => t.includes(`AGENT${STAMP}`)),
    `still nothing after 12s: ${JSON.stringify(retried)}`
  );
  check("  ↳ without painting it twice", new Set(retried).size === retried.length, JSON.stringify(retried));
  await shot("live-05-replay-blocked");

  console.log("\n== …and a thread the server no longer has must be let go ==");
  /**
   * The mirror of the check above, and it is here because getting the first one wrong
   * created it. Keeping the thread on EVERY failure means a 401 or 404 — the conversation
   * genuinely is not ours any more — leaves `state.conversationId` set, so
   * `ensureConversation()` skips creation and every later message is posted to something
   * that does not exist. Measured at the time: the client got "Sorry, something went wrong
   * on my end" for the rest of the session, with no way out but closing the tab.
   *
   * GONE and UNREACHABLE are different answers. This is the crawler's absent-versus-refused
   * rule on the client side.
   */
  await prisma.message.deleteMany({ where: { conversationId: conv.id } });
  await prisma.conversation.delete({ where: { id: conv.id } });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/v2/location/${LOCATION}/dashboard` });
  await sleep(4000);
  const letGo = await ev(`
    const out=[]; for (let i=0;i<sessionStorage.length;i++) out.push(sessionStorage.key(i)); return out;`);
  check(
    "a conversation the server has refused is dropped, not held",
    !(letGo ?? []).some((k: string) => k.indexOf("mosaic_support_thread_") === 0),
    `sessionStorage keys: ${JSON.stringify(letGo)}`
  );
  await ev(`R.querySelector(".bubble").click(); return 1;`);
  await sleep(1200);
  check(
    "  ↳ and the panel still greets them rather than sitting empty",
    ((await ev(`return transcript().map(m=>m.text).join(" ");`)) ?? "").length > 0,
    "an empty panel with nothing to explain it"
  );
  await ev(`
    const t=R.querySelector(".ft textarea");
    const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;
    t.focus(); s.call(t,"I want to speak to a real person please"); t.dispatchEvent(new Event("input",{bubbles:true}));
    const b=R.querySelector(".ft button"); if(b) b.click(); return 1;`);
  await sleep(4500);
  const recovered = await ev(`return transcript().map(m=>m.text);`);
  check(
    "  ↳ and the very next message opens a FRESH conversation",
    (recovered ?? []).some((t: string) => /someone from the team/i.test(t)),
    `the client is stuck: ${JSON.stringify(recovered)}`
  );
  await shot("live-06-stale-thread");

  console.log(`\n${"-".repeat(66)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await teardown("done");
    process.exit(fail === 0 ? 0 : 1);
  });
