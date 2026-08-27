/**
 * Drive the AGENCY DASHBOARD in a real browser and screenshot it.
 *
 * Companion to `shoot-desk.mjs`, and it earned its place immediately: `audit-styles.js`
 * was green and the response-target rows still rendered ragged, because `.field label`
 * (0,1,1) beats a bare `.sla-row` (0,1,0) and forced the rows to `display: block`. A class
 * being DEFINED is not the same as its rule TAKING EFFECT, and only rendering shows it.
 *
 * TWO TRAPS, both of which produced a check that passed for the wrong reason:
 *
 *  1. `el.blur()` DOES NOTHING IF THE ELEMENT WAS NEVER FOCUSED. No blur event fires, so
 *     an onBlur save never runs. Proven both ways here: typing without focus left the
 *     database untouched while the box on screen showed the new text.
 *  2. The Plan input is UNCONTROLLED (`defaultValue`), so reading `el.value` back tells
 *     you what you just typed and nothing about whether it saved. Assert against the
 *     SERVER, never the input.
 *     That was ALSO a product bug, fixed 2026-08-19: `handlePlanChange` rolls the config
 *     back when a save fails — and with nothing remounting the input, the rollback could
 *     never reach the DOM, so a refused save left the typed plan sitting in the cell
 *     looking stored while the client kept being told the feature "isn't part of your
 *     setup". The cell now carries a `key` built from the stored plan. Asserting against
 *     the server is still the rule; what changed is that the cell agrees with it.
 *
 *   1. npm run dev:server                          (3210, APP_PUBLIC_URL=https://localhost:3210)
 *   2. npm run dev --workspace apps/admin-dashboard  (5173)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1600,1000
 *   4. node scratchpad/shoot-dashboard.mjs <output-dir> <agencyInstallId>
 */
import { writeFileSync } from "node:fs";

