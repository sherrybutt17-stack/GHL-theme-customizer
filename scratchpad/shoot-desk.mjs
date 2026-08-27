/**
 * Drive the support desk in a REAL browser and screenshot it.
 *
 * Why this exists: `audit-styles.js` proves every class a component renders is DEFINED
 * somewhere. It cannot prove the rule is right. The first run of this script caught
 * exactly that gap — `.modal-body label` was a flex column, so `Their name <span
 * class="muted">optional</span>` put "optional" on its own line under every optional
 * field. The class existed, the audit was green, the form looked broken. Only rendering
 * shows that.
 *
 * No Playwright install: it talks CDP over Node's built-in WebSocket to the
 * `chrome-headless-shell` that Playwright already cached.
 *
 *   1. npm run dev:server   (3210, with APP_PUBLIC_URL=https://localhost:3210)
 *   2. npm run dev:desk     (5174)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1440,900
 *   4. npx tsx scratchpad/shoot-desk.mjs <output-dir>
 *
 * IT MAKES ITS OWN ACCOUNT AND DELETES IT. The setup used to be a `create-desk-user` step
 * with the password written in this comment — so anybody who followed it left a permanent,
 * active desk login on a known credential, and every desk account can read every agency's
 * support conversations. The password is now random per run, and the account is removed at
 * the end and on SIGINT/SIGTERM/SIGHUP. `readiness` reports any that survive anyway
 * (`harness-desk-accounts`), because a SIGKILL honours no handler.
 *
 * Signing in is CONDITIONAL — the browser keeps its cookie between runs, and a driver
 * that assumes a login form is one that only works the first time.
 */
// Was missing, and the gap only showed on a FRESH browser profile: `shot("01-login")` is
// the one call inside the conditional sign-in branch, so an already-signed-in run never
// reached it and the driver looked fine to everyone who had run it once.
import { writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import "../apps/server/src/services/loadEnv.ts";

const prisma = new PrismaClient();
const STAMP = Date.now();
const DESK_EMAIL = `shot-desk-${STAMP}@mosaic.test`;
// Random per run, never a constant in the file: a leftover account is a live credential to
// every agency's support conversations, and one with a published password is worse.
const DESK_PASSWORD = randomBytes(18).toString("base64url");
let deskUserId = null;
let cleaned = false;

async function removeDeskUser(reason) {
  if (cleaned || !deskUserId) return;
  cleaned = true;
  await prisma.deskSession.deleteMany({ where: { deskUserId } }).catch(() => {});
  await prisma.conversation.updateMany({ where: { assignedToId: deskUserId }, data: { assignedToId: null } }).catch(() => {});
  const r = await prisma.deskUser.deleteMany({ where: { id: deskUserId } }).catch(() => ({ count: -1 }));
  // Printed, because a cleanup nobody can see is a claim rather than a check — and it says
  // so LOUDLY when it did not happen. Seen for real: the datastore went down mid-run, the
  // delete failed, and the account was left active with a live password. A quiet failure
  // there is the whole defect this account-per-run was built to avoid.
  if (r.count === 1) {
    console.log(`desk account removed (${reason}): ${DESK_EMAIL}`);
  } else {
    console.error(
      `\n!! DESK ACCOUNT MAY STILL EXIST: ${DESK_EMAIL} (delete returned ${r.count}, reason=${reason}).\n` +
        `   It is an ACTIVE login that can read every agency's conversations. Delete it, or run\n` +
        `   \`npm run readiness\` — harness-desk-accounts reports any that survive.`
    );
  }
  await prisma.$disconnect().catch(() => {});
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { void removeDeskUser(sig).then(() => process.exit(130)); });
}
for (const ev of ["unhandledRejection", "uncaughtException"]) {
  process.on(ev, async (e) => {
    console.error(`\n${ev}:`, e instanceof Error ? e.message : e);
    await removeDeskUser(ev).catch(() => {});
    process.exit(1);
  });
}

{
  const salt = randomBytes(16);
  const passwordHash = `${salt.toString("hex")}:${scryptSync(DESK_PASSWORD, salt, 64, { N: 16384 }).toString("hex")}`;
  const u = await prisma.deskUser.create({
    data: { email: DESK_EMAIL, name: "Screenshot Demo", passwordHash, role: "mosaic_admin", tier: 3, maxConcurrent: 5 },
  });
  deskUserId = u.id;
  console.log("desk account created for this run:", DESK_EMAIL);
}

