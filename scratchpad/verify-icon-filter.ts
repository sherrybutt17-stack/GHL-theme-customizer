/**
 * The icon recolouring filter, asked what the BROWSER actually renders.
 *
 * `iconColorFilter.ts` solves a chain of invert/sepia/saturate/hue-rotate/brightness/
 * contrast numerically, because there is no closed form. Two claims ride on it and neither
 * had a test — the file has no `.test.ts` at all:
 *
 *   1. "black and white are exact; solved colours land within ~4/255 per channel"
 *   2. "a fixed-seed LCG keeps the same colour mapping to the same chain", because the CSS
 *      bundle is regenerated on EVERY request
 *
 * The second is the sharper one. `/theme-css` is `no-cache` with an ETag, so an unchanged
 * theme answers 304 with no body — and a solver that emitted a slightly different chain each
 * time would change the bytes, change the ETag, and ship a render-blocking stylesheet on
 * every page load of every sub-account. The optimisation would be silently dead for exactly
 * the agencies using this feature, and `verify-themecss-cache` could not see it: its fixture
 * sets `primaryColor` only, so the one part of the bundle that could churn was the one part
 * that suite never generated.
 *
 * Accuracy is measured in a REAL browser via `ctx.filter`, which takes the same filter
 * functions as CSS. Checking the solver against its own model of the filter spec would be
 * circular — the question is what a renderer does with the chain we ship.
 *
 *   npx tsx scratchpad/verify-icon-filter.ts
 */
