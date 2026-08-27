import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveContentTheme, contrastingTextColor, DARK_CONTENT_BG } from "./contentTheme";

/**
 * The content area is the third thing the dashboard and the stylesheet could disagree
 * about — after unlisted menu items, the accent colour and the login page. These pin
 * the SERVER's half; `verify-preview-truth` compares it against the dashboard's mirror,
 * because neither is enough on its own: a unit test proves the rule, and only the
 * comparison proves the two implementations still agree about it.
 */
describe("resolveContentTheme", () => {
  test("nothing asked for -> null, so no rule is emitted at all", () => {
    assert.equal(resolveContentTheme(null), null);
    assert.equal(resolveContentTheme(undefined), null);
    assert.equal(resolveContentTheme({}), null);
    assert.equal(resolveContentTheme({ darkMode: false }), null);
    // The editor stores a cleared colour as "", not null. That is not a choice.
    assert.equal(resolveContentTheme({ contentBgColor: "", contentTextColor: "" }), null);
    assert.equal(resolveContentTheme({ contentBgColor: "   " }), null);
  });

  test("dark mode resolves the CANVAS ONLY, never the text", () => {
    // The asymmetry is forced, not chosen. `color` on the canvas inherits into GHL's
    // own cards and tables, which this stylesheet does not repaint — so a derived
    // light text would land on their white backgrounds and vanish. A background
    // cannot do that: it only changes what sits behind them.
    assert.deepEqual(resolveContentTheme({ darkMode: true }), {
      bg: DARK_CONTENT_BG,
      text: null,
    });
  });

  test("a chosen colour BEATS dark mode — the toggle is a shortcut, not an override", () => {
    assert.deepEqual(resolveContentTheme({ darkMode: true, contentBgColor: "#332211" }), {
      bg: "#332211",
      text: null,
    });
    assert.deepEqual(resolveContentTheme({ darkMode: true, contentTextColor: "#abcdef" }), {
      bg: DARK_CONTENT_BG,
      text: "#abcdef",
    });
    assert.deepEqual(
      resolveContentTheme({ darkMode: true, contentBgColor: "#332211", contentTextColor: "#abcdef" }),
      { bg: "#332211", text: "#abcdef" }
    );
  });

  test("a background NEVER derives a text colour, however dark it is", () => {
    // Auto-contrast is right for the top bar, where every surface the text sits on is
    // one we paint. It is wrong here, where we paint one surface out of many: the
    // derived colour would reach inside cards we leave alone.
    assert.deepEqual(resolveContentTheme({ contentBgColor: "#111111" }), {
      bg: "#111111",
      text: null,
    });
    assert.deepEqual(resolveContentTheme({ contentBgColor: "#fefefe" }), {
      bg: "#fefefe",
      text: null,
    });
  });

  test("a text colour on its own is honoured rather than silently dropped", () => {
    assert.deepEqual(resolveContentTheme({ contentTextColor: "#123456" }), {
      bg: null,
      text: "#123456",
    });
  });

  test("contrastingTextColor is null for something it cannot read", () => {
    assert.equal(contrastingTextColor("not a colour"), null);
    assert.equal(contrastingTextColor("#fff"), "#1f2937");
    assert.equal(contrastingTextColor("#000"), "#ffffff");
  });
});