const [, , SHOTS, AGENCY] = process.argv;
if (!SHOTS || !AGENCY) {
  console.error("usage: node scratchpad/shoot-dashboard.mjs <output-dir> <agencyInstallId>");
  process.exit(1);
}

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HELP = `const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test((e.textContent||"").trim()));`;
const ev = async (body) => {
  const r = await send("Runtime.evaluate", { expression: `(()=>{${HELP}${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
  console.log("  shot:", name);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: `http://localhost:5173/${AGENCY}` });
await sleep(3500);

console.log("title:", await ev("return document.title"));
const rowCount = await ev(`return document.querySelectorAll("tbody tr").length`);
console.log("sub-account rows:", rowCount);
/*
 * An empty table is not a reading, it is a dead datastore. Every step below describes what
 * it found on the page, and on a blank page they describe nothing while looking like
 * measurements — the "printing readings from nothing" fault this file already records twice.
 * Caught it once for real: Docker had stopped, the dashboard rendered zero rows, and the
 * Reset step reported "no sub-account has a theme".
 */
if (rowCount === 0) {
  throw new Error("the dashboard rendered ZERO sub-accounts — check the server and the database before reading anything below");
}
console.log("Plan column present:", await ev(`return !!byText("th", /^Plan$/)`));
await shot("dash-01-locations");

/*
 * Reset deletes EVERY saved version of a sub-account's theme, not the current one — so the
 * History tab, which is the only way back from any other mistake in this editor, is emptied
 * with it. Measured on this database, two real sub-accounts were carrying 30 and 28 versions
 * behind a confirm that said only "its custom theme will be removed".
 *
 * The dialog is READ and then CANCELLED. Confirming it here would destroy a real client's
 * branding history to take a screenshot, which is the harness-writes-over-the-user's-data
 * failure this file already records six times.
 */
const resetDialog = await (async () => {
  const opened = await ev(`
    const b = byText("tbody tr button", /^Reset$/);
    if (!b) return null;
    b.click();
    return true;
  `);
  if (!opened) return { ran: false, reason: "no Reset button — no sub-account has a theme" };
  await sleep(500);
  const text = await ev(`
    const d = document.querySelector(".modal-overlay .modal");
    return d ? (d.textContent || "").replace(/\\s+/g, " ").trim() : null;
  `);
  // Cancel INSIDE this dialog, not the first Cancel on the page.
  await ev(`
    const d = document.querySelector(".modal-overlay .modal");
    const c = d && [...d.querySelectorAll("button")].find(b => /^Cancel$/.test((b.textContent||"").trim()));
    if (c) c.click();
    return !!c;
  `);
  await sleep(400);
  const stillOpen = await ev(`return !!document.querySelector(".modal-overlay")`);
  return { ran: true, text, stillOpen };
})();
console.log("reset confirm:", JSON.stringify(resetDialog));
if (resetDialog.ran) {
  if (resetDialog.stillOpen) throw new Error("Cancel left the reset dialog open — the next step would click through it");
  if (!/cannot be undone/i.test(resetDialog.text || "")) {
    throw new Error(`the reset confirm does not say it is irreversible: ${resetDialog.text}`);
  }
  console.log("  -> the dialog names the loss before the click");
}

/*
 * SNAPSHOT THE PLAN MAP FIRST, and put it back at the end.
 *
 * This driver types into a real agency's Plan column, and until now it simply left what
 * it typed there — so every run overwrote whatever the agency had recorded, with a value
 * from a screenshot script. That is the same fault this repo has now recorded in six
 * harnesses ("the harnesses were deleting the user's own data"), arriving through a
 * driver instead of a teardown. `planTiers` is what turns "isn't part of your setup" into
 * "isn't included on your Starter plan" in a real client's chat.
 */
const planBefore = (await (await fetch(`http://localhost:3210/admin/api/${AGENCY}/support`)).json())?.config;
const plansBefore = JSON.stringify(planBefore?.planTiers ?? {});
console.log("plan map before this run:", plansBefore);

/*
 * A whole-object PUT, because that is what the route is — sending the config we loaded
 * with only `planTiers` restored is exactly what the Plan cell does, and anything less
 * would clear the greeting, the blocked terms and the response targets.
 *
 * ARMED FOR THE FAILURE PATH TOO. The first version ran only at the end, so the one run
 * that threw part way — a step further down clicked a file input, and a native file
 * chooser blocks the renderer exactly as `confirm()` does — left the screenshot script's
 * test value sitting in a real agency's plan map. A restore that only happens when
 * nothing went wrong is missing precisely when it is needed.
 */
let restored = false;
async function restorePlans() {
  if (restored || !planBefore) return;
  restored = true;
  const put = await fetch(`http://localhost:3210/admin/api/${AGENCY}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...planBefore, planTiers: JSON.parse(plansBefore) }),
  });
  const now = (await (await fetch(`http://localhost:3210/admin/api/${AGENCY}/support`)).json())?.config;
  const ok = JSON.stringify(now?.planTiers ?? {}) === plansBefore;
  // Printed, because a restore nobody can see is a claim rather than a check.
  console.log(`plan map restored: ${JSON.stringify(now?.planTiers ?? {})}${ok ? "" : `  ** DID NOT MATCH (PUT ${put.status}) **`}`);
}
for (const ev of ["unhandledRejection", "uncaughtException"]) {
  process.on(ev, async (e) => {
    console.error(`\n${ev}:`, e instanceof Error ? e.message : e);
    await restorePlans().catch(() => {});
    process.exit(1);
  });
}
/*
 * …and a SIGNAL is neither of those, which cost a real agency's plan map on 2026-08-25.
 * A run was killed part way (two drivers had been started against one browser target and
 * were fighting over the same page), and `pkill` bypasses both handlers above — so the
 * step's own test value, "Enterprise Enterprise Enterprise…", was left sitting in
 * `planTiers` on a live sub-account. That column is what turns "isn't part of your setup"
 * into "isn't included on your Starter plan" in a client's chat.
 *
 * Same lesson `verify-kb-states` records for its fixtures: arm the cleanup on the signals
 * too, not only on the crash paths. Ctrl-C is how a driver usually dies.
 */
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, async () => {
    console.error(`\n${sig} — restoring before exit`);
    await restorePlans().catch(() => {});
    process.exit(130);
  });
}

// FOCUS FIRST — see trap 1 above.
await ev(`const el=document.querySelector(".plan-input"); el.focus();
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  set.call(el,"Starter"); el.dispatchEvent(new Event("input",{bubbles:true})); el.blur(); return true;`);
await sleep(1800);
console.log("error banner:", await ev(`return document.querySelector(".error-banner")?.textContent ?? "(none)"`));
// The server is the only witness that matters — see trap 2.
const saved = await (await fetch(`http://localhost:3210/admin/api/${AGENCY}/support`)).json();
console.log("planTiers ON THE SERVER:", JSON.stringify(saved?.config?.planTiers));
await shot("dash-02-plan-saved");

/*
 * …and the cell must now show what the SERVER holds, not what was typed. Sent with
 * padding and past the 60-character cap, so the stored value is provably different from
 * the keystrokes: pre-fix the box kept all 70 characters it was given.
 */
const overlong = "  " + "Enterprise ".repeat(7).trim() + "  ";
await ev(`const el=document.querySelector(".plan-input"); el.focus();
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  set.call(el,${JSON.stringify(overlong)}); el.dispatchEvent(new Event("input",{bubbles:true})); el.blur(); return true;`);
await sleep(1800);
const after = await (await fetch(`http://localhost:3210/admin/api/${AGENCY}/support`)).json();
const stored = Object.values(after?.config?.planTiers ?? {})[0] ?? "";
const onScreen = await ev(`return document.querySelector(".plan-input").value`);
console.log(`plan cell agrees with the server: ${onScreen === stored ? "yes" : "NO"}` +
  ` (typed ${overlong.length} chars, stored ${stored.length}, cell shows ${onScreen.length})`);

// --- Brand from websites ---------------------------------------------------
/*
 * The bulk-brand modal, which had never been rendered until 2026-08-19 and had no guard on
 * any of its three exits — while the Escape handler's own comment read "Never lose a long
 * pasted list to a stray Escape". `verify-bulk.ts` checks the dirty RULE without a browser;
 * this is the only thing that can show the rule is actually wired to the exits.
 *
 * Escape is dispatched through CDP rather than a synthetic KeyboardEvent, because the
 * handler is on `window` and a hand-built event is exactly the kind of thing that passes
 * while a real keypress would not.
 */
const pressEscape = async () => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};
const bulkState = () => ev(`
  const ms = [...document.querySelectorAll(".modal-overlay .modal")];
  const m = ms.find(x => /brand many/i.test(x.querySelector("h2")?.textContent || ""));
  const g = ms.find(x => /discard/i.test(x.querySelector("h2")?.textContent || ""));
  return {
    open: !!m,
    lines: (m?.querySelector("textarea")?.value || "").split("\\n").filter(Boolean).length,
    rows: m ? m.querySelectorAll(".bulk-row").length : 0,
    guard: g ? (g.querySelector(".modal-body p")?.textContent || "").replace(/\\s+/g, " ").trim() : null,
  };`);

await ev(`const b = byText("button", /brand from websites/i); if (b) b.click(); return !!b;`);
await sleep(900);
const names = await ev(`return [...document.querySelectorAll("tbody tr .loc-name, tbody tr td:first-child")]
  .map(e => (e.textContent||"").split("\\n")[0].trim()).filter(Boolean).slice(0, 3);`);
const pasted = ["190 Ranch, example.com", "711 MBS, example.com", "Nobody Ltd, example.com"].join("\n");
await ev(`const t = document.querySelector(".bulk-input"); t.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t, ${JSON.stringify(pasted)});
  t.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
console.log("bulk: typed a list ->", JSON.stringify(await bulkState()));

await pressEscape();
await sleep(500);
const guarded = await bulkState();
await shot("dash-07-bulk-discard-guard");
console.log("bulk: Escape ->", JSON.stringify(guarded));
if (!guarded.guard) throw new Error("Escape discarded the list with no prompt — the guard is not wired to the exits");

// Cancel must KEEP the work. A guard that loses it anyway is worse than none.
await ev(`const g = [...document.querySelectorAll(".modal-overlay .modal")]
  .find(x => /discard/i.test(x.querySelector("h2")?.textContent || ""));
  [...g.querySelectorAll(".modal-footer button")].find(b => /cancel/i.test(b.textContent)).click(); return true;`);
await sleep(500);
console.log("bulk: Cancel ->", JSON.stringify(await bulkState()), "(the list must still be there)");

// A backdrop click is the other exit, and the one the support modal was fixed for.
await ev(`document.querySelector(".modal-overlay").click(); return true;`);
await sleep(500);
console.log("bulk: backdrop click ->", JSON.stringify(await bulkState()));

// And Discard must genuinely close, or the guard is a trap of its own.
await ev(`const g = [...document.querySelectorAll(".modal-overlay .modal")]
  .find(x => /discard/i.test(x.querySelector("h2")?.textContent || ""));
  if (!g) return false;
  [...g.querySelectorAll(".modal-footer button")].find(b => /^discard$/i.test(b.textContent.trim())).click(); return true;`);
await sleep(600);
console.log("bulk: Discard ->", JSON.stringify(await bulkState()), "(open must be false)");

await ev(`const b=byText("button",/client support/i); if(b){b.click();return true} return false;`);
await sleep(1800);
console.log("response-target inputs:", await ev(`return document.querySelectorAll(".sla-row input").length`));
// The rows must line up: every input at the same x, or `.sla-name`'s width is inert again.
console.log("inputs left-aligned:", await ev(`
  const xs=[...document.querySelectorAll(".sla-row input")].map(i=>Math.round(i.getBoundingClientRect().left));
  return new Set(xs).size === 1 ? "yes ("+xs[0]+"px)" : "NO — ragged at "+xs.join(",");`));
await ev(`const m=document.querySelector(".modal-body"); if(m) m.scrollTop=m.scrollHeight; return true;`);
await sleep(600);
await shot("dash-03-response-targets");

/*
 * The Activity tab, and specifically the hand-off tile in the state EVERY install starts
 * in: conversations have reached a person and none have been categorised yet. It used to
 * require `types.length > 0`, so the whole tile vanished — the number this product calls
 * the agency's most actionable one showed them nothing, and hid its own reason.
 */
await ev(`const t=byText("button",/^Activity$/i); if(t){t.click();return true} return false;`);
await sleep(2200);
const handoff = await ev(`
  const lab=[...document.querySelectorAll("label")].find(l=>/what needed a person/i.test(l.textContent||""));
  if(!lab) return {rendered:false};
  const field=lab.closest(".field");
  return {
    rendered:true,
    rows:field.querySelectorAll(".topic-row").length,
    emptyList:!!field.querySelector(".topic-list") && field.querySelectorAll(".topic-row").length===0,
    // \\s, not \s: this whole block is a TEMPLATE LITERAL, so an unknown escape collapses
    // to the bare character and the regex becomes /s+/g — which silently ate every "s" in
    // the sentence being reported. A driver that garbles what it reads is worse than one
    // that fails, because the garbling reads as the product's own text.
    hint:(field.querySelector(".field-hint")?.textContent||"").replace(/\\s+/g," ").trim(),
  };`);
console.log("hand-off tile:", JSON.stringify(handoff));
await ev(`const m=document.querySelector(".modal-body"); if(m) m.scrollTop=m.scrollHeight; return true;`);
await sleep(500);
await shot("dash-04-handoff-types");

/*
 * "YOUR CONTENT" — the agency's own knowledge base, and the longest free text on the
 * screen. Rendered in the state EVERY install starts in: no articles of their own.
 */
await ev(`const t=byText(".tabs .tab",/^Your content$/i); if(t){t.click();return true} return false;`);
await sleep(1800);
const knowledge = await ev(`
  const root=document.querySelector(".modal-overlay .modal-body");
  return {
    count:(root.querySelector(".kb-count")?.textContent||"").trim(),
    emptyState:(root.querySelector(".empty-state")?.textContent||"").replace(/\\s+/g," ").trim().slice(0,80),
    feedRows:root.querySelectorAll(".kb-feeds .kb-row").length,
    addButton:!!byText(".modal-body button",/add article/i),
  };`);
console.log("your content:", JSON.stringify(knowledge));
await shot("dash-05-your-content");

// The draft guard: type, expect the standing marker, then Cancel and expect a prompt.
await ev(`const b=byText(".modal-body button",/add article/i); b.click(); return true;`);
await sleep(700);
await ev(`
  const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,"value").set;
    el.focus(); s.call(el,v); el.dispatchEvent(new Event("input",{bubbles:true}));};
  set(document.querySelector(".modal-body input[type=text]"),"Onboarding a new client");
  set(document.querySelector(".modal-body textarea"),"We set up your pipeline stages in the first week.");
  return true;`);
await sleep(500);
console.log("draft marker shown:", await ev(`return !!byText(".kb-edit-actions .unsaved-dot",/unsaved/i)`));
await shot("dash-06-article-draft");
await ev(`const c=byText(".kb-edit-actions button",/^cancel$/i); c.click(); return true;`);
await sleep(600);
console.log("discard prompt:", await ev(`
  const d=[...document.querySelectorAll(".modal, .confirm-dialog, .dialog")].map(e=>(e.textContent||"").trim()).find(t=>/discard/i.test(t));
  return d ? d.replace(/\\s+/g," ").slice(0,90) : "(none — a typed article would have been thrown away silently)";`));
await shot("dash-07-discard-article");
await ev(`const b=byText("button",/^discard$/i); if(b){b.click();return true} return false;`);
await sleep(600);

/*
 * THE DRY RUN — "Try it before you switch it on", the go-live gate, and never rendered.
 * A SIBLING overlay, not a child, so its backdrop click cannot close the settings modal
 * underneath it. Six real model calls, so this step is slow on purpose.
 */
await ev(`const t=byText(".tabs .tab",/^Setup$/i); t.click(); return true;`);
await sleep(1200);
await ev(`const b=byText(".support-tryit button",/try it/i); if(b){b.click();return true} return false;`);
await sleep(900);
console.log("overlays open (settings + dry run):", await ev(`return document.querySelectorAll(".modal-overlay").length`));
await shot("dash-08-dryrun-open");
await ev(`const b=byText(".modal-overlay button",/run the test/i); if(b){b.click();return true} return false;`);
for (let i = 0; i < 30 && !(await ev(`return !!document.querySelector(".dryrun-verdict")`)); i++) await sleep(2000);
const dry = await ev(`
  const v=document.querySelector(".dryrun-verdict");
  const rows=[...document.querySelectorAll(".dryrun-row")];
  return {
    // NOT truncated: the first pass sliced this to 140 chars and that is exactly what hid
    // the bug it was rendered to find - the line was listing all 51 menu labels as "your
    // names", and the tail is where you can see there are 51 of them.
    verdict:(v?.textContent||"").replace(/\\s+/g," ").trim(),
    namesClaimed:((v?.textContent||"").match(/using your names: ([^·]*)/)?.[1]||"(no rename clause - correct when nothing was renamed)").trim(),
    rows:rows.length,
    flagged:rows.filter(r=>r.classList.contains("bad")).length,
    emptyAnswers:rows.filter(r=>!(r.querySelector(".dryrun-a")?.textContent||"").trim()).length,
    firstAnswer:(rows[0]?.querySelector(".dryrun-a")?.textContent||"").replace(/\\s+/g," ").trim().slice(0,120),
    // Did the assistant run at all? The verdict is computed from GATE findings, so a bot
    // that answered nothing used to read "Nothing leaked." here — six polite hand-offs
    // under a pass badge, on the screen an agency uses to decide whether to switch it on.
    banner:(document.querySelector(".modal-overlay .session-banner")?.textContent||"").replace(/\\s+/g," ").trim(),
    badges:[...document.querySelectorAll(".dryrun-badge")].map(b=>(b.textContent||"").trim()),
  };`);
console.log("dry run:", JSON.stringify(dry, null, 1));
/*
 * A dry run that produced no answers must not read as a pass, and it must name the remedy.
 * Measured 2026-08-26 with the OpenAI account out of credits: allClean was TRUE, the verdict
 * said "Nothing leaked.", and nothing on the page said the model had never been called.
 */
if (dry.badges.includes("no answer")) {
  if (!dry.banner) throw new Error("rows report 'no answer' and there is no banner saying why");
  if (!/credits|OPENAI_API_KEY|key|rate-limit|again/i.test(dry.banner)) {
    throw new Error(`the banner names no remedy: "${dry.banner}"`);
  }
  if (/nothing leaked/i.test(dry.verdict)) {
    throw new Error(`the verdict reads as a PASS over answers the model never wrote: "${dry.verdict}"`);
  }
  console.log("  -> a dead model reads as a failure, with the remedy, not as 'Nothing leaked'");
} else if (/nothing leaked/i.test(dry.verdict)) {
  if (dry.banner) throw new Error(`a clean verdict beside a failure banner: "${dry.banner}"`);
  console.log("  -> the assistant answered and the gates found nothing");
}
await ev(`const m=document.querySelectorAll(".modal-body")[1]; if(m) m.scrollTop=200; return true;`);
await sleep(400);
await shot("dash-09-dryrun-results");
await ev(`const b=byText(".modal-footer button",/^close$/i); if(b){b.click();return true} return false;`);
await sleep(700);
console.log("overlays after closing the dry run:", await ev(`return document.querySelectorAll(".modal-overlay").length`));

/*
 * THE THEME EDITOR — the original product, the largest form in it, and never rendered.
 * Opened from a sub-account's "Edit" button. Carries the live preview, the look fields,
 * the features/renames tab and the History tab.
 */
/*
 * Close the support modal by its CANCEL button, not a bare ".modal-overlay button" - that picks
 * the first button in the overlay, which is a tab. The first run left the modal open and
 * opened the editor BEHIND it, then measured the modal and reported it as the editor. A
 * driver that clicks the wrong thing does not fail; it describes the wrong screen.
 */
// "Cancel" on the editing tabs, "Close" on Activity - the footer button is not the same
// word on every tab, and matching only one of them silently left the modal open.
await ev(`const c=byText(".modal-footer button, .modal-actions button, .modal button", /^(cancel|close)$/i); if(c){c.click(); return true} return false;`);
await sleep(900);
// Both overlays use `.modal-overlay`; the editor is the one carrying `.modal-lg`.
console.log("overlays open:", await ev(`return document.querySelectorAll(".modal-overlay").length`));
const editorOpen = await ev(`
  const b=[...document.querySelectorAll("tbody tr button")].find(x=>/^edit$/i.test((x.textContent||"").trim()));
  if(!b) return false; b.click(); return true;`);
console.log("editor opened:", editorOpen);
await sleep(2500);
const editor = await ev(`
  // The editor's OWN root: the overlay containing .modal-lg. Matching a bare
  // ".modal-overlay" is what let the support modal stand in for it and get measured
  // instead - the driver did not fail, it described the wrong screen.
  // NO BACKTICKS IN THIS BLOCK: it is interpolated into a template literal, so a backtick
  // in ordinary comment prose ends the string and the rest becomes code. Documented twice
  // already for supportWidgetScript.ts and kbSearch.ts; it reaches here the same way.
  const root=document.querySelector(".modal-overlay:has(.modal-lg)");
  if(!root) return {rendered:false, sawClasses:[...document.body.classList]};
  const tabs=[...root.querySelectorAll("button")].map(b=>(b.textContent||"").trim()).filter(t=>t.length&&t.length<24);
  return {
    rendered:true,
    tabs:tabs.slice(0,14),
    colorInputs:root.querySelectorAll('input[type=color]').length,
    preview:!!root.querySelector(".preview,.mosaic-preview,[class*=preview]"),
    // Every labelled control should have a control under it, not a label floating alone.
    labelsWithNoControl:[...root.querySelectorAll("label")].filter(l=>
      !l.querySelector("input,select,textarea,button") &&
      !(l.htmlFor && root.querySelector("#"+CSS.escape(l.htmlFor)))).length,
    unsavedMarker:!!byText("*", /unsaved changes/i),
  };`);
console.log("editor:", JSON.stringify(editor, null, 1));
await shot("dash-10-theme-editor");

/*
 * HISTORY. A real sub-account had 28 versions, several seconds apart, and each row showed a
 * number and a timestamp - so the only way to tell them apart was to click View on all 28.
 * The versions endpoint returns the WHOLE theme row and always did.
 */
await ev(`const t=byText(".modal-lg button", /^History$/i); if(t){t.click(); return true} return false;`);
await sleep(2200);
const history = await ev(`
  const rows=[...document.querySelectorAll(".version-row")];
  return {
    rows: rows.length,
    withSwatches: rows.filter(r=>r.querySelectorAll(".version-swatch").length>0).length,
    withBrand: rows.filter(r=>r.querySelector(".version-brand")).length,
    first: (rows[0]?.textContent||"").replace(/\\s+/g," ").trim().slice(0,70),
  };`);
console.log("history:", JSON.stringify(history));
await shot("dash-11-history");

/*
 * THE LOGIN TAB — agency-default only, and the one place an agency uploads a PHOTO.
 *
 * Both its uploaders used to report failures through `logoErr`, which renders inside the
 * BRANDING tab. The two blocks are mutually exclusive, so a failed upload here put its
 * message on a screen nobody was looking at and this button appeared to do nothing.
 * Driven with a file that reads fine and does not DECODE — the HEIC case, which
 * accept="image/*" admits on macOS and Chrome cannot read.
 */
await ev(`const c=byText(".modal-lg .modal-footer button, .modal-lg button", /^(cancel|close)$/i); if(c){c.click();return true} return false;`);
await sleep(800);
await ev(`const b=byText("button", /agency default/i); if(b){b.click(); return true} return false;`);
await sleep(2200);
/*
 * THE BRANDING TAB'S SIDEBAR-ICON ROW, read before leaving for the Login tab.
 *
 * It drew its swatch as `sidebarIconColor || accentColor || "#f59e0b"` under a hint saying
 * the icons "default to the accent color". `renderRules` emits an icon rule ONLY when the
 * field is set, so the swatch showed a colour the icons were not — and unlike the four
 * rows `lookFrom` materialises, this one stays empty through a save, so saving never made
 * the claim true.
 *
 * Asserted as a TOTAL property rather than "it currently reads not set": whatever this
 * agency has stored, the row must say WHICH it is, and the swatch and the Clear button
 * must agree with it. Then the round trip, because "not set" is only honest if there is a
 * way back — picking the same colour again fires no change event.
 */
const iconRow = await ev(`
  const row = [...document.querySelectorAll(".modal-lg .look-color-row")]
    .find(r => /sidebar icons/i.test(((r.querySelector(".look-color-label")||{}).textContent||"")));
  if(!row) return {found:false};
  const sw = row.querySelector(".look-swatch");
  return {
    found: true,
    reads: ((row.querySelector(".look-hex")||{}).textContent||"").trim(),
    hint: ((row.querySelector(".look-color-hint")||{}).textContent||"").trim(),
    hatched: sw ? sw.className.includes("look-swatch-unset") : null,
    swatchValue: sw ? sw.value : null,
    hasClear: !!row.querySelector("button"),
  };
