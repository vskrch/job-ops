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

  it("isBlockSignal is true only for blocked/captcha", () => {
    expect(isBlockSignal("blocked")).toBe(true);
    expect(isBlockSignal("captcha")).toBe(true);
    expect(isBlockSignal("ok")).toBe(false);
    expect(isBlockSignal("uncertain")).toBe(false);
  });
});
