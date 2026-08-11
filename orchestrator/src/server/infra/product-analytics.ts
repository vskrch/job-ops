import { logger } from "./logger";
import { sanitizeUnknown } from "./sanitize";

const UMAMI_EVENT_ENDPOINT = "https://umami.dakheera47.com/api/send";
const UMAMI_WEBSITE_ID = "0dc42ed1-87c3-4ac0-9409-5a9b9588fe66";
const ANALYTICS_TIMEOUT_MS = 5_000;
const UMAMI_USER_AGENT = "job-ops-server-analytics/1.0";
const DISALLOWED_KEY_PARTS = [
  "query",
  "url",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "code",
] as const;

type Primitive = string | number | boolean | null;
type AnalyticsPayload = Record<string, Primitive>;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !isHttpUrl(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

function sanitizeAnalyticsPayload(
  data: Record<string, unknown> | undefined,
): AnalyticsPayload | undefined {
  if (!data) return undefined;

  const sanitized: AnalyticsPayload = {};
  for (const [key, value] of Object.entries(data)) {
    const loweredKey = key.toLowerCase();
    if (DISALLOWED_KEY_PARTS.some((part) => loweredKey.includes(part))) {
      continue;
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function resolveBaseUrl(requestOrigin?: string | null): string {
  return (
    normalizeBaseUrl(process.env.JOBOPS_PUBLIC_BASE_URL) ??
    normalizeBaseUrl(requestOrigin) ??
    "http://localhost"
  );
}

function buildPagePayload(args: {
  requestOrigin?: string | null;
  urlPath?: string;
}): { hostname: string; url: string } {
  const baseUrl = resolveBaseUrl(args.requestOrigin);
  const resolvedUrl = new URL(args.urlPath ?? "/", baseUrl);
  return {
    hostname: resolvedUrl.hostname,
    url: `${resolvedUrl.pathname}${resolvedUrl.search}`,
  };
}

export async function trackServerProductEvent(
  _event: string,
  _data?: Record<string, unknown>,
  _options?: {
    requestOrigin?: string | null;
    urlPath?: string;
  },
): Promise<void> {
  // Server analytics tracking disabled
}
