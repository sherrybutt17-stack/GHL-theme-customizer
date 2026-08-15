import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, validateFetchUrl } from "./safeFetch";

/**
 * The loopback exemption is an escape hatch inside a security control, which is the
 * category of thing that ends up switched on in production. These tests are what stop
 * that being silent: it is loopback ONLY, and it refuses itself whenever
 * `APP_PUBLIC_URL` names a real https host.
 *
 * It exists because `verify-feeds` serves fixtures from an ephemeral 127.0.0.1 server so
 * it can exercise the genuine conditional-GET path rather than a stub — and the guard
 * rightly blocks that.
 */
const saved = {
  flag: process.env.SAFE_FETCH_ALLOW_LOOPBACK,
  url: process.env.APP_PUBLIC_URL,
};
afterEach(() => {
  process.env.SAFE_FETCH_ALLOW_LOOPBACK = saved.flag;
  process.env.APP_PUBLIC_URL = saved.url;
});

function env(flag: string | undefined, appUrl: string) {
  if (flag === undefined) delete process.env.SAFE_FETCH_ALLOW_LOOPBACK;
  else process.env.SAFE_FETCH_ALLOW_LOOPBACK = flag;
  process.env.APP_PUBLIC_URL = appUrl;
}

describe("the loopback exemption", () => {
  test("is off unless asked for", () => {
    env(undefined, "http://localhost:3210");
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("::1"), true);
  });

  test("opens loopback in dev when asked", () => {
    env("1", "http://localhost:3210");
    assert.equal(isPrivateIp("127.0.0.1"), false);
    assert.equal(isPrivateIp("::1"), false);
    // …and the port allowance moves with it, since a fixture server binds an ephemeral one.
    assert.doesNotThrow(() => validateFetchUrl("http://127.0.0.1:50961/feed.xml"));
  });

  test("REFUSES ITSELF in production, however it is set", () => {
    // The whole reason this is safe to have. A real https APP_PUBLIC_URL is production,
    // and there the variable does nothing at all.
    env("1", "https://mosaic-server.onrender.com");
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("::1"), true);
    assert.throws(() => validateFetchUrl("http://127.0.0.1:50961/feed.xml"), /bad port/);
  });

  test("never opens anything but loopback, even in dev", () => {
    env("1", "http://localhost:3210");
    // The address this entire guard exists for.
    assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("::ffff:a9fe:a9fe"), true, "hex-spelled metadata endpoint");
    assert.equal(isPrivateIp("10.0.0.5"), true);
    assert.equal(isPrivateIp("192.168.1.1"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    // Loopback written as v4-mapped hex IS still loopback, and is exempted consistently —
    // an exemption that depended on spelling would be the original bug in reverse.
    assert.equal(isPrivateIp("::ffff:7f00:1"), false);
  });

  test("a public address is never blocked by any of this", () => {
    for (const url of ["http://localhost:3210", "https://mosaic-server.onrender.com"]) {
      env("1", url);
      assert.equal(isPrivateIp("93.184.216.34"), false);
      assert.equal(isPrivateIp("2606:2800:220:1:248:1893:25c8:1946"), false);
    }
  });
});
