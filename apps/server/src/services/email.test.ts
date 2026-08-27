import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail, notifyAgencyOfHandoff, notifyDeskOfEscalation } from "./email";

/**
 * Outbound mail, which had no tests, and carries two promises worth checking.
 *
 *  1. IT MUST NEVER THROW. Every send is a notification about something already recorded
 *     and already committed, so a mail failure must cost a notification and never a
 *     hand-off. Nothing had ever exercised the failure paths.
 *
 *  2. WHAT LEAVES MOSAIC. The tier-3 hand-off is the one place a whole transcript is sent
 *     to the AGENCY, and `Message` holds our internal workflow in the same table as the
 *     conversation. The client's chat window has filtered `system` since it was built;
 *     this had no filter at all and rendered those rows under the label "Note:".
 *
 * The shipped functions are executed against a stub `fetch`, so these assert the bytes
 * that would reach Resend rather than a paraphrase of them.
 */

interface Sent { url: string; headers: Record<string, string>; body: any }
let sent: Sent[] = [];
let realFetch: typeof globalThis.fetch;
let realWarn: typeof console.warn;
let realError: typeof console.error;
let logs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "DESK_NOTIFY_EMAIL", "SUPPORT_DESK_URL"];

/** Stub `fetch` with a given responder and record what was posted. */
function stubFetch(responder: (body: any) => Promise<Response> | Response): void {
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({ url: String(url), headers: init?.headers ?? {}, body });
    return responder(body);
  }) as typeof globalThis.fetch;
}
const ok = () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 });

beforeEach(() => {
  sent = [];
  logs = [];
  realFetch = globalThis.fetch;
  realWarn = console.warn;
  realError = console.error;
  console.warn = (...a: unknown[]) => logs.push(a.join(" "));
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.EMAIL_FROM;
  delete process.env.DESK_NOTIFY_EMAIL;
  delete process.env.SUPPORT_DESK_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  console.error = realError;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("sendEmail never throws into its caller", () => {
  const one = { to: ["agency@example.com"], subject: "s", text: "t" };

  test("a good send reports sent", async () => {
    stubFetch(ok);
    assert.deepEqual(await sendEmail(one), { sent: true });
    assert.equal(sent[0].url, "https://api.resend.com/emails");
  });

  test("a provider 5xx is reported, not raised", async () => {
    stubFetch(() => new Response("upstream exploded", { status: 502 }));
    const r = await sendEmail(one);
    assert.equal(r.sent, false);
    assert.match(r.error ?? "", /502/);
  });

  test("a provider 422 with a JSON complaint is reported, not raised", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "domain not verified" }), { status: 422 }));
    assert.equal((await sendEmail(one)).sent, false);
  });

  test("a network failure is reported, not raised", async () => {
    globalThis.fetch = (async () => { throw new Error("connect ECONNREFUSED 1.2.3.4:443"); }) as any;
    const r = await sendEmail(one);
    assert.equal(r.sent, false);
    assert.match(r.error ?? "", /ECONNREFUSED/);
  });

  test("an abort — the 8s timeout — is reported, not raised", async () => {
    globalThis.fetch = (async () => { throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" }); }) as any;
    assert.equal((await sendEmail(one)).sent, false);
  });

  test("a body that cannot be read still yields a clean result", async () => {
    // `res.text()` is what reads the provider's complaint; a stream that errors mid-read
    // must not turn a failed notification into a failed hand-off.
    stubFetch(() => ({ ok: false, status: 500, text: async () => { throw new Error("stream died"); } } as any));
    assert.equal((await sendEmail(one)).sent, false);
  });

  test("no recipients is a skip, and makes no request", async () => {
    stubFetch(ok);
    assert.deepEqual(await sendEmail({ ...one, to: ["", "   "] }), { sent: false, skipped: "no-recipients" });
    assert.equal(sent.length, 0);
  });

  test("unconfigured is a SUPPORTED state: it says what it would have sent", async () => {
    delete process.env.RESEND_API_KEY;
    stubFetch(ok);
    assert.deepEqual(await sendEmail(one), { sent: false, skipped: "not-configured" });
    assert.equal(sent.length, 0);
    assert.ok(logs.some((l) => l.includes("RESEND_API_KEY") && l.includes("agency@example.com")));
  });
});

