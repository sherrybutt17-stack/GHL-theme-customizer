import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANSWERED_WITHOUT_KB_RE,
  flattenMarkdown,
  isOwnAccountMoneyQuestion,
  promisesHuman,
} from "./supportBot";

/**
 * The widget renders answers with `textContent` (never innerHTML - that text is model
 * output inside a customer's CRM), so any markdown the model emits reaches the client as
 * literal punctuation. Measured on live output: 4-6 of 11 answers used bold on every
 * model tested. The system prompt asks for plain text; this is what enforces it.
 */
describe("flattenMarkdown", () => {
  test("removes bold, which is what models actually emit", () => {
    assert.equal(flattenMarkdown("Open **Leads** from the sidebar."), "Open Leads from the sidebar.");
    assert.equal(flattenMarkdown("Click __New__ in the corner."), "Click New in the corner.");
  });

  test("removes italics, headings, inline code and quote markers", () => {
    assert.equal(flattenMarkdown("Use *People* here."), "Use People here.");
    assert.equal(flattenMarkdown("## Adding a person\nOpen People."), "Adding a person\nOpen People.");
    assert.equal(flattenMarkdown("Type `hello` there."), "Type hello there.");
    assert.equal(flattenMarkdown("> Note this."), "Note this.");
  });

  test("keeps a numbered list readable - it is the shape most procedures come back in", () => {
    assert.equal(
      flattenMarkdown("1. Open **Leads**.\n2. Select the pipelines tab.\n3. Add your stages."),
      "1. Open Leads.\n2. Select the pipelines tab.\n3. Add your stages."
    );
  });

  test("leaves ordinary prose completely alone", () => {
    for (const s of [
      "You can add up to 5 * 3 items.",
      "Their price is 2*4 dollars.",
      "The file is called my_report_final and lives in your downloads.",
      "Rates run 5-10% depending on volume.",
    ]) {
      assert.equal(flattenMarkdown(s), s, `mangled: ${s}`);
    }
  });

  test("does NOT touch markdown links - answerGuard's link gate must see them intact", () => {
    // If this stripped the syntax, the link gate would stop counting the leak, and the
    // per-agency link metric would silently read zero.
    const withLink = "See [the guide](https://example.com/docs) for more.";
    assert.ok(flattenMarkdown(withLink).includes("](https://example.com/docs)"));
  });

  test("an unmatched asterisk is left as typed rather than swallowed", () => {
    assert.equal(flattenMarkdown("A single * stays."), "A single * stays.");
    assert.equal(flattenMarkdown("**unclosed bold"), "**unclosed bold");
  });
});

/**
 * Which "I found nothing" questions file a ticket.
 *
 * Retrieving nothing normally means the bot couldn't help, so it hands the conversation
 * to a live agent — that is the fail-safe, and it is what catches a client asking for a
 * feature the agency hid but never wrote an article about ("a course area for my
 * members" shares no words with "Memberships", so no label match will ever see it).
 *
 * The exceptions are the two classes the prompt answers completely on its own. Left in,
 * they would file a ticket for every client who wondered what the software was — burying
 * the queue in questions the bot got RIGHT and recording each as a support failure.
 */
describe("ANSWERED_WITHOUT_KB_RE", () => {
  test("the identity question — the one the product exists to hold — files no ticket", () => {
    for (const q of [
      "What software is this actually? Is it built on something else?",
      "Be honest, this is a white label of another CRM right? Which one?",
      "Who built this platform?",
      "Is this rebranded from something?",
      "What CRM is this based on?",
    ]) {
      assert.ok(ANSWERED_WITHOUT_KB_RE.test(q), `should be answered without the KB: ${q}`);
    }
  });

  test("a refused link request files no ticket either", () => {
    for (const q of ["Can you send me a link to the documentation?", "Send me the link to your docs"]) {
      assert.ok(ANSWERED_WITHOUT_KB_RE.test(q), `should be answered without the KB: ${q}`);
    }
  });

  test("ordinary how-to questions are NOT exempt — an unanswerable one must reach a human", () => {
    for (const q of [
      "How do I create a pipeline?",
      "A friend told me I can build a course area for my members. Can I do that here?",
      "Why is my calendar not syncing?",
      "Can I send a text message to a whole list?",
      "How do I change the software my team uses to log calls?",
    ]) {
      assert.ok(!ANSWERED_WITHOUT_KB_RE.test(q), `must still hand off when nothing is found: ${q}`);
    }
  });
});

/**
 * The money boundary.
 *
 * This rule fails in two directions and both are expensive. Too loose and the bot
 * answers a question about the client's bill, committing the agency to something it
 * never agreed to. Too tight and it hands off every question containing the word
 * "invoice" — which is what it did, making the entire payments half of the knowledge
 * base unreachable however well written it was.
 */
