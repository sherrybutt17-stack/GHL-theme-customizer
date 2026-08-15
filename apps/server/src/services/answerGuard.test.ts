import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { guardAnswer, checkAgentDraft, longestVerbatimRun } from "./answerGuard";

/**
 * THE COMPLIANCE HARNESS.
 *
 * Three suites, matching the three gates. Together they are the release gate for the
 * white-label guarantee: if any of these fail, the bot must not be enabled for a real
 * agency's clients.
 *
 *   1. LEAK    — answers that would name the vendor are refused
 *   2. LINK    — no URL ever reaches a client
 *   3. OVERLAP — answers are rephrased, not republished
 *
 * These run on pure functions with no API calls, which is what makes it affordable to
 * run them on every change rather than "before launch".
 */

// ---------------------------------------------------------------------------------
describe("GATE 1 — brand leak", () => {
  /**
   * Answers a model might actually produce. Every one of these is a plausible reply to
   * a real client question, and every one destroys the white label in a sentence.
   */
  const leakyAnswers = [
    "This platform is built on GoHighLevel, so the steps are the same.",
    "You're using GHL — head to Settings.",
    "That's a HighLevel feature, available on all plans.",
    "Check the highlevel documentation for details.",
    "Messages are delivered through LeadConnector.",
    "See help.gohighlevel.com for the full guide.",
    "The underlying system is called Go High Level.",
    "Numbers are provisioned via LC Phone.",
    "Assets are served from msgsndr.com.",
  ];

  for (const answer of leakyAnswers) {
    test(`refuses: ${JSON.stringify(answer.slice(0, 45))}…`, () => {
      const r = guardAnswer(answer);
      assert.equal(r.ok, false, `PASSED THE GATE: ${answer}`);
      assert.ok(r.findings.some((f) => f.gate === "brand"), JSON.stringify(r.findings));
    });
  }

  test("a correct, branded answer passes cleanly", () => {
    const r = guardAnswer("Open Leads from the sidebar, then click Pipelines to add a stage.");
    assert.equal(r.ok, true, JSON.stringify(r.findings));
    assert.deepEqual(r.findings, []);
  });

  test("ordinary prose containing 'high level' is not refused", () => {
    // The false-positive side matters as much: a guard that refuses good answers makes
    // the bot useless, and does it quietly.
    const r = guardAnswer("Here's a high-level overview of how the automation works.");
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });

  test("agency-specific forbidden terms are enforced", () => {
    const r = guardAnswer("We migrated you from Kajabi last year.", { forbiddenTerms: ["Kajabi"] });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.detail === "agency-forbidden-term"));
  });

  test("a forbidden term must not match inside a longer word", () => {
    const r = guardAnswer("Open the Alpine settings panel.", { forbiddenTerms: ["Alp"] });
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });
});

// ---------------------------------------------------------------------------------
describe("GATE 2 — links", () => {
  test("strips a bare url and leaves readable prose", () => {
    const r = guardAnswer("Full instructions are at https://example.com/docs for reference.");
    assert.ok(!r.text.includes("http"), r.text);
    assert.ok(!r.text.includes("example.com"), r.text);
    assert.ok(r.findings.some((f) => f.gate === "link"));
    // Link stripping is a complete, safe transformation, so the message is still
    // sendable - unlike a brand leak, which requires regeneration.
    assert.equal(r.ok, true);
  });

  test("keeps the visible label of a markdown link, drops the target", () => {
    const r = guardAnswer("See [the setup guide](https://example.com/guide) first.");
    assert.ok(r.text.includes("the setup guide"), r.text);
    assert.ok(!r.text.includes("example.com"), r.text);
  });

  test("strips anchor tags but keeps their text", () => {
    const r = guardAnswer('Read <a href="https://example.com/x">this page</a> now.');
    assert.ok(r.text.includes("this page"), r.text);
    assert.ok(!r.text.includes("href"), r.text);
  });

  test("strips a bare hostname with no protocol", () => {
    const r = guardAnswer("Everything is documented at help.gohighlevel.com today.");
    assert.ok(!r.text.includes("gohighlevel.com"), r.text);
  });

  test("a VENDOR url blocks as a brand leak, it is not silently stripped", () => {
    // REGRESSION GUARD. Stripping links before checking the brand made this pass:
    // gate 2 removed the hostname, gate 1 then saw clean text, and the answer shipped
    // as the useless stub "See for the full guide." Two things went wrong - the leak
    // metric lost the fact that the model TRIED to name the vendor, and a gutted
    // sentence went out in the agency's voice. The brand check now runs first.
    const r = guardAnswer("See help.gohighlevel.com for the full guide.");
    assert.equal(r.ok, false, "a vendor URL must force regeneration, not a silent strip");
    assert.ok(r.findings.some((f) => f.gate === "brand"), JSON.stringify(r.findings));
    // The stripped text is still produced, as the safe fallback if regeneration fails.
    assert.ok(!r.text.includes("gohighlevel"), r.text);
  });

  test("allows ONLY the agency's own configured domains", () => {
    const opts = { allowedLinkDomains: ["acmeportal.com"] };
    const kept = guardAnswer("Details at https://acmeportal.com/help are current.", opts);
    assert.ok(kept.text.includes("acmeportal.com"), kept.text);

    const sub = guardAnswer("Details at https://docs.acmeportal.com/help.", opts);
    assert.ok(sub.text.includes("docs.acmeportal.com"), sub.text);

    const other = guardAnswer("Details at https://notacme.com/help.", opts);
    assert.ok(!other.text.includes("notacme.com"), other.text);
  });

  test("an allowlist entry must not match a lookalike domain", () => {
    // "acmeportal.com.evil.com" ends with neither "acmeportal.com" nor ".acmeportal.com"
    // as a HOST suffix, so it must not be treated as allowed.
    const r = guardAnswer("Go to https://acmeportal.com.evil.com/x now.", {
      allowedLinkDomains: ["acmeportal.com"],
    });
    assert.ok(!r.text.includes("evil.com"), r.text);
  });

  test("empty allowlist is the default, and it strips everything", () => {
    const r = guardAnswer("Try https://anything.com and https://else.org today.");
    assert.ok(!r.text.includes("http"), r.text);
  });

  test("does not leave a dangling lead-in where a link was", () => {
    const r = guardAnswer("Visit https://example.com/docs.");
    assert.ok(!/Visit\s*\./.test(r.text), JSON.stringify(r.text));
  });
});

