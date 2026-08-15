import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { looseTerms, toLooseQuery } from "./kbSearch";

/**
 * The loose-query builder.
 *
 * This exists because of a bug that was invisible from every direction except a real
 * measurement: `websearch_to_tsquery` joins bare terms with AND, so
 * "how do i copy my whole setup into a new client account" required ONE article to
 * contain all six significant words and therefore matched nothing. 23 of 30 realistic
 * questions retrieved zero rows, and zero rows is what the bot treats as thin retrieval
 * and hands to a human — so it looked like the knowledge base was empty when it wasn't.
 *
 * The SQL itself needs a database and is covered by the coverage probe. What is unit
 * tested here is the part that silently changes meaning: the operators
 * websearch_to_tsquery honours inside the text we hand it.
 */
describe("loose query building", () => {
  test("joins terms with OR — the entire point, and the thing that regressed", () => {
    const q = toLooseQuery("how do i copy my whole setup into a new client account");
    assert.ok(q.includes(" or "), "terms must be OR-joined, not left to default AND");
    assert.ok(!q.includes("&"), "never hand raw tsquery operators to websearch_to_tsquery");
  });

  test("strips a leading hyphen, which websearch_to_tsquery reads as NOT", () => {
    // "e-mail not arriving" typed with a stray dash would otherwise EXCLUDE every
    // article containing the term the user is asking about.
    assert.deepEqual(looseTerms("why is -email not arriving"), ["why", "email", "arriving"]);
  });

  test("strips quotes, which would otherwise open a phrase search", () => {
    assert.deepEqual(looseTerms(`why won't "my texts" send`), ["why", "won", "texts", "send"]);
  });

  test("drops the operator words themselves so they are not searched for", () => {
    assert.deepEqual(looseTerms("invoices and receipts or statements"), [
      "invoices",
      "receipts",
      "statements",
    ]);
  });

  test("drops tokens under three characters — they carry no signal and match everything", () => {
    assert.deepEqual(looseTerms("do i go to my ai bot"), ["bot"]);
  });

  test("caps the term count so a pasted paragraph cannot match the whole corpus", () => {
    const pasted = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    assert.equal(looseTerms(pasted).length, 24);
  });

  test("a question with nothing usable yields an empty query, so the caller can skip the pass", () => {
    assert.equal(toLooseQuery("is it ok?"), "");
  });

  test("trailing punctuation is trimmed but internal characters are kept", () => {
    // "a2p" must survive intact: it is the term people actually search for.
    assert.deepEqual(looseTerms("what is a2p, exactly?"), ["what", "a2p", "exactly"]);
  });
});
