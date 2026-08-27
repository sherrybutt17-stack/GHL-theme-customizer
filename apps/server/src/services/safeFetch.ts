/**
 * The one way this server is allowed to fetch a URL somebody else supplied.
 *
 * This guard was written for `brandScan.ts` ("Brand from websites") after a real bypass,
 * and it was thorough. What it was not was SHARED — so when feeds arrived, the agency
 * gained a second box to paste a URL into ("Your content" → Add feed) and `feedPoll.ts`
 * fetched it with a bare `fetch(url, { redirect: "follow" })`: no address check, no port
 * check, no per-hop revalidation, no size cap. The route in front of it validated the
 * SCHEME and nothing else.
 *
 * That second path was the worse of the two. brandScan turns a response into a colour and
 * an image; a feed response is parsed and **ingested as knowledge-base articles**, which
 * retrieval can then surface into a client's chat. `http://169.254.169.254/latest/
 * meta-data/iam/security-credentials/` pasted into Add feed was the whole exploit.
 *
 * So the guard lives here now and both callers use it. A defence that exists in one file
 * is a defence the next feature does not get.
 *
 * The four properties, none of which is optional:
 *   1. http/https only, on ports 80/443, with no embedded credentials.
 *   2. Every resolved address checked against the blocklist below.
 *   3. Redirects followed MANUALLY so every hop is re-validated — `redirect: "follow"`
 *      hands the whole chain to undici, so one public host can bounce you to metadata.
 *   4. Size and time caps, so a response cannot be used to exhaust the process.
 */
import dns from "node:dns/promises";
import { lookup as dnsLookupCb } from "node:dns";
import net from "node:net";
import { Agent } from "undici";
import { isProductionUrl } from "./env";

export const MAX_REDIRECTS = 3;

/**
 * Every range this server must never be talked into connecting to, checked through
 * Node's own `net.BlockList` rather than by matching the address as a STRING.
 *
 * String matching is what broke it. The old IPv6 check recognised a v4-mapped address
 * only in its dotted form (`::ffff:169.254.169.254`) — so the identical address written
 * in hex, which is the same 128 bits and which every network stack connects to exactly
 * the same place, sailed through as public:
 *
 *     ::ffff:a9fe:a9fe            -> 169.254.169.254, the cloud metadata endpoint
 *     ::ffff:7f00:1               -> 127.0.0.1
 *     0:0:0:0:0:ffff:a9fe:a9fe    -> the same, fully expanded
 *
 * `http://[::ffff:a9fe:a9fe]/` pasted into "Brand from websites" was enough. Measured
 * against the old predicate: SEVEN forms allowed, including all three above.
 *
 * `BlockList.check(addr, "ipv6")` resolves a v4-mapped address against the IPv4 rules
 * itself, in every spelling, because Node parses the address to bytes instead of reading
 * it. The lesson generalises past this file: an IP is a number, and any check that treats
 * it as text is one alternative encoding away from being wrong.
 *
 * The v4-EMBEDDING prefixes below are blocked wholesale rather than decoded, since the
 * embedded address is attacker-chosen and cannot be enumerated. Losing 6to4 and NAT64
 * costs nothing here: no brand website or publisher feed lives behind either.
 */
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — AWS/GCP/Azure metadata lives at 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
] as const) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 96], // unspecified, ::1 loopback, and the deprecated v4-COMPATIBLE range
  ["64:ff9b::", 96], // NAT64 well-known prefix — embeds an arbitrary IPv4
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an arbitrary IPv4
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local (fe80–febf, not just the fe80 prefix the old check read)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

/**
 * The ONE exemption, and it is refused in production.
 *
 * `verify-feeds` serves its fixtures from an ephemeral `127.0.0.1` server so it can
 * exercise the real conditional-GET / 304 / redirect path rather than a stub, and this
 * guard correctly blocks it. An escape hatch inside a security control is exactly the
 * setting that ends up on in production, so it is gated on `isProductionUrl()` the same
 * way the dev cookie's `Secure` flag is: with `APP_PUBLIC_URL` set to a real https host
 * the variable does nothing at all, however it is set.
 *
 * Loopback ONLY. It does not open link-local, so the cloud metadata endpoint — the thing
 * this whole guard exists for — stays blocked even in dev.
 */
