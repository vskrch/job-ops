/**
 * Stateless signed-cookie session management (no external dependencies).
 *
 * The session token is `userId.expiresAt.signature` where the signature is
 * an HMAC-SHA256 over `userId.expiresAt` using a server secret. This is the
 * same stateless pattern Flask/JWT use: no session store, no DB writes per
 * request. Tampering with the userId or expiry invalidates the signature.
 *
 * Cookie flags enforce browser security:
 *   - HttpOnly  — not readable by JS (XSS token theft)
 *   - SameSite=Lax — blocks CSRF on state-changing requests
 *   - Secure     — sent only over HTTPS in production
 *   - Path=/     — available to the whole app
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@infra/logger";

const COOKIE_NAME = "jobops.session";
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const TTL_MS = TTL_SECONDS * 1000;
const DEV_FALLBACK_SECRET = "jobops-dev-session-secret-change-in-production";

let devFallbackWarned = false;

function sessionSecret(): string {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return explicit;

  const basicAuthPass = process.env.BASIC_AUTH_PASSWORD?.trim();
  if (basicAuthPass) return basicAuthPass;

  if (!devFallbackWarned) {
    devFallbackWarned = true;
    logger.warn(
      "SESSION_SECRET is not set — using a publicly known dev fallback. Do NOT deploy without setting SESSION_SECRET.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

function sign(userId: string, expiresAt: number): string {
  const payload = `${userId}.${expiresAt}`;
  const sig = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export interface VerifiedSession {
  userId: string;
  expiresAt: number;
}

export function createSessionToken(userId: string): string {
  return sign(userId, Date.now() + TTL_MS);
}

/** Verify a session token. Returns null on tampering, expiry, or bad shape. */
export function verifySessionToken(token: string): VerifiedSession | null {
  const parts = token.split(".");
  // userId may contain dots? No — userId is a UUID. Format: userId.expires.sig
  if (parts.length !== 3) return null;
  const [userId, expiresRaw, sig] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (!userId) return null;

  const expected = createHmac("sha256", sessionSecret())
    .update(`${userId}.${expiresRaw}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Constant-time comparison to prevent timing attacks.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { userId, expiresAt };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionSetCookieHeader(token: string): string {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${TTL_SECONDS}`,
  ];
  if (isProduction()) flags.push("Secure");
  return flags.join("; ");
}

export function sessionClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/** Extract a verified session from a Cookie header. */
export function readSessionFromCookieHeader(
  cookieHeader: string | undefined,
): VerifiedSession | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (name === COOKIE_NAME) {
      return verifySessionToken(value);
    }
  }
  return null;
}