import { cssFilterForColor } from "../apps/server/src/services/iconColorFilter";
import { renderRules } from "../apps/server/src/services/themeCssBundle";

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
    pending.set(n, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
async function ev(body: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression: "(()=>{" + body + "})()", returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}

/**
 * Paint pure black through the emitted chain and read the pixel back. `ctx.filter` accepts
 * the CSS filter grammar, so this is the renderer's own answer rather than ours.
 */
async function renderThrough(chains: string[]): Promise<[number, number, number][]> {
  const body =
    "const CHAINS = " + JSON.stringify(chains) + ";" +
    "const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;" +
    "const ctx = cv.getContext('2d', { willReadFrequently: true });" +
    "const out = [];" +
    "for (const chain of CHAINS) {" +
    "  ctx.filter = 'none'; ctx.clearRect(0,0,4,4);" +
    "  ctx.filter = chain; ctx.fillStyle = '#000000'; ctx.fillRect(0,0,4,4);" +
    "  const d = ctx.getImageData(2,2,1,1).data; out.push([d[0], d[1], d[2]]);" +
    "}" +
    "return out;";
  return await ev(body);
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

/**
 * Real brand colours, plus a coarse sweep of the whole RGB cube.
 *
 * A hand-picked list can only report "the worst I happened to try", and the first draft of
 * this file did exactly that: sixteen colours, worst error 7/255, which would have been
 * written down as the bound. The cube is what makes the number mean something.
 */
const BRAND = [
  "#0f766e", "#7c3aed", "#f59e0b", "#b91c1c", "#1e293b",
  "#22d3ee", "#84cc16", "#e11d48", "#334155", "#facc15",
  "#4f46e5", "#059669", "#db2777", "#0369a1",
];
const hx = (n: number) => n.toString(16).padStart(2, "0");
const CUBE: string[] = [];
for (let r = 0; r <= 255; r += 51) {
  for (let g = 0; g <= 255; g += 51) {
    for (let b = 0; b <= 255; b += 51) CUBE.push("#" + hx(r) + hx(g) + hx(b));
  }
}
/** Black and white lead, because they are the exact cases and are asserted on their own. */
const COLORS = ["#000000", "#ffffff", ...BRAND, ...CUBE.filter((c) => c !== "#000000" && c !== "#ffffff")];

async function main(): Promise<void> {
  await connect();

  console.log("\n== the chain the browser renders is the colour that was asked for ==");
  const chains = COLORS.map((c) => cssFilterForColor(c));
  check("every colour produced a chain", chains.every((c) => !!c), chains.filter((c) => !c).length + " were null");

  const painted = await renderThrough(chains.map((c) => c!));
  const errors: { hex: string; err: number; got: number[] }[] = [];
  COLORS.forEach((hex, i) => {
    const want = hexToRgb(hex);
    const got = painted[i];
    const err = Math.max(...want.map((v, k) => Math.abs(v - got[k])));
    errors.push({ hex, err, got });
  });
  // Print the brand colours in full and only the outliers from the cube — a table of 216
  // rows is a table nobody reads, and the tail is the part under test.
  for (const e of errors.slice(0, 2 + BRAND.length)) {
    console.log(`        ${e.hex}  ->  rgb(${e.got.join(",")})   worst channel off by ${e.err}`);
  }
  const tail = errors.slice(2 + BRAND.length).sort((a, b) => b.err - a.err).slice(0, 5);
  console.log("        worst five of the " + (errors.length - 2 - BRAND.length) + "-colour cube sweep:");
  for (const e of tail) {
    console.log(`        ${e.hex}  ->  rgb(${e.got.join(",")})   worst channel off by ${e.err}`);
  }

  /**
   * "Black and white are EXACT" is a stronger claim than the rest and is what most
   * white-label sidebars actually use, so it is asserted on its own terms.
   */
  check("black is exact", errors[0].err === 0, errors[0].got.join(","));
  check("white is exact", errors[1].err === 0, errors[1].got.join(","));

  /**
   * TWO bars, because the two populations are not the same question.
   *
   * Real brand colours are what agencies actually pick, and they fit well. The cube includes
   * the fully-saturated corners of the RGB space — 150 of its 214 entries are 100% saturated
   * — which no brand palette looks like, and some of those the chain simply cannot reach.
   *
   * Both are REGRESSION bars, set above what the code does today. Asserting the measured
   * figure would be a check that can only ever pass.
   */
  const brandErrs = errors.slice(2, 2 + BRAND.length).map((e) => e.err);
  const worstBrand = Math.max(...brandErrs);
  check(
    `real brand colours land within 8/255 per channel (worst ${worstBrand})`,
    worstBrand <= 8,
    errors.slice(2, 2 + BRAND.length).filter((e) => e.err > 8).map((e) => `${e.hex} off by ${e.err}`).join("; ")
  );

  const cube = errors.slice(2 + BRAND.length).map((e) => e.err).sort((a, b) => a - b);
  const worst = Math.max(...cube);
  const q = (f: number) => cube[Math.floor(cube.length * f)];
  check(
    `the saturated-corner sweep stays within 48/255 (worst ${worst})`,
    worst <= 48,
    errors.slice(2 + BRAND.length).filter((e) => e.err > 48).map((e) => `${e.hex} off by ${e.err}`).join("; ")
  );
  console.log(
    `        cube of ${cube.length}: median ${q(0.5)}  p90 ${q(0.9)}  worst ${worst}  ` +
      `(${cube.filter((e) => e > 4).length} exceed the 4/255 this was once documented as)`
  );

  console.log("\n== the same colour always yields the same chain ==");
  /**
   * The bundle is rebuilt on every request. A chain that drifted would change the ETag and
   * turn a 304 into a full render-blocking download, for every page load, for exactly the
   * agencies using this feature.
   */
  for (const hex of ["#0f766e", "#7c3aed", "#facc15"]) {
    const a = cssFilterForColor(hex);
    // Interleave other colours, in case any solver state leaks between calls.
    cssFilterForColor("#123456");
    cssFilterForColor("#abcdef");
    const b = cssFilterForColor(hex);
    check(`${hex} is stable across calls, with other colours solved in between`, a === b, `${a}\n        ${b}`);
  }

  console.log("\n== …and the STYLESHEET is byte-identical, which is what the ETag reads ==");
  const scope: any = { bases: ["#sidebar-v2"], prefix: "" };
  const theme = { primaryColor: "#0f766e", sidebarIconColor: "#facc15", sidebarTextColor: "#ffffff" };
  const first = renderRules(scope, theme as never).join("\n");
  const second = renderRules(scope, theme as never).join("\n");
  check("two generations of the same theme produce identical bytes", first === second, first.length + " vs " + second.length);
  check("…and the filter chain really is in them", /filter: brightness\(0\) saturate\(100%\)/.test(first));

  console.log("\n== an unusable colour emits NOTHING rather than a broken rule ==");
  /** The route's own rule: "Unparseable colour -> emit nothing rather than a broken rule." */
  for (const bad of ["", "not-a-colour", "#12", "rgb(1,2,3)"]) {
    check(`${JSON.stringify(bad)} yields no chain`, cssFilterForColor(bad) === null, cssFilterForColor(bad));
  }
  const broken = renderRules(scope, { sidebarIconColor: "not-a-colour" } as never).join("\n");
  check("and no filter rule is emitted for it", !broken.includes("filter:"), broken.slice(0, 160));

  console.log("\n" + "-".repeat(70) + "\n  " + pass + " passed, " + fail + " failed");
}

main()
  .catch((e) => { console.error("\nERROR:", e); fail++; })
  .finally(() => { try { ws?.close(); } catch {} process.exit(fail ? 1 : 0); });
