/**
 * The crawler's stop conditions, against a real HTTP server.
 *
 * All three of these were found by pointing the crawler at help.gohighlevel.com, and all
 * three reported success while doing the wrong thing:
 *
 *  1. `--dry-run` WROTE. `ingestArticle` was called unconditionally and the flag only chose
 *     how to log the result. A 3-page dry run left 2 rows behind.
 *  2. The template detector's abort DID NOT ABORT. It threw from inside the per-article
 *     `try`, whose `catch` counts one failure and moves on — so after the host started
 *     refusing us the crawl made 217 more requests to a server that had said stop.
 *  3. The abort message printed the CURRENT page rather than the repeated text, so it
 *     showed a perfectly good article beside a claim that everything looked alike. That
 *     made a true positive read as a false one.
 *  4. On a portal that publishes article JSON, a page WITHOUT any fell back to HTML — which
 *     on a JS-rendered portal is the page shell. 41 shells out of 68 pages tripped the
 *     detector and aborted a 600-article resume. The JSON-less articles were not the
 *     problem; the fallback was.
 *
 * `SAFE_FETCH_ALLOW_LOOPBACK` is set here for the same reason `verify-feeds` sets it: the
 * fixture is served from 127.0.0.1 and the SSRF guard blocks loopback by default. Both
 * variables are set by the harness rather than assumed from the caller's shell.
 */
process.env.SAFE_FETCH_ALLOW_LOOPBACK = "1";
process.env.APP_PUBLIC_URL = "http://localhost:3210";

import "../apps/server/src/services/loadEnv";
process.env.SAFE_FETCH_ALLOW_LOOPBACK = "1";
process.env.APP_PUBLIC_URL = "http://localhost:3210";

import { createServer, type Server } from "node:http";
import { crawlHelpCenter } from "../apps/server/src/services/kbIngest";
import { prisma } from "../apps/server/src/services/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

const ARTICLES = 40;
type Mode = "distinct" | "identical" | "refuse" | "mixed-json" | "refuse-json";
/** In "mixed-json", these indices serve NO .json — only the SPA shell, as GHL does. */
const NO_JSON = new Set([3, 7, 11, 15, 19, 23, 27, 31, 35, 39]);
const SHELL =
  '<section class="fw-sticky fw-searchbar-wrapper"><div class="container"><nav aria-label="breadcrumb">' +
  "<a>Home</a><a>Knowledge base</a></nav><div>All Articles Recent Searches Clear all No recent searches " +
  "Popular Articles View all Topics View all Tickets View all Sorry nothing found for your search.</div></section>";

/** Requests actually made for an article, so "did it stop" is measured, not inferred. */
let hits = 0;

