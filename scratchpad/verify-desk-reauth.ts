/**
 * The session-ended overlay — the promise nobody had ever watched being kept.
 *
 * `App.tsx` argues the case at length: an agent whose session ends mid-shift has very
 * likely typed a reply to a real client, one already through the brand and link gates as
 * they typed, and swapping the app for <Login> unmounts `Ticket` and throws it away —
 * "worse than the expiry itself and the sort of thing that teaches people to draft
 * somewhere else". So re-authentication happens OVER the live desk, and signing back in
 * "restores exactly what was on screen, mid-sentence".
 *
 * Every word of that is a claim about the SCREEN, and every existing check is HTTP.
 * `verify-desk-session` (15) proves revocation refuses a live cookie; `verify-desk-password`
 * (16) proves a wrong password's 401 does not raise the overlay. Neither can see whether
 * the desk is still mounted underneath it, whether the draft is still in the box, or
 * whether the NEXT person to sign in inherits the previous agent's words — which is the
 * one outcome this design exists to prevent, since it would put one agent's sentence under
 * another's name on a message going to a customer.
 *
 * That gap is the `verify-delivery` blind spot exactly: 23/23 green while the widget never
 * called the endpoint under test.
 *
 * The draft lives in a `useRef` INSIDE `Ticket`, so every property here is a consequence of
 * that component staying mounted — which is a fact about React reconciliation, not about
 * anything anybody wrote down. Worth measuring rather than reasoning about: two `<Ticket>`
 * elements sit in mutually exclusive branches of one ternary, and whether a draft survives
 * a trip to the Queue tab depends on how React pairs them up.
 *
 *   1. npm run dev:server                     (3210)
 *   2. npm run dev:desk                       (5174)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1500,1000
 *   4. npx tsx scratchpad/verify-desk-reauth.ts [output-dir]
 */
import "../apps/server/src/services/loadEnv";
import { writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../apps/server/src/services/prisma";

const [, , SHOTS] = process.argv;
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}
const DESK = "http://localhost:5174";
const STAMP = Date.now();
const PW = "a perfectly fine passphrase";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

async function pageTarget(): Promise<any> {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = (list as any[]).find((t) => t.type === "page");
  if (found) return found;
  return await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
}