`);
console.log("sidebar-icon row:", JSON.stringify(iconRow));
/*
 * …and the PREVIEW beside it told the same lie, which is the half an agency actually looks
 * at: `MosaicPreview` painted its glyphs `sidebarIconColor || look.accentColor`. Read the
 * computed colour off a non-active item — the first item is drawn active and gets #fff.
 */
const iconPaint = await ev(`
  const items = [...document.querySelectorAll(".modal-lg .mp-item")];
  if (items.length < 2) return {found:false, items: items.length};
  const it = items[1];
  const g = (el) => el ? getComputedStyle(el).color : null;
  const accentSwatch = [...document.querySelectorAll(".modal-lg .look-color-row")]
    .find(r => /accent/i.test(((r.querySelector(".look-color-label")||{}).textContent||"")));
  return {
    found: true,
    icon: g(it.querySelector(".mp-icon")),
    label: g(it.querySelector(".mp-label")),
    accentHex: accentSwatch ? ((accentSwatch.querySelector(".look-hex")||{}).textContent||"").trim() : null,
  };
`);
console.log("preview icon paint (field unset):", JSON.stringify(iconPaint));
if (!iconPaint.found) throw new Error(`the live preview rendered ${iconPaint.items} nav items — nothing to read`);
if (iconRow.reads === "not set") {
  const hexToRgb = (h) => {
    const m = /^#([0-9a-f]{6})$/i.exec(h || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  const accentRgb = hexToRgb(iconPaint.accentHex);
  if (accentRgb && iconPaint.icon === accentRgb) {
    throw new Error(`nothing is set, yet the preview paints the icons the ACCENT (${iconPaint.accentHex}) — the stylesheet emits no icon rule at all`);
  }
  if (iconPaint.icon !== iconPaint.label) {
    throw new Error(`unset icons should read as the labels do, got ${iconPaint.icon} against ${iconPaint.label}`);
  }
  console.log(`  -> unset icons read as the labels (${iconPaint.icon}), not as the accent (${iconPaint.accentHex})`);
}
if (!iconRow.found) throw new Error("no Sidebar icons row on the branding tab — the editor did not open");
if (/defaults to the accent/i.test(iconRow.hint)) {
  throw new Error(`the hint still promises a default the stylesheet has no rule for: "${iconRow.hint}"`);
}
{
  const unset = iconRow.reads === "not set";
  if (!unset && !/^#[0-9a-fA-F]{3,8}$/.test(iconRow.reads)) {
    throw new Error(`the row says neither a colour nor "not set": "${iconRow.reads}"`);
  }
  if (unset !== iconRow.hatched) throw new Error("the swatch and the label disagree about whether it is set");
  if (unset === iconRow.hasClear) throw new Error("Clear is offered exactly when there is nothing to clear");
  console.log(`  -> the row states its own state: ${unset ? "not set, hatched, no Clear" : iconRow.reads + ", Clear offered"}`);
}
const iconRoundTrip = await ev(`
  const row = [...document.querySelectorAll(".modal-lg .look-color-row")]
    .find(r => /sidebar icons/i.test(((r.querySelector(".look-color-label")||{}).textContent||"")));
  const sw = row.querySelector(".look-swatch");
  const set = (v) => {
    const proto = Object.getPrototypeOf(sw);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(sw, v);
    sw.dispatchEvent(new Event("input", {bubbles:true}));
    sw.dispatchEvent(new Event("change", {bubbles:true}));
  };
  set("#112233");
  return new Promise(r => setTimeout(() => {
    const after = [...document.querySelectorAll(".modal-lg .look-color-row")]
      .find(x => /sidebar icons/i.test(((x.querySelector(".look-color-label")||{}).textContent||"")));
    r({
      reads: ((after.querySelector(".look-hex")||{}).textContent||"").trim(),
      hatched: after.querySelector(".look-swatch").className.includes("look-swatch-unset"),
      hasClear: !!after.querySelector("button"),
    });
  }, 350));
