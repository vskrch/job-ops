/**
 * Security response headers (no helmet dependency).
 *
 * Sets defensive headers on every API response:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (clickjacking)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Strict-Transport-Security: max-age=31536000 (HSTS, production-only)
 *   - X-DNS-Prefetch-Control: off
 *   - Content-Security-Policy: script-src 'self' (blocks inline scripts)
 *
 * The client is a Vite SPA with inline styles from third-party UI libs,
 * so style-src allows 'unsafe-inline'. script-src is locked to 'self'
 * to block stored XSS from crawled job descriptions.
 */
import type { RequestHandler } from "express";

const CSP_HEADER =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' https:; " +
  "connect-src 'self'; " +
  "frame-ancestors 'none'";

export function securityHeaders(): RequestHandler {
  const isProduction = process.env.NODE_ENV === "production";
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Content-Security-Policy", CSP_HEADER);
    if (isProduction) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  };
}
