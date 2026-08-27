import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { defang, defangWithMap, findBrandLeaks, leakTerms } from "./brandLexicon";

/**
 * The lexicon had no unit tests, which is why nothing noticed that the defanged scan
 * reported its own FOLDED token as the thing to remove. An article containing
 * "GoHighLeveI" answered the agency with `Mentions "gohighievei"` — a canonicalised string
 * that occurs nowhere in what they wrote, so searching for it finds nothing.
 *
 * The function's own doc comment had said the folded index was "fine for its purpose: a
 * hit means quarantine the article or regenerate the answer, never patch this one span."
 * True of the gate and false of the other consumer, which shows these to a person as the
 * words to delete. The reasoning was written down and a caller walked into it.
 *
 * Two properties are pinned here, and they pull in opposite directions:
 *
 *   DETECTION must stay exactly as paranoid as it was. The folding is the fail-safe, and
 *   a fold that got narrower would let a disguised term through — so the map is asserted
 *   to leave `defang`'s output byte-identical rather than merely "still catching things".
 *
 *   REPORTING must be something a human can act on: the source text, once per occurrence.
 */

describe("defangWithMap", () => {
  test("folds exactly as defang does — the map must not change detection", () => {
    const cases = [
      "GoHighLeveI",
      "Go.High.Level",
      "h1ghlevel",
      "a high level overview",
      "|-|ighLevel",
      "/-\\gency",
      "MSGSNDR",
      "$5 @ 3pm, 0k?",
      "",
      "   ",
      "—–…‽",
      "lead-connector.com",
    ];
    for (const c of cases) {
      for (const stripSeparators of [false, true]) {
        assert.equal(defangWithMap(c, { stripSeparators }).folded, defang(c, { stripSeparators }), c);
      }
    }
  });

  test("one piece per folded character, each pointing inside the source", () => {
    const src = "Go​High-LeveI!";
    for (const stripSeparators of [false, true]) {
      const { folded, pieces } = defangWithMap(src, { stripSeparators });
      assert.equal(pieces.length, folded.length);
      let last = -1;
      for (const p of pieces) {
        assert.ok(p.from >= 0 && p.to <= src.length && p.from < p.to, JSON.stringify(p));
        assert.ok(p.from >= last, "spans must run forwards");
        last = p.from;
      }
    }
  });

  test("a collapsed trigraph reports all three of its characters", () => {
    // "|-|" folds to a single "h", so a naive one-character span would quote "|" alone
    // and send somebody hunting for a pipe.
    const leaks = findBrandLeaks("We use |-|ighLevel here");
    assert.equal(leaks.length, 1);
    assert.equal(leaks[0].match, "|-|ighLevel");
  });
});

describe("findBrandLeaks reports the source text", () => {
  test("a homoglyph is quoted as it was typed, not as it was folded", () => {
    const text = "If you are moving across from GoHighLeveI, export your contacts.";
    const leaks = findBrandLeaks(text);
    assert.ok(leaks.length > 0, "the disguised term must still be caught");
    for (const l of leaks) {
      assert.equal(text.slice(l.index, l.index + l.match.length), l.match, "index and match must agree");
      assert.ok(text.includes(l.match), `"${l.match}" is not in the article — nobody can search for it`);
    }
  });

  test("the literal patterns are unaffected", () => {
    const leaks = findBrandLeaks("Go High Level is the platform");
    assert.ok(leaks.some((l) => l.match === "Go High Level"));
  });

  test("ordinary English is still clean", () => {
    assert.deepEqual(findBrandLeaks("a high level overview of the plan"), []);
    assert.deepEqual(findBrandLeaks("Set a big hint for the user."), []);
  });
});

describe("leakTerms — what a person is shown", () => {
  test("one occurrence is one term, however many rules fired on it", () => {
    // "GoHighLeveI" trips defanged-gohighlevel AND defanged-highlevel. Listing both reads
    // as two separate mistakes, and deleting the first silently removes the second.
    assert.deepEqual(leakTerms(findBrandLeaks("moving from GoHighLeveI to us")), ["GoHighLeveI"]);
    assert.deepEqual(leakTerms(findBrandLeaks("see msgsndr.com for details")), ["msgsndr.com"]);
  });

  test("the same term twice is still one thing to remove", () => {
    assert.deepEqual(leakTerms(findBrandLeaks("GoHighLevel, and again GoHighLevel")), ["GoHighLevel"]);
  });

  test("two DIFFERENT terms are both reported", () => {
    const terms = leakTerms(findBrandLeaks("GoHighLevel and also msgsndr.com"));
    assert.equal(terms.length, 2, JSON.stringify(terms));
  });

  test("clean text reports nothing", () => {
    assert.deepEqual(leakTerms(findBrandLeaks("a perfectly ordinary sentence")), []);
  });

  test("rows written before the fix still read, rather than throwing", () => {
    // Quarantined before the source-span change: a folded token and a folded index. The
    // original cannot be recovered for those, and re-saving the article repairs the row.
    assert.deepEqual(leakTerms([{ id: "x", match: "gohighievei", index: 3 }]), ["gohighievei"]);
  });

  test("junk in the column is not a crash on a settings screen", () => {
    assert.deepEqual(leakTerms(null), []);
    assert.deepEqual(leakTerms("nonsense"), []);
    assert.deepEqual(leakTerms([{}, { match: "" }, null]), []);
  });
});