`);
console.log("after picking #112233:", JSON.stringify(iconRoundTrip));
if (iconRoundTrip.reads !== "#112233" || iconRoundTrip.hatched || !iconRoundTrip.hasClear) {
  throw new Error("picking a colour did not make the row say so");
}
// …and the preview must follow, or "not set" is honest and "set" is decoration.
const iconPainted = await ev(`
  const it = [...document.querySelectorAll(".modal-lg .mp-item")][1];
  return it ? getComputedStyle(it.querySelector(".mp-icon")).color : null;
`);
console.log("preview icon paint (after picking):", iconPainted);
if (iconPainted !== "rgb(17, 34, 51)") {
  throw new Error(`picked #112233 and the preview icons render ${iconPainted}`);
}
const iconCleared = await ev(`
  const row = [...document.querySelectorAll(".modal-lg .look-color-row")]
    .find(r => /sidebar icons/i.test(((r.querySelector(".look-color-label")||{}).textContent||"")));
  row.querySelector("button").click();
  return new Promise(r => setTimeout(() => {
    const after = [...document.querySelectorAll(".modal-lg .look-color-row")]
      .find(x => /sidebar icons/i.test(((x.querySelector(".look-color-label")||{}).textContent||"")));
    r({
      reads: ((after.querySelector(".look-hex")||{}).textContent||"").trim(),
      hatched: after.querySelector(".look-swatch").className.includes("look-swatch-unset"),
    });
  }, 350));
`);
console.log("after Clear:", JSON.stringify(iconCleared));
if (iconCleared.reads !== "not set" || !iconCleared.hatched) {
  throw new Error("Clear did not return the sidebar-icon field to unset");
}
await shot("dash-11b-icon-row");

