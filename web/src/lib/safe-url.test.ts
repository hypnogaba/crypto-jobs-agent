import { describe, expect, it } from "vitest";
import { safeJobUrl } from "./safe-url";

describe("safeJobUrl", () => {
  it("пускає звичайну https-адресу роботодавця", () => {
    expect(safeJobUrl("https://jobs.lever.co/acme/1?ref=x")).toBe("https://jobs.lever.co/acme/1?ref=x");
  });
  it.each([
    ["http://jobs.lever.co/acme/1", "http"],
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html,hi", "data:"],
    ["https://nextrole.info@evil.com/x", "userinfo"],
    ["https://localhost/x", "localhost"],
    ["https://10.0.0.1/x", "ip"],
    ["https://[::1]/x", "ipv6"],
    ["https://intranet/x", "без домену"],
    ["не адреса", "сміття"],
    ["", "порожньо"],
  ])("відкидає %s (%s)", (raw) => {
    expect(safeJobUrl(raw)).toBeNull();
  });
});
