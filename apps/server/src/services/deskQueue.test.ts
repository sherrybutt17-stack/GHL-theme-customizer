import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AgentSlot,
  capacitySnapshot,
  estimateWaitSeconds,
  freeSlots,
  enterQueuePatch,
  planDistribution,
  MIN_SAMPLES_FOR_ESTIMATE,
  formatWait,
  waitSentence,
} from "./deskQueue";

/**
 * The arithmetic behind a promise made to a real client.
 *
 * The atomic claim needs a database and is covered by the live sweep; what is unit
 * tested here is everything that can be wrong quietly — an ETA invented from two
 * samples, a distribution that fills an agent past their limit.
 *
 * Response-time percentiles used to be here as a pure function. They now run as
 * `percentile_cont` inside Postgres — the JS version pulled every row in the window
 * across the pipe and was 97% of the cost of a poll that fires for every waiting
 * client — so their checks moved to `scratchpad/verify-routing.js`, where they run
 * against real SQL. Unit tests for a function nothing calls are worse than no tests:
 * they report green while the code that ships is unexercised.
 */

const agent = (over: Partial<AgentSlot> & { name: string }): AgentSlot => ({
  id: over.name.toLowerCase(),
  tier: 1,
  maxConcurrent: 3,
  held: 0,
  available: true,
  ...over,
});

describe("capacity", () => {
  test("an away agent contributes no capacity", () => {
    const snap = capacitySnapshot([
      agent({ name: "Ada", maxConcurrent: 3 }),
      agent({ name: "Bo", maxConcurrent: 3, available: false }),
    ]);
    assert.equal(snap.capacity, 3);
    assert.equal(snap.onDuty, 1);
  });

  test("but tickets they are still holding DO count as in progress", () => {
    // Otherwise stepping away makes the desk look emptier than it is, and those
    // clients are neither queued nor answered.
    const snap = capacitySnapshot([
      agent({ name: "Ada", held: 1 }),
      agent({ name: "Bo", held: 2, available: false }),
    ]);
    assert.equal(snap.inProgress, 3);
    assert.equal(snap.free, 2);
  });

  test("free slots never go negative when an agent is over their limit", () => {
    // A manager can deliberately transfer past capacity; the arithmetic must not then
    // hand out phantom negative seats that make the desk look like it has room.
    assert.equal(freeSlots(agent({ name: "Ada", maxConcurrent: 3, held: 5 })), 0);
  });
});

describe("wait estimate — null is a real answer", () => {
  const base = { position: 1, medianSeconds: 120, sampleCount: 20, free: 2, capacity: 6 };

  test("quotes roughly one typical response when a seat is free", () => {
    assert.equal(estimateWaitSeconds(base), 120);
  });

  test("grows with the queue once every seat is taken", () => {
    const busy = estimateWaitSeconds({ ...base, position: 8, free: 0 });
    assert.ok(busy !== null && busy > 120, `expected a longer wait, got ${busy}`);
  });

  test("refuses to guess from too few samples", () => {
    assert.equal(estimateWaitSeconds({ ...base, sampleCount: MIN_SAMPLES_FOR_ESTIMATE - 1 }), null);
  });

  test("refuses to quote a time when NOBODY is on the desk", () => {
    // The worst version of this promise: "someone will be with you in 2 minutes" while
    // the desk is empty. No number is the honest output.
    assert.equal(estimateWaitSeconds({ ...base, capacity: 0, free: 0 }), null);
  });
});