const loginTab = await ev(`const t=byText(".modal-lg button", /^Login( page)?$/i); if(t){t.click(); return true} return false;`);
console.log("login tab opened:", loginTab);
await sleep(900);
await shot("dash-12-login-branding");

/*
 * The login colour rows have a real UNSET state and had no way to show it. An
 * `<input type="color">` cannot be empty, so a blank background rendered as a `#0f172a`
 * swatch - byte for byte what somebody CHOOSING dark slate sees - beside a preview that
 * painted the whole frame dark slate, on a panel whose own copy says "leave a field blank
 * to skip it". The stylesheet delivers nothing for any of them.
 *
 * Read from the DOM, because the resolver being right proves nothing about the row.
 */
const loginRows = await ev(`
  const rows = [...document.querySelectorAll(".modal-lg .look-color-row")].map(r => ({
    label: ((r.querySelector(".look-color-label")||{}).textContent||"").trim(),
    reads: ((r.querySelector(".look-hex")||{}).textContent||"").trim(),
    clear: !!byText(".look-color-row button", /clear/i) && !!r.querySelector("button"),
  })).filter(r => /background color|sign-in button|login box/i.test(r.label));
  const frame = document.querySelector(".lp-frame");
  const note = ((document.querySelector(".lp-note")||{}).textContent||"").trim();
  return {
    rows,
    frameHatched: frame ? frame.className.includes("lp-unset") : null,
    frameBg: frame ? getComputedStyle(frame).backgroundImage.slice(0, 30) : null,
    note,
  };
`);
console.log("login rows:", JSON.stringify(loginRows, null, 2));
for (const r of loginRows.rows) {
  if (!r.reads) throw new Error(`login row "${r.label}" says nothing about whether it is set`);
}
if (loginRows.rows.length === 3 && loginRows.rows.every((r) => r.reads === "not set")) {
  if (!loginRows.frameHatched) throw new Error("nothing is set, yet the preview paints a background anyway");
  if (!/background/i.test(loginRows.note)) throw new Error("the preview does not say the background is unbranded");
  console.log("  -> unset is visible on the rows AND in the preview");
}

