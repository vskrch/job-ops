/**
 * Security response headers (no helmet dependency).
 *
 * Sets defensive headers on every API response:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (clickjacking)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Strict-Transport-Security: max-age=31536000 (HSTS, production-only)
 *   - X-DNS-Prefetch-Control: off
 *
 * CSP is intentionally not applied here: the client is a Vite SPA bundle
 * served as static files with inline styles/scripts from third-party UI libs;
 * a strict CSP would need a per-build nonce pipeline. That's a separate
 * hardening step.
 */
import type { RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  const isProduction = process.env.NODE_ENV === "production";
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if (isProduction) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  };
}
