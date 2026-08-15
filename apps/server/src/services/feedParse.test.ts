import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, tagText, atomLink, decodeXml } from "./feedParse";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Help Centre</title>
    <link>https://help.example.com</link>
    <item>
      <title>Connecting a domain</title>
      <link>https://help.example.com/domains</link>
      <description>A short teaser that should lose to the full content.</description>
      <content:encoded><![CDATA[<p>Open <b>Settings</b> and add the domain.</p>]]></content:encoded>
      <pubDate>Tue, 12 Aug 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Sending email</title>
      <link>https://help.example.com/email</link>
      <description>Verify your sending domain first.</description>
      <pubDate>Wed, 13 Aug 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Changelog</title>
  <link rel="self" href="https://example.com/feed.atom"/>
  <link rel="alternate" href="https://example.com/"/>
  <entry>
    <title>Calendars now support buffers</title>
    <link rel="self" href="https://example.com/feed.atom#1"/>
    <link rel="alternate" href="https://example.com/posts/buffers"/>
    <summary>Short summary.</summary>
    <content type="html">&lt;p&gt;You can now set a gap after each appointment.&lt;/p&gt;</content>
    <updated>2026-08-14T10:00:00Z</updated>
  </entry>
</feed>`;

describe("feed parsing", () => {
  test("reads RSS items with title, link and date", () => {
    const feed = parseFeed(RSS);
    assert.equal(feed.title, "Example Help Centre");
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].url, "https://help.example.com/domains");
    assert.equal(feed.items[0].title, "Connecting a domain");
    assert.equal(feed.items[0].publishedAt?.toISOString(), "2026-08-12T09:00:00.000Z");
  });

  test("prefers full content over the teaser", () => {
    // A description ingested as an article makes the bot answer from an advert for the
    // answer rather than from the answer.
    const [first] = parseFeed(RSS).items;
    assert.ok(first.body.includes("Open <b>Settings</b>"), `got: ${first.body}`);
    assert.ok(!first.body.includes("short teaser"));
  });

  test("falls back to the description when there is no full content", () => {
    assert.equal(parseFeed(RSS).items[1].body, "Verify your sending domain first.");
  });

  test("the feed title is the channel's, not the first item's", () => {
    // Read from the whole document, `<title>` matches the first ITEM, mislabelling
    // every feed in the review queue after its most recent post.
    assert.equal(parseFeed(ATOM).title, "Example Changelog");
  });

  test("reads Atom entries and takes the alternate link, never self", () => {
    const feed = parseFeed(ATOM);
    assert.equal(feed.items.length, 1);
    // rel="self" points at the feed. Taking it would give every entry the same URL, and
    // since sourceUrl is the upsert key, the whole feed would collapse into one article
    // that overwrites itself on every poll.
    assert.equal(feed.items[0].url, "https://example.com/posts/buffers");
    assert.ok(feed.items[0].body.includes("gap after each appointment"));
    assert.equal(feed.items[0].publishedAt?.toISOString(), "2026-08-14T10:00:00.000Z");
  });

  test("an item with no link is dropped rather than ingested without its key", () => {
    const noLink = RSS.replace("<link>https://help.example.com/domains</link>", "");
    assert.equal(parseFeed(noLink).items.length, 1);
  });

  test("returns nothing for junk instead of throwing inside a scheduled job", () => {
    for (const junk of ["", "<html><body>not a feed</body></html>", "<rss><channel>"]) {
      assert.deepEqual(parseFeed(junk).items, []);
    }
  });

  test("CDATA is unwrapped and entities are decoded", () => {
    assert.equal(tagText("<title><![CDATA[Raw & <b>bold</b>]]></title>", "title"), "Raw & <b>bold</b>");
    assert.equal(tagText("<title>Raw &amp; plain</title>", "title"), "Raw & plain");
  });

  test("&amp; decodes last so an escaped entity survives as text", () => {
    assert.equal(decodeXml("&amp;lt;"), "&lt;");
    assert.equal(decodeXml("&#65;&#x42;"), "AB");
  });

  test("a malformed numeric entity yields nothing rather than throwing", () => {
    assert.equal(decodeXml("&#999999999;"), "");
  });

  test("namespaced tags are matched whatever prefix the publisher chose", () => {
    assert.equal(tagText("<dc:date>2026-01-01</dc:date>", "date", { namespaced: true }), "2026-01-01");
    assert.equal(tagText("<foo:encoded>body</foo:encoded>", "encoded", { namespaced: true }), "body");
  });

  test("atomLink falls back to any non-self link rather than returning nothing", () => {
    assert.equal(atomLink('<link rel="self" href="a"/><link href="b"/>'), "b");
    assert.equal(atomLink('<link rel="self" href="a"/>'), null);
  });
});