/*
 * …and the round trip, because "not set" is only honest if the agency can get BACK to it.
 * Picking the same colour again fires no change event, so without Clear an accidental
 * choice is permanent - and every colour on this tab is one the stylesheet delivers.
 */
const loginRoundTrip = await ev(`
  const row = [...document.querySelectorAll(".modal-lg .login-color-row")]
    .find(r => /background color/i.test((r.querySelector(".look-color-label")||{}).textContent||""));
  if (!row) return {ran:false};
  const input = row.querySelector('input[type="color"]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(input, "#112233");
  input.dispatchEvent(new Event("input", {bubbles:true}));
  return {ran:true, dashed: getComputedStyle(input).borderStyle};
`);
await sleep(400);
const afterPick = await ev(`
  const row = [...document.querySelectorAll(".modal-lg .login-color-row")]
    .find(r => /background color/i.test((r.querySelector(".look-color-label")||{}).textContent||""));
  const input = row.querySelector('input[type="color"]');
  const clear = [...row.querySelectorAll("button")].find(b => /clear/i.test(b.textContent||""));
  return {
    reads: ((row.querySelector(".look-hex")||{}).textContent||"").trim(),
    borderStyle: getComputedStyle(input).borderStyle,
    hasClear: !!clear,
    frameHatched: (document.querySelector(".lp-frame")||{className:""}).className.includes("lp-unset"),
    note: ((document.querySelector(".lp-note")||{}).textContent||"").trim(),
  };
`);
console.log("after picking a colour:", JSON.stringify(afterPick));
if (loginRoundTrip.ran) {
  if (afterPick.reads !== "#112233") throw new Error(`the row still reads "${afterPick.reads}" after a colour was picked`);
  if (afterPick.borderStyle === "dashed") throw new Error("the swatch still renders as a placeholder after a colour was picked");
  if (!afterPick.hasClear) throw new Error("no way back to unset — Clear is the only one, since re-picking the same colour fires nothing");
  if (afterPick.frameHatched) throw new Error("the preview still shows an unbranded background after a colour was picked");
  if (/background/.test(afterPick.note)) throw new Error("the preview still calls the background unbranded");
  const back = await ev(`
    const row = [...document.querySelectorAll(".modal-lg .login-color-row")]
      .find(r => /background color/i.test((r.querySelector(".look-color-label")||{}).textContent||""));
    [...row.querySelectorAll("button")].find(b => /clear/i.test(b.textContent||"")).click();
    return true;
  `);
  await sleep(400);
  const cleared = await ev(`
    const row = [...document.querySelectorAll(".modal-lg .login-color-row")]
      .find(r => /background color/i.test((r.querySelector(".look-color-label")||{}).textContent||""));
    return {
      reads: ((row.querySelector(".look-hex")||{}).textContent||"").trim(),
      frameHatched: (document.querySelector(".lp-frame")||{className:""}).className.includes("lp-unset"),
    };
  `);
  console.log("after Clear:", JSON.stringify(cleared), "clicked:", back);
  if (cleared.reads !== "not set" || !cleared.frameHatched) throw new Error("Clear did not return the field to unset");
  console.log("  -> set and unset are both reachable, and the preview follows");
}

