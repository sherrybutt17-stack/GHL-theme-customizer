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
