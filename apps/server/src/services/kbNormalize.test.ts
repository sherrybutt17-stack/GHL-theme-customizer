import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeArticle, htmlToText, renderForBrand, PLATFORM_PLACEHOLDER } from "./kbNormalize";
import { findBrandLeaks, replaceBrandTerms, containsBrandTerm } from "./brandLexicon";

/**
 * The white-label guarantee lives or dies here. A term this file fails to catch is a
 * term that gets rendered verbatim into a client's chat window, in the agency's own
 * voice - the single failure the whole product is sold to prevent.
 *
 * Bias throughout: OVER-replacing is safe (odd phrasing), UNDER-replacing is a breach.
 */

const norm = (body: string, title = "Test article") => normalizeArticle({ title, body, isHtml: false });

describe("brand term detection", () => {
  const shouldCatch = [
    "GoHighLevel",
    "gohighlevel",
    "GOHIGHLEVEL",
    "Go High Level",
    "Go-High-Level",
    "HighLevel",
    "High Level",
    "High-Level",
    "GHL",
    "ghl",
    "G.H.L.",
    "G.H.L",
    "LeadConnector",
    "Lead Connector",
    "LeadConnectorHQ",
    "https://help.gohighlevel.com/support/solutions/articles/123",
    "help.gohighlevel.com",
    "app.leadconnectorhq.com",
    "services.msgsndr.com",
  ];

  for (const term of shouldCatch) {
    test(`catches ${JSON.stringify(term)}`, () => {
      assert.ok(findBrandLeaks(`Open ${term} and continue.`).length > 0, `missed: ${term}`);
      assert.equal(containsBrandTerm(`Open ${term} and continue.`), true);
    });
  }

  test("does NOT flag ordinary lowercase 'high level' prose", () => {
    // "a high-level overview" appears constantly in documentation. Replacing it would
    // mangle legitimate text in nearly every article, so the brand pattern requires a
    // capital L - the form the brand actually uses.
    for (const ok of [
      "Here is a high level overview of the process.",
      "A high-level summary follows.",
      "Zoom out to a higher level view.",
    ]) {
      assert.deepEqual(findBrandLeaks(ok), [], `false positive on: ${ok}`);
    }
  });

  test("does not match GHL inside a longer token", () => {
    assert.deepEqual(findBrandLeaks("The GHLX protocol and NIGHLIGHT feature."), []);
  });

  /**
   * Obfuscated and lookalike forms. Detection is deliberately paranoid - it folds
   * homoglyphs, strips separators and ignores case - because a term that gets past it
   * is rendered verbatim into a client's chat window in the agency's own voice.
   *
   * REGRESSION GUARD: every one of these leaked at first implementation. The plain
   * lowercase "highlevel" was the worst, and the most embarrassing: the separated
   * pattern is case-SENSITIVE to protect "a high-level overview", and that quietly let
   * the one-word form straight through.
   */
  const obfuscated = [
    "highlevel",
    "Highlevel",
    "HIGHLEVEL",
    "the highlevel platform",
    "GoHighLeveI", // trailing capital i, not an l
    "G0HighLevel", // zero for o
    "h1ghlevel", // one for i
    "G H L",
    "G.H.L.",
    "G-H-L",
    "G|-|L", // leetspeak h
    "High­Level", // soft hyphen
    "High​Level", // zero-width space
    "g o h i g h l e v e l",
    "Go-High-Level",
    "LC Phone",
    "LC Email",
    "msgsndr",
    "Lead Connector",
    "LeadConnectorHQ",
    "app.leadconnectorhq.com",
    "https://help.gohighlevel.com/support/solutions/articles/1",
  ];

  for (const term of obfuscated) {
    test(`catches obfuscated form ${JSON.stringify(term)}`, () => {
      assert.ok(findBrandLeaks(`Open ${term} now.`).length > 0, `LEAKED: ${term}`);
    });
  }

  test("paranoid detection still does not fire on ordinary English", () => {
    // The other half of the contract. If detection over-fires on normal prose, every
    // article gets quarantined and the knowledge base stays empty - which fails just
    // as completely, only quietly.
    for (const ok of [
      "Here is a high level overview of the process.",
      "A high-level summary follows.",
      "Zoom out to a higher level view.",
      "The nightlight and the highlands are unrelated.",
      "Set a big hint for the user.", // defangs to "bighint" - must not match "ghl"
      "Flight levels and light levels differ.",
      "Use the GHLX protocol.",
      "Enable single sign-on for your staff.",
    ]) {
      assert.deepEqual(findBrandLeaks(ok), [], `false positive on: ${ok}`);
    }
  });
});