const SHOTS = process.argv[2];
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
let page = list.find((t) => t.type === "page");
if (!page) page = await (await fetch("http://127.0.0.1:9222/json/new?about:blank")).json();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HELPERS = `
  const setVal = (el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test((e.textContent||"").trim()));
`;
/** Each evaluation gets its own scope — one shared context means top-level consts collide. */
const evaluate = async (body) => {
  const expr = `(() => { ${HELPERS} ${body} })()`;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result.value;
};
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`  shot: ${name}.png`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

// --- sign in -------------------------------------------------------------
await send("Page.navigate", { url: "http://localhost:5174/" });
await sleep(2500);
console.log("title:", await evaluate("return document.title"));

// The browser keeps its cookie between runs, so signing in is CONDITIONAL — a driver
// that assumes a login form is one that only works the first time.
const signedIn = await evaluate(`return !!document.querySelector(".topbar-nav")`);
console.log("already signed in:", signedIn);
if (!signedIn) {
  await evaluate(`
    const ins = [...document.querySelectorAll("input")];
    setVal(ins[0], ${JSON.stringify(DESK_EMAIL)});
    setVal(ins[1], ${JSON.stringify(DESK_PASSWORD)});
    return true;`);
  await sleep(300);
  await shot("01-login");
  await evaluate(`(byText("button", /sign in/i) || document.querySelector("button[type=submit]")).click(); return true;`);
  await sleep(2500);
}
console.log("after login, view:", await evaluate(`return document.querySelector(".topbar-nav button.active")?.textContent ?? "(none)"`));
await shot("02-queue");

/*
 * The queue board's wait line, which cannot be seen on an ordinary dev database:
 * `estimatedWaitText` is null below five measured responses or with nobody on the desk.
 * Run `npx tsx scratchpad/seed-queue-demo.ts plant` first, and `clear` after.
 *
 * It is QUOTED here rather than paraphrased — this line's whole job is to show the promise
 * the widget is making, and it used to re-derive that from the seconds with the desk's own
 * compact formatter, so it displayed "1h 7m" while the client read "about 67 min".
 */
const board = await evaluate(`
  // The INNERMOST match. Searching every element and taking the first hit walks the tree
  // from <html> down, so the first match is the document — a "wait line" containing the
  // entire stylesheet. Take the last, which is the deepest node still holding the text.
  const hits = [...document.querySelectorAll("p, div, span, small")]
    .filter(e => /would be told/i.test(e.textContent||""));
  const el = hits[hits.length - 1];
  const rows = document.querySelectorAll(".queue-row, tbody tr").length;
  return { rows, line: el ? (el.textContent||"").replace(/\\s+/g," ").trim() : "(no wait line)" };`);
console.log("queue depth:", board.rows);
console.log("wait line   :", board.line);
const alarms = await evaluate(`
  return [...document.querySelectorAll(".queue-alarm")].map(e => (e.textContent||"").replace(/\\s+/g," ").trim());`);
console.log("queue alarms:", JSON.stringify(alarms));
await shot("02b-queue-wait");

// --- The INBOX and a real TICKET -----------------------------------------
/*
 * The densest screen in the desk, and the one that shipped with NO CSS at all — every
 * server-side check passed the whole time, because they drive it over HTTP. Needs a
 * conversation that has actually been through the pipeline:
 *   npx tsx scratchpad/seed-queue-demo.ts ticket
 */
await evaluate(`const b=byText(".topbar-nav button",/^Inbox$/i); if(b){b.click();return true} return false;`);
await sleep(1800);
console.log("inbox rows:", await evaluate(`return document.querySelectorAll(".inbox-row").length`));
await shot("02c-inbox");

const opened = await evaluate(`
  const rows=[...document.querySelectorAll(".inbox-row")];
  const r=rows.find(x=>/texts aren|queue-demo/i.test(x.textContent||"")) || rows[0];
  if(!r) return false; r.click(); return true;`);
console.log("ticket opened:", opened);
await sleep(2000);
const ticket = await evaluate(`
  const t=document.querySelector(".ticket");
  if(!t) return {rendered:false};
  const roles={};
  for(const m of document.querySelectorAll(".transcript .msg"))
    for(const c of m.classList) if(c.startsWith("msg-")&&c!=="msg") roles[c]=(roles[c]||0)+1;
  const banner=document.querySelector(".brand-banner");
  return {
    rendered:true,
    messages:document.querySelectorAll(".transcript .msg").length,
    roles,
    // The internal note and the transfer live in the SAME table as the transcript and
    // carry staff names — the desk must show them, the client must never.
    internalVisible:/internal/i.test(document.querySelector(".transcript")?.textContent||""),
    // NOT truncated, and the truncation is the point: at .slice(0,120) this driver could
    // never have shown that "Renamed:" was listing all 51 menu labels, six of them plus
    // "+45". The dashboard driver had the identical blind spot on the dry-run verdict. A
    // measurement that cuts off the thing under test is a measurement that agrees with you.
    brandBanner:(banner?.textContent||"").replace(/\\s+/g," ").trim(),
    renamedClause:((banner?.textContent||"").match(/Renamed:([^]*?)(Hidden from|How-to|Never say|No links|$)/)?.[1]||"(none - correct when the client renamed nothing)").replace(/\\s+/g," ").trim(),
    // The banner is directly above the compose box on purpose: last thing read before typing.
    bannerAboveCompose: banner && document.querySelector(".compose")
      ? banner.getBoundingClientRect().bottom <= document.querySelector(".compose").getBoundingClientRect().top + 1
      : null,
    badges:[...document.querySelectorAll(".plan,.ttype,.raised,.snoozed")].map(e=>e.textContent.trim()),
    citations:[...document.querySelectorAll(".msg-cites")].map(e=>e.textContent.trim()),
  };`);