/*
 * Every control carrying `.btn` must RENDER like a button.
 *
 * The upload control is a <label> (a file input needs one to be clickable) carrying
 * `.btn`, and `.field label` beat it - measured at uppercase / 700 / muted grey, i.e.
 * byte for byte the treatment of the heading directly above it, while every real button
 * beside it was none / 600 / accent. An agency scanning for a button saw two headings and
 * a URL box. Third instance of this specificity trap, and no static check of class names
 * can see any of them, which is why the assertion lives here in the pixels.
 */
const btnStyles = await ev(`
  const root=document.querySelector(".modal-overlay:has(.modal-lg)");
  const seen=[...root.querySelectorAll(".btn")].map(el=>{
    const cs=getComputedStyle(el);
    return {text:(el.textContent||"").trim().slice(0,20), transform:cs.textTransform, weight:cs.fontWeight};
  });
  const odd=seen.filter(b=>b.transform!=="none");
  return {total:seen.length, disguisedAsHeadings:odd};`);
console.log(
  btnStyles.disguisedAsHeadings.length === 0
    ? `buttons render as buttons: ${btnStyles.total}/${btnStyles.total}`
    : `FAIL - .btn rendered as a heading: ${JSON.stringify(btnStyles.disguisedAsHeadings)}`
);

