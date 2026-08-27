/**
 * Response targets: what the agency types is what gets stored.
 *
 * `slaFirstResponseMins` decides when the automations chase an unanswered ticket, raise a
 * tier and unassign it. The field clamped on every KEYSTROKE — `Math.max(5, Math.round(n))`
 * inside onChange — so any first digit below 5 was rewritten to a 5 and the rest appended
 * to it. Measured in a browser, keystroke by keystroke, before the fix:
 *
 *   type "240" into Normal -> 2 becomes 5, then 54, then 540
 *   type  "30" into Urgent -> 3 becomes 5, then 50
 *   clear a box entirely   -> 5
 *
 * The common targets all start with a digit below 5 (15, 30, 45, 120, 240, 480), so the
 * field stored the wrong number nearly every time somebody set one. 240 -> 540 leaves a
 * client waiting nine hours while the agency believes four; a cleared box -> 5 breaches
 * every ticket at that priority almost immediately, escalates it and unassigns it, which
 * is the backlog-manufactured-by-the-clock failure the open-hours rule exists to prevent.
 *
 * The clamp carried its own reason — "below the server's floor the save is refused
 * outright, which would lose the rest of the form's edits" — and that reason is real. It
 * is answered on BLUR instead, the same shape as the desk's maxConcurrent fix: refuse,
 * say so beside the row, and put the stored value back in the box.
 *
 * ONE LIMIT, stated rather than hidden: the GET RESOLVES the column against the code
 * defaults, so this harness cannot tell a stored `{15,60,240,480}` from a NULL column, and
 * its restore writes the resolved object either way. Identical today; not identical if the
 * defaults ever move, since a materialised policy would keep the old numbers while a NULL
 * one would follow the new ones. Run it against an agency whose policy you have set.
 *
 * This asserts the SERVER, not the input. The box showing "240" proves nothing about what
 * the automations will read — the Plan-cell lesson, which cost a driver a false pass.
 *
 *   1. npm run dev:server                            (3210)
 *   2. npm run dev --workspace apps/admin-dashboard  (5173)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1600,1000
 *   4. node scratchpad/verify-sla-input.mjs <agencyInstallId> [output-dir]
 */
import { writeFileSync } from "node:fs";

const [, , AGENCY, SHOTS] = process.argv;
if (!AGENCY) {
  console.error("usage: node scratchpad/verify-sla-input.mjs <agencyInstallId> [output-dir]");
  process.exit(1);
}
const API = "http://localhost:3210";

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

/**
 * A chrome-headless-shell started without a URL has no page target at all, and
 * `list.find(...)` then fails with "cannot read webSocketDebuggerUrl of undefined" —
 * which reads like a protocol bug rather than "there is no tab". Ask for one instead.
 */
