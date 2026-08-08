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
 * ~20 hand-curated desktop fingerprints covering Chrome 124-126, Firefox
 * 125-127, Safari 17.4, and Edge 124-126 across Windows and macOS. Firefox
 * and Safari do not send sec-ch-ua hints, matching real behavior.
 */
export const BROWSER_FINGERPRINTS: readonly BrowserFingerprint[] = [
  // Chrome 126 - Windows
  {
    label: "Chrome 126 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Chrome 126 - macOS
  {
    label: "Chrome 126 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Chrome 125 - Windows
  {
    label: "Chrome 125 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="125", "Google Chrome";v="125"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Chrome 125 - macOS
  {
    label: "Chrome 125 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="125", "Google Chrome";v="125"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Chrome 124 - Windows
  {
    label: "Chrome 124 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Chrome 124 - macOS
  {
    label: "Chrome 124 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Edge 126 - Windows
  {
    label: "Edge 126 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    secChUa:
      '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Edge 125 - Windows
  {
    label: "Edge 125 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    secChUa:
      '"Not/A)Brand";v="8", "Chromium";v="125", "Microsoft Edge";v="125"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Edge 124 - macOS
  {
    label: "Edge 124 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    secChUa:
      '"Not/A)Brand";v="8", "Chromium";v="124", "Microsoft Edge";v="124"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Firefox 127 - Windows
  {
    label: "Firefox 127 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Firefox 127 - macOS
  {
    label: "Firefox 127 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Firefox 126 - Windows
  {
    label: "Firefox 126 / Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Firefox 126 - macOS
  {
    label: "Firefox 126 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Firefox 125 - Linux
  {
    label: "Firefox 125 / Linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Safari 17.4 - macOS
  {
    label: "Safari 17.4 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Safari 17.4 - macOS (alt locale)
  {
    label: "Safari 17.4 / macOS (alt)",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Chrome 126 - Linux
  {
    label: "Chrome 126 / Linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Linux"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Chrome 125 - Linux
  {
    label: "Chrome 125 / Linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="125", "Google Chrome";v="125"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Linux"',
    acceptLanguage: "en-US,en;q=0.9",
  },
  // Edge 126 - macOS
  {
    label: "Edge 126 / macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    secChUa:
      '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
    acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8",
  },
  // Chrome 124 - Linux
  {
    label: "Chrome 124 / Linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Linux"',
    acceptLanguage: "en-US,en;q=0.9",
  },
];

/** Default accept-language used when a fingerprint omits one. */
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
