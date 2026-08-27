/**
 * "Your content" in every state except the one it has always been rendered in.
 *
 * The agency's own knowledge base is four screens wearing one tab: an article the bot can
 * use, an article QUARANTINED because something brand-shaped survived normalisation, an
 * article HELD because it arrived from a feed nobody has vouched for, and a feed that has
 * stopped working. `shoot-dashboard.mjs` renders it with a comment saying so — "in the
 * state EVERY install starts in: no articles of their own" — and that is the only state
 * anybody has ever looked at. Measured before writing this: the dev agency holds 0
 * articles and 0 feeds, so the list, both warning branches, the Publish button and the
 * whole feed panel are markup nothing has drawn.
 *
 * `audit-styles.js` is green on all of it — every class is defined — which is its
 * documented limit reached from another direction. `verify-kb-authoring` is green too,
 * because it drives the routes over HTTP, and a route cannot tell you what the row says.
 *
 * The distinction under test is the one the component's own comment calls out:
 *
 *   held with nothing to fix  -> waiting on a human, and CAN be published from here
 *   quarantined with terms    -> cannot be published at all, and the terms are named
 *
 * Server and client decide it the same way (`residualLeaks.length > 0`), which is right,
 * so what is worth checking is not the rule but whether the SCREEN acts on it: a Publish
 * button on a quarantined row offers an action the route answers 422 to.
 *
 * Everything planted is removed again, and the agency's existing rows are counted first
 * so the teardown can prove it put the tab back the way it found it.
 *
 *   1. npm run dev:server                            (3210)
 *   2. npm run dev --workspace apps/admin-dashboard  (5173)
 *   3. chrome-headless-shell --remote-debugging-port=9222 --headless --window-size=1600,1100
 *   4. npx tsx scratchpad/verify-kb-states.ts <agencyInstallId> [output-dir]
 */
import "../apps/server/src/services/loadEnv";
import { writeFileSync } from "node:fs";
import { prisma } from "../apps/server/src/services/prisma";

const [, , AGENCY, SHOTS] = process.argv;
if (!AGENCY) {
  console.error("usage: npx tsx scratchpad/verify-kb-states.ts <agencyInstallId> [output-dir]");
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}

const API = "http://localhost:3210";
const STAMP = Date.now();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** A page target, asked for rather than assumed — a shell started bare has no tab. */
async function pageTarget(): Promise<any> {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const found = (list as any[]).find((t) => t.type === "page");
  if (found) return found;
  return await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
}

let ws: WebSocket;
let msgId = 0;
const pending = new Map<number, (m: any) => void>();
/** tsx compiles this file to CJS, where top-level await is not available. */
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

/**
 * `\s` inside a template literal collapses to `s`, which silently eats every "s" out of
 * whatever it normalises — already recorded as a driver trap that reads like the product
 * rendering garbage. Doubled here.
 */
