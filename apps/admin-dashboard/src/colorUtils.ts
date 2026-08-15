// Small, dependency-free color helpers used to auto-suggest gradients and
// accent colors from a chosen primary color, using basic HSL color theory.

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function hexToHsl(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isValidHex(hex: string) {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
}

export function shift(hex: string, dHue = 0, dSat = 0, dLight = 0): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + dHue, s + dSat, l + dLight);
}

export interface GradientSuggestion {
  label: string;
  from: string;
  to: string;
  angle: number;
}

/** A few tasteful gradient pairings derived from the primary color. */
export function suggestGradients(primary: string): GradientSuggestion[] {
  if (!isValidHex(primary)) return [];
  return [
    { label: "Deep", from: primary, to: shift(primary, 0, 5, -32), angle: 160 },
    { label: "Night", from: shift(primary, 0, 0, -8), to: "#0f172a", angle: 180 },
    { label: "Complement", from: primary, to: shift(primary, 180, -5, -18), angle: 135 },
    { label: "Sunrise", from: primary, to: shift(primary, 35, 8, -6), angle: 135 },
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // lets us read pixels for CORS-enabled URLs
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/**
 * Extract a brand palette (primary + accent) from a logo image. Downscales to a
 * small canvas, drops transparent / near-white / near-black / grey pixels, buckets
 * the rest, and takes the most common saturated color as primary; accent is the next
 * bucket with a distinct hue (else a derived complement). Returns null if the image
 * can't be read (e.g. a cross-origin URL without CORS headers taints the canvas) -
 * uploaded logos are data: URLs and always work.
 */
export async function paletteFromImage(src: string): Promise<{ primary: string; accent: string } | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return null;
  }
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  try {
    return paletteFromPixels(ctx.getImageData(0, 0, size, size).data);
  } catch {
    return null; // tainted canvas (cross-origin without CORS)
  }
}

/**
 * The pure pixel-analysis half of paletteFromImage, split out so it can be tested
 * without a DOM. Takes RGBA pixel data; returns primary + accent, or null if no
 * usable (non-neutral, opaque) color is present.
 */
export function paletteFromPixels(
  data: Uint8ClampedArray | number[]
): { primary: string; accent: string } | null {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 244 && min > 244) continue; // near-white
    if (max < 22) continue; // near-black
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.12) continue; // grey / neutral
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`; // quantize to 16 levels/channel
    const e = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    e.count++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  if (buckets.size === 0) return null;

  const avg = (e: { count: number; r: number; g: number; b: number }) =>
    rgbToHex(e.r / e.count, e.g / e.count, e.b / e.count);
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const primary = avg(sorted[0]);
  const [ph] = hexToHsl(primary);
  let accent = "";
  for (let i = 1; i < sorted.length; i++) {
    const hx = avg(sorted[i]);
    const [hh] = hexToHsl(hx);
    const hueDist = Math.abs((((hh - ph) % 360) + 540) % 360 - 180); // 0..180
    if (hueDist > 40) { accent = hx; break; }
  }
  if (!accent) accent = suggestAccents(primary)[0] ?? shift(primary, 180, 5, 6);
  return { primary, accent };
}

/** Accent color candidates (complementary / triadic / tint) from the primary. */
export function suggestAccents(primary: string): string[] {
  if (!isValidHex(primary)) return [];
  return [
    shift(primary, 180, 5, 6), // complementary
    shift(primary, 150, 0, 4), // split-complementary
    shift(primary, 30, 10, 10), // analogous, brighter
    shift(primary, 0, 8, 22), // lighter tint of same hue
  ];
}

/**
 * Shrink and re-encode a data: URL, keeping whichever of WebP/PNG is smaller.
 *
 * This exists for the same reason the upload path downscales: a logo is base64-inlined
 * into the theme stylesheet, ONE PER SUB-ACCOUNT, and that stylesheet is render-blocking.
 * A scraped logo arrives at whatever size the client's website happened to serve — the
 * first one measured here was a 77KB PNG — so applying scans across 41 sub-accounts
 * unprocessed is megabytes of CSS in front of every page load.
 *
 * Two traps, both the same as in the upload encoder:
 *  - `toDataURL` with an unsupported type does NOT throw, it silently returns PNG, so
 *    check the mime of what came back rather than trusting the request; and
 *  - WebP is not always smaller (flat-colour marks often favour PNG), so encode both
 *    and compare — it costs microseconds and can never make a logo bigger.
 */
export async function downscaleDataUrl(
  src: string,
  maxDim = 512
): Promise<{ dataUrl: string; bytes: number; format: "webp" | "png" } | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return null;
  }
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let png: string;
  let webp: string;
  try {
    png = canvas.toDataURL("image/png");
    webp = canvas.toDataURL("image/webp", 0.85);
  } catch {
    return null; // tainted canvas
  }
  const webpSupported = webp.startsWith("data:image/webp");
  const chosen = webpSupported && webp.length < png.length ? webp : png;
  return {
    dataUrl: chosen,
    format: chosen === webp ? "webp" : "png",
    bytes: Math.round(((chosen.length - chosen.indexOf(",") - 1) * 3) / 4),
  };
}
