/**
 * A per-key circuit breaker.
 *
 * Exists because `/theme-css` is fetched by `@import` from GHL's Custom CSS field and is
 * therefore RENDER-BLOCKING: during a database outage, paying the connect timeout on
 * every request would stall every page load of the agency's whole GHL UI. Once a build
 * fails we stop dialling the database for a cooldown and answer from the last-known-good
 * cache instead.
 *
 * KEYED, not global. The original was a module-level `let dbDownUntil = 0`, which meant
 * ANY failure - including one agency's malformed theme data throwing inside the CSS
 * builder - stopped every other agency's stylesheet from being rebuilt. One tenant's bug
 * degraded all of them.
 *
 * Extracted from the route so the behaviour that matters (isolation between keys, the
 * recovery probe) can be tested without standing up a server and killing a database.
 */
export class CircuitBreaker {
  private readonly openUntil = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number,
    /** Bound on distinct keys, so an unbounded id space can't grow this forever. */
    private readonly maxEntries = 500,
    /** Injectable clock — tests must not depend on real elapsed time. */
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Is this key currently short-circuited?
   *
   * Reading also EXPIRES an elapsed entry, so the first request after the cooldown is
   * let through as a recovery probe. That is what makes the theme come back on its own
   * within one cooldown of the database returning, with no restart and no manual reset.
   */
  isOpen(key: string): boolean {
    const until = this.openUntil.get(key);
    if (until === undefined) return false;
    if (this.now() >= until) {
      this.openUntil.delete(key);
      return false;
    }
    return true;
  }

  /** Record a failure for this key and stop dialling for the cooldown. */
  open(key: string): void {
    // Clearing wholesale rather than evicting one entry: at the cap something is wrong
    // (an id-space flood), and the safe response is to stop short-circuiting anyone
    // rather than to keep an arbitrary subset of keys degraded.
    if (this.openUntil.size >= this.maxEntries && !this.openUntil.has(key)) this.openUntil.clear();
    this.openUntil.set(key, this.now() + this.cooldownMs);
  }

  /** Record a success. Only this key closes — others may still be failing for their own reasons. */
  close(key: string): void {
    this.openUntil.delete(key);
  }

  /** Open keys, for diagnostics. */
  get size(): number {
    return this.openUntil.size;
  }
}