function fixture(mode: Mode): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: *\nCrawl-delay: 0\n");
    }
    if (url === "/sitemap.xml") {
      const path = mode === "mixed-json" || mode === "refuse-json" ? "/support/solutions/articles" : "/kb";
      const urls = Array.from({ length: ARTICLES }, (_, i) => `<url><loc>${origin}${path}/a${i}</loc></url>`).join("");
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0"?><urlset>${urls}</urlset>`);
    }
    // Freshdesk-shaped: `<article-url>.json` carries the real body. Some articles have none.
    if (url.startsWith("/support/solutions/articles/")) {
      const isJson = url.endsWith(".json");
      const n = Number(url.replace("/support/solutions/articles/a", "").replace(".json", ""));
      if (isJson) {
        hits++;
        // The rate-limit shape: the JSON endpoint refuses while the HTML page still serves.
        if (mode === "refuse-json") {
          res.writeHead(403, { "content-type": "text/plain" });
          return res.end("You have exceeded the limit of requests per hour");
        }
        if (NO_JSON.has(n)) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          article: {
            status: 2,
            title: `Real article ${n}`,
            // Comfortably past MIN_BODY_CHARS (200) after HTML stripping, or every
            // article is skipped as a nav stub and the fixture measures nothing.
            description:
              `<p>Guide ${n}. To configure widget ${n} open the ${n} settings screen and choose how the ${n} ` +
              `behaviour applies across the working week, then save it. Distinct prose for article ${n} so that ` +
              `no two pages share an opening and the template detector has nothing to fire on. Widget ${n} also ` +
              `supports overflow handling, which decides what happens once the ${n} allowance for the period is ` +
              `used up, and reporting for widget ${n} is available from the same screen.</p>`,
          },
        }));
      }
      // The HTML route on this portal carries no article — only the shell.
      hits++;
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><head><title>Article ${n}</title></head><body>${SHELL}</body></html>`);
    }
    if (url.startsWith("/kb/")) {
      hits++;
      if (mode === "refuse") {
        res.writeHead(403, { "content-type": "text/plain" });
        return res.end("You have exceeded the limit of requests per hour");
      }
      const n = url.slice(4);
      // "identical" mimics a portal shell: same text for every URL, comfortably past the
      // 200-char floor, naming no vendor and carrying no link — so every gate passes it.
      const body =
        mode === "identical"
          ? "<p>Home Knowledge base All Articles Recent Searches Clear all No recent searches Popular Articles View all Topics View all Tickets View all Sorry nothing found for your search please try again later or browse the categories listed above for help.</p>"
          : `<p>Guide ${n}. To configure widget ${n} you open the ${n} settings screen and choose how the ${n} behaviour should apply across your working week, then save it. This is distinct prose for article number ${n} so no two pages share an opening.</p>`;
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><head><title>Article ${n}</title></head><body>${body}</body></html>`);
    }
    res.writeHead(404);
    res.end();
  });
  let origin = "";
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      origin = `http://127.0.0.1:${addr.port}`;
      resolve({ server, origin });
    });
  });
}

async function crawl(mode: Mode, dryRun = false) {
  hits = 0;
  const { server, origin } = await fixture(mode);
  try {
    const summary = await crawlHelpCenter({
      origin,
      maxPages: ARTICLES,
      dryRun,
      pathPrefixes: [mode === "mixed-json" || mode === "refuse-json" ? "/support/solutions/articles/" : "/kb/"],
      // 0 disables the resume skip: each fixture is a fresh origin anyway, and leaving it
      // on would make a re-run of this suite silently measure nothing.
      refetchAfterDays: 0,
    });
    return { summary, requests: hits, origin };
  } finally {
    server.close();
  }
}

async function storedFor(origin: string): Promise<number> {
  return prisma.kbArticle.count({ where: { sourceUrl: { startsWith: origin } } });
}

