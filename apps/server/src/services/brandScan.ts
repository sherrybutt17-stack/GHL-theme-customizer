/**
 * "Brand from website" — given a URL an agency pastes, fetch the page and pull out
 * its brand signals: a <meta name="theme-color"> hex and the best brand image
 * (og:image / apple-touch-icon / favicon). The image is returned as a data: URL so
 * the DASHBOARD can run the existing client-side palette extractor on it (same code
 * path as logo upload) without any cross-origin canvas tainting.
 *
 * SECURITY: this fetches an arbitrary user-supplied URL server-side, which is a classic
 * SSRF vector. The guard is all four of scheme/port validation, address blocklisting,
 * manual per-hop redirect re-validation and size/time caps — and it now lives in
 * `safeFetch.ts` rather than here.
 *
 * That move IS the lesson. The guard was written in this file, was thorough, was tested
 * against every bypass form, and was documented at length — and the next feature that
 * needed to fetch a user-supplied URL (feed polling) got none of it, because a defence
 * that exists in one file is a defence the next feature does not get. Anything that
 * fetches a URL somebody else chose goes through `safeFetch`.
 */
import { safeFetch, isPrivateIp } from "./safeFetch";

// Re-exported so the unit tests documenting every bypass form keep their import here,
// beside the feature whose exploit produced them.
export { isPrivateIp };

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 3_000_000;

export interface BrandScanResult {
  sourceUrl: string;
  siteName?: string;
  /** A #hex color from <meta name="theme-color">, if present and valid. */
  themeColor?: string;
  /** Best brand image as a data: URL, for client-side palette extraction. */
  imageDataUrl?: string;
}

/** brandScan wants a hard failure on any non-2xx; the shared fetch reports the status. */
async function get(rawUrl: string, maxBytes: number, accept: string) {
  const r = await safeFetch(rawUrl, {
    maxBytes,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: "MosaicBrandScan/1.0",
    accept,
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`fetch failed ${r.status}`);
  return r;
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
  const page = await get(rawUrl, MAX_HTML_BYTES, "text/html,application/xhtml+xml,*/*");

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
      const img = await get(cand, MAX_IMAGE_BYTES, "image/*");
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
