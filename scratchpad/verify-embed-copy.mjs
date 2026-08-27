/**
 * "Get embed code" — the screen the whole product depends on, driven in a real browser.
 *
 * Nothing about Mosaic works until the agency has that one @import line in GHL's Custom
 * CSS, and the JavaScript snippet beside it is what delivers the tab title, the favicon
 * and the client support bubble. This modal had never been opened in a browser.
 *
 * CLAUDE.md already records the sharp bug here: "Copied!" was shown for a copy that never
 * happened, because `navigator.clipboard.writeText` returns a PROMISE and the rejection
 * landed outside the try meant to catch it. That is fixed and stays fixed — this suite
 * executes the shipped helper against stub clipboards rather than reading it.
 *
 * WHAT RENDERING FOUND (2026-08-20) is the mirror of that bug. The failure was honest and
 * delivered where nobody was looking: ONE message, rendered just under the one-line embed,
 * for all THREE copy buttons. Measured at 1440x780 with both disclosures expanded:
 *
 *   Copy JavaScript fails -> the only report is 450px ABOVE, and reads "select the line
 *                            above", which from there is the @import line, not the 31KB
 *                            snippet that just failed. Wrong instructions.
 *   Copy full CSS  fails -> 891px above and SCROLLED CLEAN OUT of the modal body. The
 *                            label does not change on failure, so there is nothing on
 *                            screen at all — a dead button.
 *
 * The copy-failure path is the documented production case: GHL iframes this dashboard
 * cross-origin, where navigator.clipboard is blocked, and there is no clipboard API at
 * all on plain http (local dev, ngrok). So this is the path, not an edge of it.
 *
 * Both stubs below drive the SHIPPED helper, not a copy of it:
 *   success — execCommand returns false, the async clipboard resolves  (the real fallback
 *             ordering: execCommand is tried first because it is what works in the iframe)
 *   failure — execCommand returns false, there is no clipboard API      (plain http)
 *
 *   1. npm run dev:server                            (3210)
 *   2. npm run dev --workspace apps/admin-dashboard  (5173)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1600,1000
 *   4. node scratchpad/verify-embed-copy.mjs <agencyInstallId> [output-dir]
 */
import { writeFileSync } from "node:fs";