async function main(): Promise<void> {
  console.log("\n== a dry run writes NOTHING, and still reports what it would do ==");
  {
    const { summary, origin } = await crawl("distinct", true);
    check("the dry run classified every article", summary.created === ARTICLES, JSON.stringify(summary));
    check("  ↳ and reported real counts, not all zeros", summary.created > 0);
    check("  ↳ but wrote NO rows", (await storedFor(origin)) === 0, `${await storedFor(origin)} rows written`);
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: origin } } });
  }

  console.log("\n== a real run of the same fixture DOES write ==");
  {
    const { summary, origin } = await crawl("distinct");
    check("every distinct article ingested", summary.created === ARTICLES, JSON.stringify(summary));
    check("  ↳ rows are actually there", (await storedFor(origin)) === ARTICLES);
    check("  ↳ and nothing aborted a healthy crawl", !summary.abortReason, String(summary.abortReason));
    check("  ↳ so it is NOT reported as truncated", summary.truncated === false);
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: origin } } });
  }

  console.log("\n== identical text on every page STOPS the crawl ==");
  {
    const { summary, requests, origin } = await crawl("identical");
    check("it aborted", !!summary.abortReason, "no abortReason set");
    check("  ↳ and actually STOPPED — the abort is not swallowed by the per-article catch",
      requests < ARTICLES, `made ${requests} of ${ARTICLES} possible requests`);
    check("  ↳ reporting the REPEATED text, not whatever page was in hand",
      /Sorry nothing found/.test(summary.abortReason ?? ""), summary.abortReason ?? "");
    check("  ↳ and flagged truncated, so it cannot read as complete coverage",
      summary.truncated === true);
    // The furniture passes every brand gate, which is the entire reason this guard exists.
    const stored = await storedFor(origin);
    check(`  ↳ few rows stored before it noticed (${stored})`, stored < ARTICLES / 2, `${stored} stored`);
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: origin } } });
  }

  console.log("\n== a portal that publishes JSON: pages without it are SKIPPED, not shell-scraped ==");
  {
    /*
     * The case that stopped the real resume dead. On a JS-rendered portal the HTML carries
     * no article, so falling back to it returns the page shell — which clears the length
     * floor, names no vendor and carries no link, so every gate passes it. 41 shells out of
     * 68 pages tripped the template detector and aborted the whole run. The handful of
     * JSON-less articles were not the problem; the fallback was.
     */
    const { summary, origin } = await crawl("mixed-json");
    check("the crawl did NOT abort over a minority of JSON-less pages",
      !summary.abortReason, summary.abortReason ?? "");
    check(`  ↳ every article WITH json was ingested (${summary.created})`,
      summary.created === ARTICLES - NO_JSON.size, JSON.stringify(summary));
    check(`  ↳ and the ${NO_JSON.size} without were skipped`,
      summary.skipped === NO_JSON.size, JSON.stringify(summary));

    const serving = await prisma.kbArticle.findMany({
      where: { sourceUrl: { startsWith: origin }, status: "ready" },
      select: { bodyNormalized: true },
    });
    check("  ↳ NOT ONE shell was stored as retrievable",
      serving.every((r) => !/Sorry nothing found|Recent Searches/.test(r.bodyNormalized)),
      "the portal shell reached the corpus as a real article");
    check("  ↳ and every stored body is real article prose",
      serving.length > 0 && serving.every((r) => /configure widget/.test(r.bodyNormalized)));

    // Markers, so a resumed run does not pay for these URLs again and again.
    const marked = await prisma.kbArticle.count({ where: { sourceUrl: { startsWith: origin }, status: "archived" } });
    check(`  ↳ the JSON-less URLs are remembered (${marked}) so a resume does not refetch them forever`,
      marked === NO_JSON.size, `${marked} markers for ${NO_JSON.size} skipped`);

    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: origin } } });
  }

  console.log("\n== a REFUSED json is not the same as an ABSENT one ==");
  {
    /*
     * The worst bug of the whole crawl, and I wrote it. `fetchStructuredArticle` returned
     * null for a 403 exactly as it did for a 404, so once the host began rate-limiting,
     * every article read as "this one has no JSON" and was marked `archived` with
     * `lastCrawledAt` set — which the resume filter skips FOREVER. 584 real articles were
     * permanently retired by a temporary rate limit, and because that path never calls
     * `fetchText`, the refusal guard never saw one refusal to count.
     */
    const { summary, requests, origin } = await crawl("refuse-json");
    check("a refusing JSON endpoint ABORTS the run", !!summary.abortReason, "no abortReason");
    check("  ↳ naming it a refusal, not an absence",
      /consecutive refusals|403/.test(summary.abortReason ?? ""), summary.abortReason ?? "");
    check("  ↳ stopping within a handful of requests", requests <= 8, `${requests} requests`);
    check("  ↳ and it is NOT counted as 'skipped', which would read as 'these have no JSON'",
      summary.skipped === 0, JSON.stringify(summary));
    const marked = await prisma.kbArticle.count({ where: { sourceUrl: { startsWith: origin } } });
    check("  ↳ NOTHING is written, so a temporary rate limit cannot permanently retire an article",
      marked === 0, `${marked} rows written`);
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: origin } } });
  }

  console.log("\n== a host refusing us stops the crawl instead of hammering it ==");
  {
    const { summary, requests, origin } = await crawl("refuse");
    check("it aborted", !!summary.abortReason, "no abortReason set");
    check("  ↳ naming the refusal rather than blaming extraction",
      /consecutive refusals|403/.test(summary.abortReason ?? ""), summary.abortReason ?? "");
    check("  ↳ and stopped within a handful of requests, not after all 40",
      requests <= 8, `made ${requests} requests to a server that was refusing`);
    check("  ↳ writing nothing", (await storedFor(origin)) === 0);
    check("  ↳ and it says a re-run is safe, because the hash short-circuits",
      /re-run/i.test(summary.abortReason ?? ""), summary.abortReason ?? "");
  }

  console.log(`\n${"-".repeat(54)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0); });
