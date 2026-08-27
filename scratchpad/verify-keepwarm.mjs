/**
 * The keep-warm ping, EXECUTED — not read.
 *
 * Theming is delivered by a render-blocking `@import`, so when the free Render instance
 * sleeps (about fifteen minutes idle, ~50s to wake) the stall lands on the client's whole
 * GHL UI rather than on a Mosaic screen. That is the deployment note's long-standing open
 * item and the most likely thing to be reported as "GHL is slow".
 *
 * It ships as a STEP inside `ticket-automations.yml` rather than a workflow of its own,
 * and that is arithmetic, not tidiness. Actions bills private repos by the minute and
 * rounds every job up to a whole one, so cadence alone sets a floor:
 *
 *     ticket-automations  6/hour -> 4,320 runs/month
 *     poll-feeds          1/hour ->   720
 *     floor                          5,040 min/month vs a 2,000-min free allowance
 *
 * Already 2.5x over before any real work; a separate 10-minute keep-warm would make it
 * 4.7x. Folded into the job that already runs every ten minutes it costs nothing.
 *
 * This suite pulls the script OUT OF THE WORKFLOW FILE and runs it against local stubs, so
 * it tests what GitHub would run rather than a copy that can drift — the same rule that
 * made the widget harness fetch the real pasted snippet instead of keeping its own.
 *
 *   node scratchpad/verify-keepwarm.mjs
 */
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer } from "node:http";

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).replace(/\n/g, "\n        ").slice(0, 400)}`); }
}

/**
 * Extract the step's `run:` block by hand, because this repo has no YAML parser as a
 * dependency and adding one so a harness can read a file is the wrong trade.
 *
 * The risk is extracting the WRONG text and then agreeing with yourself about it, so the
 * markers below are a positive control: if the block does not contain all of them, this
 * did not find the step and says so instead of testing an empty string.
 */
function extractStepScript(file, stepName) {
  const lines = readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (at < 0) throw new Error(`no step named "${stepName}" in ${file}`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s*run:\s*\|\s*$/.test(l));
  if (runAt < 0 || runAt - at > 40) throw new Error(`step "${stepName}" has no "run: |" block`);
  const indent = lines[runAt].match(/^\s*/)[0].length + 2;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") { body.push(""); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

const script = extractStepScript(".github/workflows/ticket-automations.yml", "Keep the web service warm");
console.log("\n== the script really is the one that ships ==");
for (const marker of ["APP_PUBLIC_URL is not set", "curl -sS", "/health", "::warning::", "--retry"]) {
  check(`extracted script contains ${JSON.stringify(marker)}`, script.includes(marker));
}
check("and it is a whole script, not a fragment", script.split("\n").length > 15, `${script.split("\n").length} lines`);

const run = (env) =>
  new Promise((res) => {
    execFile("bash", ["-c", script], { env: { ...process.env, ...env }, timeout: 120_000 }, (err, stdout, stderr) => {
      res({ code: err?.code ?? 0, out: `${stdout}${stderr}` });
    });
  });

/** A stand-in for the deployed server, so every branch is driven by a real HTTP answer. */
function stub(handler) {
  const srv = createServer(handler);
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ srv, port: srv.address().port })));
}

async function main() {
  console.log("\n== unconfigured is a supported state, not a red X ==");
  const none = await run({ BASE: "" });
  check("no APP_PUBLIC_URL: exits 0", none.code === 0, none.out);
  check("  ↳ and says how to set it, as a notice", /::notice::.*APP_PUBLIC_URL/.test(none.out), none.out);
  check("  ↳ naming Variables, since the URL is not a secret", /Variables/.test(none.out), none.out);

  console.log("\n== a healthy server ==");
  const ok = await stub((_, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"ok":true,"db":"up","ms":9}'); });
  let got = await run({ BASE: `http://127.0.0.1:${ok.port}` });
  check("200 is reported with its timing", /-> 200 in \d+s/.test(got.out), got.out);
  check("  ↳ the body is printed, so /health's own diagnosis is in the log", /"db":"up"/.test(got.out), got.out);
  check("  ↳ and a fast answer raises no warning", !/::warning::/.test(got.out), got.out);
  check("  ↳ exits 0", got.code === 0);

  console.log("\n== a trailing slash must not produce //health ==");
  got = await run({ BASE: `http://127.0.0.1:${ok.port}/` });
  check("the URL is built with exactly one slash", /http:\/\/127\.0\.0\.1:\d+\/health ->/.test(got.out), got.out);
  ok.srv.close();

  console.log("\n== the shape of the August 2026 outage ==");
  /**
   * `/health` does a real SELECT 1 and answers 503 with a reason when the datastore is
   * gone. During that outage the check was pointed at `/` and reported the service
   * perfectly healthy throughout, which is the whole reason it moved.
   */
  const sick = await stub((_, r) => { r.writeHead(503, { "content-type": "application/json" }); r.end('{"ok":false,"db":"down"}'); });
  got = await run({ BASE: `http://127.0.0.1:${sick.port}` });
  check("503 is warned about", /::warning::.*503/.test(got.out), got.out);
  check("  ↳ and still exits 0 — the automations step is what fails on a dead database", got.code === 0, `exit ${got.code}`);
  sick.srv.close();

  console.log("\n== a cold start is reported as the stall it is ==");
  /**
   * The number this prints IS the delay an agency's whole GHL UI would have taken, which
   * is why it is called out rather than left in the timing line.
   */
  const slow = await stub((_, r) => setTimeout(() => { r.writeHead(200); r.end('{"ok":true}'); }, 21_000));
  got = await run({ BASE: `http://127.0.0.1:${slow.port}` });
  check("a >20s wake is warned about", /::warning::.*[Ww]oke a sleeping instance/.test(got.out), got.out);
  check("  ↳ naming the render-blocking @import as why it matters", /@import/.test(got.out), got.out);
  check("  ↳ and it was NOT abandoned by the timeout", /-> 200 in 2\ds/.test(got.out), got.out);
  check("  ↳ exits 0", got.code === 0);
  slow.srv.close();

  console.log("\n== unreachable ==");
  const dead = await stub(() => {});
  const deadPort = dead.port;
  dead.srv.close();
  await new Promise((r) => setTimeout(r, 200));
  got = await run({ BASE: `http://127.0.0.1:${deadPort}` });
  check("a refused connection is warned about, not thrown", /::warning::.*000/.test(got.out), got.out);
  check("  ↳ and exits 0, so a runner hiccup never red-Xes the schedule", got.code === 0, `exit ${got.code}`);

  console.log(`\n${"-".repeat(58)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(() => process.exit(fail === 0 ? 0 : 1));
