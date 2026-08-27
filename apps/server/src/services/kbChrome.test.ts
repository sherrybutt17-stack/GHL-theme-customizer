import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHelpCentreChrome, stripPortalSuffix } from "./kbIngest";

/**
 * Shapes taken verbatim from the live corpus, shortened only in the article prose. 424 of
 * 1,190 crawled articles were stored like this: `extractMainContent`'s container patterns
 * do not match a Freshdesk portal, so it fell through to `<body>` and kept the whole page.
 */
const PROSE =
  "Text-To-Pay Links let you request and collect payments instantly via SMS directly from a " +
  "conversation. No website required! They generate a checkout link so customers can pay in a " +
  "few taps, which reduces friction and speeds up collection for any business that already " +
  "talks to its customers by text message rather than by email or over the phone.";

const CHROME =
  "• Home • Knowledge base • {{FEATURE:payments}} • Payment Links • Knowledge base • " +
  "{{FEATURE:payments}} • Payment Links • Text-To-Pay Links All Articles Recent Searches " +
  "Clear all No recent searches Popular Articles Articles View all Topics View all Tickets " +
  "View all Sorry! nothing found for Text-To-Pay Links Modified on: Thu, 4 Dec, 2025 at 4:59 PM ";

test("the nav prefix is removed and the article survives intact", () => {
  const out = stripHelpCentreChrome(CHROME + PROSE);
  assert.equal(out, PROSE);
});

test("the search overlay's trailing counter goes too", () => {
  assert.equal(stripHelpCentreChrome(CHROME + PROSE + " X 0 of 0"), PROSE);
});

test("an article that never had chrome is returned unchanged", () => {
  assert.equal(stripHelpCentreChrome(PROSE), PROSE);
});

test("prose that merely mentions the marker words is NOT cut", () => {
  /**
   * The whole risk here: a stripper that fires on ordinary text silently deletes articles.
   * Two independent signals are required, and this has the words but no Modified-on line.
   */
  const innocent = "Popular Articles and Recent Searches both appear in the sidebar. " + PROSE;
  assert.equal(stripHelpCentreChrome(innocent), innocent);
});

test("a Modified-on line with no nav markers is NOT cut", () => {
  const changelog = "Modified on: Thu, 4 Dec, 2025 at 4:59 PM " + PROSE;
  assert.equal(stripHelpCentreChrome(changelog), changelog);
});

test("it refuses to cut when almost nothing would be left", () => {
  // Better to keep a chrome-laden article than to store an empty one: `ingestArticle`
  // rejects anything under the floor, so an over-eager cut deletes the article outright.
  const stub = CHROME + "Too short to survive.";
  assert.equal(stripHelpCentreChrome(stub), stub);
});

test("chrome further into the page than the window is left alone", () => {
  const padded = "x".repeat(2100) + CHROME + PROSE;
  assert.equal(stripHelpCentreChrome(padded), padded);
});

test("the portal name comes off the title, both separators seen live", () => {
  assert.equal(stripPortalSuffix("Text-To-Pay Links: {{PLATFORM}} Support Portal"), "Text-To-Pay Links");
  assert.equal(
    stripPortalSuffix("RSS Email Body showing HTML tags? {{PLATFORM}} Support Portal"),
    "RSS Email Body showing HTML tags?"
  );
  assert.equal(
    stripPortalSuffix("How to Manage and Merge Duplicate {{FEATURE:contacts}} in {{PLATFORM}}: {{PLATFORM}} Support Portal"),
    "How to Manage and Merge Duplicate {{FEATURE:contacts}} in {{PLATFORM}}"
  );
});

test("a title without the suffix is untouched, and one made ONLY of it survives", () => {
  assert.equal(stripPortalSuffix("Using trigger links"), "Using trigger links");
  // Never return an empty title: an untitled article is worse than a badly titled one.
  assert.equal(stripPortalSuffix("{{PLATFORM}} Support Portal"), "{{PLATFORM}} Support Portal");
});
