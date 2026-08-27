/**
 * Serve a GHL-shaped sub-account page with the REAL support widget on it, so the whole
 * client half can be exercised by hand in a browser.
 *
 * The persistent twin of `shoot-widget.mjs`, which does the same thing and then exits after
 * a screenshot. Same two constraints, both recorded in that file's header and both worth
 * repeating because either one makes the widget look broken rather than absent:
 *
 *   - IT LOADS THE REAL SNIPPET from /admin/api/:agency/embed, not a copy. The harness page
 *     under scratchpad/harness/ inlines a copy of a script that is GENERATED from a template
 *     literal, so it drifts silently, and rendering it proves something about the copy.
 *   - THE ONLY EDIT IS THE SCHEME. env.ts requires APP_PUBLIC_URL to be https even locally,
 *     while `npm run dev:server` serves plain http, so every fetch in the snippet points at
 *     https://localhost:3210, which nothing is listening to. The rewrite is asserted to
 *     change exactly the byte count of the scheme, or this refuses to serve something that
 *     is not the real paste.
 *
 * Served over http on a path shaped like a real sub-account URL, never file:// — the widget
 * reads window.location to work out which sub-account it is in, and a file:// page has no
 * path of that shape, so it takes the "no sub-account" branch and builds nothing.
 *
 *   node scratchpad/serve-widget.mjs <agencyInstallId> <ghlLocationId> [port]
 */
import { createServer } from "node:http";

const [, , AGENCY, LOCATION, PORT_ARG] = process.argv;
if (!AGENCY || !LOCATION) {
  console.error("usage: node scratchpad/serve-widget.mjs <agencyInstallId> <ghlLocationId> [port]");
  process.exit(1);
}
const PORT = Number(PORT_ARG ?? 4599);

const res0 = await fetch(`http://localhost:3210/admin/api/${AGENCY}/embed`);
if (!res0.ok) throw new Error(`embed endpoint -> ${res0.status}. Is the API up on 3210?`);
const embed = await res0.json();

const RAW = embed.jsSnippet;
const snippet = RAW.split("https://localhost:3210").join("http://localhost:3210");
const rewrites = RAW.split("https://localhost:3210").length - 1;
if (snippet.length !== RAW.length - rewrites) {
  throw new Error("the origin rewrite changed more than the scheme — refusing to serve something that is not the real paste");
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Sub-account — widget test</title>
<style>
 body{margin:0;font:14px/1.6 system-ui,sans-serif;background:#f6f7fb;color:#334155;height:100vh}
 .pad{padding:32px;max-width:640px}
 h2{margin:0 0 4px}
 code{background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:13px}
 .note{margin-top:20px;padding:14px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px}
</style></head>
<body><div class="pad">
  <h2>Mock sub-account page</h2>
  <p>Standing in for GHL's own chrome. The bubble in the corner is the only thing under test.</p>
  <div class="note">
    <div>sub-account <code>${LOCATION}</code></div>
    <div>agency <code>${AGENCY}</code></div>
    <div style="margin-top:8px">Running the real pasted snippet (${RAW.length} bytes, ${rewrites} origin(s) rewritten https&rarr;http for local dev).</div>
  </div>
</div>
<script>${snippet}</script></body></html>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(PORT, () => {
  console.log(`widget test page:  http://localhost:${PORT}/v2/location/${LOCATION}/dashboard`);
  console.log(`(any path works — the widget only needs /location/<id>/ in it)`);
});
