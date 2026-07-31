/**
 * Recolor an arbitrary icon to a target color using a CSS `filter` chain.
 *
 * WHY THIS EXISTS (confirmed against live GHL DOM, after four failed attempts):
 * the GHL sidebar draws its icons at least two different ways -
 *   - inline <svg> whose shapes carry hardcoded colors from GHL's own stylesheet
 *     (NOT `currentColor`, and NOT `fill=`/`stroke=` attributes), and
 *   - <span class="…-icon"> painted with a CSS background-image (e.g. the Ask AI
 *     sparkle: `span.ask-ai-sparkle-icon`, role=image).
 * So `color` can't reach them, `fill`/`stroke` can't reach the background-image
 * ones, and `mask` would need each icon's source URL. `filter` is the only lever
 * that works on all of them, because it operates on rendered pixels and doesn't
 * care how the icon was drawn - which also means it survives GHL reshuffling its
 * markup, the failure mode that broke every selector-based attempt.
 *
 * HOW: `brightness(0) saturate(100%)` flattens any icon to pure black, then a
 * chain of invert/sepia/saturate/hue-rotate/brightness/contrast tints that black
 * to the target. There's no closed-form inverse for that chain, so we solve it
 * numerically (SPSA - the standard approach for this problem).
 *
 * Two consequences worth knowing:
 *   - The result is APPROXIMATE. `loss` is reported by solveFilter(); black and
 *     white are special-cased to exact chains, and those cover most white-label use.
 *   - Multi-color icons FLATTEN to a single color. That's inherent to a one-color
 *     control, not a bug.
 */

/** Clamp to a valid 0-255 channel. */
function clamp255(value: number): number {
  return value > 255 ? 255 : value < 0 ? 0 : value;
}

/**
 * An RGB color that can have CSS filter primitives applied to it, mirroring the
 * filter effects spec so the solver can predict what the browser will render.
 */
class Color {
  constructor(public r: number, public g: number, public b: number) {}

  set(r: number, g: number, b: number) {
    this.r = clamp255(r);
    this.g = clamp255(g);
    this.b = clamp255(b);
  }

  /** Apply a 3x3 color matrix (row-major). */
  multiply(m: number[]) {
    const r = clamp255(this.r * m[0] + this.g * m[1] + this.b * m[2]);
    const g = clamp255(this.r * m[3] + this.g * m[4] + this.b * m[5]);
    const b = clamp255(this.r * m[6] + this.g * m[7] + this.b * m[8]);
    this.r = r;
    this.g = g;
    this.b = b;
  }

  hueRotate(angle = 0) {
    const a = (angle / 180) * Math.PI;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    this.multiply([
      0.213 + cos * 0.787 - sin * 0.213,
      0.715 - cos * 0.715 - sin * 0.715,
      0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143,
      0.715 + cos * 0.285 + sin * 0.14,
      0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787,
      0.715 - cos * 0.715 + sin * 0.715,
      0.072 + cos * 0.928 + sin * 0.072,
    ]);
  }

  sepia(value = 1) {
    const i = 1 - value;
    this.multiply([
      0.393 + 0.607 * i,
      0.769 - 0.769 * i,
      0.189 - 0.189 * i,
      0.349 - 0.349 * i,
      0.686 + 0.314 * i,
      0.168 - 0.168 * i,
      0.272 - 0.272 * i,
      0.534 - 0.534 * i,
      0.131 + 0.869 * i,
    ]);
  }

  saturate(value = 1) {
    this.multiply([
      0.213 + 0.787 * value,
      0.715 - 0.715 * value,
      0.072 - 0.072 * value,
      0.213 - 0.213 * value,
      0.715 + 0.285 * value,
      0.072 - 0.072 * value,
      0.213 - 0.213 * value,
      0.715 - 0.715 * value,
      0.072 + 0.928 * value,
    ]);
  }

  /** slope/intercept transform shared by brightness() and contrast(). */
  linear(slope = 1, intercept = 0) {
    this.r = clamp255(this.r * slope + intercept * 255);
    this.g = clamp255(this.g * slope + intercept * 255);
    this.b = clamp255(this.b * slope + intercept * 255);
  }

  brightness(value = 1) {
    this.linear(value);
  }

  contrast(value = 1) {
    this.linear(value, -(0.5 * value) + 0.5);
  }

  invert(value = 1) {
    this.r = clamp255((value + (this.r / 255) * (1 - 2 * value)) * 255);
    this.g = clamp255((value + (this.g / 255) * (1 - 2 * value)) * 255);
    this.b = clamp255((value + (this.b / 255) * (1 - 2 * value)) * 255);
  }

  hsl(): { h: number; s: number; l: number } {
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 100, s: s * 100, l: l * 100 };
  }
}

/**
 * Deterministic PRNG. SPSA needs randomness, but the CSS bundle is regenerated on
 * every request - a Math.random()-driven solver would emit a slightly different
 * filter chain each time, churning the stylesheet and defeating HTTP caching for
 * no visual gain. A fixed-seed LCG keeps the same color mapping to the same chain.
 */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SOLVER_ITERATION_MAX = 100;
const SOLVER_HUE_MAX = 7500;

