/**
 * Does the widget ever ASK for the agent's reply?
 *
 * `verify-delivery` proves the /updates endpoint returns an agent's message correctly —
 * 23 checks, all green — and it could not see this bug, because it drives that endpoint
 * over HTTP itself. The widget was never asked whether it calls it.
 *
 * It did not. `watchUpdates` was started from exactly one place, `addQueueWatcher`, which
 * runs only when the CLIENT escalates. But the desk lists conversations by status and
 * counts "open" as its own tab, so an agent can open a chat nobody escalated and reply.
 * That reply was stored, set firstAgentReplyAt, and counted toward the response time the
 * agency is shown — and the client's widget never polled, so it never arrived. The
 * write-only failure, surviving in the case where the DESK starts talking rather than the
 * client asking for a person, and worse than the original because the metric says we
 * answered.
 *
 * So this runs the ACTUAL pasted snippet in a DOM stub with a virtual clock, sends one
 * ordinary question, and asserts the poll happens with no escalation anywhere.
 *
 *   node scratchpad/verify-widget-poll.js
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const vm = require("node:vm");

const prisma = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${String(detail).slice(0, 300)}`); fail++; }
};

/* ---------------------------------------------------------------- virtual clock ---- */
/* Real timers would make this a 90-second test whose failures read as flake. The poller
   starts at 2s and widens to 60s, so the whole point is to move time deliberately. */
let now = 0, seq = 0;
const timers = new Map();
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const target = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= target && (next === null || t.at < next.t.at)) next = { id, t };
    if (!next) break;
    timers.delete(next.id);
    now = next.t.at;
    try { next.t.fn(); } catch (e) { console.log(`        timer threw: ${e.message}`); }
    await settle();
  }
  now = target;
  await settle();
}