const HELP = `
  const flat=(e)=>((e&&e.textContent)||"").replace(/\\s+/g," ").trim();
  const byText=(s,re)=>[...document.querySelectorAll(s)].find(e=>re.test(flat(e)));
  const kbRows=()=>[...document.querySelectorAll(".modal-body .kb-list > .kb-row")].filter(r=>!r.closest(".kb-feeds"));
  const feedRows=()=>[...document.querySelectorAll(".modal-body .kb-feeds .kb-row")];
  const describe=(r)=>r?({
    title:flat(r.querySelector(".kb-row-title")),
    badges:[...r.querySelectorAll(".kb-badge")].map(flat),
    warn:flat(r.querySelector(".kb-row-warn"))||null,
    hint:flat(r.querySelector(".field-hint"))||null,
    buttons:[...r.querySelectorAll("button")].map(flat),
    held:r.classList.contains("kb-held"),
  }):null;
  const rowFor=(t)=>describe(kbRows().find(r=>flat(r.querySelector(".kb-row-title")).indexOf(t)>=0));
  const feedFor=(t)=>describe(feedRows().find(r=>flat(r).indexOf(t)>=0));
`;
async function ev(body: string): Promise<any> {
  const r = await send("Runtime.evaluate", {
    expression: `(()=>{${HELP}${body}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
}
async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
}

const madeArticles: string[] = [];
const madeFeeds: string[] = [];

/**
 * Cleanup armed on SIGNALS as well as on the normal path.
 *
 * A `finally` block does not run when the process is killed, and two interrupted runs of
 * this suite left their fixtures behind — after which the NEXT run matched a STALE row by
 * its human-readable title, clicked the retry on somebody else's feed, and reported the
 * product broken. The database this suite plants into is the same one it reads back, so a
 * teardown that only fires on success is missing exactly when it is needed: the same
 * lesson `shoot-dashboard.mjs` records for the Plan column, and the same
 * assumes-an-empty-database trap this repo has now hit six times.
 *
 * Rows are also tagged with a per-run stamp so a stray can never be mistaken for ours.
 */
let tornDown = false;
async function teardown(reason: string): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  const a = await prisma.kbArticle.deleteMany({ where: { id: { in: madeArticles } } }).catch(() => ({ count: -1 }));
  const f = await prisma.kbFeed.deleteMany({ where: { id: { in: madeFeeds } } }).catch(() => ({ count: -1 }));
  const left = await api("GET", `/admin/api/${AGENCY}/kb`).catch(() => ({ json: null } as any));
  const leftFeeds = await api("GET", `/admin/api/${AGENCY}/kb/feeds`).catch(() => ({ json: null } as any));
  console.log(
    `cleanup (${reason}): removed ${a.count} article(s) and ${f.count} feed(s) — ` +
      `${left.json?.articles?.length ?? "?"} article(s) and ${leftFeeds.json?.feeds?.length ?? "?"} feed(s) remain`
  );
  await prisma.$disconnect().catch(() => {});
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => { void teardown(sig).then(() => process.exit(130)); });
}

async function main(): Promise<void> {
  await connect();
  const before = await api("GET", `/admin/api/${AGENCY}/kb`);
  const feedsBefore = await api("GET", `/admin/api/${AGENCY}/kb/feeds`);
  const baseArticles = before.json?.articles?.length ?? 0;
  const baseFeeds = feedsBefore.json?.feeds?.length ?? 0;
  console.log(`\nbaseline: ${baseArticles} article(s), ${baseFeeds} feed(s) already on this agency`);

  console.log("\n== plant the four states ==");

  const clean = await api("POST", `/admin/api/${AGENCY}/kb`, {
    title: `Onboarding a new client ${STAMP}`,
    body:
      "Once your account is live we set up your pipeline stages in the first week. Book the " +
      "kickoff call from the calendar link in your welcome email and we will import your " +
      "existing contacts together on the call.",
  });
  check("a clean article saves ready", clean.status === 201 && clean.json?.status === "ready", JSON.stringify(clean.json));
  if (clean.json?.id) madeArticles.push(clean.json.id);

  /**
   * A REAL quarantine, produced the way one actually happens: a homoglyph the lexicon can
   * DETECT but cannot REPLACE. Writing the row by hand would let this harness invent a
   * shape the pipeline never stores, which is how a suite ends up asserting against itself.
   */
  const dirty = await api("POST", `/admin/api/${AGENCY}/kb`, {
    title: `Migrating from your old CRM ${STAMP}`,
    body:
      "If you are moving across from GoHighLeveI, export your contacts to CSV first and we " +
      "will map the fields for you before anything is imported into your new account.",
  });
  check(
    "an article naming another platform is quarantined, with the term named",
    dirty.status === 201 && dirty.json?.quarantined === true && (dirty.json?.residualLeaks?.length ?? 0) > 0,
    JSON.stringify(dirty.json)
  );
  if (dirty.json?.id) madeArticles.push(dirty.json.id);

  const feedOk = await api("POST", `/admin/api/${AGENCY}/kb/feeds`, {
    url: `https://example.com/blog/feed-${STAMP}.xml`,
  });
  check("a healthy feed is added", feedOk.status === 201, JSON.stringify(feedOk.json));
  if (feedOk.json?.feed?.id) madeFeeds.push(feedOk.json.feed.id);

  const feedBad = await api("POST", `/admin/api/${AGENCY}/kb/feeds`, {
    url: `https://example.org/rss-${STAMP}.xml`,
  });
  check("a second feed is added", feedBad.status === 201, JSON.stringify(feedBad.json));
  if (feedBad.json?.feed?.id) madeFeeds.push(feedBad.json.feed.id);

  /**
   * Two states no route can express, so they are written directly — and they are exactly
   * the states this harness exists to render:
   *
   *  - an article HELD from a feed (`forceReview` on an untrusted publisher): status
   *    needs_review with residualLeaks EMPTY, which is what tells the queue "nobody has
   *    read it" apart from "a brand term survived";
   *  - a feed the poller GAVE UP ON: ten consecutive failures, which sets `enabled:false`
   *    on top of the error rather than instead of it.
   */
  const heldTitle = `What changed in the September release ${STAMP}`;
  const held = await prisma.kbArticle.create({
    data: {
      agencyInstallId: AGENCY,
      source: "agency",
      sourceUrl: `https://example.com/blog/post-${STAMP}`,
      feedId: feedOk.json?.feed?.id ?? null,
      titleNormalized: heldTitle,
      bodyNormalized:
        "We have added a new way to tag contacts straight from the conversation view, so " +
        "you no longer have to open the contact record to file it.",
      contentHash: `verify-kb-states-${STAMP}`,
      status: "needs_review",
      featureTags: [],
    },
    select: { id: true },
  });
  madeArticles.push(held.id);
  check("an item held from a feed exists with nothing to fix", true);

  const GIVE_UP_AT = 10;
  await prisma.kbFeed.update({
    where: { id: feedBad.json.feed.id },
    data: {
      title: `Example Org — Product news ${STAMP}`,
      enabled: false,
      consecutiveErrors: GIVE_UP_AT,
      lastError: "HTTP 404",
      lastPolledAt: new Date(Date.now() - 26 * 24 * 3600 * 1000),
    },
  });
  await prisma.kbFeed.update({
    where: { id: feedOk.json.feed.id },
    data: { title: `Example Co — Blog ${STAMP}`, lastPolledAt: new Date(Date.now() - 40 * 60 * 1000) },
  });

  console.log("\n== render the tab ==");
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:5173/${AGENCY}` });
  await sleep(3800);
  const opened = await ev(`const b=byText("button",/client support/i); if(!b) return "no button"; b.click(); return "ok";`);
  check("the support settings open", opened === "ok", opened);
  await sleep(1200);
  const tab = await ev(`const t=byText(".tabs .tab",/^Your content$/i); if(!t) return "no tab"; t.click(); return "ok";`);
  check("the Your content tab opens", tab === "ok", tab);
  await sleep(2000);

  const counts = await ev(`return {articles:kbRows().length, feeds:feedRows().length};`);
  console.log(`rendered: ${counts.articles} article row(s), ${counts.feeds} feed row(s)`);
  check(
    "the three planted articles render as rows",
    counts.articles === baseArticles + 3,
    `${counts.articles} rows against a baseline of ${baseArticles} + 3 planted`
  );
  check("both feeds render", counts.feeds === baseFeeds + 2, `${counts.feeds} rows`);
  await shot("kb-01-your-content-populated");

  console.log("\n== A. the three article states are distinguishable ==");
  const readyRow = await ev(`return rowFor("Onboarding a new client ${STAMP}");`);
  const dirtyRow = await ev(`return rowFor("Migrating from your old CRM ${STAMP}");`);
  const heldRow = await ev(`return rowFor(${JSON.stringify(heldTitle)});`);
  console.log("  ready:      " + JSON.stringify(readyRow));
  console.log("  quarantined:" + JSON.stringify(dirtyRow));
  console.log("  held:       " + JSON.stringify(heldRow));

  check("a usable article carries no warning and no badge", !!readyRow && !readyRow.warn && readyRow.badges.length === 0, JSON.stringify(readyRow));
  check("  ↳ and offers no Publish button — there is nothing to publish", !!readyRow && !readyRow.buttons.some((b: string) => /publish/i.test(b)), JSON.stringify(readyRow?.buttons));

  check("a quarantined article says it is held back", !!dirtyRow && dirtyRow.badges.some((b: string) => /held back/i.test(b)), JSON.stringify(dirtyRow?.badges));
  /**
   * AS TYPED. The defanged scan used to report its own folded token, so this line read
   * `Mentions "gohighievei"` — a canonicalised string that appears nowhere in the article,
   * so searching for it finds nothing. The whole point of naming the term is that they can
   * delete it.
   */
  check(
    "  ↳ and NAMES the term exactly as they typed it",
    !!dirtyRow?.warn && /GoHighLeveI/.test(dirtyRow.warn),
    dirtyRow?.warn
  );
  /**
   * ONE occurrence is one thing to fix. Two lexicon entries fire on "GoHighLeveI"
   * (`defanged-gohighlevel` and `defanged-highlevel`), and listing both reads as two
   * separate mistakes — then deleting the first silently removes the second.
   */
  const quoted = (dirtyRow?.warn ?? "").match(/[“"][^”"]+[”"]/g) ?? [];
  check(
    "  ↳ and names it ONCE, not once per lexicon rule that fired",
    quoted.length === 1,
    `${quoted.length} term(s) quoted: ${JSON.stringify(quoted)}`
  );
  check(
    "  ↳ and offers NO Publish button, because the route would 422 it",
    !!dirtyRow && !dirtyRow.buttons.some((b: string) => /publish/i.test(b)),
    JSON.stringify(dirtyRow?.buttons)
  );

  check("a feed item says it is waiting for a human", !!heldRow?.warn && /waiting for your review/i.test(heldRow.warn), heldRow?.warn);
  check(
    "  ↳ and DOES offer Publish — this is the one state a person can clear",
    !!heldRow && heldRow.buttons.some((b: string) => /publish/i.test(b)),
    JSON.stringify(heldRow?.buttons)
  );

  console.log("\n== …and the refusal the screen implies is the one the route gives ==");
  /**
   * The button's absence is only correct if the route really would refuse. Asserted
   * against the server rather than inferred from the missing button, because "the UI
   * hides it" and "the action is impossible" are different claims and only one of them
   * survives somebody adding a second caller.
   */
  const forced = await api("POST", `/admin/api/${AGENCY}/kb/${madeArticles[1]}/approve`);
  check("approving a quarantined article is refused (422)", forced.status === 422, `${forced.status} ${JSON.stringify(forced.json)}`);

  console.log("\n== B. Publish, and assert the SERVER — not the row that redrew itself ==");
  const clicked = await ev(`
    const r=kbRows().find(x=>((x.querySelector(".kb-row-title")||{}).textContent||"").indexOf(${JSON.stringify(heldTitle)})>=0);
    if(!r) return "row gone";
    const b=[...r.querySelectorAll("button")].find(x=>/publish/i.test(flat(x)));
    if(!b) return "no publish button";
    b.click(); return "clicked";`);
  check("the Publish button is clickable", clicked === "clicked", clicked);
  await sleep(1200);
  const storedStatus = (await prisma.kbArticle.findUnique({ where: { id: held.id }, select: { status: true } }))?.status;
  check("  ↳ and the article is actually ready in the database", storedStatus === "ready", storedStatus);
  const afterRow = await ev(`return rowFor(${JSON.stringify(heldTitle)});`);
  check(
    "  ↳ and the row stops offering it",
    !!afterRow && !afterRow.buttons.some((b: string) => /publish/i.test(b)) && !afterRow.warn,
    JSON.stringify(afterRow)
  );
  await shot("kb-02-published");

  console.log("\n== C. a feed that stopped working ==");
  const okFeed = await ev(`return feedFor("Example Co — Blog ${STAMP}");`);
  const badFeed = await ev(`return feedFor("Example Org — Product news ${STAMP}");`);
  console.log("  healthy: " + JSON.stringify(okFeed));
  console.log("  broken:  " + JSON.stringify(badFeed));

  check("a healthy feed says when it was last checked", !!okFeed?.hint && /last checked/i.test(okFeed.hint), okFeed?.hint);
  check("a broken feed names the error", !!badFeed?.warn && /404/.test(badFeed.warn), badFeed?.warn);
  check(
    "  ↳ and the failure COUNT, not a hardcoded 1",
    !!badFeed?.warn && new RegExp(`${GIVE_UP_AT} times`).test(badFeed.warn),
    badFeed?.warn
  );
  check(
    "  ↳ and says we have STOPPED checking, not merely that it is paused",
    !!badFeed && /stopped checking/i.test(badFeed.warn ?? ""),
    JSON.stringify({ badges: badFeed?.badges, warn: badFeed?.warn })
  );
  check(
    "  ↳ and is distinguishable from a feed the agency paused on purpose",
    !!badFeed && !badFeed.badges.some((b: string) => /^paused$/i.test(b)),
    JSON.stringify(badFeed?.badges)
  );
  check(
    "  ↳ and the button says it is a RETRY, not a resume",
    !!badFeed && badFeed.buttons.some((b: string) => /try again/i.test(b)),
    JSON.stringify(badFeed?.buttons)
  );
  await shot("kb-03-feeds");

  console.log("\n== …and retrying it forgives the fault on BOTH sides ==");
  /**
   * The route clears `lastError` and the counter when a feed is re-enabled — deliberately,
   * so it gets its full allowance back rather than one poll before it re-disables. The
   * toggle was optimistic on `enabled` alone, so the row went on reporting "Failed 10
   * times in a row, so we've stopped checking it" over a feed that was running again.
   */
  const retried = await ev(`
    const r=feedRows().find(x=>flat(x).indexOf("Example Org — Product news ${STAMP}")>=0);
    if(!r) return "row gone";
    const b=[...r.querySelectorAll("button")].find(x=>/try again/i.test(flat(x)));
    if(!b) return "no retry button";
    b.click(); return "clicked";`);
  check("the retry is clickable", retried === "clicked", retried);
  await sleep(1000);
  const storedFeed = await prisma.kbFeed.findUnique({
    where: { id: feedBad.json.feed.id },
    select: { enabled: true, lastError: true, consecutiveErrors: true },
  });
  check(
    "  ↳ the server re-enables it and forgives the counter",
    storedFeed?.enabled === true && storedFeed?.lastError === null && storedFeed?.consecutiveErrors === 0,
    JSON.stringify(storedFeed)
  );
  const retriedRow = await ev(`return feedFor("Example Org — Product news ${STAMP}");`);
  check(
    "  ↳ and the row stops reporting a fault we have just forgiven",
    !!retriedRow && !retriedRow.warn && retriedRow.badges.every((b: string) => !/stopped|paused/i.test(b)),
    JSON.stringify(retriedRow)
  );
  await shot("kb-04-feed-retried");

  console.log(`\n${"-".repeat(66)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    // Only what this run made. The agency's own rows were counted, never touched.
    await teardown("done");
    process.exit(fail === 0 ? 0 : 1);
  });