const [, , AGENCY, SHOTS] = process.argv;
if (!AGENCY) {
  console.error("usage: node scratchpad/verify-embed-copy.mjs <agencyInstallId> [output-dir]");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
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

/**
 * `byText` and `warnInfo` are injected into every evaluation. `warnInfo` is the load-bearing
 * one: it reports which button the message is actually attached to by walking BACKWARDS to
 * the nearest preceding button, which is the property that was wrong — the old message was
 * a sibling of the import button no matter which copy had failed.
 */
const HELP = `
  const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test((e.textContent||"").trim()));
  const warns=()=>[...document.querySelectorAll(".modal p")].filter(p=>/Couldn't copy automatically/.test(p.textContent||""));
  const warnInfo=()=>{
    const ws=warns();
    if(ws.length!==1) return {count:ws.length};
    const w=ws[0], body=document.querySelector(".modal .modal-body");
    const btns=[...document.querySelectorAll(".modal button")];
    let owner=null;
    for(const b of btns){ if(b.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING) owner=b; }
    const wr=w.getBoundingClientRect(), br=owner.getBoundingClientRect(), bo=body.getBoundingClientRect();
    return {
      count:1, text:(w.textContent||"").trim(), owner:(owner.textContent||"").trim(),
      pxBelowOwner: Math.round(wr.top - br.bottom),
      insideVisibleBody: wr.top >= bo.top - 1 && wr.bottom <= bo.bottom + 1,
    };
  };
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

/** Stub the two clipboard paths the shipped helper tries, in the order it tries them. */
const CLIPBOARD = {
  succeeds: `document.execCommand=()=>false;
             Object.defineProperty(navigator,"clipboard",{value:{writeText:()=>Promise.resolve()},configurable:true});`,
  fails: `document.execCommand=()=>false;
          Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true});`,
};

async function main() {
  await send("Page.enable");
  await send("Runtime.enable");
  // Deliberately NOT a tall test viewport: the defect is about a message leaving the
  // scrolled modal body, and a 1000px window hides it on one of the two buttons.
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 780, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:5173/${AGENCY}` });
  await sleep(3500);

  console.log("\n== the modal opens and hands over a real one-line embed ==");
  const opened = await ev(`const b=byText("button",/^Get embed code$/); if(!b) return "no button"; b.click(); return "ok";`);
  check("the toolbar has a Get embed code button", opened === "ok", opened);
  await sleep(2200);
  const head = await ev(`
    const m=document.querySelector(".modal-overlay .modal");
    if(!m) return null;
    return { header:m.querySelector(".modal-header h2")?.textContent,
             line:(m.querySelector("pre")?.textContent||"").trim() };
  `);
  check("it renders", head !== null);
  check(
    "the one-line embed is this agency's @import, not a placeholder",
    /^@import url\(".*\/theme-css\//.test(head?.line ?? "") && head.line.includes(AGENCY),
    head?.line
  );
  await shot("embed-01-open");

  console.log("\n== a copy that WORKS says so, and reports no failure ==");
  await ev(CLIPBOARD.succeeds + "return 1;");
  await ev(`byText("button",/Copy one-line embed/).click(); return 1;`);
  await sleep(400);
  check(
    "the button reports Copied!",
    (await ev(`return !!byText("button",/^Copied!$/)`)) === true
  );
  check("and nothing claims a failure", (await ev(`return warns().length`)) === 0);

  console.log("\n== every failing button reports BESIDE ITSELF ==");
  /**
   * THE load-bearing section. Each button is asserted on three things a wrongly-placed
   * message cannot satisfy: it is owned by the button that failed, it sits within a line
   * of it, and it is inside the part of the modal body currently on screen.
   */
  await ev(CLIPBOARD.fails + "return 1;");
  await ev(`byText("button",/Show the JavaScript snippet/).click(); return 1;`);
  await sleep(300);
  await ev(`byText("button",/Show full CSS/).click(); return 1;`);
  // The "Copied!" label from the section above lasts 2s. Looking for the buttons by their
  // resting text before it lapses finds nothing, and reads as a missing button.
  await sleep(2200);

  const cases = [
    ["Copy one-line embed", "/^Copy one-line embed$/", /select the line above|the line above is selected/],
    ["Copy JavaScript", "/^Copy JavaScript$/", /the code above/],
    ["Copy full CSS", "/^Copy full CSS$/", /the code above/],
  ];
  for (const [label, re, wording] of cases) {
    // Scroll it to the BOTTOM edge — what a person does to reach a button further down,
    // and the position in which the old message went under the fold.
    await ev(`byText("button",${re}).scrollIntoView({block:"end"}); return 1;`);
    await sleep(250);
    await ev(`byText("button",${re}).click(); return 1;`);
    await sleep(450);
    const w = await ev(`return warnInfo();`);
    check(`${label}: exactly one failure message on screen`, w.count === 1, JSON.stringify(w));
    check(`${label}:   ↳ attached to the button that failed`, w.owner === label, `owner was "${w.owner}"`);
    check(`${label}:   ↳ within a line of it`, w.pxBelowOwner >= 0 && w.pxBelowOwner < 60, `${w.pxBelowOwner}px`);
    check(`${label}:   ↳ and actually on screen, not scrolled out of the body`, w.insideVisibleBody === true, JSON.stringify(w));
    check(`${label}:   ↳ names the right thing to copy by hand`, wording.test(w.text ?? ""), w.text);
    await shot(`embed-fail-${label.replace(/\s+/g, "-")}`);
  }

  console.log("\n== the manual fallback is performable ==");
  /**
   * "Select the code above" is fine for a 90-byte line and close to useless for a 31KB
   * snippet in a 260px scroll box, so the failure puts the caret round it. The message
   * SAYS it is selected; this asserts the selection really holds that snippet, because a
   * claim nobody checks is how the "Copied!" bug got here in the first place.
   */
  await ev(`byText("button",/^Copy JavaScript$/).click(); return 1;`);
  await sleep(400);
  const sel = await ev(`
    const pres=[...document.querySelectorAll(".modal pre")];
    const js=pres[1];
    const s=(window.getSelection()||{toString:()=>""}).toString();
    return { selLen:s.length, jsLen:(js.textContent||"").length,
             same: s.trim() === (js.textContent||"").trim(),
             claimsSelected: /is selected/.test(warns()[0]?.textContent||"") };
  `);
  check("the message claims the snippet is selected", sel.claimsSelected === true, JSON.stringify(sel));
  check(
    "  ↳ and the browser's selection really is that snippet",
    sel.same === true && sel.jsLen > 10000,
    `selected ${sel.selLen} chars, snippet is ${sel.jsLen}`
  );

  console.log("\n== retrying the same button clears its own message ==");
  /**
   * Deliberately scoped to the SAME button. A failure on the JavaScript snippet is not
   * made untrue by the full-CSS button working afterwards, and each message clears on its
   * own 4s timer — so the property worth pinning is that a successful retry replaces the
   * failure it belongs to, rather than leaving "Copied!" and "Couldn't copy" side by side.
   */
  await ev(CLIPBOARD.succeeds + "return 1;");
  await ev(`byText("button",/^Copy JavaScript$/).click(); return 1;`);
  await sleep(400);
  const retried = await ev(`
    const btns=[...document.querySelectorAll(".modal button")].map(b=>(b.textContent||"").trim());
    return { warnings: warns().length, copied: btns.filter(t=>t==="Copied!").length };
  `);
  check("the retry reports Copied!", retried.copied === 1, JSON.stringify(retried));
  check("  \u21b3 and its own failure message is gone", retried.warnings === 0, JSON.stringify(retried));

  console.log("\n== and it closes behind itself ==");
  /**
   * Not politeness. A harness that leaves an overlay up disables whatever runs next in the
   * same browser — `verify-sla-input` failed to reach the support settings for exactly this
   * reason, which read as a broken driver rather than a modal in the way. The same trap is
   * already recorded for `shoot-desk`'s password dialog.
   */
  await ev(`byText(".modal-footer button", /^Close$/).click(); return 1;`);
  await sleep(500);
  check("Close leaves nothing on top of the dashboard", (await ev(`return document.querySelectorAll(".modal-overlay").length`)) === 0);

  /* ------------------------------------------------------------------------------
   * THE SECOND DOOR: /onboarding/:agency.
   *
   * There are two screens that hand the paste over, and CLAUDE.md records them drifting
   * once already — one shipped the theme bundle alone while the other shipped both halves.
   * `embedSnippet.ts` fixed WHAT they hand over. What they DO when the copy fails was never
   * reconciled, and this is the page an agency meets first, straight off the OAuth redirect.
   *
   * Measured 2026-08-27 with every clipboard route failing:
   *
   *   both buttons -> label "Select & copy", selection length 0, and back to "Copy" after
   *                   2.5 seconds.
   *
   * Two defects the dashboard modal had already been fixed for. The instruction was not
   * PERFORMABLE — fine for a 90-byte @import line, close to useless for the 31KB snippet in
   * a scroll box — and the report of failure was TRANSIENT, so looking away left a normal
   * "Copy" button over a clipboard that still held whatever it held before.
   * ------------------------------------------------------------------------------ */
  console.log("\n== the other screen that hands the paste over ==");
  await send("Page.navigate", { url: `http://localhost:3210/onboarding/${AGENCY}` });
  await sleep(2500);
  check("the onboarding page renders", (await ev(`return document.title`)) === "Mosaic — Finish setup");
  await ev(CLIPBOARD.fails + "return 1;");
  await ev(`const d=document.querySelector("details"); if(d) d.open=true; return 1;`);
  await sleep(200);

  for (const [label, sel, minLen, head] of [
    ["the one-line embed", "#copy-btn", 60, "@import"],
    ["the 31KB JS snippet", "#copy-js-btn", 20000, "(function"],
  ]) {
    await ev(`document.querySelector(${JSON.stringify(sel)}).click(); return 1;`);
    await sleep(250);
    const now = await ev(`
      const b = document.querySelector(${JSON.stringify(sel)});
      const s = window.getSelection();
      return { label: b.textContent.trim(), failed: b.classList.contains("copy-failed"),
               len: s ? String(s.toString()).length : -1, head: s ? String(s.toString()).slice(0, 12) : "" };`);
    check(`${label}: a failed copy says so ON THE BUTTON`, /press|Ctrl|\u2318/i.test(now.label), JSON.stringify(now));
    check(`${label}:   \u21b3 and looks failed, not merely worded differently`, now.failed === true, JSON.stringify(now));
    // The property the wording cannot supply: the browser's selection really holds it.
    check(`${label}:   \u21b3 the text is SELECTED, so the fallback is one keystroke`, now.len >= minLen, `${now.len} chars`);
    check(`${label}:   \u21b3 and it is the right text`, now.head.startsWith(head), JSON.stringify(now.head));

    await sleep(2700);
    const after = await ev(`
      const b = document.querySelector(${JSON.stringify(sel)});
      return { label: b.textContent.trim(), failed: b.classList.contains("copy-failed") };`);
    check(
      `${label}:   \u21b3 and the failure does NOT time out back to "Copy"`,
      after.failed === true && after.label !== "Copy",
      JSON.stringify(after)
    );
  }

  // The control: a copy that WORKS must still say Copied! and must still time out, because
  // there is nothing left for the reader to do.
  await ev(CLIPBOARD.succeeds + "return 1;");
  await ev(`document.querySelector("#copy-btn").click(); return 1;`);
  await sleep(300);
  const okNow = await ev(`const b=document.querySelector("#copy-btn"); return { label: b.textContent.trim(), failed: b.classList.contains("copy-failed") };`);
  check("a copy that works still reports Copied!", okNow.label === "Copied!" && okNow.failed === false, JSON.stringify(okNow));
  await sleep(2700);
  check("  \u21b3 and THAT one does time out", (await ev(`return document.querySelector("#copy-btn").textContent.trim()`)) === "Copy");

  console.log(`\n${"-".repeat(58)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(() => process.exit(fail === 0 ? 0 : 1));