console.log("ticket:", JSON.stringify(ticket, null, 1));
await shot("02d-ticket");

// --- Raise a ticket ------------------------------------------------------
/*
 * BACK TO THE QUEUE FIRST. "New ticket" lives in the queue board's header, and the steps
 * above navigate to the Inbox and open a ticket — so this searched the ticket view for a
 * button that is not on it, printed `NOT FOUND`, and then reported
 * `modal-backdrop present: false` as though that were a reading. Two lines that look like
 * findings, taken from a screen the modal was never opened on.
 *
 * That matters more here than for most steps: the NewTicket modal is the exact screen
 * `audit-styles.js` was written for — it shipped with no `position: fixed` backdrop at
 * all, so the "modal" simply appended itself below the fold. This step is the only thing
 * that can see that, and it has been silently looking elsewhere. Same family as the
 * generic-selector trap already recorded: a driver that clicks the wrong thing does not
 * fail, it describes another screen.
 */
await evaluate(`const b = byText(".topbar-nav button", /queue/i); if (b) b.click(); return !!b;`);
await sleep(1200);
const raiseFound = await evaluate(`
  const b = byText(".queue-head button", /new ticket|raise a ticket|raise ticket/i)
         || byText("button", /new ticket|raise a ticket|raise ticket/i);
  if (b) { b.click(); return true }
  return [...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join(" | ");`);
console.log("raise button:", raiseFound === true ? "clicked" : `NOT FOUND -> ${raiseFound}`);
await sleep(1200);
await shot("03-raise-ticket");
const backdrop = await evaluate(`
  const e = document.querySelector(".modal-backdrop");
  if (!e) return null;
  const s = getComputedStyle(e);
  return { position: s.position, z: s.zIndex, modal: !!document.querySelector(".modal") };`);
// Refuse to report a reading taken from a screen that never opened. "false" and "none"
// are what this printed for months while measuring nothing.
if (!backdrop) throw new Error("the New-ticket modal never opened — this step measures nothing, fix the driver before trusting it");
console.log("  modal backdrop:", JSON.stringify(backdrop));
console.log("  modal fits the viewport:", await evaluate(`
  const m = document.querySelector(".modal"); if (!m) return "no modal";
  const r = m.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= innerHeight ? "yes" : "NO — clipped, top=" + Math.round(r.top) + " bottom=" + Math.round(r.bottom) + " viewport=" + innerHeight;`));
// Close it again, or the Password step below clicks through a modal that is still open.
await evaluate(`const b = byText(".modal-actions button", /cancel|close/i); if (b) b.click(); return !!b;`);
await sleep(600);

// close it
await evaluate(`(byText("button", /^cancel$/i) || document.querySelector(".modal-head .icon"))?.click(); return true;`);
await sleep(800);

// --- Change password -----------------------------------------------------
const pwFound = await evaluate(`
  const b = byText("button", /^password$/i);
  if (b) { b.click(); return true }
  return [...document.querySelectorAll(".who button")].map(b=>b.textContent.trim()).join(" | ");`);
console.log("password button:", pwFound === true ? "clicked" : `NOT FOUND -> ${pwFound}`);
await sleep(1000);
await shot("04-change-password");
console.log("  modal present:", await evaluate(`return !!document.querySelector(".modal.narrow")`));

// type a mismatch to show the inline validation, and a wrong current password
await evaluate(`
  const ins = [...document.querySelectorAll(".modal-body input")];
  setVal(ins[0], ${JSON.stringify(DESK_PASSWORD)});
  setVal(ins[1], "a much better passphrase 42");
  setVal(ins[2], "a much better passphras");
  return true;`);
await sleep(500);
await shot("05-password-mismatch");
console.log("  inline error shown:", await evaluate(`return [...document.querySelectorAll(".modal-body .error")].map(e=>e.textContent).join(" / ") || "(none)"`));

