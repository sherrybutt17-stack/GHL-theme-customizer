import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp } from "./brandScan";

/**
 * "Brand from websites" fetches a URL the agency pastes, server-side. That is a textbook
 * SSRF vector, and the thing on the other side of it is the cloud metadata endpoint:
 * 169.254.169.254 hands out instance credentials to anything that asks.
 *
 * The guard was defeated by SPELLING. It recognised a v4-mapped IPv6 address only in its
 * dotted form, so the same 128 bits written in hex read as a public address — and every
 * network stack connects both to exactly the same place.
 */
describe("the SSRF address guard", () => {
  test("the cloud metadata endpoint, in every spelling", () => {
    // Each of these is 169.254.169.254. The last three were ALLOWED before this fix.
    for (const form of [
      "169.254.169.254",
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe",
      "0:0:0:0:0:ffff:a9fe:a9fe",
      "::a9fe:a9fe",
    ]) {
      assert.equal(isPrivateIp(form), true, `${form} reaches the metadata endpoint`);
    }
  });

  test("loopback and private ranges, dotted and hex", () => {
    for (const form of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "10.0.0.1",
      "::ffff:a00:1",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
    ]) {
      assert.equal(isPrivateIp(form), true, `${form} is reachable inside our own network`);
    }
  });

  test("IPv6 ranges that EMBED an attacker-chosen IPv4", () => {
    // Blocked wholesale rather than decoded: the embedded address is chosen by whoever
    // publishes the DNS record, so there is nothing to enumerate. No brand website
    // publishes an AAAA record in either range.
    assert.equal(isPrivateIp("2002:a9fe:a9fe::"), true, "6to4");
    assert.equal(isPrivateIp("64:ff9b::a9fe:a9fe"), true, "NAT64 well-known prefix");
  });

  test("link-local is fe80::/10, not just addresses beginning fe80", () => {
    assert.equal(isPrivateIp("fe80::1"), true);
    assert.equal(isPrivateIp("feaf::1"), true);
    assert.equal(isPrivateIp("febf::1"), true);
  });

  test("unique-local, multicast and the reserved v4 blocks", () => {
    assert.equal(isPrivateIp("fd00::1"), true);
    assert.equal(isPrivateIp("fc00::1"), true);
    assert.equal(isPrivateIp("ff02::1"), true);
    assert.equal(isPrivateIp("255.255.255.255"), true);
    assert.equal(isPrivateIp("240.0.0.1"), true);
    assert.equal(isPrivateIp("100.64.0.1"), true); // CGNAT
    assert.equal(isPrivateIp("198.18.0.1"), true); // benchmarking
  });

  test("anything unparseable is refused, not waved through", () => {
    // The old code returned `false` (= public) for a string it could not read.
    for (const junk of ["", "not-an-ip", "999.999.999.999", "127.0.0.1.evil.com", "::gg"]) {
      assert.equal(isPrivateIp(junk), true, `${junk} was treated as a public address`);
    }
  });

  test("real public addresses are still allowed", () => {
    // The guard is worthless if it blocks the feature. These must all pass.
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      assert.equal(isPrivateIp(ip), false, `${ip} is a legitimate public host`);
    }
  });
});
