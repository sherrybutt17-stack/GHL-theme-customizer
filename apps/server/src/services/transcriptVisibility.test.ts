import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EXTERNAL_VISIBLE_ROLES, visibleOutsideMosaic } from "./transcriptVisibility";

/**
 * One filter, two doors: the client's chat window and the agency hand-off email. The
 * second had none until 2026-08-25, which is the whole reason this is a module rather
 * than a `const` in whichever route thought of it first.
 */
describe("what may leave Mosaic", () => {
  test("the client, the bot and an agent are visible outside", () => {
    assert.deepEqual([...EXTERNAL_VISIBLE_ROLES].sort(), ["agent", "bot", "user"]);
  });

  test("`system` is not, and that is the point", () => {
    assert.equal(EXTERNAL_VISIBLE_ROLES.has("system"), false);
  });

  test("it is an ALLOWLIST: a role added later is invisible until somebody decides", () => {
    // A `!== "system"` denylist would ship the next role by default, and the next role is
    // as likely to be internal as not.
    const rows = [{ role: "user" }, { role: "system" }, { role: "audit" }, { role: "internal" }];
    assert.deepEqual(visibleOutsideMosaic(rows), [{ role: "user" }]);
  });

  test("order and identity are preserved — it filters, it does not rebuild", () => {
    const a = { role: "user", body: "one" };
    const b = { role: "system", body: "[transferred from Ada to Bo]" };
    const c = { role: "agent", body: "two" };
    const out = visibleOutsideMosaic([a, b, c]);
    assert.equal(out.length, 2);
    assert.equal(out[0], a);
    assert.equal(out[1], c);
  });

  test("nothing visible yields an empty list, not a throw", () => {
    assert.deepEqual(visibleOutsideMosaic([{ role: "system" }]), []);
    assert.deepEqual(visibleOutsideMosaic([]), []);
  });
});
