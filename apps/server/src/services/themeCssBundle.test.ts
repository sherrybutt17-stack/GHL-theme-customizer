import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderRules, cssColor } from "./themeCssBundle";

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

/**
 * The sanitisers, which had NO tests at all until 2026-08-24 — nine tests in this file and
 * not one of them mentioned `cssColor`, `cssUrl`, escaping or injection, while CLAUDE.md
 * stated the guarantee as settled fact.
 *
 * These are cheap and run in `npm test`; the blast radius is measured in a real browser by
 * `scratchpad/verify-css-injection.ts`, because what matters is not whether a character was
 * removed but whether the NEXT sub-account in the same stylesheet still gets its branding.
 */
describe("value sanitisation", () => {
  const rulesFor = (theme: unknown) => renderRules(scope as never, theme as never).join("\n");

  test("a colour cannot open a CSS comment", () => {
    // `red/*` ran on until the next `*/` anywhere in the file, which is the next
    // sub-account's block label. Measured: six rules in, one out.
    assert.equal(cssColor("red/*"), "red/");
    assert.equal(cssColor("red*/"), "red/");
    assert.ok(!rulesFor({ primaryColor: "red/*" }).includes("/*"));
  });

  test("a colour still keeps the slash that modern colour syntax needs", () => {
    // `rgb(0 0 0 / 50%)` is a real colour, so stripping `/` would break the feature.
    // Killing the asterisk closes both comment delimiters on its own.
    assert.equal(cssColor("rgb(0 0 0 / 50%)"), "rgb(0 0 0 / 50%)");
  });

  test("a colour cannot terminate the declaration or the rule", () => {
    assert.equal(cssColor("red; } body { display: none"), "red  body  display: none");
  });

  test("every CSS newline is folded out of a string, not just LF", () => {
    // CSS ends a string at LF, CR, CRLF *and* FF. The alert banner used to fold only
    // `\s*\n\s*`, so a bare CR — or a form feed, in either field — left the string open
    // and took the following sub-account's rules with it.
    // The joined bundle is newline-separated, so read the string ITSELF back out.
    const contentOf = (theme: unknown) =>
      renderRules(scope as never, theme as never)
        .flatMap((r) => [...r.matchAll(/content: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))
        .join("|");
    for (const nl of ["\r", "\n", "\r\n", "\f", "\v"]) {
      const label = JSON.stringify(nl);
      assert.equal(contentOf({ alertMessage: `Closed${nl}today` }), "Closed today", `alert kept ${label}`);
      assert.equal(
        contentOf({ menuLabelOverrides: { contacts: `Peo${nl}ple` } }),
        "Peo ple",
        `label kept ${label}`
      );
    }
  });

  test("a quote in a string is escaped, in BOTH fields", () => {
    // Written out twice by hand and the two copies had drifted; they share one helper now.
    assert.match(rulesFor({ alertMessage: 'say "hi"' }), /content: "say \\"hi\\""/);
    assert.match(rulesFor({ menuLabelOverrides: { contacts: 'say "hi"' } }), /content: "say \\"hi\\""/);
  });

  test("a font family is reduced to an identifier charset", () => {
    // The apostrophe is the one that mattered: `fontImports` used to build its Google
    // Fonts URL with `encodeURIComponent`, which leaves `'` alone, so the `url('…')`
    // closed early and the whole stylesheet parsed to ZERO rules.
    assert.match(rulesFor({ fontFamily: "Ev'il Sans" }), /font-family: 'Evil Sans'/);
    assert.ok(!rulesFor({ fontFamily: "a\"; } body { x: y" }).includes("body { x: y"));
  });
});

/**
 * The raw-CSS escape hatch, scoped per sub-account. Untested until 2026-08-25, under a doc
 * comment that claimed it "passes at-rules (@media/@keyframes) through untouched" while a
 * flat `([^{}]+)\{([^{}]*)\}` regex was silently deleting them.
 */
describe("scoping a sub-account's custom CSS", () => {
  const customFor = (css: string, s: unknown = scope) =>
    renderRules(s as never, { customCssOverride: css } as never)
      .filter((r) => r.startsWith("/* custom css */"))
      .join("\n")
      .replace("/* custom css */\n", "");

  test("a media query SURVIVES, with the prefix inside it", () => {
    // It used to come out as a bare `[prefix] .hl_nav { display: none }` — the query gone
    // and the rule it guarded applying at every width, on the client's desktop all day.
    const out = customFor("@media (max-width: 600px) { .hl_nav { display: none } }");
    assert.match(out, /@media \(max-width: 600px\)/);
    assert.match(out, /\.abc123 \.hl_nav \{ display: none \}/);
  });

  test("keyframe selectors are NOT prefixed", () => {
    // `from`/`to` are keyframe selectors. Prefixed, they become element selectors and the
    // animation is deleted without a word.
    const out = customFor("@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }");
    assert.match(out, /@keyframes pulse/);
    assert.ok(!out.includes(".abc123 from"), out);
  });

  test("@font-face passes through whole", () => {
    const out = customFor("@font-face { font-family: X; src: url(a.woff2) }");
    assert.match(out, /@font-face \{ font-family: X; src: url\(a\.woff2\) \}/);
  });

  test("a brace inside a string does not truncate the declaration", () => {
    // The old regex stopped at the first `}` wherever it was, leaving an unterminated
    // string — which in a one-file-per-agency stylesheet is the NEXT sub-account's problem.
    assert.match(customFor('.a::after { content: "}" }'), /content: "\}"/);
  });

  test("every selector in a list is prefixed, not just the first", () => {
    const out = customFor(".a, .b { color: red }");
    assert.match(out, /\.abc123 \.a, \.abc123 \.b \{/);
  });

  test("bare declarations are still wrapped — the documented fallback", () => {
    assert.match(customFor("color: red; font-weight: 700"), /^\.abc123 \{ color: red; font-weight: 700 \}$/);
  });

  test("a stray closing brace does not cost the agency the rule", () => {
    // A paste that lost its opening brace. The old flat regex dropped the `}` as a side
    // effect of `[^{}]+`; the splitter that replaced it has to do so deliberately, or the
    // brace lands mid-selector, the selector is invalid, and the rule silently vanishes.
    assert.match(customFor("} .hl_nav { color: red }"), /^\.abc123 \.hl_nav \{ color: red \}$/);
  });

  test("the agency default is emitted verbatim", () => {
    // An empty prefix means global, where nesting and at-rules already worked fully.
    const global = { prefix: "", bases: ["#sidebar-v2"] };
    assert.equal(customFor("@media print { .a { color: red } }", global), "@media print { .a { color: red } }");
  });

  test("@import is dropped from a location block, deliberately", () => {
    // Only legal before any other rule, and this block is emitted after the agency default
    // and every earlier sub-account — so the browser would ignore it wherever we put it.
    assert.ok(!customFor('@import url("https://x/y.css"); .a { color: red }').includes("@import"));
    assert.match(customFor('@import url("https://x/y.css"); .a { color: red }'), /\.abc123 \.a/);
  });
});

/**
 * The content area. Three columns carried this for the life of the schema and rendered
 * nothing; these pin the two properties that make shipping an UNCONFIRMED selector
 * defensible — that it is opt-in, and that it never reaches the sidebar or the header.
 */
describe("content area", () => {
  const contentRules = (theme: unknown, s: unknown = scope) =>
    renderRules(s as never, theme as never).filter((r) => /body, #app, main/.test(r));

  test("emits NOTHING when no content colour is set and dark mode is off", () => {
    // Every theme that exists today is in this state, and the stylesheet is
    // render-blocking, so "off" has to mean zero bytes rather than a default.
    assert.equal(contentRules({}).length, 0);
    assert.equal(contentRules({ primaryColor: "#0f766e", topBarColor: "#123456" }).length, 0);
    assert.equal(contentRules({ darkMode: false, contentBgColor: "" }).length, 0);
  });

  test("dark mode paints the canvas and emits NO text rule", () => {
    // The load-bearing half. `color` on the canvas inherits into GHL's own cards and
    // tables, which this file does not repaint — so a derived light text would land on
    // their white backgrounds and disappear. A background cannot do that.
    const rules = contentRules({ darkMode: true });
    assert.equal(rules.length, 1);
    assert.match(rules[0], /background-color: #111827 !important/);
    assert.doesNotMatch(rules[0], /(^|[^-])color: /);
  });

  test("a text colour is emitted only when it was explicitly chosen", () => {
    assert.equal(contentRules({ contentBgColor: "#111111" }).length, 1);
    const both = contentRules({ contentBgColor: "#111111", contentTextColor: "#eeeeee" });
    assert.equal(both.length, 2);
    assert.match(both[1], /[^-]color: #eeeeee !important/);
  });

  test("it never names the sidebar or the header", () => {
    // The one way a content rule could do real harm is by reaching something we already
    // brand. Both of those are painted with `!important` from this same file, so a
    // collision would be decided by specificity rather than by intent.
    const rules = contentRules({ darkMode: true, contentBgColor: "#222222" }).join("\n");
    assert.doesNotMatch(rules, /sidebar-v2|hl_header|hl_nav/);
  });

  test("it sets only colours — never position, size or display", () => {
    const rules = contentRules({ darkMode: true }).join("\n");
    assert.doesNotMatch(rules, /position:|display:|width:|height:|margin:|padding:/);
  });

  test("a sub-account's rule outranks the agency default's", () => {
    // `body` is an ANCESTOR of the location wrapper, so the usual descendant prefix
    // cannot reach it. This is the alert banner's `html:has(...)` route, and the point
    // of the test is that the override still wins.
    const theme = { darkMode: true, contentTextColor: "#eeeeee" };
    const global = contentRules(theme, { prefix: "", bases: ["#sidebar-v2"] });
    const local = contentRules(theme, scope);
    assert.equal(global.length, 2);
    assert.equal(local.length, 2);
    assert.match(local[0], /^html:has\(\.abc123\) :is\(body, #app, main/);
    assert.match(global[0], /^body, #app, main/);
    assert.doesNotMatch(global[0], /has\(/);
  });

  test("a content colour is sanitised like every other value in the file", () => {
    const rules = contentRules({ contentBgColor: "red/*", contentTextColor: "#fff;}" }).join("\n");
    assert.doesNotMatch(rules, /\/\*|\*\/|;\}/);
  });
});