/* ------------------------------------------------------------------- DOM stub ------ */
const created = [];
function makeEl(tag) {
  const e = {
    tag, style: {}, attrs: {}, children: [], listeners: {},
    className: null, textContent: null, value: "", rows: 0, placeholder: "",
    scrollTop: 0, scrollHeight: 0, disabled: false, parentNode: null,
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { e.attrs[k] = v; },
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    removeAttribute(k) { delete e.attrs[k]; },
    appendChild(c) { e.children.push(c); if (c) c.parentNode = e; return c; },
    remove() {
      const p = e.parentNode;
      if (p && p.children) p.children = p.children.filter((x) => x !== e);
      e.parentNode = null;
    },
    addEventListener(ev, fn) { (e.listeners[ev] = e.listeners[ev] || []).push(fn); },
    focus() {}, blur() {}, scrollIntoView() {},
    attachShadow() { const root = makeEl("#shadow"); e.shadow = root; return root; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  created.push(e);
  return e;
}
const textOf = (e) => {
  let s = e.textContent == null ? "" : String(e.textContent);
  for (const c of e.children) s += " " + textOf(c);
  return s;
};
const fire = (e, ev, arg) => (e.listeners[ev] || []).forEach((fn) => fn(arg || { preventDefault() {} }));

(async () => {
  const agency = await prisma.agencyInstall.findFirst({ where: { status: "active" }, select: { id: true } });
  const embed = await (await fetch(`${BASE}/admin/api/${agency.id}/embed`)).json();

  /* --------------------------------------------------------------- fake server ---- */
  const reqs = [];
  let queued = [];            // messages the "desk" has written but the client hasn't seen
  let cursor = 0;
  let convStatus = "open";    // never escalated — the whole point
  let escalateCalls = 0;

  const respond = (url, opts) => {
    reqs.push(String(url));
    const u = String(url);
    if (/\/theme-bundle\//.test(u)) return { brandName: "Harbour Suite", primaryColor: "#123456" };
    if (/\/support\/api\/.*\/config$/.test(u)) {
      return { enabled: true, brandName: "Harbour Suite", greeting: "Hi! Ask me anything.", quickActions: [], businessHours: null };
    }
    if (/\/conversation$/.test(u) && opts && opts.method === "POST") return { conversationId: "conv1", token: "tok1" };
    if (/\/conversation\/conv1\/message$/.test(u)) {
      // An ORDINARY answer: not handed to a human, so nothing on the client side ever
      // calls addQueueWatcher. This is the exact path that used to leave no poller.
      return { reply: "Open Deals from the left sidebar.", canEscalate: true, handedToHuman: false };
    }
    if (/\/conversation\/conv1\/escalate$/.test(u)) {
      escalateCalls++; convStatus = "escalated";
      return { message: "Passing this to the team." };
    }
    if (/\/conversation\/conv1\/updates/.test(u)) {
      const out = queued;
      queued = [];
      if (out.length) cursor += out.length;
      return {
        messages: out,
        cursor: "m" + cursor,
        status: convStatus,
        waiting: convStatus === "escalated",
        position: 1,
        estimatedWaitSeconds: 720,
        // The SENTENCE, exactly as `waitSentence` builds it. The widget must render this
        // and do no arithmetic of its own: it used to compute "about 12 min" itself, which
        // made a second wording of one number and left the desk quoting a third.
        estimatedWaitText: "Usually about 12 min.",
      };
    }
    return {};
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 1,      // the SPA re-boot poll: counted elsewhere, noise here
    clearInterval() {},
    fetch: (url, opts) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(respond(url, opts)) }),
    document: {
      readyState: "complete",
      hidden: false,
      title: "",
      body: makeEl("body"),
      head: makeEl("head"),
      styleSheets: [],
      createElement: makeEl,
      createTextNode: () => ({}),
      listeners: {},
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    location: { pathname: "/location/zGcbvRQMJxqowkasy7Uj/dashboard", href: "https://app.example.com/location/zGcbvRQMJxqowkasy7Uj/dashboard" },
    navigator: { userAgent: "node" },
    sessionStorage: (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem(k, v) { m[k] = String(v); }, removeItem(k) { delete m[k]; } }; })(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  console.log("\n== the widget boots ==");
  let threw = null;
  try { vm.runInNewContext(embed.jsSnippet, sandbox, { timeout: 5000 }); } catch (e) { threw = e; }
  check("the pasted snippet runs without throwing", threw === null, threw && threw.stack);
  await advance(50);
  check("it asked whether support is on here", reqs.some((u) => /\/support\/api\/.*\/config$/.test(u)), reqs.join(" "));

  // The panel is built on first open, so click the bubble the way a client would —
  // asserting against a widget that was never opened would test nothing.
  const bubble = created.find((e) => e.tag === "button" && e.className === "bubble");
  check("the launcher bubble was mounted", !!bubble);
  fire(bubble, "click");
  await advance(50);

  const send = created.find((e) => e.tag === "button" && e.textContent === "Send");
  const input = created.find((e) => e.tag === "textarea");
  check("the compose box was built", !!send && !!input);

  console.log("\n== an ORDINARY question — nobody escalates anything ==");
  input.value = "how do i create a pipeline";
  fire(send, "click");
  await advance(50);
  check("the question was sent", reqs.some((u) => /\/conversation\/conv1\/message$/.test(u)));
  check("nothing escalated (this is a plain chat)", escalateCalls === 0 && convStatus === "open");

  console.log("\n== THE BUG: does it ever ask for a reply? ==");
  const before = reqs.filter((u) => /\/updates/.test(u)).length;
  await advance(4000);
  const after = reqs.filter((u) => /\/updates/.test(u)).length;
  check(
    "the widget polls for updates with NO escalation anywhere",
    after > before,
    "zero /updates requests — an agent replying from the desk would never reach this client"
  );

  console.log("\n== an agent replies from the desk ==");
  queued = [{ id: "m1", role: "agent", body: "Hi, this is Bo from the team — happy to help." }];
  await advance(30000);
  /* Count MESSAGE ROWS, not every element whose subtree contains the text. `created`
     holds parents and children alike, so joining all of them counts one message five
     times over — an assertion that reports duplicate delivery where there is none. */
  const rows = () => created.filter((e) => typeof e.className === "string" && /^msg /.test(e.className));
  const rowText = () => rows().map(textOf).join(" | ");
  check("the agent's reply is rendered in the panel", /Bo from the team/.test(rowText()), rowText().slice(0, 200));
  check("  and it is styled like the assistant, not marked as staff", !/\[agent\]|internal/i.test(rowText()));

  console.log("\n== it does not re-deliver what is already on screen ==");
  const withCursor = reqs.filter((u) => /\/updates\?after=/.test(u)).length;
  check("later polls carry the read cursor", withCursor > 0, reqs.filter((u) => /updates/.test(u)).join(" "));
  const copies = rows().filter((r) => /Bo from the team/.test(textOf(r))).length;
  check("the reply appears exactly once", copies === 1, `${copies} copies`);

  console.log("\n== a hidden tab costs nothing ==");
  sandbox.document.hidden = true;
  const beforeHidden = reqs.filter((u) => /\/updates/.test(u)).length;
  await advance(120000);
  const afterHidden = reqs.filter((u) => /\/updates/.test(u)).length;
  check(
    "no requests at all while the tab is in the background",
    afterHidden === beforeHidden,
    `${afterHidden - beforeHidden} requests made with nobody watching`
  );

  console.log("\n== coming back asks immediately ==");
  sandbox.document.hidden = false;
  queued = [{ id: "m2", role: "agent", body: "Still here if you need anything." }];
  (sandbox.document.listeners.visibilitychange || []).forEach((fn) => fn({}));
  await advance(100);
  const afterReturn = reqs.filter((u) => /\/updates/.test(u)).length;
  check("returning to the tab polls at once, not a minute later", afterReturn > afterHidden);
  check("  and the message waiting for them appears", /Still here if you need/.test(rowText()));

  console.log("\n== escalating later must not start a SECOND poller ==");
  /* Two pollers would double every waiting client's share of a 60/min budget shared with
     SENDING messages — the reason there is deliberately only one poller in the first place. */
  const esc = created.find((e) => e.tag === "button" && e.textContent === "Talk to the team");
  const beforeEsc = reqs.filter((u) => /\/updates/.test(u)).length;
  if (esc) fire(esc, "click");
  await advance(50);
  await advance(20000);
  const during = reqs.filter((u) => /\/updates/.test(u)).length - beforeEsc;
  check("escalating adds no extra poller", during <= 2, `${during} update requests in a 20s window`);
  /*
   * The queue row is written by a POLL, and by this point the interval has widened to its
   * 60s ceiling — deliberately, that is the rate-limit decision. So 20 seconds buys zero
   * requests and the row is still blank.
   *
   * This check used to read `... || convStatus === "escalated"`, which is true here by
   * construction: it passed WITHOUT the line ever rendering, on a run where `during` was
   * 0. Same trap this file records twice already. Waiting for a poll costs nothing on a
   * virtual clock and makes it an assertion about the screen again.
   */
  await advance(70000);
  const queueLine = created.map((e) => String(e.textContent || "")).filter((t) => /in line/.test(t)).pop() || "";
  check("  and the queue position still renders", /number 1 in line/.test(queueLine), JSON.stringify(queueLine));

  /* Asserting the payload proves nothing about the SCREEN — the verify-delivery lesson.
     This executes the shipped snippet and reads what the client is actually shown. */
  check(
    "the client is shown the server's sentence, verbatim",
    /Usually about 12 min\./.test(queueLine),
    JSON.stringify(queueLine)
  );
  check(
    "  ↳ and the widget does no arithmetic of its own on the seconds",
    !/\b720\b/.test(queueLine) && !/12 minutes/.test(queueLine),
    JSON.stringify(queueLine)
  );

  if (process.env.DEBUG_POLL) {
    console.log("\n  updates requests:");
    reqs.filter((u) => /updates/.test(u)).forEach((u) => console.log("    " + u.split("/conversation/")[1]));
  }
  console.log(`\n${"-".repeat(62)}\n  ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