/** Bound each filter parameter to its legal range; hue wraps instead of clamping. */
function fixValue(value: number, idx: number): number {
  let max = SOLVER_ITERATION_MAX;
  if (idx === 2) max = SOLVER_HUE_MAX;
  else if (idx === 4 || idx === 5) max = 200;

  if (idx === 3) {
    if (value > max) return value % max;
    if (value < 0) return max + (value % max);
    return value;
  }
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

class Solver {
  private targetHSL: { h: number; s: number; l: number };
  private scratch = new Color(0, 0, 0);
  private rand = makeRng(0x5eed);

  constructor(private target: Color) {
    this.targetHSL = target.hsl();
  }

  /** How far the filtered black is from the target, in combined RGB + HSL distance. */
  private loss(filters: number[]): number {
    const c = this.scratch;
    c.set(0, 0, 0);
    c.invert(filters[0] / 100);
    c.sepia(filters[1] / 100);
    c.saturate(filters[2] / 100);
    c.hueRotate(filters[3] * 3.6);
    c.brightness(filters[4] / 100);
    c.contrast(filters[5] / 100);

    const hsl = c.hsl();
    return (
      Math.abs(c.r - this.target.r) +
      Math.abs(c.g - this.target.g) +
      Math.abs(c.b - this.target.b) +
      Math.abs(hsl.h - this.targetHSL.h) +
      Math.abs(hsl.s - this.targetHSL.s) +
      Math.abs(hsl.l - this.targetHSL.l)
    );
  }

  /** Simultaneous Perturbation Stochastic Approximation. */
  private spsa(A: number, a: number[], c: number, values: number[], iters: number) {
    const alpha = 1;
    const gamma = 0.16666666666666666;

    let best: number[] | null = null;
    let bestLoss = Infinity;
    const deltas = new Array(6);
    const high = new Array(6);
    const low = new Array(6);

    for (let k = 0; k < iters; k++) {
      const ck = c / Math.pow(k + 1, gamma);
      for (let i = 0; i < 6; i++) {
        deltas[i] = this.rand() > 0.5 ? 1 : -1;
        high[i] = values[i] + ck * deltas[i];
        low[i] = values[i] - ck * deltas[i];
      }

      const lossDiff = this.loss(high) - this.loss(low);
      for (let i = 0; i < 6; i++) {
        const g = ((lossDiff / (2 * ck)) * deltas[i]) / 1;
        const ak = a[i] / Math.pow(A + k + 1, alpha);
        values[i] = fixValue(values[i] - ak * g, i);
      }

      const loss = this.loss(values);
      if (loss < bestLoss) {
        best = values.slice(0);
        bestLoss = loss;
      }
    }
    return { values: best ?? values.slice(0), loss: bestLoss };
  }

  solve(): { filter: string; loss: number } {
    // Coarse pass, restarted until the fit is good enough, then a fine pass around
    // the best result. The restart budget is deliberately generous: this runs once
    // per distinct colour, memoized, on the server - a few extra ms buys noticeably
    // tighter fits on saturated hues, which are the hardest for this chain.
    let wide = { values: [] as number[], loss: Infinity };
    for (let i = 0; wide.loss > 6 && i < 12; i++) {
      const result = this.spsa(5, [60, 180, 18000, 600, 1.2, 1.2], 15, [50, 20, 3750, 50, 100, 100], 1000);
      if (result.loss < wide.loss) wide = result;
    }

    const A = wide.loss + 1;
    const narrow = this.spsa(
      wide.loss,
      [0.25 * A, 0.25 * A, A, 0.25 * A, 0.2 * A, 0.2 * A],
      2,
      wide.values.slice(0),
      500
    );

    const v = narrow.values;
    const round = (n: number, mult = 1) => Math.round(n * mult);
    const filter =
      `invert(${round(v[0])}%) sepia(${round(v[1])}%) saturate(${round(v[2])}%) ` +
      `hue-rotate(${round(v[3], 3.6)}deg) brightness(${round(v[4])}%) contrast(${round(v[5])}%)`;
    return { filter, loss: narrow.loss };
  }
}

/** Parse #rgb / #rrggbb into a Color. Returns null for anything else. */
function parseHex(hex: string): Color | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return new Color(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}

/** Flattens any icon - svg, background-image, <img> - to a pure black silhouette. */
const TO_BLACK = "brightness(0) saturate(100%)";

const cache = new Map<string, string | null>();

/**
 * The full CSS `filter` value that recolors an icon to `hex`, or null if `hex`
 * isn't a color we can parse (caller should then emit no rule at all rather than
 * a broken one).
 *
 * Pure black and pure white are exact; everything else is solved and approximate.
 * Results are memoized - the same theme color is rendered on every bundle build.
 */
export function cssFilterForColor(hex: string): string | null {
  const key = hex.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const color = parseHex(key);
  let result: string | null;

  if (!color) {
    result = null;
  } else if (color.r === 0 && color.g === 0 && color.b === 0) {
    result = TO_BLACK;
  } else if (color.r === 255 && color.g === 255 && color.b === 255) {
    result = `${TO_BLACK} invert(100%)`;
  } else {
    result = `${TO_BLACK} ${new Solver(color).solve().filter}`;
  }

  cache.set(key, result);
  return result;
}
