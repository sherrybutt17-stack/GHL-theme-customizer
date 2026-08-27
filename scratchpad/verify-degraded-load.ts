/**
 * What the dashboard SAYS when part of it fails to load.
 *
 * `App.tsx` loads four resources through `allSettled` for a stated reason: a failure in a
 * secondary one — presets, the agency default theme, the support config — must not blank
 * out the sub-account list, which is the core of the page. That reasoning is right, and it
 * stopped one step short: "surface an error only if the essential locations call fails",
 * so the other three failed in COMPLETE SILENCE.
 *
 * Measured before the fix, by blocking each endpoint in a real browser and rendering: with
 * the default theme, the presets, or the support config failing, the page was byte for byte
 * indistinguishable from a healthy one — ten rows, no banner, every control in place. Not
 * blanking the page and not mentioning it are different decisions, and only the first had
 * been made.
 *
 * What each silence tells the agency, in their words rather than ours:
 *   - the default theme reads as "you have never set one", and its editor then opens as
 *     though there were nothing there;
 *   - the presets read as "you have no presets";
 *   - support reads as OFF, because `supportOn` starts false — a false statement about the
 *     switch that decides whether the widget appears in front of their clients.
 *
 * Both halves are asserted here, because a fix that reported the failure by emptying the
 * page would be worse than the silence: every case must ALSO still show the table.
 *
 *   1. npm run dev:server                            (3210)
 *   2. npm run dev --workspace apps/admin-dashboard  (5173)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1500,1000
 *   4. npx tsx scratchpad/verify-degraded-load.ts <agencyInstallId> [out-dir]
 */
import { writeFileSync } from "node:fs";

const [, , AGENCY, SHOTS] = process.argv;
if (!AGENCY) {
  console.error("usage: npx tsx scratchpad/verify-degraded-load.ts <agencyInstallId> [out-dir]");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
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
/** `\s` doubled: inside a template literal it collapses to `s` and eats every "s". */
const HELP = `
  const flat=(e)=>((e&&e.textContent)||"").replace(/\\s+/g," ").trim();
  const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test(flat(e)));
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

/**
 * `about:blank` between cases, because navigating to the same URL can be served from the
 * back/forward cache — which would replay the previous case's render and quietly make
 * every assertion a statement about the run before it.
 */
async function render(blocked: string[]): Promise<any> {
  await send("Network.setBlockedURLs", { urls: blocked });
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `http://localhost:5173/${AGENCY}` });
  await sleep(3800);
  return await ev(`
    return {
      rows: document.querySelectorAll("tbody tr").length,
      amber: flat(document.querySelector(".session-banner")) || null,
      red: flat(document.querySelector(".error-banner")) || null,
      /**
       * The PLAN cell specifically. Written first as "the first input in a row", which is
       * the Support toggle CHECKBOX — so it reported the guard broken while measuring a
       * different control entirely. Type-narrowed, and asserted to have found exactly one.
       */
      planInputs: document.querySelectorAll('tbody tr input[type="text"]').length,
      planDisabled: (()=>{const i=document.querySelector('tbody tr input[type="text"]');
        return i ? i.disabled : null;})(),
    };`);
}

async function main(): Promise<void> {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

  console.log("\n== the control: a healthy page says nothing ==");
  const ok = await render([]);
  console.log("  " + JSON.stringify(ok));
  check("the table loads", ok.rows > 0, JSON.stringify(ok));
  check("  ↳ and no banner is shown", !ok.amber && !ok.red, JSON.stringify(ok));
  const HEALTHY_ROWS = ok.rows;
  await shot("degraded-00-control");

  console.log("\n== the sub-account list is the one that IS essential ==");
  const noLocs = await render(["*/locations*"]);
  console.log("  " + JSON.stringify(noLocs));
  check("it reports in RED, as a failure rather than an instruction", !!noLocs.red, JSON.stringify(noLocs));
  await shot("degraded-01-locations");

  const cases: [string, string, RegExp][] = [
    ["the agency default theme", "*/default-theme*", /agency default theme/i],
    ["the saved presets", "*/presets*", /saved presets/i],
    ["the client support settings", "*/admin/api/*/support*", /client support settings/i],
  ];
  for (const [label, url, wanted] of cases) {
    console.log(`\n== ${label} fails ==`);
    const r = await render([url]);
    console.log("  " + JSON.stringify(r));
    check(`the page SAYS ${label} did not load`, !!r.amber && wanted.test(r.amber), r.amber ?? "(no banner at all)");
    /**
     * The other half, and the reason the original design chose silence: a fix that reported
     * the failure by emptying the page would be worse than saying nothing. The core list
     * has to survive every one of these.
     */
    check("  ↳ and the sub-account table is still there", r.rows === HEALTHY_ROWS, `${r.rows} rows against ${HEALTHY_ROWS}`);
    check(
      "  ↳ amber, not red — this is an instruction, not a fault they caused",
      !r.red,
      `a red error banner as well: ${r.red}`
    );
    check("  ↳ and it names the remedy", /reload/i.test(r.amber ?? ""), r.amber);
  }

  console.log("\n== …and support says what the screen is now getting WRONG ==");
  const sup = await render(["*/admin/api/*/support*"]);
  check(
    "the support message warns the status shown may be wrong",
    /may be wrong/i.test(sup.amber ?? ""),
    sup.amber
  );
  /**
   * Asserting the guard that was already there: with no config loaded, the Plan cell is
   * disabled rather than accepting a value it cannot save. A message that names a problem
   * beside a control that still looks usable is half a fix.
   */
  check(
    "  ↳ and the Plan cell refuses input rather than looking usable",
    sup.planInputs > 0 && sup.planDisabled === true,
    `found ${sup.planInputs} text input(s) in the table, disabled=${sup.planDisabled}`
  );
  await shot("degraded-02-support");

  await send("Network.setBlockedURLs", { urls: [] });
  console.log(`\n${"-".repeat(66)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    // Leaving a URL pattern blocked on the browser target would silently break the NEXT
    // driver that uses this Chrome, and it would look like a product failure.
    await send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
    process.exit(fail === 0 ? 0 : 1);
  });
