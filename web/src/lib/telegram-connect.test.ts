import { describe, it, expect } from "vitest";
import {
  generateConnectToken,
  buildTelegramDeepLink,
  parseStartCommand,
} from "./telegram-connect";

describe("generateConnectToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateConnectToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different token on each call", () => {
    expect(generateConnectToken()).not.toBe(generateConnectToken());
  });
});

describe("buildTelegramDeepLink", () => {
  it("builds a t.me start link with the token as the start param", () => {
    const link = buildTelegramDeepLink("my_jobs_bot", "abc123");
    expect(link).toBe("https://t.me/my_jobs_bot?start=abc123");
  });
});

describe("parseStartCommand", () => {
  it("extracts the token from a /start command", () => {
    expect(parseStartCommand("/start abc123")).toBe("abc123");
  });

  it("extracts the token when the bot username is included", () => {
    expect(parseStartCommand("/start@my_jobs_bot abc123")).toBe("abc123");
  });

  it("returns null for a bare /start with no token", () => {
    expect(parseStartCommand("/start")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(parseStartCommand("hello there")).toBeNull();
  });
});