function loopbackAllowed(): boolean {
  return process.env.SAFE_FETCH_ALLOW_LOOPBACK === "1" && !isProductionUrl();
}

const loopback = new net.BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

export function isPrivateIp(ip: string): boolean {
  // An address we cannot even classify is not one to connect to.
  if (net.isIPv4(ip)) {
    if (loopbackAllowed() && loopback.check(ip, "ipv4")) return false;
    return blocked.check(ip, "ipv4");
  }
  if (net.isIPv6(ip)) {
    if (loopbackAllowed() && loopback.check(ip, "ipv6")) return false;
    return blocked.check(ip, "ipv6");
  }
  return true;
}

/** Reject hostnames that resolve to any non-public address (SSRF guard). */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("blocked host");
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length) throw new Error("unresolvable host");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("blocked host");
  }
}

export function validateFetchUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
  if (u.username || u.password) throw new Error("credentials not allowed");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  // The port allowance moves WITH the loopback exemption rather than being a second
  // switch: a fixture server binds an ephemeral port, so allowing the host without the
  // port exempts nothing, and two independent switches is one more thing to leave on.
  if (port !== 80 && port !== 443 && !loopbackAllowed()) throw new Error("bad port");
  return u;
}

/** Read a response body up to `maxBytes`, aborting if it runs over. */
export async function readCapped(resp: Response, maxBytes: number): Promise<Buffer> {
  const cl = Number(resp.headers.get("content-length"));
  if (Number.isFinite(cl) && cl > maxBytes) throw new Error("too large");
  const reader = resp.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

/**
 * A DNS lookup that rejects any hostname resolving to a non-public IP. Used as the
 * undici connect-time lookup so the IP we validate is the exact one connected to
 * (closes DNS-rebinding: no separate earlier resolution to race).
 */
function guardedLookup(hostname: string, options: any, callback: any) {
  dnsLookupCb(hostname, { all: true, verbatim: true }, (err, addresses: any) => {
    if (err) return callback(err, undefined, undefined);
    const addrs = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return callback(new Error("blocked host (private IP)"), undefined, undefined);
    }
    if (options && options.all) callback(null, addrs, undefined);
    else callback(null, addrs[0].address, addrs[0].family);
  });
}
const ssrfAgent = new Agent({ connect: { lookup: guardedLookup } });

export interface SafeFetchResult {
  /** The FINAL url after redirects — every hop of which was re-validated. */
  url: URL;
  status: number;
  headers: Headers;
  contentType: string;
  /** Empty for any status without a body (304, HEAD-like responses). */
  buf: Buffer;
}

/**
 * Fetch with SSRF re-validation on every redirect hop plus size and time caps.
 *
 * Non-2xx is RETURNED, not thrown: a conditional GET's 304 is a success for the caller
 * that sent `if-none-match`, and deciding that here would force every caller to catch an
 * error to read a normal answer.
 */
export async function safeFetch(
  rawUrl: string,
  opts: {
    maxBytes: number;
    timeoutMs: number;
    headers?: Record<string, string>;
    userAgent: string;
    accept: string;
  }
): Promise<SafeFetchResult> {
  let url = validateFetchUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: "GET",
        // MANUAL, so hop N+1 goes back through validateFetchUrl + assertPublicHost above.
        redirect: "manual",
        signal: ac.signal,
        headers: { "user-agent": opts.userAgent, accept: opts.accept, ...(opts.headers ?? {}) },
        // Connect-time IP guard (closes DNS rebinding). `dispatcher` is a valid undici
        // fetch option not yet in the DOM lib types, hence the cast.
        dispatcher: ssrfAgent,
      } as any);
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      url = validateFetchUrl(new URL(resp.headers.get("location") as string, url).toString());
      continue;
    }
    const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
    // 304 and other bodiless answers: nothing to read, and asking would hang.
    const buf = resp.status === 204 || resp.status === 304 ? Buffer.alloc(0) : await readCapped(resp, opts.maxBytes);
    return { url, status: resp.status, headers: resp.headers, contentType, buf };
  }
  throw new Error("too many redirects");
}
