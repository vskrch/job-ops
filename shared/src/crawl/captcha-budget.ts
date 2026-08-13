/**
 * Budget tracker for captcha solving.
 *
 * Both per-domain and global solve counts are tracked to prevent unbounded
 * spending on adversarial sites that serve a captcha on every page load.
 *
 * Defaults:
 *   - 3 solves per source domain (the circuit breaker also trips at 5)
 *   - 20 solves total per CrawlEngine instance (a single crawl pass)
 *
 * When `allow()` returns false, callers must skip solving and escalate.
 */

export interface CaptchaBudgetConfig {
  /** Max solves per source key. Default 3. */
  perSource?: number;
  /** Max solves per CrawlEngine instance. Default 20. */
  global?: number;
}

export class CaptchaBudget {
  private readonly perSource: number;
  private readonly global: number;
  private readonly perSourceCount = new Map<string, number>();
  private totalCount = 0;

  constructor(config: CaptchaBudgetConfig = {}) {
    this.perSource = config.perSource ?? 3;
    this.global = config.global ?? 20;
  }

  /** True when the next solve is within budget for this source. */
  allow(sourceKey: string): boolean {
    if (this.totalCount >= this.global) return false;
    const used = this.perSourceCount.get(sourceKey) ?? 0;
    return used < this.perSource;
  }

  /** Record a successful solve submission (not necessarily a solved result). */
  recordSolve(sourceKey: string): void {
    this.totalCount += 1;
    this.perSourceCount.set(
      sourceKey,
      (this.perSourceCount.get(sourceKey) ?? 0) + 1,
    );
  }

  /** Read-only snapshot for tests / logging. */
  snapshot(): { total: number; perSource: Record<string, number> } {
    return {
      total: this.totalCount,
      perSource: Object.fromEntries(this.perSourceCount),
    };
  }
}