/*
 * CLOSE THE PASSWORD MODAL. Left open, every Staff screenshot below was taken through it
 * — the DOM assertions still read the right cells, because `.click()` ignores what is on
 * top, but the pictures showed a dialog over the screen under test and a human clicking
 * there could not have reached it. Same trap already recorded for the dashboard's footer
 * button: the step that forgets to close leaves the next one rendering behind it.
 */
await evaluate(`const b = byText(".modal-actions button", /^cancel$/i); if (b) b.click(); return !!b;`);
await sleep(500);

// --- Staff -----------------------------------------------------------------
/*
 * The Staff screen, which had never been rendered until 2026-08-19 and had two defects
 * only a browser can see. `verify-staff.ts` proves the ROUTE refuses a bad limit and
 * carries a held-ticket count; neither says anything about what ends up in the cell.
 * That is the `verify-delivery` lesson exactly — that suite was 23/23 green while the
 * widget never called the endpoint under test — so the assertions here are about the DOM.
 *
 * Note the escape: `\\s` inside a template literal collapses to `s`, so every regex
 * passed to the browser doubles its backslashes. A driver that garbles what it reads is
 * worse than one that fails.
 */
await evaluate(`const b = byText(".topbar-nav button", /staff/i); if (b) b.click(); return !!b;`);
await sleep(1400);
await shot("06-staff");

const target = await evaluate(`
  const rows = [...document.querySelectorAll("tbody tr")];
  const you = rows.findIndex(r => /You\\s*$/.test(r.textContent));
  const other = rows.find((r, i) => i !== you);
  return other ? other.querySelector("td:nth-child(2)").textContent.trim() : null;`);
console.log("staff: editing the row for", target);

const rowOf = `[...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(target)}))`;
const storedLimit = await evaluate(`return ${rowOf}.querySelector("input[type=number]").value`);
console.log("staff: stored limit reads", storedLimit);

// A. a value the server will refuse must not be left on screen looking accepted.
await evaluate(`const i = ${rowOf}.querySelector("input[type=number]"); i.focus(); setVal(i, "99"); return true;`);
await evaluate(`${rowOf}.querySelector("input[type=number]").blur(); return true;`);
await sleep(1500);
await shot("07-staff-refused-limit");
console.log("staff: after a refused 99, the cell reads", await evaluate(`return ${rowOf}.querySelector("input[type=number]").value`),
  "(must be the stored value, not 99)");
console.log("staff: and the reason is IN THE ROW:", await evaluate(`return ${rowOf}.querySelector(".row-error")?.textContent.trim() ?? "(none)"`));

// B. an emptied box is a mid-edit state, not an instruction to route them nothing.
await evaluate(`const i = ${rowOf}.querySelector("input[type=number]"); i.focus(); setVal(i, ""); return true;`);
await evaluate(`${rowOf}.querySelector("input[type=number]").blur(); return true;`);
await sleep(1200);
await shot("08-staff-blank-limit");
console.log("staff: after clearing it, the cell reads", await evaluate(`return JSON.stringify(${rowOf}.querySelector("input[type=number]").value)`),
  "(must be the stored value, never \"\" or 0)");
console.log("staff: blank message:", await evaluate(`return ${rowOf}.querySelector(".row-error")?.textContent.trim() ?? "(none)"`));

// C. the blast radius of Disable, readable before the click.
console.log("staff: Holding column:", await evaluate(`
  const heads = [...document.querySelectorAll("thead th")].map(t => t.textContent.trim());
  const idx = heads.indexOf("Holding");
  if (idx < 0) return "NO Holding COLUMN";
  return [...document.querySelectorAll("tbody tr")]
    .map(r => r.querySelector("td:nth-child(2)").textContent.trim() + " -> " + r.querySelectorAll("td")[idx].textContent.trim())
    .join(" | ");`));

/*
 * `confirm()` BLOCKS the renderer, so Runtime.evaluate never returns while it is open —
 * the click must not be awaited, and the dialog is read from the CDP event rather than
 * the page. Cost one hung driver to learn.
 */
let dialog = null;
const onDialog = (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") dialog = m.params.message; };
ws.addEventListener("message", onDialog);
void evaluate(`const b = [...${rowOf}.querySelectorAll("button")].find(x => /disable/i.test(x.textContent)); if (b) b.click(); return true;`).catch(() => {});
await sleep(1200);
console.log("staff: the confirm says:", JSON.stringify(dialog));
// Dismissed: this driver renders the desk, it does not offboard anybody on it.
await send("Page.handleJavaScriptDialog", { accept: false });
ws.removeEventListener("message", onDialog);

ws.close();
await removeDeskUser("done");
console.log("done");
