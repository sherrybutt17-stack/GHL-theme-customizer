import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderRules } from "./themeCssBundle";

/**
 * Sidebar reordering, which is delivered as flex `order` on each nav item.
 *
 * The stylesheet is render-blocking and applies to a live agency's whole GHL UI, so the
 * ordering rules are worth pinning down here rather than discovering in a browser.
 */
const scope = { prefix: ".abc123", locationId: "abc123", bases: ["#sidebar-v2"] };

const orderRules = (menuOrder: unknown) =>
  renderRules(scope as never, { menuOrder } as never)
    // `order:` alone would also catch `border:`/`border-radius:`.
    .filter((r) => /\border: \d/.test(r));

describe("menu ordering", () => {
  test("emits an order per item, in the saved sequence", () => {
    const rules = orderRules(["conversations", "calendars", "contacts"]);
    assert.match(rules.join("\n"), /#sb_conversations[^}]*order: 0/);
    assert.match(rules.join("\n"), /#sb_calendars[^}]*order: 1/);
    assert.match(rules.join("\n"), /#sb_contacts[^}]*order: 2/);
  });

  /**
   * The bug this guards: `order` defaults to 0, so an item missing from the saved list
   * tied with the FIRST item in it and jumped to the top of the sidebar. Lists go stale
   * on their own — GHL adds a nav item, or a preset saved before we knew about one is
   * applied — and the live preview sorts unlisted items LAST, so the two disagreed.
   */
  test("sends anything NOT in the list to the back, not the front", () => {
    const rules = orderRules(["conversations", "calendars"]);
    const catchAll = rules.find((r) => /a\[meta\]\s*\{/.test(r));
    assert.ok(catchAll, "expected a catch-all rule for unlisted nav items");
    assert.match(catchAll!, /order: 999/);
    assert.ok(catchAll!.startsWith(".abc123 "), `catch-all must stay scoped: ${catchAll}`);
  });

  test("the catch-all is emitted FIRST, so per-key rules win on source order", () => {
    // `a[meta="x"]` ties with `a[meta]` on specificity — only order in the sheet
    // separates them. `#sb_x` outranks both, but not every item is matched by id.
    const rules = orderRules(["conversations", "calendars"]);
    assert.match(rules[0], /a\[meta\]\s*\{/);
    assert.ok(rules.slice(1).every((r) => !/a\[meta\]\s*\{/.test(r)));
  });

  test("no ordering rules at all when nothing was reordered", () => {
    // Otherwise every sub-account pays a rule that pins its whole nav to order 999,
    // in a stylesheet that blocks rendering.
    assert.deepEqual(orderRules([]), []);
    assert.deepEqual(orderRules(null), []);
    assert.deepEqual(orderRules(undefined), []);
  });

  test("an unknown key can never reach a selector", () => {
    const rules = orderRules(["contacts", "'; drop table --", "not-a-feature"]);
    assert.ok(!rules.some((r) => /drop table|not-a-feature/.test(r)), rules.join("\n"));
    // The known key still lands at its own index, not shifted by the rejects.
    assert.match(rules.join("\n"), /#sb_contacts[^}]*order: 0/);
  });
});
