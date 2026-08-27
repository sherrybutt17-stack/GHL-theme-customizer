/**
 * End to end against the REAL public widget API, with a real model, real retrieval and
 * the real gates — the only test that proves what a client actually sees.
 *
 * Every question is phrased the way somebody types into a chat box. What is asserted is
 * what the client would judge:
 *   - an answer arrived at all
 *   - it named no vendor and emitted no link (the two gates that matter)
 *   - it did NOT hand off, for questions the corpus covers — the specific complaint
 *     that started this work was a bot handing everything to a human
 */
const BASE = "http://localhost:3210";
const AGENCY = "cmr9o8vze0001x8d5phm2egm2";
// Whichever sub-account local-setup.js most recently enabled. It picks with findFirst,
// so this moves whenever a gate's cleanup deletes the demo SupportConfig and it is re-run.
const LOCATION = process.env.LOCATION ?? "sGU9O4zQPekCHR3hpQfA";

/** [question, shouldTheBotAnswerItItself] */
const QUESTIONS = [
  ["hello there", true],
  ["how do i point my own web address at my funnel", true],
  ["my text messages arent going through to anyone", true],
  ["can i charge a deposit before someone books a slot", true],
  ["i need a client to sign an agreement electronically", true],
  ["what do i need to do before i can text american numbers", true],
  ["they paid me and never received what they bought", true],
  ["how do i copy my whole setup into a new client account", true],
  ["why does my email keep landing in junk", true],
  ["i want a staff member who can only see their own people", true],
  ["how do i stop the follow up once somebody writes back", true],
  ["the same person keeps appearing twice in my list", true],
  ["how do i put a little chat bubble on my website", true],
  ["what is the difference between a website and a funnel", true],
  ["a friend told me i can build a course area for my members", false], // hidden feature
  ["what software is this actually built on? be honest", true],
  ["can you send me a link to the documentation", true],

  // --- the second tranche: areas that did not exist in the corpus before ---
  ["how do i get a zoom link onto my bookings automatically", true],
  ["a customer has asked me to delete all their data, what do i do", true],
  ["can i let someone pay in three instalments instead of all at once", true],
  ["how do i stop two staff being booked into the same treatment room", true],
  ["what should the title be so my page looks right in google results", true],
  ["someone on my team should not be able to export the contact list", true],
  ["how do i turn on two factor authentication", true],
  ["my facebook page stopped sending messages through", true],
  ["how do i work out what a customer actually costs me to acquire", true],
  ["can i schedule a text to send tomorrow morning instead of now", true],
];

const BLOCKLIST = /gohighlevel|highlevel|high[\s._-]+level|leadconnector|msgsndr|\bghl\b/i;
const URL_RE = /https?:\/\/|www\./i;

(async () => {
  const rows = [];
  for (const [question, shouldAnswer] of QUESTIONS) {
    // A fresh conversation each time: re-using one lets an earlier answer colour the next.
    const start = await fetch(`${BASE}/support/api/${AGENCY}/${LOCATION}/conversation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/v2/location/x/dashboard" }),
    });
    if (!start.ok) throw new Error(`conversation start failed: ${start.status} ${await start.text()}`);
    const { conversationId, token } = await start.json();

    const res = await fetch(
      `${BASE}/support/api/${AGENCY}/${LOCATION}/conversation/${conversationId}/message`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-mosaic-conversation": token },
        body: JSON.stringify({ text: question }),
      }
    );
    const out = await res.json();
    const answer = (out.reply ?? "").toString();

    const problems = [];
    // Surface a transport failure as itself rather than as "the bot said nothing" —
    // the first run of this script reported 17 empty answers that were actually a
    // wrong field name, which reads exactly like a broken bot.
    if (out.error) problems.push(`HTTP ${res.status}: ${out.error}`);
    else if (!answer.trim()) problems.push("EMPTY ANSWER");
    if (BLOCKLIST.test(answer)) problems.push("VENDOR NAME LEAKED");
    if (URL_RE.test(answer)) problems.push("URL LEAKED");
    if (shouldAnswer && out.handedToHuman) problems.push("handed to a human unnecessarily");
    if (!shouldAnswer && !out.handedToHuman) problems.push("should have handed off and did not");

    rows.push({ question, answer, problems, handed: !!out.handedToHuman });
  }

  let bad = 0;
  for (const r of rows) {
    const mark = r.problems.length ? "FAIL" : "  ok";
    if (r.problems.length) bad++;
    console.log(`\n${mark}  Q: ${r.question}`);
    console.log(`      A: ${r.answer.replace(/\n+/g, " ").slice(0, 260)}`);
    console.log(`      handedToHuman=${r.handed}${r.problems.length ? `  << ${r.problems.join("; ")}` : ""}`);
  }
  console.log(`\n${rows.length - bad}/${rows.length} clean.`);
  process.exit(bad ? 1 : 0);
})();
