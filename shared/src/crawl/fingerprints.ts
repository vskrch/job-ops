/**
 * Realistic browser fingerprints for the crawl engine.
 *
 * Browsers differ in TLS cipher order, HTTP/2 settings, header ordering, and
 * minor UA quirks. Rotating the full fingerprint (UA + sec-ch-ua + platform +
 * accept-language) makes traffic look like real browser diversity instead of
 * a single machine rotating a single string.
 */

export interface BrowserFingerprint {
  /** A descriptive label for diagnostics. */
  label: string;
  userAgent: string;
  /** `Sec-CH-UA` client hint (Chrome/Edge families). */
  secChUa?: string;
  /** `Sec-CH-UA-Mobile` client hint. */
  secChUaMobile?: string;
  /** `Sec-CH-UA-Platform` client hint. */
  secChUaPlatform?: string;
  acceptLanguage: string;
}

/**
 * ~30 hand-curated fingerprints covering Chrome 140-142, Firefox 140-142,
 * Safari 18.x, and Edge 140-142 across Windows, macOS, Android, and iOS.
 * Firefox and Safari do not send sec-ch-ua hints, matching real behavior.
 */
export const BROWSER_FINGERPRINTS: readonly BrowserFingerprint[] = [
  {
    label: "Chrome 140 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Google Chrome";v="140"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Chrome 140 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Google Chrome";v="140"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Chrome 141 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Google Chrome";v="141"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 141 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Google Chrome";v="141"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 142 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="142", "Google Chrome";v="142"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-CA,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 142 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="142", "Google Chrome";v="142"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-CA,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Firefox 140 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Firefox 140 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:140.0) Gecko/20100101 Firefox/140.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Firefox 141 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
    acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8",
  },
  {
    label: "Firefox 141 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:141.0) Gecko/20100101 Firefox/141.0",
    acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8",
  },
  {
    label: "Firefox 142 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
    acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8",
  },
  {
    label: "Firefox 142 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:142.0) Gecko/20100101 Firefox/142.0",
    acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari 18.4 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari 18.5 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Edge 140 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Microsoft Edge";v="140"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Edge 140 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Microsoft Edge";v="140"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Edge 141 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Microsoft Edge";v="141"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-IN,en;q=0.9",
  },
  {
    label: "Edge 141 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Microsoft Edge";v="141"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-IN,en;q=0.9",
  },
  {
    label: "Edge 142 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="142", "Microsoft Edge";v="142"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Edge 142 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="142", "Microsoft Edge";v="142"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 140 / Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Google Chrome";v="140"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Chrome 141 / Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Google Chrome";v="141"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 142 / Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="142", "Google Chrome";v="142"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8",
  },
  {
    label: "Chrome 140 / Android (en-IN)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="140", "Google Chrome";v="140"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "en-IN,en;q=0.9",
  },
  {
    label: "Chrome 141 / Android (fr-FR)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    secChUa:
      '"Not)A;Brand";v="99", "Chromium";v="141", "Google Chrome";v="141"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
    acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari iOS 18.4",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    label: "Safari iOS 18.5",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari iPadOS 18.4",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    acceptLanguage: "en-CA,en;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari iPadOS 18.5",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8",
  },
  {
    label: "Safari iOS 18.4 (alt build)",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/21E148 Safari/604.1",
    acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8",
  },
];

/** Default accept-language used when a fingerprint omits one. */
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
