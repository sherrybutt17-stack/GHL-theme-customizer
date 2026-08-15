import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveBrandName, GENERIC_PLATFORM_NAME } from "./brandTerms";
import { findBrandLeaks } from "./brandLexicon";

/**
 * The brand-name fallback chain.
 *
 * This is the single most important string in the product - it is what the client is
 * told they are using - so every branch is pinned here rather than being exercised
 * only by whatever rows happen to exist in a database.
 */
describe("resolveBrandName", () => {
  test("sub-account brand wins over everything", () => {
    const r = resolveBrandName({
      locationBrandName: "Client Portal",
      agencyDefaultBrandName: "Agency Brand",
      companyName: "The Agency LLC",
    });
    assert.deepEqual(r, { brandName: "Client Portal", source: "location" });
  });

  test("falls back to the agency default", () => {
    const r = resolveBrandName({ agencyDefaultBrandName: "Agency Brand", companyName: "The Agency LLC" });
    assert.deepEqual(r, { brandName: "Agency Brand", source: "agency-default" });
  });

  test("falls back to the agency's company name", () => {
    // Last of the real values on purpose: this is the AGENCY's own name, a reasonable
    // guess but not the white-label name the client is meant to see.
    const r = resolveBrandName({ companyName: "The Agency LLC" });
    assert.deepEqual(r, { brandName: "The Agency LLC", source: "company-name" });
  });

  test("falls back to a generic name when nothing is configured", () => {
    assert.deepEqual(resolveBrandName({}), { brandName: GENERIC_PLATFORM_NAME, source: "generic" });
  });

  test("treats blank and whitespace-only values as unset", () => {
    // An empty string in the database must not become the client's brand name - the
    // bot would address them as "" and the sentence would read as broken.
    const r = resolveBrandName({
      locationBrandName: "   ",
      agencyDefaultBrandName: "",
      companyName: "\t\n",
    });
    assert.equal(r.brandName, GENERIC_PLATFORM_NAME);
    assert.equal(r.source, "generic");
  });

  test("trims surrounding whitespace off a real value", () => {
    assert.equal(resolveBrandName({ locationBrandName: "  Acme Portal  " }).brandName, "Acme Portal");
  });

  test("NO fallback can ever name a vendor", () => {
    // The property that actually matters: whatever this returns when nothing is
    // configured is going straight into a client-facing sentence.
    assert.deepEqual(findBrandLeaks(GENERIC_PLATFORM_NAME), []);
    assert.deepEqual(findBrandLeaks(resolveBrandName({}).brandName), []);
  });

  test("null and undefined are handled identically", () => {
    assert.deepEqual(
      resolveBrandName({ locationBrandName: null, agencyDefaultBrandName: undefined, companyName: null }),
      resolveBrandName({})
    );
  });
});
