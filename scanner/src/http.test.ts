import { describe, expect, it } from "vitest";
import { runSource, SourceUnavailableError } from "./http.js";

describe("runSource", () => {
  it("429 позначає rateLimited, а не broken", async () => {
    const out = await runSource("aggregator:x", async () => { throw new SourceUnavailableError("x → 429", 429); });
    expect(out.ok).toBe(false);
    expect(out.rateLimited).toBe(true);
    expect(out.broken).toBe(false);
  });
  it("404 лишається broken", async () => {
    const out = await runSource("aggregator:x", async () => { throw new SourceUnavailableError("x → 404", 404); });
    expect(out.broken).toBe(true);
    expect(out.rateLimited).toBe(false);
  });
});