describe("distribution", () => {
  test("goes to the least loaded, not the next in rotation", () => {
    // Round-robin is fair to agents and unfair to clients: it can hand a ticket to
    // someone already at their limit while a colleague sits idle.
    const plan = planDistribution(
      [{ id: "t1", tier: 1 }],
      [agent({ name: "Ada", held: 2 }), agent({ name: "Bo", held: 0 })]
    );
    assert.deepEqual(plan, [{ conversationId: "t1", deskUserId: "bo" }]);
  });

  test("a big limit does not swallow the whole queue", () => {
    // The bug this catches, found live: ranking on FREE SEATS sends every ticket to
    // whoever has the largest limit. A manager with a limit of 5 outranked two idle
    // agents with limits of 2 all the way down, so distribute stacked all three
    // tickets on one person while two agents sat empty.
    const plan = planDistribution(
      [
        { id: "t1", tier: 1 },
        { id: "t2", tier: 1 },
        { id: "t3", tier: 1 },
      ],
      [
        agent({ name: "Ada", maxConcurrent: 2 }),
        agent({ name: "Bo", maxConcurrent: 2 }),
        agent({ name: "Mgr", maxConcurrent: 5 }),
      ]
    );
    assert.equal(new Set(plan.map((p) => p.deskUserId)).size, 3, JSON.stringify(plan));
  });

  test("but the bigger limit does earn more work over a full pass", () => {
    // Levelling utilisation must not flatten into equal shares — capacity is a real
    // statement about how much someone can carry.
    const tickets = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, tier: 1 }));
    const plan = planDistribution(tickets, [
      agent({ name: "Ada", maxConcurrent: 2 }),
      agent({ name: "Mgr", maxConcurrent: 5 }),
    ]);
    const forMgr = plan.filter((p) => p.deskUserId === "mgr").length;
    const forAda = plan.filter((p) => p.deskUserId === "ada").length;
    assert.equal(forMgr, 5);
    assert.equal(forAda, 2);
  });

  test("never assigns past an agent's limit", () => {
    const plan = planDistribution(
      [
        { id: "t1", tier: 1 },
        { id: "t2", tier: 1 },
        { id: "t3", tier: 1 },
      ],
      [agent({ name: "Ada", maxConcurrent: 2, held: 0 })]
    );
    assert.equal(plan.length, 2);
    // The third stays queued. Leaving it visible in the queue is the honest outcome;
    // assigning it would hide it behind a full desk.
    assert.ok(!plan.some((p) => p.conversationId === "t3"));
  });

  test("a tier-2 ticket never lands on a tier-1 agent", () => {
    // It would look assigned, so nobody would escalate it, and the client would wait
    // behind a person who cannot answer them.
    const plan = planDistribution(
      [{ id: "t1", tier: 2 }],
      [agent({ name: "Ada", tier: 1 })]
    );
    assert.deepEqual(plan, []);
  });

  test("skips agents who are away", () => {
    const plan = planDistribution([{ id: "t1", tier: 1 }], [agent({ name: "Ada", available: false })]);
    assert.deepEqual(plan, []);
  });

  test("is deterministic — clicking distribute twice on an unchanged queue agrees", () => {
    const tickets = [
      { id: "t1", tier: 1 },
      { id: "t2", tier: 1 },
    ];
    const agents = () => [agent({ name: "Ada" }), agent({ name: "Bo" })];
    assert.deepEqual(planDistribution(tickets, agents()), planDistribution(tickets, agents()));
  });
});

describe("entering the queue", () => {
  test("a follow-up into a WAITING ticket does not restart the wait clock", () => {
    // Otherwise a client asking "hello? anyone there?" sends themselves to the back of
    // the line for asking.
    const queuedAt = new Date("2026-08-14T10:00:00Z");
    const patch = enterQueuePatch({ status: "escalated", queuedAt });
    assert.equal(patch.queuedAt.getTime(), queuedAt.getTime());
  });

  test("a resolved ticket coming back is a NEW wait", () => {
    const old = new Date("2026-08-01T10:00:00Z");
    const patch = enterQueuePatch({ status: "resolved", queuedAt: old });
    assert.ok(patch.queuedAt.getTime() > old.getTime());
    assert.equal(patch.status, "escalated");
  });

  test("an open conversation escalating for the first time gets a clock", () => {
    const patch = enterQueuePatch({ status: "open", queuedAt: null });
    assert.ok(patch.queuedAt instanceof Date);
  });
});

describe("the wait a client is told about", () => {
  test("hours above an hour, because 'about 243 min' is a number the reader has to convert", () => {
    assert.equal(formatWait(30), "under a minute");
    assert.equal(formatWait(90), "2 min");
    assert.equal(formatWait(3540), "59 min");
    assert.equal(formatWait(4000), "1.1 hr");
  });

  test("the sentence reads naturally in both branches", () => {
    // "Usually about under a minute" is why this is one function and not a concatenation
    // at each call site.
    assert.equal(waitSentence(30), "Usually under a minute.");
    assert.equal(waitSentence(720), "Usually about 12 min.");
  });

  test("no estimate stays null - it must never become a promise", () => {
    // estimateWaitSeconds returns null below five measured responses or with nobody on
    // the desk. Formatting a null into "under a minute" would invent the exact claim
    // that rule exists to withhold.
    assert.equal(waitSentence(null), null);
  });

  test("the desk and the client cannot be shown different wordings", () => {
    // The regression this replaces: the widget rounded to minutes forever while the desk
    // used a compact `1h 7m`, so one estimate produced two sentences and the desk's line
    // claimed to be quoting the client's.
    for (const s of [10, 59, 61, 900, 3599, 3601, 7200, 86400]) {
      assert.equal(waitSentence(s), waitSentence(s));
      assert.ok(waitSentence(s)!.startsWith("Usually"));
      assert.ok(!/\d+h \d+m/.test(waitSentence(s)!), "no compact desk format reaches a client");
    }
  });
});