async function pageTarget() {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = list.find((t) => t.type === "page");
  if (found) return found;
  const made = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  return made;
}
const page = await pageTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HELP = `
  const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test((e.textContent||"").trim()));
  const row=(n)=>[...document.querySelectorAll(".sla-row")].find(r=>(r.querySelector(".sla-name")?.textContent||"").trim()===n);
  const slaBox=(n)=>row(n)?.querySelector("input");
  const allSla=()=>[...document.querySelectorAll(".sla-row")].map(r=>[(r.querySelector(".sla-name").textContent||"").trim(), r.querySelector("input").value]);
`;
const ev = async (body) => {
  const r = await send("Runtime.evaluate", { expression: `(()=>{${HELP}${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
async function shot(name) {
  if (!SHOTS) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
}

/**
 * The GET answers an ENVELOPE — `{ config, locationsEnabled, locationsTotal }` — while the
 * PUT takes the bare config. `api.ts` declares both correctly and the first draft of this
 * harness read neither: it snapshotted the envelope and PUT it back, so the route saw no
 * `enabled` and no `escalationEmails` and, being whole-object, DELETED them. It turned the
 * agency's master switch off in the course of tidying up after itself.
 *
 * Recorded rather than quietly fixed, because it is the trap this file already documents
 * for `planTiers` — "a whole-object PUT makes every field the GET omits a deletion" — and
 * it caught the person writing the harness for it. Read what the GET actually returns.
 */
const getConfig = async () => (await (await fetch(`${API}/admin/api/${AGENCY}/support`)).json()).config;

/** Type into a box the way a person does: select what is there, then the digits. */
async function typeInto(name, text) {
  await ev(`const b=slaBox(${JSON.stringify(name)}); b.focus(); b.select(); return 1;`);
  const trail = [];
  for (const ch of text) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(110);
    trail.push(`${ch}->${await ev(`return slaBox(${JSON.stringify(name)}).value`)}`);
  }
  return trail;
}
async function blur(name) {
  await ev(`slaBox(${JSON.stringify(name)}).blur(); return 1;`);
  await sleep(300);
}

let snapshot = null;
async function main() {
  const before = await getConfig();
  if (!before || before.error) throw new Error(`could not read the support config: ${JSON.stringify(before)}`);
  // Snapshotted and restored, whole-object like the PUT itself. This suite edits the
  // agency's real response policy, which is exactly the column the automations enforce.
  snapshot = before;
  console.log(`\nresponse policy on entry: ${JSON.stringify(before.slaFirstResponseMins)}`);

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:5173/${AGENCY}` });
  await sleep(3800);
  await ev(`const b=byText("button",/client support/i); if(!b) return "no button"; b.click(); return "ok";`);
  await sleep(2600);

  console.log("\n== the form shows the policy the automations will actually use ==");
  const loaded = await ev(`return allSla();`);
  check("all four response targets render", Array.isArray(loaded) && loaded.length === 4, JSON.stringify(loaded));
  const shown = Object.fromEntries(loaded.map(([k, v]) => [k.toLowerCase(), Number(v)]));
  check(
    "  ↳ and they match the server's resolved policy",
    ["urgent", "high", "normal", "low"].every((k) => shown[k] === before.slaFirstResponseMins[k]),
    `screen ${JSON.stringify(shown)} vs server ${JSON.stringify(before.slaFirstResponseMins)}`
  );

  console.log("\n== typing a number leaves that number ==");
  /**
   * Every value here starts with a digit below 5 — 1, 3, 4 — because that is precisely
   * what the old clamp rewrote. And each must DIFFER from what is already stored, or the
   * save assertion at the end passes without the form having changed anything: the first
   * draft typed 240 into a target that already held 240 and went green either way.
   */
  const TYPED = { Normal: "120", Urgent: "30", Low: "45" };
  const key = (n) => n.toLowerCase();
  for (const [name, text] of Object.entries(TYPED)) {
    check(
      `${name}: the value being typed is not already stored (or this proves nothing)`,
      Number(text) !== before.slaFirstResponseMins[key(name)],
      `stored ${before.slaFirstResponseMins[key(name)]}, typing ${text}`
    );
    check(`${name}:   ↳ and starts with a digit the old clamp would have rewritten`, Number(text[0]) < 5, text);
  }
  for (const [name, text] of Object.entries(TYPED)) {
    const trail = await typeInto(name, text);
    const onScreen = await ev(`return slaBox(${JSON.stringify(name)}).value`);
    check(`${name}: typing "${text}" leaves "${text}"`, onScreen === text, `got "${onScreen}" — keystrokes: ${trail.join(" ")}`);
    await blur(name);
    check(`${name}:   ↳ and blur does not rewrite it`, (await ev(`return slaBox(${JSON.stringify(name)}).value`)) === text);
  }
  await shot("sla-01-typed");

  console.log("\n== a blank box is a mid-edit state, not an instruction ==");
  await ev(`const b=slaBox("High"); b.focus(); b.select(); return 1;`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", nativeVirtualKeyCode: 8, windowsVirtualKeyCode: 8 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", nativeVirtualKeyCode: 8, windowsVirtualKeyCode: 8 });
  await sleep(250);
  check("clearing it does not silently pick a number", (await ev(`return slaBox("High").value`)) === "");
  await blur("High");
  const highBack = await ev(`return slaBox("High").value`);
  check("  ↳ on blur the box goes back to what is STORED", Number(highBack) === before.slaFirstResponseMins.high, highBack);

  console.log("\n== below the floor is refused, beside the row ==");
  await typeInto("High", "3");
  await blur("High");
  const refused = await ev(`
    const r = row("High");
    const err = r.parentElement.querySelector(".field-error");
    if (!err) return { message: "(ABSENT)" };
    const er = err.getBoundingClientRect(), rr = r.getBoundingClientRect();
    return { message: err.textContent.trim(), pxBelowItsRow: Math.round(er.top - rr.bottom),
             boxNowShows: slaBox("High").value,
             otherRowsClean: [...document.querySelectorAll(".sla-grid .field-error")].length };
  `);
  check("a value below the floor is refused in words", /5 or more/.test(refused.message ?? ""), JSON.stringify(refused));
  check("  ↳ beside the row it belongs to", refused.pxBelowItsRow >= 0 && refused.pxBelowItsRow < 40, `${refused.pxBelowItsRow}px`);
  check("  ↳ and only that row is marked", refused.otherRowsClean === 1, JSON.stringify(refused));
  check("  ↳ the box shows the stored value, not the refused one", Number(refused.boxNowShows) === before.slaFirstResponseMins.high, refused.boxNowShows);
  await shot("sla-02-refused");

  console.log("\n== and the typed numbers reach the DATABASE, not just the box ==");
  await ev(`const b=byText(".modal-footer button",/^save/i)||byText("button",/^Save/); if(!b) return "no save"; b.click(); return "ok";`);
  await sleep(2500);
  const after = await getConfig();
  for (const [name, text] of Object.entries(TYPED)) {
    check(
      `Save stores ${name} = ${text}`,
      after.slaFirstResponseMins?.[name.toLowerCase()] === Number(text),
      JSON.stringify(after.slaFirstResponseMins)
    );
  }
  check(
    "  ↳ and the refused row kept its stored value",
    after.slaFirstResponseMins?.high === before.slaFirstResponseMins.high,
    `${after.slaFirstResponseMins?.high} vs ${before.slaFirstResponseMins.high}`
  );
  check(
    "  ↳ nothing else in the policy moved",
    JSON.stringify(after.greeting) === JSON.stringify(before.greeting) &&
      JSON.stringify(after.forbiddenTerms) === JSON.stringify(before.forbiddenTerms) &&
      JSON.stringify(after.planTiers) === JSON.stringify(before.planTiers) &&
      after.enabled === before.enabled,
    JSON.stringify({ greeting: after.greeting, planTiers: after.planTiers, enabled: after.enabled })
  );

  console.log(`\n${"-".repeat(58)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    if (snapshot) {
      // Whole-object, because the PUT is: anything omitted is a deletion.
      const res = await fetch(`${API}/admin/api/${AGENCY}/support`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),  // the bare config, never the envelope
      }).catch(() => null);
      const now = await getConfig().catch(() => null);
      console.log(
        `\ncleanup: response policy restored -> ${JSON.stringify(now?.slaFirstResponseMins)}` +
          (res && res.ok ? "" : "  (PUT FAILED — check it by hand)")
      );
    }
    process.exit(fail === 0 ? 0 : 1);
  });
