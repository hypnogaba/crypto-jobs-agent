import { describe, expect, it } from "vitest";
import { parseHnComment } from "./aggregators.js";

describe("parseHnComment", () => {
  it("бере компанію й перше посилання з формату з вертикальними рисками", () => {
    const html = 'Snout <a href="https:&#x2F;&#x2F;snout.com&#x2F;" rel="nofollow">link</a>'
      + " | Multiple Engineering Roles | Remote US or Ontario | Full Time<p>Join us";
    const p = parseHnComment(html, "2026-08-03T15:00:54Z");
    expect(p).toMatchObject({ company: "Snout", url: "https://snout.com/", remote: true });
    expect(p!.title).toContain("Multiple Engineering Roles");
  });
  it("викидає коментар без посилання", () => {
    expect(parseHnComment("We are hiring, email me", "2026-08-03T15:00:54Z")).toBeNull();
  });
  it("викидає посилання не http", () => {
    expect(parseHnComment('<a href="mailto:a@b.c">пиши</a> | Role', "2026-08-03T15:00:54Z")).toBeNull();
  });
});
