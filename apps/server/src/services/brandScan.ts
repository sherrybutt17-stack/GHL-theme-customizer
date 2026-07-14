/**
 * "Brand from website" — given a URL an agency pastes, fetch the page and pull out
 * its brand signals: a <meta name="theme-color"> hex and the best brand image
 * (og:image / apple-touch-icon / favicon). The image is returned as a data: URL so
 * the DASHBOARD can run the existing client-side palette extractor on it (same code
 * path as logo upload) without any cross-origin canvas tainting.
 *
 * SECURITY: this fetches an arbitrary user-supplied URL server-side, which is a
 * classic SSRF vector. We defend by (1) allowing only http/https on ports 80/443,
 * (2) resolving the hostname and rejecting any private / loopback / link-local /
 * reserved IP, (3) handling redirects manually and re-validating every hop, and
 * (4) capping response size + total time. Never relax these without care.
 */
import dns from "node:dns/promises";
import net from "node:net";

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

export interface BrandScanResult {
  sourceUrl: string;
  siteName?: string;
  /** A #hex color from <meta name="theme-color">, if present and valid. */
  themeColor?: string;
  /** Best brand image as a data: URL, for client-side palette extraction. */
  imageDataUrl?: string;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique-local fc00::/7
  const mapped = s.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}

/** Reject hostnames that resolve to any non-public address (SSRF guard). */
async function assertPublicHost(hostname: string): Promise<void> {
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

function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
  if (u.username || u.password) throw new Error("credentials not allowed");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) throw new Error("bad port");
  return u;
}

/** Read a response body up to `maxBytes`, aborting if it runs over. */
async function readCapped(resp: Response, maxBytes: number): Promise<Buffer> {
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

/** Fetch with SSRF re-validation on every redirect hop + size/time caps. */
async function safeFetch(
  rawUrl: string,
  maxBytes: number,
  accept: string
): Promise<{ url: URL; contentType: string; buf: Buffer }> {
  let url = validateUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: { "user-agent": "MosaicBrandScan/1.0", accept },
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      url = validateUrl(new URL(resp.headers.get("location") as string, url).toString());
      continue;
    }
    if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
    const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
    const buf = await readCapped(resp, maxBytes);
    return { url, contentType, buf };
  }
  throw new Error("too many redirects");
}

function firstMatch(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? m[1] : undefined;
}

function extractFromHtml(
  html: string,
  baseUrl: URL
): { themeColor?: string; siteName?: string; imageCandidates: string[] } {
  let themeColor =
    firstMatch(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  if (themeColor && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(themeColor.trim())) themeColor = undefined;

  const siteName =
    firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i);

  const candidates: string[] = [];
  const push = (v?: string) => {
    if (!v) return;
    try {
      candidates.push(new URL(v, baseUrl).toString());
    } catch {
      /* ignore unparseable */
    }
  };
  push(
    firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  );
  push(firstMatch(html, /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i));
  const iconRe = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = iconRe.exec(html))) push(m[1]);
  push(new URL("/favicon.ico", baseUrl).toString());

  return { themeColor: themeColor?.trim(), siteName: siteName?.trim(), imageCandidates: [...new Set(candidates)] };
}

function toDataUrl(contentType: string, buf: Buffer): string {
  const ct = contentType.split(";")[0].trim() || "image/png";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

/**
 * Scan a website for brand signals. Throws on invalid / blocked / unreachable URLs;
 * returns whatever signals it can find (may have only themeColor, only an image, or
 * both). The caller decides what to do when neither is present.
 */
export async function scanBrand(rawUrl: string): Promise<BrandScanResult> {
  const page = await safeFetch(rawUrl, MAX_HTML_BYTES, "text/html,application/xhtml+xml,*/*");

  // If they pasted an image URL directly, use it as the brand image.
  if (/^image\//.test(page.contentType)) {
    return { sourceUrl: page.url.toString(), imageDataUrl: toDataUrl(page.contentType, page.buf) };
  }
  if (!/html/.test(page.contentType)) throw new Error("not an HTML page");

  const html = page.buf.toString("utf8");
  const { themeColor, siteName, imageCandidates } = extractFromHtml(html, page.url);

  let imageDataUrl: string | undefined;
  for (const cand of imageCandidates) {
    try {
      const img = await safeFetch(cand, MAX_IMAGE_BYTES, "image/*");
      if (/^image\//.test(img.contentType) && img.buf.length > 0) {
        imageDataUrl = toDataUrl(img.contentType, img.buf);
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }

  return { sourceUrl: page.url.toString(), siteName, themeColor, imageDataUrl };
}
