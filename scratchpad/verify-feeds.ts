/**
 * RSS auto-ingestion, end to end against a real HTTP feed.
 *
 * The feed is served locally so the run is deterministic and depends on nobody's website
 * — but it is a genuine HTTP fetch with genuine conditional-GET headers, not a stub.
 *
 * What actually needs proving is not "can it parse XML" (unit tests cover that) but the
 * safety properties, because this is the first path that puts text nobody wrote into the
 * corpus automatically:
 *   - a vendor name in a feed item is QUARANTINED, not published
 *   - a clean item still waits for review while the feed is untrusted
 *   - neither is ever retrievable
 *   - trusting the feed publishes, and only then
 *   - a second poll costs a 304 rather than a re-download
 */
import "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/loadEnv";
import { createServer } from "node:http";

/**
 * The fixture server is on 127.0.0.1 and an ephemeral port, both of which `safeFetch`
 * now refuses — correctly: a feed is a publisher URL on the internet, and the guard is
 * what stops "Add feed" being pointed at the cloud metadata endpoint.
 *
 * The exemption is loopback-only and REFUSES ITSELF when `APP_PUBLIC_URL` is a real https
 * host, so both are declared here rather than left to the caller's shell. That second
 * line is not a workaround: it is this harness stating it is not production, and the same
 * check is what makes the flag inert on the deployed service however it is set.
 */
process.env.SAFE_FETCH_ALLOW_LOOPBACK = "1";
process.env.APP_PUBLIC_URL = "http://localhost:3210";
import { prisma } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/prisma";
import { pollFeed } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/feedPoll";
import { searchKb } from "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/kbSearch";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

const ETAG = '"v1"';

/**
 * A token no real article contains, regenerated per run.
 *
 * The retrieval checks below used to query "trigger links that track who clicked", which is
 * a fair question and, since the help centre was crawled, one that TWENTY genuine articles
 * answer better than a five-sentence fixture. Measured on a 1,443-article corpus: the
 * fixture appears nowhere in the top 20, so
 *
 *   - "retrievable now" failed, reading like published articles being unreachable, and
 *   - "retrieval returns neither" had been passing FOR THE WRONG REASON ever since the
 *     crawl landed — the fixture could not reach the top 5 whatever its status.
 *
 * The property under test is STATUS GATING, not ranking, so the query must not be a
 * popularity contest against the real corpus. This is the same reason every other suite
 * plants a marked row; it is not fitting the test to the data.
 */
const MARK = `zephyrbeacon${Date.now().toString(36)}`;

/** Long enough to clear the 200-char floor; the third item deliberately is not. */
const CLEAN = `<p>Trigger links are trackable links you place in an email or a text message.
When somebody clicks one you know exactly who it was, and a workflow can act on it straight
away. That makes a click a far better signal of intent than an open, which is inflated by
mailbox providers loading images to scan them. Create the link once and reuse it across
messages so the numbers aggregate rather than fragmenting into a dozen separate entries.
Internally this fixture calls that report the ${MARK} summary.</p>`;

/**
 * A plainly-spelled vendor name. This is REPLACED, not quarantined — that is the design:
 * replacement is surgical, and a term the lexicon knows becomes {{PLATFORM}} with nothing
 * left for the residual scan to find.
 */
const NAMED = `<p>This article explains how GoHighLevel handles sub-account snapshots and
how the GoHighLevel team recommends loading one into a fresh location. Open the snapshot
area, choose the account you want to copy, and load it into the destination. Structure such
as pipelines and automations travels across, while contacts and conversation history stay
exactly where they were, which is almost always what you want when starting a new client.</p>`;

/**
 * An OBFUSCATED vendor name — capital i for the l. The defanged scan catches it and the
 * literal patterns cannot repair it, so the article is quarantined rather than served.
 * This is the fail-safe, and it is the case worth proving on an automated path: a feed
 * publishes text nobody on our side wrote or read.
 */
const OBFUSCATED = `<p>A quick note on where this platform came from. It is built on
GoHighLeveI, and the GoHighLeveI team ships changes to the interface continually, so a
screenshot taken last year may not match what you see today. Check the layout described
here against your own screen before following the steps, and tell us if something has moved
so we can bring the wording back up to date for everybody else using it.</p>`;

