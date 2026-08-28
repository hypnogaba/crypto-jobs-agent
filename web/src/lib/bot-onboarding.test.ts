import { describe, expect, it } from "vitest";
import {
  emptyDraft, keyboard, nextStep, questionText, summary, toggle, STEPS,
} from "./bot-onboarding";

describe("порядок питань", () => {
  it("веде від сфер до зарплати й зупиняється", () => {
    expect(STEPS[0]).toBe("spheres");
    expect(nextStep("spheres")).toBe("industries");
    expect(nextStep("where")).toBe("salary");
    expect(nextStep("salary")).toBeNull();
  });
});

describe("вибір кількох варіантів", () => {
  it("перемикає, а не лише додає", () => {
    expect(toggle([], "engineering")).toEqual(["engineering"]);
    expect(toggle(["engineering"], "engineering")).toEqual([]);
    expect(toggle(["engineering"], "qa")).toEqual(["engineering", "qa"]);
  });
});

describe("клавіатура", () => {
  it("не дає йти далі, доки не обрано жодної сфери", () => {
    // Саме тут ламався старий бот: він приймав «тест» і зберігав порожній
    // профіль, який щоранку видавав би сміття.
    const rows = keyboard("spheres", emptyDraft(), "uk");
    const last = rows[rows.length - 1]![0]!;
    expect(last.callback_data).toBe("ob:noop:0");
    expect(last.text).toBe("Обери хоча б одне");
  });

  it("пускає далі, щойно щось обрано, і показує галочку", () => {
    const draft = { ...emptyDraft(), spheres: ["engineering"] };
    const rows = keyboard("spheres", draft, "uk");
    expect(rows[rows.length - 1]![0]!.callback_data).toBe("ob:spheres:__next");
    expect(rows.flat().find((b) => b.callback_data === "ob:spheres:engineering")!.text)
      .toBe("✓ Інженерія");
  });

  it("індустрії необов'язкові — там «Пропустити», а не «Обери хоча б одне»", () => {
    const rows = keyboard("industries", emptyDraft(), "uk");
    const last = rows[rows.length - 1]![0]!;
    expect(last.callback_data).toBe("ob:industries:__next");
    expect(last.text).toBe("Пропустити");
  });

  it("кожна кнопка вміщається в ліміт Telegram у 64 байти", () => {
    for (const step of STEPS) {
      for (const b of keyboard(step, emptyDraft(), "uk").flat()) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("тексти", () => {
  it("нумерують кроки, щоб людина бачила, скільки лишилось", () => {
    expect(questionText("spheres", "uk")).toContain("1 з 4");
    expect(questionText("where", "uk")).toContain("4 з 4");
  });

  it("підсумок читається словами, а не ідентифікаторами", () => {
    const draft = {
      spheres: ["engineering"], industries: ["fintech"], seniority: "senior",
      remoteMode: "remote_only", salaryMin: 90_000, salaryCurrency: "EUR",
    };
    const out = summary(draft, "uk");
    expect(out).toContain("Інженерія");
    expect(out).toContain("Фінтех");
    expect(out).toContain("Тільки віддалено");
    expect(out).not.toContain("remote_only");
  });

  it("порожня зарплата не вигадує число", () => {
    expect(summary(emptyDraft(), "uk")).toContain("Не важливо");
  });
});
