import { describe, expect, it } from "vitest";
import {
  emptyDraft, keyboard, nextStep, questionText, summary, toggle, STEPS,
} from "./bot-onboarding";

describe("порядок питань", () => {
  it("веде від сфер до зарплати й зупиняється", () => {
    expect(STEPS[0]).toBe("spheres");
    expect(nextStep("spheres")).toBe("wishes");
    expect(nextStep("wishes")).toBe("industries");
    expect(nextStep("salary")).toBeNull();
  });

  // Місто питається лише в того, кому воно щось означає. Саме звідси
  // береться країна для ботових акаунтів: Telegram поясу не надсилає.
  it("питає місто в того, хто готовий не тільки віддалено", () => {
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "remote_or_city" })).toBe("city");
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "relocate" })).toBe("city");
  });

  it("не питає міста в того, хто хоче лише віддалено", () => {
    // Без міста пояс невідомий, тож далі — «котра година», а не зарплата.
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "remote_only" })).toBe("tz");
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "remote_only", timezone: "Europe/Kyiv" })).toBe("salary");
  });

  // Хто вже написав місце своїми словами на попередньому кроці, не має
  // відповідати на те саме вдруге.
  it("не питає міста двічі", () => {
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "relocate", location: "Берлін" })).toBe("salary");
  });

  it("без чернетки поводиться як раніше", () => {
    expect(nextStep("where")).toBe("city");
    expect(nextStep("city")).toBe("tz");
    expect(nextStep("tz")).toBe("salary");
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

// ── Побажання, вільний текст і правка по пунктах ──────────────
import { EDITABLE, freeTextAction, profileMenu, profileUpdateFor, readyText } from "./bot-onboarding";

describe("вільний текст поза командами", () => {
  it("у підключеної людини стає побажанням, а не новою анкетою", () => {
    expect(freeTextAction(true, true, false)).toBe("wish");
  });

  it("посеред анкети нічого не перезапускає", () => {
    expect(freeTextAction(true, true, true)).toBe("useButtons");
    expect(freeTextAction(false, false, true)).toBe("useButtons");
  });

  it("реєструє лише того, кого ще немає", () => {
    expect(freeTextAction(false, false, false)).toBe("register");
    expect(freeTextAction(true, false, false)).toBe("hint");
  });
});

describe("побажання в анкеті", () => {
  it("стоять одразу після сфер і мають кнопку «Пропустити»", () => {
    expect(nextStep("spheres")).toBe("wishes");
    expect(nextStep("wishes")).toBe("industries");
    const rows = keyboard("wishes", emptyDraft(), "uk");
    expect(rows).toEqual([[{ text: "Пропустити", callback_data: "ob:wishes:__next" }]]);
  });

  it("потрапляють у підсумок", () => {
    expect(summary({ ...emptyDraft(), spheres: ["design"], wishes: "без on-call" }, "uk"))
      .toContain("«без on-call»");
    expect(summary({ ...emptyDraft(), spheres: ["design"] }, "uk")).toContain("Дизайн");
  });
});

describe("правка по пунктах", () => {
  it("меню /profile відкриває кожне редаговане поле", () => {
    const data = profileMenu("uk").flat().map((b) => b.callback_data);
    for (const step of EDITABLE) expect(data).toContain(`ed:${step}`);
    expect(data).toContain("ed:lang");
    expect(profileMenu("uk").flat().map((b) => b.text))
      .toEqual(["Сфери", "Індустрії", "Рівень", "Місце", "Зарплата", "Побажання", "Мова", "Година"]);
  });

  it("клавіатура з префіксом ed: не плутається з онбордингом", () => {
    const rows = keyboard("spheres", { ...emptyDraft(), spheres: ["qa"] }, "uk", { prefix: "ed" });
    const flat = rows.flat();
    expect(flat.every((b) => b.callback_data.startsWith("ed:"))).toBe(true);
    expect(flat[flat.length - 1]!.callback_data).toBe("ed:spheres:__next");
  });

  it("пише лише своє поле", () => {
    const draft = { ...emptyDraft(), spheres: ["design"], customRole: "motion", salaryMin: 90_000,
                    salaryCurrency: "USD", wishes: " тільки стартапи " };
    expect(profileUpdateFor("spheres", draft)).toEqual({
      set: "spheres=?, custom_role=?", params: ['["design"]', "motion"] });
    expect(profileUpdateFor("salary", draft)).toEqual({
      set: "salary_min=?, salary_currency=?", params: [90_000, "USD"] });
    expect(profileUpdateFor("wishes", draft)).toEqual({ set: "wishes=?", params: ["тільки стартапи"] });
    expect(profileUpdateFor("seniority", { ...draft, seniority: null, customSeniority: "founder" }))
      .toEqual({ set: "seniority=?, custom_seniority=?", params: [null, "founder"] });
    // Година живе в users, не в profiles
    expect(profileUpdateFor("tz", draft)).toBeNull();
  });
});

describe("де хочеш працювати", () => {
  // Офіс у своєму місті й готовність переїхати — не альтернативи. Радіо-кнопка
  // змушувала викреслити одне з двох, і в базу йшла половина відповіді.
  it("позначає обидва обрані варіанти", () => {
    const rows = keyboard("where", { ...emptyDraft(), remoteMode: "remote_or_city,relocate" }, "uk");
    const flat = rows.flat();
    expect(flat.filter((b) => b.text.startsWith("✓ "))).toHaveLength(2);
    expect(flat[flat.length - 1]!.callback_data).toBe("ob:where:__next");
  });

  it("не дає завершити, поки нічого не обрано", () => {
    const rows = keyboard("where", emptyDraft(), "uk");
    expect(rows[rows.length - 1]![0]!.callback_data).toBe("ob:noop:0");
  });

  it("веде до міста, коли обрано будь-який варіант із місцем", () => {
    expect(nextStep("where", { ...emptyDraft(), remoteMode: "remote_or_city,relocate" })).toBe("city");
  });

  // Місто обов'язкове: питання ставиться лише тому, хто сам обрав місце,
  // а профіль без міста лишається без країни й без місцевих дошок.
  it("не пропонує пропустити місто", () => {
    expect(keyboard("city", emptyDraft(), "uk")).toEqual([]);
    expect(keyboard("wishes", emptyDraft(), "uk")[0]![0]!.callback_data).toBe("ob:wishes:__next");
  });

  it("пише набір одним рядком і показує обидва варіанти в підсумку", () => {
    const draft = { ...emptyDraft(), remoteMode: "relocate,remote_or_city", location: "Берлін" };
    expect(profileUpdateFor("where", draft)).toEqual({
      set: "remote_mode=?, location=?", params: ["remote_or_city,relocate", "Берлін"] });
    const text = summary(draft, "uk");
    expect(text).toContain("Віддалено або офіс у місті + Готовий/готова переїхати");
    expect(text).toContain("Берлін");
  });
});

describe("readyText", () => {
  it("підставляє годину, зону й дату", () => {
    const s = readyText("uk", { h: "09:00", tz: "Париж", when: "понеділок, 31 серпня, 09:00" });
    expect(s).toContain("робочі дні о 09:00 (Париж)");
    expect(s).toContain("Найближча: понеділок, 31 серпня, 09:00");
  });
});
