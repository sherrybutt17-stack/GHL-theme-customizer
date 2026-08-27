/**
 * Render the SUPPORT WIDGET the way a client meets it, and screenshot it.
 *
 * This is the only surface that appears in front of the agency's own customers, inside
 * their CRM, and nothing had ever looked at it in a browser.
 *
 * IT LOADS THE REAL SNIPPET. `scratchpad/harness/location/<id>/index.html` inlines a COPY
 * of the widget script, which is a copy of something generated server-side from a template
 * literal — so it can silently drift from what actually ships, and rendering it would prove
 * something about the copy. This fetches `jsSnippet` from the embed endpoint: byte for byte
 * what the agency pastes into GHL's Custom JavaScript field.
 *
 *   1. npm run dev:server  (3210, APP_PUBLIC_URL=https://localhost:3210)
 *   2. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1280,900
 *   3. node scratchpad/shoot-widget.mjs <out-dir> <agencyInstallId> <ghlLocationId>
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [, , SHOTS, AGENCY, LOCATION] = process.argv;
if (!SHOTS || !AGENCY || !LOCATION) {
  console.error("usage: node scratchpad/shoot-widget.mjs <out-dir> <agencyInstallId> <ghlLocationId>");
  process.exit(1);
}

const embed = await (await fetch(`http://localhost:3210/admin/api/${AGENCY}/embed`)).json();

/*
 * THE ONE EDIT MADE TO THE REAL PASTE, and it is a local-dev artefact rather than a defect.
 *
 * `env.ts` requires APP_PUBLIC_URL to be https EVEN LOCALLY (so that isProductionUrl() can
 * treat a localhost host as dev), while `npm run dev:server` serves plain HTTP. The snippet
 * is built from APP_PUBLIC_URL, so every fetch in it points at https://localhost:3210 —
 * which nothing is listening to. Rendered as-is the widget builds NOTHING and looks broken.
 *
 * That is also why this had never been rendered: the harness page under
 * scratchpad/harness/ sidesteps it by inlining a stale copy of the script, and the DOM-stub
 * suites stub fetch, so the origin never mattered to them. The consequence worth knowing is
 * that a defect in the GENERATED javascript would first appear in production.
 *
 * The rewrite is asserted to touch the scheme and nothing else.
 */
const RAW = embed.jsSnippet;
const snippet = RAW.split("https://localhost:3210").join("http://localhost:3210");
const rewrites = RAW.split("https://localhost:3210").length - 1;
console.log(`jsSnippet: ${RAW.length} bytes, ${rewrites} origin(s) rewritten https->http for local dev`);
if (snippet.length !== RAW.length - rewrites) {
  throw new Error("the origin rewrite changed more than the scheme — refusing to render something that is not the real paste");
}

/*
 * Served over HTTP on a real origin, not file://. The widget reads window.location to work
 * out which sub-account it is in, and file:// has no path of the shape it looks for — so a
 * file:// harness would exercise the "no sub-account" branch and render nothing, which is
 * indistinguishable from the widget being broken.
 */
const PORT = 4599;
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Mock sub-account</title>
<style>body{margin:0;font:14px/1.5 system-ui;background:#f6f7fb;height:100vh}
.pad{padding:28px;color:#334155}</style></head>
<body><div class="pad"><h2>Sub-account page</h2>
<p>Standing in for GHL's own chrome. The widget is the only thing under test here.</p></div>
<script>${snippet}</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});
await new Promise((r) => server.listen(PORT, r));

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = list.find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
const ev = async (body) => {
  const r = await send("Runtime.evaluate", { expression: `(()=>{${body}})()`, returnByValue: true, awaitPromise: true });
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
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
// The URL shape the widget parses to find its sub-account.
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/v2/location/${LOCATION}/dashboard` });
await sleep(4000);

/*
 * Everything is inside a SHADOW ROOT — non-negotiable, or Mosaic's own !important theme CSS
 * would style Mosaic's own widget. So every query below has to cross that boundary; a plain
 * document.querySelector finds nothing and reads exactly like a widget that never rendered.
 */
const HOST = `const h=[...document.querySelectorAll("*")].find(e=>e.shadowRoot); const R=h&&h.shadowRoot;`;
console.log("shadow host found:", await ev(`${HOST} return !!R;`));
console.log("bubble:", await ev(`${HOST} const b=R&&R.querySelector(".bubble"); return b?getComputedStyle(b).backgroundColor:"(none)";`));
await shot("widget-01-bubble");

await ev(`${HOST} R.querySelector(".bubble").click(); return true;`);
await sleep(1500);
const panel = await ev(`${HOST}
  const p=R.querySelector(".panel"); if(!p) return {open:false};
  const cs=getComputedStyle(p);
  return {
    open:true,
    header:(R.querySelector(".hd")?.textContent||"").trim(),
    headerBg:getComputedStyle(R.querySelector(".hd")).backgroundColor,
    greeting:(R.querySelector(".bub")?.textContent||"").trim().slice(0,90),
    quickActions:[...R.querySelectorAll(".qa button")].map(b=>b.textContent.trim()),
    // A panel taller than the viewport is one whose composer the client cannot reach.
    fitsViewport: p.getBoundingClientRect().bottom <= window.innerHeight + 1,
    composerVisible: !!R.querySelector(".ft textarea"),
    // The one thing that must never appear.
    namesVendor:/gohighlevel|highlevel|lead ?connector/i.test(R.innerHTML),
    linksOut:[...R.querySelectorAll("a[href]")].map(a=>a.getAttribute("href")),
  };`);
console.log("panel:", JSON.stringify(panel, null, 1));
await shot("widget-02-panel");

server.close();
ws.close();
console.log("done");