describe("the tier-3 hand-off email — what leaves Mosaic", () => {
  /**
   * A realistic conversation: the client, the bot, an agent's reply, and every shape of
   * `system` row the product actually writes (bodies copied from the four files that
   * write them — deskInbox, deskQueue, deskQueue's release, and ticketAutomations).
   */
  const MESSAGES = [
    { role: "user", body: "My contact import keeps failing halfway through." },
    { role: "bot", body: "Try splitting the file into batches of 500 rows." },
    { role: "system", body: "[ticket raised by Ada Lovelace — email]" },
    { role: "system", body: "[transferred from Ada Lovelace to Bo Diaz] client is on the legacy billing plan, check before promising anything" },
    { role: "system", body: "[escalated to tier 2 by Bo Diaz]" },
    { role: "system", body: "[still unanswered] held by Bo Diaz for at least 90 minutes with no reply to the client." },
    { role: "system", body: "[returned to the queue — Bo Diaz's account was disabled]" },
    { role: "system", body: "[raised to tier 3 automatically] no first reply after at least 240 minutes of open hours, against a target of 240." },
    { role: "agent", body: "Sorry for the wait — splitting the file is the right fix, but your plan caps imports." },
  ];

  async function handoff(messages = MESSAGES) {
    stubFetch(ok);
    const r = await notifyAgencyOfHandoff({
      to: ["owner@theagency.com"],
      brandName: "Harbour Suite",
      locationName: "190 Ranch",
      note: "This is about their plan limit, which is your call not ours.",
      messages,
      agentName: "Cy Prentice",
    });
    assert.equal(r.sent, true);
    return String(sent[0].body.text);
  }

  test("not one `system` row reaches the agency", async () => {
    const text = await handoff();
    for (const m of MESSAGES.filter((m) => m.role === "system")) {
      assert.ok(!text.includes(m.body), `leaked: ${m.body}`);
    }
  });

  test("…nor the fragments that identify our staff and our own failures", async () => {
    const text = await handoff();
    for (const fragment of [
      "Bo Diaz",              // a Mosaic agent's name
      "Ada Lovelace",
      "account was disabled", // why they stopped working the ticket
      "still unanswered",     // our own missed response target
      "tier 2",               // Mosaic-internal escalation levels
      "tier 3",
      "transferred from",
      "legacy billing plan",  // an agent's private note to another agent
    ]) {
      assert.ok(!text.includes(fragment), `leaked "${fragment}"`);
    }
    // The label that made them read as deliberate is gone with them.
    assert.ok(!text.includes("Note: ["));
  });

  test("and the CONVERSATION still arrives — a filter that empties the email is not a fix", async () => {
    const text = await handoff();
    assert.ok(text.includes("Client: My contact import keeps failing halfway through."));
    assert.ok(text.includes("Assistant: Try splitting the file into batches of 500 rows."));
    assert.ok(text.includes("Mosaic: Sorry for the wait"));
  });

  test("the note our team wrote IS delivered — that is the deliberate channel", async () => {
    const text = await handoff();
    assert.ok(text.includes("This is about their plan limit, which is your call not ours."));
    assert.ok(text.includes("Cy Prentice"), "the agency is told who passed it over");
    assert.ok(text.includes("190 Ranch") && text.includes("Harbour Suite"));
  });

  test("a transcript with nothing visible says so rather than trailing a bare heading", async () => {
    const text = await handoff(MESSAGES.filter((m) => m.role === "system"));
    assert.ok(/nothing the client wrote/.test(text), text.slice(-400));
  });

  test("the subject names the sub-account, so it is findable in an inbox", async () => {
    await handoff();
    assert.equal(sent[0].body.subject, "Support request needs you — 190 Ranch (Harbour Suite)");
  });
});

describe("notifyDeskOfEscalation", () => {
  test("with DESK_NOTIFY_EMAIL unset it skips and sends nothing", async () => {
    stubFetch(ok);
    const r = await notifyDeskOfEscalation({
      brandName: "Harbour Suite", locationName: null, agencyName: null,
      question: "q", conversationId: "c1", reason: "the client asked for a human",
    });
    assert.deepEqual(r, { sent: false, skipped: "no-recipients" });
    assert.equal(sent.length, 0);
  });

  test("it goes to Mosaic's own team, so it may name the desk and the reason", async () => {
    process.env.DESK_NOTIFY_EMAIL = "desk@mosaic.test, second@mosaic.test";
    process.env.SUPPORT_DESK_URL = "https://desk.example.com/";
    stubFetch(ok);
    await notifyDeskOfEscalation({
      brandName: "Harbour Suite", locationName: "190 Ranch", agencyName: "The Agency",
      question: "Where is my invoice?", conversationId: "c1", reason: "money question",
    });
    assert.deepEqual(sent[0].body.to, ["desk@mosaic.test", "second@mosaic.test"]);
    assert.ok(String(sent[0].body.text).includes("https://desk.example.com"), "no trailing slash, and present");
    assert.ok(String(sent[0].body.text).includes("money question"));
  });
});
