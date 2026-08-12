import { describe, expect, it } from "vitest";
import { detectBlock, isBlockSignal } from "./block-detector";

describe("detectBlock", () => {
  it("classifies a 403 as blocked", () => {
    expect(
      detectBlock({ status: 403, contentType: "text/html", text: "" }),
    ).toBe("blocked");
  });

  it("classifies a 429 as blocked", () => {
    expect(
      detectBlock({ status: 429, contentType: "text/html", text: "" }),
    ).toBe("blocked");
  });

  it("classifies a Cloudflare challenge 200 as blocked", () => {
    const text = "<html><title>Just a moment...</title>cf-challenge</html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("classifies a reCAPTCHA page as captcha", () => {
    const text = '<html><div class="g-recaptcha"></div></html>';
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "captcha",
    );
  });

  it("classifies an 'Access Denied' page as blocked", () => {
    const text =
      "<html><body>Access Denied. You have been blocked.</body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("classifies a normal HTML job page as ok", () => {
    const text =
      "<html><head><title>Senior Engineer Job</title></head><body><h1>Senior Engineer</h1><p>We are hiring.</p></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "ok",
    );
  });

  it("classifies a JSON response as ok", () => {
    expect(
      detectBlock({
        status: 200,
        contentType: "application/json",
        text: '{"jobs":[]}',
      }),
    ).toBe("ok");
  });

  it("classifies a tiny HTML body with no title as uncertain", () => {
    const text = "<div>short</div>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "uncertain",
    );
  });

  it("detects Akamai sensor cookie (_abck)", () => {
    const text = "<html><body><script src='/_abck'></script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Akamai bot metadata (bm_sz)", () => {
    const text = "<html><body><script>var bm_sz='x';</script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Imperva session (incap_ses)", () => {
    const text = "<html><body><script>incap_ses=1;</script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Imperva visitor ID (visid_incap)", () => {
    const text = "<html><body><script>visid_incap='x';</script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Imperva challenge (reese84)", () => {
    const text =
      "<html><body><script src='/reese84.js'></script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects AWS WAF (awswaf)", () => {
    const text = "<html><body><script src='/awswaf.js'></script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Kasada (kdjIO)", () => {
    const text = "<html><body><script>kdjIO='x';</script></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Cloudflare Turnstile (cf-turnstile)", () => {
    const text = '<html><body><div class="cf-turnstile"></div></body></html>';
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("detects Cloudflare Turnstile domain (challenges.cloudflare.com)", () => {
    const text =
      '<html><body><script src="https://challenges.cloudflare.com/turnstile.js"></script></body></html>';
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "blocked",
    );
  });

  it("does not block a page mentioning Cloudflare in a non-challenge context", () => {
    const text =
      "<html><head><title>Senior Software Engineer</title></head><body><h1>Senior Software Engineer</h1><p>We are hiring.</p><footer>Powered by Cloudflare</footer></body></html>";
    expect(detectBlock({ status: 200, contentType: "text/html", text })).toBe(
      "ok",
    );
  });

  it("isBlockSignal is true only for blocked/captcha", () => {
    expect(isBlockSignal("blocked")).toBe(true);
    expect(isBlockSignal("captcha")).toBe(true);
    expect(isBlockSignal("ok")).toBe(false);
    expect(isBlockSignal("uncertain")).toBe(false);
  });
});
