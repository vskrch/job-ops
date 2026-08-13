import { describe, expect, it } from "vitest";
import {
  type CaptchaType,
  captchaTokenField,
  detectCaptcha,
} from "./captcha-solver";

describe("detectCaptcha", () => {
  it("detects Cloudflare Turnstile", () => {
    const html = '<div class="cf-turnstile" data-sitekey="0x4AAA"></div>';
    const result = detectCaptcha(html);
    expect(result).toEqual({ type: "turnstile", sitekey: "0x4AAA" });
  });

  it("detects reCAPTCHA v2", () => {
    const html = '<div class="g-recaptcha" data-sitekey="6Lc_abc"></div>';
    const result = detectCaptcha(html);
    expect(result?.type).toBe("recaptcha_v2");
    expect(result?.sitekey).toBe("6Lc_abc");
  });

  it("detects reCAPTCHA v3 with action", () => {
    const html =
      '<div class="g-recaptcha" data-sitekey="6Lc_abc"></div>' +
      "<script>grecaptcha.execute('6Lc_abc', {action: 'submit'})</script>";
    const result = detectCaptcha(html);
    expect(result?.type).toBe("recaptcha_v3");
    expect(result?.action).toBe("submit");
  });

  it("detects hCaptcha", () => {
    const html = '<div class="h-captcha" data-sitekey="10000000-ffff"></div>';
    const result = detectCaptcha(html);
    expect(result?.type).toBe("hcaptcha");
    expect(result?.sitekey).toBe("10000000-ffff");
  });

  it("detects FunCaptcha", () => {
    const html = '<div class="funcaptcha" data-public-key="abc123"></div>';
    const result = detectCaptcha(html);
    expect(result?.type).toBe("funcaptcha");
    expect(result?.sitekey).toBe("abc123");
  });

  it("returns null when no captcha is present", () => {
    const html =
      "<html><body><h1>Jobs</h1><p>No captcha here</p></body></html>";
    expect(detectCaptcha(html)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectCaptcha("")).toBeNull();
  });
});

describe("captchaTokenField", () => {
  it("returns g-recaptcha-response for reCAPTCHA v2", () => {
    expect(captchaTokenField("recaptcha_v2" as CaptchaType)).toBe(
      "g-recaptcha-response",
    );
  });

  it("returns h-captcha-response for hCaptcha", () => {
    expect(captchaTokenField("hcaptcha" as CaptchaType)).toBe(
      "h-captcha-response",
    );
  });

  it("returns cf-turnstile-response for Turnstile", () => {
    expect(captchaTokenField("turnstile" as CaptchaType)).toBe(
      "cf-turnstile-response",
    );
  });
});