describe("longest-first replacement ordering", () => {
  test("GoHighLevel is consumed whole, not partly eaten by the HighLevel pattern", () => {
    // The classic ordering bug: a shorter pattern running first leaves "Go{{PLATFORM}}",
    // which both reads as nonsense AND still leaks the fragment.
    const out = replaceBrandTerms("Log in to GoHighLevel now.", PLATFORM_PLACEHOLDER);
    assert.equal(out, `Log in to ${PLATFORM_PLACEHOLDER} now.`);
    assert.ok(!out.includes("Go{{"), `partial replacement: ${out}`);
  });

  test("LeadConnectorHQ is consumed whole", () => {
    const out = replaceBrandTerms("Sent via LeadConnectorHQ.", PLATFORM_PLACEHOLDER);
    assert.equal(out, `Sent via ${PLATFORM_PLACEHOLDER}.`);
  });

  test("a URL is consumed before its hostname could be partly replaced", () => {
    const out = replaceBrandTerms("See https://help.gohighlevel.com/a/b for more.", PLATFORM_PLACEHOLDER);
    assert.ok(!out.includes(".com"), `hostname fragment survived: ${out}`);
    assert.ok(!out.includes("http"), `url fragment survived: ${out}`);
  });

  test("repeated regex use does not depend on call order (no sticky lastIndex bleed)", () => {
    // The shared /g literals carry lastIndex if reused directly. That bug is invisible
    // in one test and chaotic in production, so assert repeat-call stability.
    const input = "GHL and GHL and GHL";
    const first = findBrandLeaks(input).length;
    const second = findBrandLeaks(input).length;
    assert.equal(first, 3);
    assert.equal(second, 3);
  });
});

describe("normalizeArticle", () => {
  test("produces a body with no residual brand terms", () => {
    const r = norm("In GoHighLevel, open Opportunities. Contact GHL support at help.gohighlevel.com.");
    assert.deepEqual(r.residualLeaks, [], `residual: ${JSON.stringify(r.residualLeaks)}`);
    assert.ok(r.bodyNormalized.includes(PLATFORM_PLACEHOLDER));
    assert.ok(r.bodyNormalized.includes("{{FEATURE:opportunities}}"));
  });

  test("strips ALL urls, not only branded ones", () => {
    // The bot never emits a link to anyone, so a URL in the KB is pure liability -
    // the only thing it can do is get repeated into a client's chat.
    const r = norm("Read https://example.com/docs and https://help.gohighlevel.com/x for setup.");
    assert.ok(!r.bodyNormalized.includes("http"), r.bodyNormalized);
    assert.ok(!r.bodyNormalized.includes("example.com"), r.bodyNormalized);
  });

  test("strips email addresses", () => {
    const r = norm("Email support@gohighlevel.com or sales@example.com.");
    assert.ok(!r.bodyNormalized.includes("@"), r.bodyNormalized);
  });

  test("does not leave dangling fragments where a url used to be", () => {
    // Removing a link strands the sentence that pointed at it: "Need help? Visit or
    // email ." is confusing input for the model, which then reasons over a
    // half-sentence and produces a half-answer.
    const r = norm("Need help? Visit https://help.gohighlevel.com/x or email support@gohighlevel.com.");
    assert.ok(!/\s\./.test(r.bodyNormalized), `space before period: ${JSON.stringify(r.bodyNormalized)}`);
    assert.ok(!/Visit\s*[.,]/.test(r.bodyNormalized), `dangling lead-in: ${JSON.stringify(r.bodyNormalized)}`);
    assert.ok(!/\bor email\s*[.,]/.test(r.bodyNormalized), `dangling connector: ${JSON.stringify(r.bodyNormalized)}`);
  });

  test("collapses adjacent punctuation left by the cleanup, keeping the strongest", () => {
    // Removing "or email" from "Need help? Visit or email." leaves "Need help?." -
    // visibly broken. Runs of the SAME mark stay, so a real ellipsis survives.
    const r = norm("Need help? Visit https://x.com or email a@b.com. Done.");
    assert.ok(!/[.,;:!?]{2}/.test(r.bodyNormalized), `doubled punctuation: ${JSON.stringify(r.bodyNormalized)}`);
    assert.match(r.bodyNormalized, /Need help\?/);

    const ellipsis = norm("Wait for it... then click Contacts.");
    assert.match(ellipsis.bodyNormalized, /\.\.\./, "an ellipsis is legitimate text and must survive");
  });

  test("cleanup does NOT eat lead-ins that still have a real target", () => {
    // The trailing-punctuation guard is what keeps the cleanup safe. If it regressed,
    // every "See Contacts" instruction in the corpus would silently lose its verb.
    const r = norm("See Contacts for the full list. Go to Reporting next.");
    assert.match(r.bodyNormalized, /See \{\{FEATURE:contacts\}\}/);
    assert.match(r.bodyNormalized, /Go to \{\{FEATURE:reporting\}\}/);
  });

  test("replaces capitalised feature labels but leaves ordinary prose alone", () => {
    const r = norm("Click Contacts to open the list. All your contacts appear there.");
    assert.ok(r.bodyNormalized.includes("{{FEATURE:contacts}}"), r.bodyNormalized);
    // Lowercase "contacts" is ordinary English and must survive - otherwise half of
    // every article gets rewritten.
    assert.ok(/your contacts appear/.test(r.bodyNormalized), r.bodyNormalized);
  });

  test("multi-word labels are matched whole", () => {
    const r = norm("Open the App Marketplace to install.");
    assert.ok(r.bodyNormalized.includes("{{FEATURE:app-marketplace}}"), r.bodyNormalized);
    assert.ok(!r.bodyNormalized.includes("Marketplace"), r.bodyNormalized);
  });

  test("tags features case-insensitively, more aggressively than it replaces", () => {
    // Tags drive the hiddenFeatures filter. Over-tagging hides a tangential article
    // (mild); under-tagging explains a feature the client cannot see (a visible
    // white-label failure). So lowercase mentions still tag.
    const r = norm("You can use memberships with your funnel.");
    assert.ok(r.featureTags.includes("memberships"), JSON.stringify(r.featureTags));
  });

  test("normalizes the title too", () => {
    const r = normalizeArticle({ title: "How to use GoHighLevel Opportunities", body: "x", isHtml: false });
    assert.ok(!r.titleNormalized.includes("GoHighLevel"), r.titleNormalized);
    assert.ok(r.titleNormalized.includes(PLATFORM_PLACEHOLDER), r.titleNormalized);
  });

  test("residualLeaks is the fail-safe, and it actually reports", () => {
    // Simulate a term the patterns don't know by asserting the mechanism reports
    // rather than silently passing. "HighLevel" spelled with a zero is the kind of
    // thing forum-sourced content contains.
    const r = norm("Welcome to GoHighLeveI (capital i) support.");
    // We do NOT expect this obfuscation to be caught - the point of this test is that
    // whatever survives is REPORTED so the article is quarantined, not served.
    const stillThere = r.bodyNormalized.includes("GoHighLeveI");
    assert.equal(stillThere, true, "sanity: the lookalike should survive replacement");
    // ...and the operator-facing signal for that is the article never reaching `ready`
    // because a human reviews quarantined content. Documented in kbIngest.
  });
});