// ---------------------------------------------------------------------------------
describe("GATE 3 — verbatim overlap", () => {
  const source =
    "To create a pipeline open the opportunities section from the left hand sidebar and " +
    "then click the pipelines tab where you can add rename or reorder each of the stages " +
    "that your deals will move through as they progress toward closing";

  test("a genuine rephrasing passes", () => {
    const r = guardAnswer(
      "Head to Leads in the sidebar, open the Pipelines tab, and you can add or rename stages there.",
      { sourceChunks: [source] }
    );
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });

  test("a long verbatim copy is refused", () => {
    // Republication with extra steps. This is the mechanical half of the
    // transformative-use argument, not a style preference.
    const r = guardAnswer(source, { sourceChunks: [source] });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.gate === "overlap"), JSON.stringify(r.findings));
  });

  test("a short quoted phrase is fine", () => {
    const r = guardAnswer("Just click the pipelines tab and you're done.", { sourceChunks: [source] });
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });

  test("threshold is configurable and enforced at the boundary", () => {
    const words = source.split(/\s+/);
    const exactly10 = words.slice(0, 10).join(" ");
    assert.equal(longestVerbatimRun(exactly10, [source]), 10);

    assert.equal(guardAnswer(exactly10, { sourceChunks: [source], overlapThreshold: 11 }).ok, true);
    assert.equal(guardAnswer(exactly10, { sourceChunks: [source], overlapThreshold: 10 }).ok, false);
  });

  test("punctuation and case differences do not hide a copy", () => {
    const disguised = source.toUpperCase().replace(/ /g, ",  ");
    assert.ok(longestVerbatimRun(disguised, [source]) >= 25, "case/punctuation should not defeat the check");
  });

  test("no source chunks means the gate is inert, not accidentally blocking", () => {
    assert.equal(guardAnswer(source, {}).ok, true);
  });

  test("handles empty and whitespace input without throwing", () => {
    assert.equal(longestVerbatimRun("", [source]), 0);
    assert.equal(longestVerbatimRun(source, [""]), 0);
    assert.equal(longestVerbatimRun("   ", [source]), 0);
  });
});

// ---------------------------------------------------------------------------------
describe("agent compose-box check", () => {
  /**
   * The human path. Because Mosaic's own team answers on behalf of many agencies, an
   * agent is the PRIMARY leak risk - they know the platform is GoHighLevel and they're
   * switching brands all afternoon.
   */
  test("blocks an agent typing the vendor name", () => {
    const r = checkAgentDraft("Yeah that's just how GoHighLevel handles it.");
    assert.equal(r.blocked, true);
  });

  test("blocks an agent pasting a vendor link", () => {
    const r = checkAgentDraft("Here you go: https://help.gohighlevel.com/support/solutions/articles/1");
    assert.equal(r.blocked, true);
  });

  test("blocks any outside link, not only vendor ones", () => {
    assert.equal(checkAgentDraft("See https://random.example.com/x").blocked, true);
  });

  test("allows the agency's own domain", () => {
    const r = checkAgentDraft("Details at https://acmeportal.com/help", {
      allowedLinkDomains: ["acmeportal.com"],
    });
    assert.equal(r.blocked, false, JSON.stringify(r.findings));
  });

  test("a normal branded reply is not blocked", () => {
    const r = checkAgentDraft("Sure! Open Leads from the sidebar and you'll see the pipeline there.");
    assert.equal(r.blocked, false, JSON.stringify(r.findings));
  });
});