let ws: WebSocket;
let msgId = 0;
const pending = new Map<number, (m: any) => void>();
async function connect(): Promise<void> {
  const page = await pageTarget();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r as any));
  ws.onmessage = (e: any) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  };
}
const send = (method: string, params: any = {}) =>
  new Promise<any>((res, rej) => {
    const n = ++msgId;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `\s` inside a template literal collapses to `s` — doubled, per the driver trap. */
const HELP = `
  const flat=(e)=>((e&&e.textContent)||"").replace(/\\s+/g," ").trim();
  const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test(flat(e)));
  const composeBox=()=>document.querySelector(".compose textarea");
  const overlay=()=>document.querySelector(".session-overlay");
  const setValue=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;
    el.focus(); s.call(el,v); el.dispatchEvent(new Event("input",{bubbles:true}));};
  const setInput=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
    el.focus(); s.call(el,v); el.dispatchEvent(new Event("input",{bubbles:true}));};
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

/** Sign in through the form that is on screen, whichever one it is. */
async function signIn(email: string, root: string): Promise<boolean> {
  const done = await ev(`
    const scope=document.querySelector(${JSON.stringify(root)}) || document;
    const f=scope.querySelector("form.login-card");
    if(!f) return "no form";
    setInput(f.querySelector('input[type=email]'), ${JSON.stringify(email)});
    setInput(f.querySelector('input[type=password]'), ${JSON.stringify(PW)});
    return "filled";`);
  if (done !== "filled") return false;
  await sleep(250);
  await ev(`
    const scope=document.querySelector(${JSON.stringify(root)}) || document;
    scope.querySelector("form.login-card button.primary").click(); return 1;`);
  await sleep(2200);
  return true;
}

/** The state an expired cookie is in: the row is gone, the browser still holds it. */
async function killSessions(userId: string): Promise<number> {
  const r = await prisma.deskSession.deleteMany({ where: { deskUserId: userId } });
  return r.count;
}

const madeUsers: string[] = [];
const madeConvs: string[] = [];
let tornDown = false;

async function teardown(reason: string): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  await prisma.message.deleteMany({ where: { conversationId: { in: madeConvs } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { id: { in: madeConvs } } }).catch(() => {});
  await prisma.deskSession.deleteMany({ where: { deskUserId: { in: madeUsers } } }).catch(() => {});
  const u = await prisma.deskUser.deleteMany({ where: { id: { in: madeUsers } } }).catch(() => ({ count: -1 }));
  console.log(`cleanup (${reason}): removed ${u.count} desk user(s), ${madeConvs.length} conversation(s)`);
  await prisma.$disconnect().catch(() => {});
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => { void teardown(sig).then(() => process.exit(130)); });
}

const DRAFT = `Thanks for waiting — I have checked your account and the import finished at 2pm. STAMP${STAMP}`;

async function main(): Promise<void> {
  await connect();

  const location = await prisma.locationInstall.findFirst({ where: { status: "active" } });
  if (!location) throw new Error("no active LocationInstall — this suite needs one to hang a ticket off");

  const ada = await prisma.deskUser.create({
    data: { email: `reauth-ada-${STAMP}@mosaic.test`, name: "Ada Reauth", passwordHash: hashPassword(PW), role: "mosaic_agent" },
  });
  const bo = await prisma.deskUser.create({
    data: { email: `reauth-bo-${STAMP}@mosaic.test`, name: "Bo Reauth", passwordHash: hashPassword(PW), role: "mosaic_agent" },
  });
  madeUsers.push(ada.id, bo.id);

  const conv = await prisma.conversation.create({
    data: {
      agencyInstallId: location.agencyInstallId,
      locationInstallId: location.id,
      status: "escalated",
      subject: `reauth suite ${STAMP}`,
      queuedAt: new Date(),
      // Written directly rather than through the widget, so the clocks the inbox filters
      // and orders on have to be set by hand — without `lastMessageAt` the fixture is
      // simply absent from the list, which reads as the list being broken.
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  madeConvs.push(conv.id);
  await prisma.message.create({
    data: { conversationId: conv.id, role: "user", body: "My contact import seems to have stalled, can someone check?" },
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Start from a clean slate: a cookie left by another desk suite would skip the sign-in.
  await send("Network.clearBrowserCookies");
  await send("Page.navigate", { url: DESK });
  await sleep(3000);

  console.log("\n== sign in and start typing a reply to a real client ==");
  check("the login form is shown", await ev(`return !!document.querySelector("form.login-card")`));
  check("Ada signs in", await signIn(ada.email, "body"), "sign-in failed — a 429 on /desk/api/login looks exactly like this");
  check("  ↳ and lands on the desk", await ev(`return !!document.querySelector(".topbar")`));

  // The Inbox is where a reply gets typed; the queue board is the landing page.
  await ev(`const b=byText(".topbar-nav button",/^Inbox$/i); if(b) b.click(); return 1;`);
  await sleep(2000);
  /**
   * The fixture may not survive the inbox's default filter, so the suite falls back to
   * whatever is at the top — and then REMEMBERS which row that was. Asking for "our
   * ticket" later when a different one was opened is how the first run reported a
   * product failure ("ticket not listed") that was entirely the harness's own doing.
   */
  const openedTicket = await ev(`
    const r=[...document.querySelectorAll(".inbox-row")].find(x=>flat(x).indexOf("reauth suite ${STAMP}")>=0)
         || document.querySelector(".inbox-row");
    if(!r) return null; r.click(); return flat(r.querySelector(".inbox-row-preview"));`);
  check("a ticket opens", typeof openedTicket === "string" && openedTicket.length > 0, openedTicket ?? "no inbox rows at all");
  console.log(`  (working on: ${JSON.stringify(openedTicket)})`);
  await sleep(1800);
  check("the compose box is on screen", await ev(`return !!composeBox()`));

  await ev(`setValue(composeBox(), ${JSON.stringify(DRAFT)}); return 1;`);
  await sleep(600);
  check("the draft is in the box", (await ev(`return composeBox().value`)) === DRAFT);
  await shot("reauth-01-draft-typed");

  console.log("\n== the session ends underneath them ==");
  /**
   * Deleting the row is what an EXPIRY looks like from the browser's side: the cookie is
   * still in the jar and no longer names anything. Disabling the account would work too
   * and would also stop them signing back in, which is the other half of this design.
   */
  const killed = await killSessions(ada.id);
  check(`the session row is gone (${killed})`, killed > 0);

  /**
   * And the client says something else while nobody is signed in. Whatever is on screen
   * when the overlay lifts has to include this: an agent finishing a reply they cannot
   * see the last message of is the one way a preserved draft becomes a liability.
   */
  await prisma.message.create({
    data: { conversationId: madeConvs[0], role: "user", body: `Actually it just finished — ignore me. LATE${STAMP}` },
  });
  await prisma.conversation.update({ where: { id: madeConvs[0] }, data: { lastMessageAt: new Date() } });

  // Any authenticated call now 401s. The lists poll on their own, but nudging one makes
  // this deterministic rather than a race against a 15s timer.
  await ev(`const b=byText(".topbar-nav button",/^Queue$/i); if(b) b.click(); return 1;`);
  await sleep(1200);
  await ev(`const b=byText(".topbar-nav button",/^Inbox$/i); if(b) b.click(); return 1;`);
  await sleep(2500);

  const overlaid = await ev(`
    const o=overlay();
    if(!o) return {present:false};
    const r=o.getBoundingClientRect(), cs=getComputedStyle(o);
    return {present:true, position:cs.position, zIndex:cs.zIndex,
            coversViewport: r.width>=innerWidth-1 && r.height>=innerHeight-1,
            opaque: cs.backgroundColor,
            says: flat(o.querySelector(".notice")),
            hasForm: !!o.querySelector("form.login-card")};`);
  console.log("  overlay: " + JSON.stringify(overlaid));
  check("the session-ended overlay appears", overlaid?.present === true, JSON.stringify(overlaid));
  check("  ↳ it is fixed and covers the viewport", overlaid?.position === "fixed" && overlaid?.coversViewport === true, JSON.stringify(overlaid));
  check("  ↳ and offers a sign-in form rather than only an apology", overlaid?.hasForm === true);
  check(
    "  ↳ and PROMISES the work is still there, which is the whole design",
    /still here|still there/i.test(overlaid?.says ?? ""),
    overlaid?.says
  );

  /**
   * THE load-bearing assertion. Swapping the app for <Login> would unmount Ticket, and
   * the draft — already gate-checked as it was typed — would be gone with no warning.
   */
  const behind = await ev(`return {mounted: !!composeBox(), value: composeBox()?.value ?? null};`);
  check("the desk is still MOUNTED underneath, not replaced", behind?.mounted === true, JSON.stringify(behind));
  check("  ↳ and the half-written reply is untouched", behind?.value === DRAFT, JSON.stringify(behind?.value));
  await shot("reauth-02-overlay");

  console.log("\n== the same person signs back in ==");
  check("Ada signs in again, in the overlay", await signIn(ada.email, ".session-overlay"));
  await sleep(1500);
  check("  ↳ the overlay is gone", (await ev(`return !overlay()`)) === true);
  const restored = await ev(`return {mounted: !!composeBox(), value: composeBox()?.value ?? null};`);
  check("  ↳ the same ticket is still open", restored?.mounted === true, JSON.stringify(restored));
  check(
    "  ↳ and they carry on mid-sentence",
    restored?.value === DRAFT,
    `expected the draft back, got ${JSON.stringify(restored?.value)}`
  );
  const transcript = await ev(`return flat(document.querySelector(".transcript, .messages, .ticket"));`);
  check(
    "  ↳ and the transcript catches up with what the client said meanwhile",
    (transcript ?? "").includes(`LATE${STAMP}`),
    "the message sent while the session was dead is still not on screen"
  );
  const listBack = await ev(`return document.querySelectorAll(".inbox-row").length`);
  check("  ↳ and the inbox is not blank", listBack > 0, `${listBack} rows`);
  await shot("reauth-03-restored");

  console.log("\n== …but a DIFFERENT person must not inherit it ==");
  /**
   * The one outcome this design exists to prevent: one agent's sentence going out under
   * another's name. `onReauthenticated` clears the selection on a different id, which
   * unmounts `Ticket` and takes its draft map with it — so this is really a check that
   * the drafts really do live inside the component that gets unmounted.
   */
  await killSessions(ada.id);
  await ev(`const b=byText(".topbar-nav button",/^Queue$/i); if(b) b.click(); return 1;`);
  await sleep(1200);
  await ev(`const b=byText(".topbar-nav button",/^Inbox$/i); if(b) b.click(); return 1;`);
  await sleep(2500);
  check("the overlay is up again", (await ev(`return !!overlay()`)) === true);
  check("Bo signs in instead", await signIn(bo.email, ".session-overlay"));
  await sleep(1800);
  check("  ↳ the overlay is gone", (await ev(`return !overlay()`)) === true);
  const whoami = await ev(`return flat(document.querySelector(".topbar-right, .topbar")).slice(0,120);`);
  check("  ↳ the top bar names the new person", /Bo Reauth/.test(whoami ?? ""), whoami);
  check(
    "  ↳ and the ticket view is RESET, not carried over",
    (await ev(`return !composeBox()`)) === true,
    "the previous agent's compose box is still on screen"
  );

  /**
   * MEASURED, not assumed: how long after signing back in does the desk have anything on
   * it? `Inbox` and `QueueBoard` keep polling behind the overlay with a dead cookie, and
   * nothing in the sign-in path tells them to try again — so the recovery is whatever the
   * next 15s tick brings.
   */
  const recovery: string[] = [];
  for (const at of [0, 1000, 2000, 4000, 8000, 12000, 17000]) {
    if (at) await sleep(at - (recovery.length ? [0, 1000, 2000, 4000, 8000, 12000, 17000][recovery.length - 1] : 0));
    recovery.push(`${at}ms:${await ev(`return document.querySelectorAll(".inbox-row").length`)}`);
  }
  console.log(`  rows in the inbox after signing back in -> ${recovery.join("  ")}`);
  check(
    "the desk has its list back within a second of signing in",
    Number(recovery[1].split(":")[1]) > 0,
    `row counts over time: ${recovery.join("  ")}`
  );

  const inherited = await ev(`
    const want=${JSON.stringify(String(openedTicket ?? ""))};
    const r=[...document.querySelectorAll(".inbox-row")].find(x=>flat(x.querySelector(".inbox-row-preview"))===want);
    if(!r) return "the ticket Ada was on is not listed for Bo"; r.click(); return "clicked";`);
  if (inherited === "clicked") {
    await sleep(1800);
    const box = await ev(`return composeBox()?.value ?? null;`);
    check(
      "  ↳ and opening the SAME ticket gives Bo an empty box",
      box === "",
      `Bo can see Ada's words: ${JSON.stringify(box)}`
    );
  } else {
    check("  ↳ and opening the SAME ticket gives Bo an empty box", false, inherited);
  }
  await shot("reauth-04-different-person");

  console.log("\n== and an ordinary trip to the Queue tab must not eat a draft ==");
  /**
   * Not part of the expiry story, and reachable far more often. The two `<Ticket>` elements
   * live in mutually exclusive branches of one ternary, so whether a draft survives
   * switching views is a fact about how React pairs those elements up — nothing anybody
   * wrote down. Measured rather than reasoned about, because the Queue tab is the DEFAULT
   * landing and glancing at the board mid-reply is ordinary desk work.
   */
  const haveBox = await ev(`
    if(composeBox()) return true;
    const r=document.querySelector(".inbox-row"); if(!r) return false; r.click(); return "opening";`);
  if (haveBox === "opening") await sleep(1800);
  check("a ticket is open to type into", (await ev(`return !!composeBox()`)) === true);
  await ev(`setValue(composeBox(), "Checking the board for a second."); return 1;`);
  await sleep(500);
  await ev(`const b=byText(".topbar-nav button",/^Queue$/i); b.click(); return 1;`);
  await sleep(1500);
  await ev(`const b=byText(".topbar-nav button",/^Inbox$/i); b.click(); return 1;`);
  await sleep(1500);
  const afterHop = await ev(`return composeBox()?.value ?? null;`);
  check(
    "a draft survives a look at the queue board",
    afterHop === "Checking the board for a second.",
    `got ${JSON.stringify(afterHop)}`
  );
  await shot("reauth-05-view-hop");

  console.log(`\n${"-".repeat(66)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await teardown("done");
    process.exit(fail === 0 ? 0 : 1);
  });