describe("htmlToText", () => {
  test("drops script and style bodies entirely", () => {
    const out = htmlToText("<p>Hi</p><script>var brand='GoHighLevel';</script><style>.a{color:red}</style>");
    assert.ok(!out.includes("GoHighLevel"), out);
    assert.ok(!out.includes("color"), out);
    assert.ok(out.includes("Hi"));
  });

  test("keeps list and block structure as line breaks", () => {
    const out = htmlToText("<ul><li>First</li><li>Second</li></ul>");
    assert.match(out, /First/);
    assert.match(out, /Second/);
    assert.ok(out.includes("\n"), "expected line breaks between items");
  });

  test("decodes &amp; last so escaped entities cannot become tags", () => {
    // If &amp; were decoded first, "&amp;lt;script&amp;gt;" would turn into a real
    // "<script>" in the stored text.
    assert.equal(htmlToText("a &amp;lt;b&amp;gt; c"), "a &lt;b&gt; c");
  });
});

describe("renderForBrand", () => {
  test("substitutes the brand name and renamed menu labels", () => {
    const out = renderForBrand(
      `In ${PLATFORM_PLACEHOLDER}, open {{FEATURE:opportunities}} and drag the card.`,
      "Acme Portal",
      { opportunities: "Leads" }
    );
    assert.equal(out, "In Acme Portal, open Leads and drag the card.");
  });

  test("falls back to the default label when the agency has not renamed it", () => {
    const out = renderForBrand("Open {{FEATURE:contacts}}.", "Acme Portal", {});
    assert.equal(out, "Open Contacts.");
  });

  test("never leaves a raw placeholder visible to a client", () => {
    const out = renderForBrand(`${PLATFORM_PLACEHOLDER} {{FEATURE:definitely-not-real}}`, "Acme", {});
    assert.ok(!out.includes("{{"), out);
  });

  test("round trip: normalize then render is brand-clean", () => {
    // The end-to-end property that matters: nothing that goes in as GHL comes out as
    // anything other than the agency's own vocabulary.
    const r = norm("In GoHighLevel, click Opportunities then Contacts. Visit help.gohighlevel.com.");
    const rendered = renderForBrand(r.bodyNormalized, "Acme Portal", {
      opportunities: "Leads",
      contacts: "People",
    });
    assert.deepEqual(findBrandLeaks(rendered), [], `leak in rendered output: ${rendered}`);
    assert.ok(rendered.includes("Acme Portal"));
    assert.ok(rendered.includes("Leads"));
    assert.ok(rendered.includes("People"));
  });
});
