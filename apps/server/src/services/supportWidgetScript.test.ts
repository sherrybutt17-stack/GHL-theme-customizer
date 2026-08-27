import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateSupportWidgetScript } from "./supportWidgetScript";

/**
 * The widget script is built as one big template literal, which makes a BACKTICK in
 * ordinary comment prose a syntax error in the generated file — writing `foo` to quote
 * an identifier silently ends the string and the rest of the widget becomes TypeScript.
 *
 * It has happened twice. Both times tsc caught it, but only because the wreckage
 * happened not to parse; a backtick that lands somewhere the remainder still parses
 * would ship a broken widget into a customer's CRM. This is a two-line guard against a
 * mistake that is very easy to make and impossible to see by reading.
 */
describe("the generated widget script", () => {
  const script = generateSupportWidgetScript("agency_123", "https://mosaic.example.com");

  test("contains no backtick — it lives inside a template literal", () => {
    assert.equal(script.includes("`"), false, "a backtick in this file ends the template literal early");
  });

  test("is syntactically valid JavaScript", () => {
    // Parses without executing: the widget touches window/document, which do not exist here.
    assert.doesNotThrow(() => new Function(script));
  });

  test("carries the agency it was built for, and the API base", () => {
    assert.ok(script.includes("agency_123"));
    assert.ok(script.includes("https://mosaic.example.com"));
  });

  test("fetches JSON only — never loads a remote script, which GHL blocks", () => {
    assert.equal(/document\.createElement\(\s*["']script["']\s*\)/.test(script), false);
  });

  test("never uses innerHTML for message text", () => {
    // Model output rendered as markup, inside a customer's CRM, is the one thing this
    // file must never do. The bubble icon is the single allowed innerHTML, and it is a
    // literal SVG with no interpolation.
    const uses = script.match(/\.innerHTML\s*=/g) ?? [];
    assert.equal(uses.length, 1, `expected only the static bubble icon, found ${uses.length}`);
    assert.ok(/bubble\.innerHTML\s*=\s*'<svg/.test(script));
  });
});
