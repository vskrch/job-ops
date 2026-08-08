/**
 * In-memory sliding-window rate limiter (no external dependencies).
 *
 * Used to protect auth endpoints from brute-force credential stuffing. The
 * limiter is per-IP per-route and uses a fixed window with a counter. This is
 * intentionally simple and dependency-free: a single-process Node deployment
 * has one in-memory store; for multi-instance deployments a shared store
 * (Redis) would replace this.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  max: number;
  /** Window duration in ms. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** ponytail: in-memory; per-IP+route; evicted lazily on read. */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    const fresh: RateLimitEntry = { count: 1, resetAt: now + options.windowMs };
    buckets.set(key, fresh);
    return {
      allowed: true,
      remaining: options.max - 1,
      resetAt: fresh.resetAt,
    };
  }

  if (entry.count >= options.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: options.max - entry.count,
    resetAt: entry.resetAt,
  };
}

/** Apply rate-limit headers + reject when the limit is exceeded. */
export function rateLimitMiddleware(
  options: RateLimitOptions,
): import("express").RequestHandler {
  // Lazy eviction of expired buckets so the map doesn't grow unbounded.
  let lastSweep = Date.now();
  return (req, res, next) => {
    if (Date.now() - lastSweep > options.windowMs) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= Date.now()) buckets.delete(k);
      }
      lastSweep = Date.now();
    }
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const result = checkRateLimit(key, options);
    res.setHeader("x-ratelimit-limit", String(options.max));
    res.setHeader(
      "x-ratelimit-remaining",
      String(Math.max(0, result.remaining)),
    );
    res.setHeader(
      "x-ratelimit-reset",
      String(Math.ceil(result.resetAt / 1000)),
    );
    if (!result.allowed) {
      res.setHeader(
        "retry-after",
        String(Math.ceil((result.resetAt - Date.now()) / 1000)),
      );
      res.status(429).json({
        ok: false,
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please slow down and retry shortly.",
        },
        meta: { requestId: res.getHeader("x-request-id") ?? "unknown" },
      });
      return;
    }
    next();
  };
}

/** Test-only: reset all rate-limit state. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