const feedXml = (extra = "") => `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Help Feed</title>
    <item>
      <title>Using trigger links</title>
      <link>https://feed.test/trigger-links</link>
      <content:encoded><![CDATA[${CLEAN}${extra}]]></content:encoded>
      <pubDate>Tue, 12 Aug 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Loading a snapshot</title>
      <link>https://feed.test/snapshots</link>
      <content:encoded><![CDATA[${NAMED}]]></content:encoded>
      <pubDate>Wed, 13 Aug 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>About this platform</title>
      <link>https://feed.test/obfuscated</link>
      <content:encoded><![CDATA[${OBFUSCATED}]]></content:encoded>
      <pubDate>Mon, 10 Aug 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Too short to be an article</title>
      <link>https://feed.test/stub</link>
      <description>Just a headline.</description>
      <pubDate>Thu, 14 Aug 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

(async () => {
  let body = feedXml();
  let etag = ETAG;
  let conditionalHits = 0;

  const server = createServer((req, res) => {
    if (req.headers["if-none-match"] === etag) {
      conditionalHits++;
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/rss+xml", etag });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/feed.xml`;

  // Clean slate, in case a previous run died before its cleanup.
  await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: "https://feed.test/" } } });
  await prisma.kbFeed.deleteMany({ where: { url } });

  const feed = await prisma.kbFeed.create({ data: { url, source: "ghl" } });

  try {
    console.log("== a new feed publishes to the review queue, not to clients ==");
    check("autoPublish is OFF by default", feed.autoPublish === false);

    const first = await pollFeed(feed.id, { log: () => {} });
    // Two held (the clean one and the one whose vendor name was cleanly REPLACED), one
    // quarantined (the obfuscated name that replacement cannot repair), one skipped.
    check("held the clean article and the replaceable one", first.held === 2, JSON.stringify(first));
    check("QUARANTINED the obfuscated vendor name", first.quarantined === 1, JSON.stringify(first));
    check("skipped the headline-only item", first.skipped === 1, JSON.stringify(first));

    const clean = await prisma.kbArticle.findUnique({ where: { sourceUrl: "https://feed.test/trigger-links" } });
    const named = await prisma.kbArticle.findUnique({ where: { sourceUrl: "https://feed.test/snapshots" } });
    const obfus = await prisma.kbArticle.findUnique({ where: { sourceUrl: "https://feed.test/obfuscated" } });

    check("clean article stored needs_review", clean?.status === "needs_review", `status=${clean?.status}`);
    check("  -> with NO residual leaks, so the queue can tell it from a quarantine",
      clean?.residualLeaks == null, JSON.stringify(clean?.residualLeaks));
    check("a plainly-named vendor is REPLACED, not quarantined",
      named?.status === "needs_review" && named?.residualLeaks == null, `residual=${JSON.stringify(named?.residualLeaks)}`);
    check("  -> and the name became the placeholder",
      (named?.bodyNormalized ?? "").includes("{{PLATFORM}}"));
    check("the obfuscated one IS quarantined", obfus?.status === "needs_review", `status=${obfus?.status}`);
    check("  -> WITH the term that survived, so a human knows why",
      Array.isArray(obfus?.residualLeaks) && (obfus!.residualLeaks as unknown[]).length > 0,
      JSON.stringify(obfus?.residualLeaks));

    console.log("\n== nothing from an untrusted feed can reach a client ==");
    // Same query as the positive check below, so the two are each other's control: this
    // one is only meaningful because that one proves the query DOES find the row once it
    // is published.
    const hits = await searchKb({ query: MARK, agencyInstallId: null, limit: 5 });
    check("retrieval returns neither",
      !hits.some((h) => (h.sourceUrl ?? "").startsWith("https://feed.test/")),
      hits.map((h) => h.sourceUrl).join(", "));

    console.log("\n== polling again costs a 304, not a re-download ==");
    const second = await pollFeed(feed.id, { log: () => {} });
    check("publisher answered 304", second.notModified === true);
    check("  -> and we sent the conditional header", conditionalHits === 1, `hits=${conditionalHits}`);
    check("  -> nothing re-ingested", second.created === 0 && second.held === 0);

    console.log("\n== trusting the feed publishes it, and only then ==");
    await prisma.kbFeed.update({ where: { id: feed.id }, data: { autoPublish: true } });
    // Change the content so the contentHash short-circuit does not skip it.
    body = feedXml(" <p>Send yourself a test before using one in a live campaign.</p>");
    etag = '"v2"';

    const third = await pollFeed(feed.id, { log: () => {} });
    check("clean article now published", third.updated === 1, JSON.stringify(third));

    const republished = await prisma.kbArticle.findUnique({ where: { sourceUrl: "https://feed.test/trigger-links" } });
    const stillHeld = await prisma.kbArticle.findUnique({ where: { sourceUrl: "https://feed.test/obfuscated" } });
    check("stored ready", republished?.status === "ready", `status=${republished?.status}`);
    // The state that matters, not the counter: an unchanged item short-circuits on its
    // content hash, so counting quarantines on this poll would prove nothing.
    check("trusting a feed does NOT release the quarantined one",
      stillHeld?.status === "needs_review", `status=${stillHeld?.status}`);

    const nowHits = await searchKb({ query: MARK, agencyInstallId: null, limit: 5 });
    check("retrievable now", nowHits.some((h) => h.sourceUrl === "https://feed.test/trigger-links"),
      `${nowHits.length} hit(s): ${nowHits.map((h) => h.sourceUrl).join(", ") || "none"}`);
    check("the quarantined one is still NOT retrievable",
      !nowHits.some((h) => h.sourceUrl === "https://feed.test/obfuscated"));

    console.log("\n== no vendor name survived into stored text ==");
    const allStored = await prisma.kbArticle.findMany({
      where: { sourceUrl: { startsWith: "https://feed.test/" } },
      select: { titleNormalized: true, bodyNormalized: true },
    });
    const joined = allStored.map((a) => `${a.titleNormalized}\n${a.bodyNormalized}`).join("\n");
    check("no plainly-spelled vendor term in any stored body",
      !/gohighlevel|leadconnector|msgsndr/i.test(joined));
    check("  -> the replaceable one became the placeholder", joined.includes("{{PLATFORM}}"));

    console.log("\n== a broken feed is disabled loudly, not dropped silently ==");
    server.close();
    const dead = await pollFeed(feed.id, { log: () => {} });
    check("records the failure", !!dead.error, JSON.stringify(dead));
    const afterFail = await prisma.kbFeed.findUnique({ where: { id: feed.id } });
    check("  -> counts it and keeps the reason", (afterFail?.consecutiveErrors ?? 0) === 1 && !!afterFail?.lastError);
    check("  -> still enabled after one failure", afterFail?.enabled === true);
  } finally {
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: "https://feed.test/" } } });
    await prisma.kbFeed.deleteMany({ where: { url } });
    server.close();
  }

  console.log(`\n---------------------------------------------\n  ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