const uploadResult = await ev(`
  const root=document.querySelector(".modal-overlay:has(.modal-lg)");
  const inputs=[...root.querySelectorAll('input[type=file]')];
  if(!inputs.length) return {ran:false, reason:"no file input on the login tab"};
  // Reads cleanly, decodes to nothing: exactly what a HEIC does in Chrome.
  const f=new File([new Uint8Array([0,1,2,3,4,5,6,7])], "hero.heic", {type:"image/heic"});
  const dt=new DataTransfer(); dt.items.add(f);
  Object.defineProperty(inputs[0], "files", {value: dt.files, configurable: true});
  inputs[0].dispatchEvent(new Event("change", {bubbles: true}));
  return {ran:true};`);
console.log("upload attempt:", JSON.stringify(uploadResult));
await sleep(1200);
const errWhere = await ev(`
  const root=document.querySelector(".modal-overlay:has(.modal-lg)");
  const onScreen=[...root.querySelectorAll(".field-error")].map(e=>(e.textContent||"").trim());
  // Which tab is showing right now: the message has to be on THIS one.
  const activeTab=(root.querySelector("button.tab.active")?.textContent||"").trim();
  return {activeTab, errorsVisibleOnThisTab:onScreen};`);
console.log("failed upload reported:", JSON.stringify(errWhere));
await shot("dash-13-login-upload-error");

ws.close();
await restorePlans();
console.log("done");