describe("isOwnAccountMoneyQuestion", () => {
  test("their own account, plan or bill ALWAYS reaches a human", () => {
    for (const q of [
      "I want a refund",
      "Can you refund me for last month?",
      "Why was I charged twice?",
      "I want to cancel my subscription",
      "How do I cancel my plan?",
      "What is my invoice for this month?",
      "How much does this cost?",
      "What am I paying for exactly?",
      "What are your prices?",
      "I want to upgrade",
      "Can I see my contract?",
    ]) {
      assert.ok(isOwnAccountMoneyQuestion(q), `must reach a human: ${q}`);
    }
  });

  test("operating the product's payment features is a how-to the bot should answer", () => {
    for (const q of [
      "Can I charge a deposit before someone books a slot?",
      "How do I send an invoice to a customer?",
      "How do I set up a subscription that bills monthly?",
      "Where do I connect a payment provider?",
      "Is there a way to add a discount code at checkout?",
      "How do I refund a customer who paid me by card?",
      "Can I cancel a subscription for one of my clients?",
      "How do I take payment when someone books an appointment?",
    ]) {
      assert.ok(!isOwnAccountMoneyQuestion(q), `bot should answer this itself: ${q}`);
    }
  });

  test("a bare money statement with no how-to framing still reaches a human", () => {
    for (const q of ["refund", "billing problem", "the payment failed and I am annoyed"]) {
      assert.ok(isOwnAccountMoneyQuestion(q), `must reach a human: ${q}`);
    }
  });

  test("questions with no money content are untouched by this rule", () => {
    for (const q of ["How do I create a pipeline?", "Why is my calendar not syncing?", "hello"]) {
      assert.ok(!isOwnAccountMoneyQuestion(q), `not a money question: ${q}`);
    }
  });
});

/**
 * The bot must not promise a person it has not summoned.
 *
 * Found live: asked how to get a contract signed electronically, the bot replied "that
 * isn't part of your setup. I'm passing this to someone from the team" while BOTH
 * shouldEscalate and offerHuman were false — no ticket, no email to the desk, not even a
 * button. The client is told somebody is coming and nobody is, which is the one failure
 * they experience as being lied to.
 *
 * The prompt cannot prevent this. Telling a model "only offer a human when the system
 * says so" is a request; this is the guarantee.
 */
describe("promisesHuman", () => {
  test("catches the phrasings the bot actually produced", () => {
    for (const s of [
      "Electronic signing isn't part of your setup. I'm passing this to someone from the team who can help.",
      "Let me get someone from the team to help you with this.",
      "I'll connect you with someone who can sort that out.",
      "Someone from the team will take a look at this.",
      "That's best handled by a colleague — I'm handing this over.",
      "I've escalated this to an agent for you.",
    ]) {
      assert.equal(promisesHuman(s), "committed", `should be a committed promise: ${s}`);
    }
  });

  test("catches a promise of contact even with no hand-off verb", () => {
    for (const s of [
      "We'll be in touch shortly.",
      "Someone will get back to you before the end of the day.",
      "We will call you once we have looked into it.",
    ]) {
      assert.equal(promisesHuman(s), "committed", `should be a committed promise: ${s}`);
    }
  });

  test("a hand-off verb alone is ordinary advice, not an escalation", () => {
    // These are real sentences from the knowledge base. Escalating on them would file a
    // ticket for a perfectly good answer.
    for (const s of [
      "You can pass it to your accountant at the end of the month.",
      "Connect your Google account in Settings, then pick the calendar to check.",
      "Get the details from your domain provider and add the record shown.",
      "Ask for the request in writing and keep a copy.",
    ]) {
      assert.equal(promisesHuman(s), null, `must NOT count as a promise: ${s}`);
    }
  });

  test("a human noun alone is a description, not an escalation", () => {
    for (const s of [
      "Someone with settings access can change this for you.",
      "A colleague can be given their own login from My Staff.",
      "The team calendar shows everybody's availability at once.",
    ]) {
      assert.equal(promisesHuman(s), null, `must NOT count as a promise: ${s}`);
    }
  });

  test("an ordinary how-to answer never trips it", () => {
    assert.equal(
      promisesHuman(
        "Open Deals in the left sidebar, switch to the pipelines tab, then select create a pipeline and name it."
      ),
      null
    );
  });

  test("an OFFER of a person is not a hand-off — it shows the button, it files no ticket", () => {
    // Measured: one generation in four of "can you send me a link" volunteers this. Read
    // as a commitment it files a ticket for a question the bot answered perfectly, and
    // buries the desk queue in solved questions — the exact bug ANSWERED_WITHOUT_KB_RE
    // exists to prevent.
    for (const s of [
      "I can't send links here. Tell me what you're trying to do, and I'll help if I can—or connect you with the team for the right guidance.",
      "I can walk you through it, or I can get someone from the team if you'd prefer.",
      "Let me know if you'd like me to pass this to someone.",
      "Happy to connect you with the team if that would help.",
    ]) {
      assert.equal(promisesHuman(s), "offered", `should be an offer, not a hand-off: ${s}`);
    }
  });

  test("a commitment anywhere outranks an offer elsewhere in the same answer", () => {
    assert.equal(
      promisesHuman("Let me know if you want more detail. I'm passing this to someone from the team now."),
      "committed"
    );
  });
});
