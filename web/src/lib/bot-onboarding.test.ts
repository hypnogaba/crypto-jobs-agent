import { describe, expect, it } from "vitest";
import {
  emptyDraft, keyboard, nextStep, questionText, summary, toggle, STEPS,
} from "./bot-onboarding";

describe("порядок питань", () => {
  it("веде від сфер до зарплати й зупиняється", () => {
    expect(STEPS[0]).toBe("spheres");
    expect(nextStep("spheres")).toBe("wishes");
    expect(nextStep("wishes")).toBe("cv");
    expect(nextStep("cv")).toBe("industries");
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
    expect(questionText("spheres", "uk")).toContain("1 з 3");
    expect(questionText("where", "uk")).toContain("3 з 3");
  });

  it("підсумок читається словами, а не ідентифікаторами", () => {
    const draft = {
      spheres: ["engineering"], industries: ["fintech"],
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
      .toEqual(["Посада", "Галузь", "Місце", "Зарплата", "Побажання", "Стек", "Мова", "Година"]);
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

// ─────────────────────────────────────────────────────────────────────────
import { currentOf, currentLine, keyboard as kb } from "./bot-onboarding.js";

/**
 * Питання відкривалось порожнім, і людина не бачила, що там уже лежить:
 * зарплату вводила наосліп, місто так само. Виняток був один — побажання,
 * і саме тому вони єдині не викликали цього питання.
 */
describe("що вже записано в полі", () => {
  const draft = {
    ...emptyDraft(),
    spheres: ["engineering"], customRole: "комуніті менеджер",
    location: "Варшава", salaryMin: 36_000, salaryCurrency: "EUR",
    wishes: "тільки стартапи",
  };

  it("зарплата показується місячною — тією ж мірою, якою її питали", () => {
    // Нерозривний пробіл від toLocaleString рівняємо до звичайного: інакше
    // тест міряв би розділювач розрядів, а не суму.
    const v = currentOf("salary", draft, "uk")!.replace(/\u00a0/g, " ");
    expect(v).toContain("3 000 EUR");
    expect(v).toContain("міс");
  });

  it("місто показується, а не лишається таємницею", () => {
    expect(currentOf("where", draft, "uk")).toContain("Варшава");
  });

  it("написана роль стоїть у лапках поруч з обраними", () => {
    const v = currentOf("spheres", draft, "uk")!;
    expect(v).toContain("Інженерія");
    expect(v).toContain("«комуніті менеджер»");
  });

  it("порожнє поле не малює рядок «Зараз: —»", () => {
    expect(currentLine("salary", emptyDraft(), "uk")).toBeNull();
    expect(currentLine("where", emptyDraft(), "uk")).toBeNull();
  });
});

describe("кнопка «своє» на питанні про місце", () => {
  it("каже про місце, а не «немає в списку»: у списку не перелік місць", () => {
    const texts = kb("where", emptyDraft(), "uk").flat().map((b) => b.text);
    expect(texts.some((t) => t.includes("Інше місце"))).toBe(true);
    expect(texts.some((t) => t.includes("Немає в списку"))).toBe(false);
  });

  it("а на ролях лишається «Немає в списку» — там список справді є", () => {
    const texts = kb("spheres", emptyDraft(), "uk").flat().map((b) => b.text);
    expect(texts.some((t) => t.includes("Немає в списку"))).toBe(true);
  });
});

import { currentOf as nowOf } from "./bot-onboarding.js";

/**
 * Аудит 01.09: сайт питав «стек, роки, мови» четвертим питанням, а крокова
 * анкета бота не питала його ніколи — і не давала правити, бо в EDITABLE
 * його теж не було. Тобто людина з бота не могла заповнити це поле в
 * принципі. Воно йде в промпт до моделі, яка пише рядок «чому ти», тож
 * пояснення для неї виходило біднішим, ніж для тієї самої людини з сайту.
 */
describe("стек, роки, мови — те саме поле в боті й на сайті", () => {
  it("питається в анкеті", () => {
    expect(STEPS).toContain("cv");
    expect(nextStep("wishes")).toBe("cv");
  });

  it("має кнопку «Пропустити»: це не обов'язкове поле", () => {
    const rows = keyboard("cv", emptyDraft(), "uk");
    expect(rows.flat().map((b) => b.text)).toContain("Пропустити");
  });

  it("правиться з меню й пише саме cv_highlights", () => {
    expect(EDITABLE).toContain("cv");
    const upd = profileUpdateFor("cv", { ...emptyDraft(), cvHighlights: "8 років BD, Solana" });
    expect(upd?.set).toContain("cv_highlights");
    expect(upd?.params).toEqual(["8 років BD, Solana"]);
  });

  it("показує вже записане над питанням", () => {
    expect(nowOf("cv", { ...emptyDraft(), cvHighlights: "Go, 6 років, EN/UA" }, "uk"))
      .toContain("Go, 6 років, EN/UA");
    expect(nowOf("cv", emptyDraft(), "uk")).toBeNull();
  });
});

import { ASK_FRAME_BANNED, OPEN_STEPS } from "./bot-onboarding";

/**
 * Продукт шукає роботу, а анкета питала «яка твоя роль», тобто про минуле.
 * Той, хто змінює напрям, чесно відповідав про роботу, від якої йде, і
 * отримував добірку туди ж. Рамку легко зламати назад однією правкою тексту,
 * тому вона під тестом, а не лише в коментарі.
 */
describe("питання стоять у рамці пошуку, а не минулого", () => {
  const locales = ["en", "uk", "fr", "ru"] as const;

  for (const locale of locales) {
    it(`${locale}: жодне відкрите питання не питає, ким людина є`, () => {
      for (const step of OPEN_STEPS) {
        const text = questionText(step, locale).toLowerCase();
        for (const banned of ASK_FRAME_BANNED) {
          expect(text, `${step}/${locale}: «${banned}»`).not.toContain(banned);
        }
      }
    });

    it(`${locale}: кожне відкрите питання дає приклад відповіді`, () => {
      for (const step of OPEN_STEPS) {
        // Приклад — це те, що робить відкрите питання відповідальним. Без
        // нього людина не знає, скільки писати, і це вже раз провалилось.
        expect(questionText(step, locale).split("\n").length,
          `${step}/${locale}`).toBeGreaterThan(1);
      }
    });
  }
});

import { askKeyboard, confirmKeyboard, confirmText, notRecognisedLine } from "./bot-onboarding";

describe("клавіатура відкритого питання", () => {
  it("посада має один вихід: до списку", () => {
    expect(askKeyboard("spheres", "uk").flat().map((b) => b.callback_data))
      .toEqual(["ob:spheres:__list"]);
  });

  /** Галузь необов'язкова, тож пропустити її треба з першого екрана. */
  it("галузь має ще й «Пропустити»", () => {
    expect(askKeyboard("industries", "uk").flat().map((b) => b.callback_data))
      .toEqual(["ob:industries:__next", "ob:industries:__list"]);
  });

  it("кнопки підписані мовою людини", () => {
    expect(askKeyboard("spheres", "fr").flat()[0]!.text).toMatch(/liste/i);
  });
});

describe("клавіатура підтвердження", () => {
  it("далі й виправити, обидві прив'язані до свого кроку", () => {
    expect(confirmKeyboard("spheres", "uk").flat().map((b) => b.callback_data))
      .toEqual(["ob:spheres:__yes", "ob:spheres:__no"]);
  });
});

describe("текст підтвердження", () => {
  const draft = { ...emptyDraft(), customRole: "комуніті менеджер", spheres: ["devrel"] };

  it("цитує слова людини", () => {
    expect(confirmText("spheres", draft, [], "uk")).toContain("комуніті менеджер");
  });

  /**
   * Виведений напрям мусить бути підписаний як виведений. Скарга «галочки не
   * мої» вже була, і ParsedProfile.suggested існує рівно заради цієї межі.
   */
  it("показує виведений напрям", () => {
    expect(confirmText("spheres", draft, [], "uk")).toContain("DevRel");
  });

  it("вставляє приклади вакансій із компаніями", () => {
    const t = confirmText("spheres", draft,
      [{ title: "Community Manager", company: "Polygon" }], "uk");
    expect(t).toContain("Community Manager");
    expect(t).toContain("Polygon");
  });

  /** Порожні приклади — теж відповідь, і корисна. Мовчати тут гірше. */
  it("без прикладів каже про це прямо", () => {
    expect(confirmText("spheres", draft, [], "uk")).toMatch(/нічого немає/i);
  });

  it("для галузі прикладів вакансій не показуємо", () => {
    const ind = { ...emptyDraft(), industries: ["web3"] };
    expect(confirmText("industries", ind, [], "uk")).not.toMatch(/нічого немає/i);
  });

  it("для місця показує і режим, і місто", () => {
    const w = { ...emptyDraft(), remoteMode: "remote_or_city", location: "Берлін" };
    const t = confirmText("where", w, [], "uk");
    expect(t).toContain("Берлін");
    expect(t).toMatch(/офіс/i);
  });
});

describe("рядок про невпізнане", () => {
  it("є в усіх чотирьох мовах і не мовчить", () => {
    for (const l of ["en", "uk", "fr", "ru"] as const) {
      expect(notRecognisedLine(l).length).toBeGreaterThan(10);
    }
  });
});

import { nextMode } from "./bot-onboarding";

/**
 * Три режими одного кроку. `pick` — це поведінка до цієї зміни, тож у нього
 * веде кожен випадок, у якому розмова не вдалася. Гірший випадок нового
 * потоку дорівнює старому, і це головна властивість усієї перебудови.
 */
describe("режими кроку анкети", () => {
  it("написане й розібране веде до підтвердження", () => {
    expect(nextMode("ask", { parsed: true })).toBe("confirm");
  });

  /**
   * Найважливіший перехід. Вільний текст у 2026-08 провалився саме тим, що
   * на «тест» бот мовчки зберігав порожній профіль. Порожній розбір мусить
   * вести до кнопок, а не до порожнього підтвердження.
   */
  it("порожній розбір веде до кнопок, а не до порожнього підтвердження", () => {
    expect(nextMode("ask", { parsed: false })).toBe("pick");
  });

  it("«Показати список» веде до кнопок з будь-якого режиму", () => {
    expect(nextMode("ask", { listed: true })).toBe("pick");
    expect(nextMode("confirm", { listed: true })).toBe("pick");
  });

  it("«Не те» веде до кнопок", () => {
    expect(nextMode("confirm", { rejected: true })).toBe("pick");
  });

  /** Людина дописує уточнення замість того, щоб тиснути «Не те». */
  it("текст у підтвердженні — це виправлення, знову підтвердження", () => {
    expect(nextMode("confirm", { parsed: true })).toBe("confirm");
  });

  /** Із кнопок назад у розмову не повертаємось: людина вже обрала спосіб. */
  it("з кнопок нічого не виводить назад у розмову", () => {
    expect(nextMode("pick", { parsed: true })).toBe("pick");
  });
});

import { understood } from "./bot-onboarding";

/**
 * Найважливіша перевірка всієї перебудови.
 *
 * `mergeIntoDraft` каже «щось змінилось» і тоді, коли просто склала
 * НЕРОЗІБРАНИЙ текст у побажання. Якби режим спирався на неї, слово «тест»
 * дало б підтвердження замість списку — рівно той провал 2026-08, від якого
 * ми й тікаємо. Зрозуміле мусить означати «розібрано в поле того питання,
 * яке ми поставили», а не «текст кудись покладено».
 */
describe("що вважається зрозумілим", () => {
  const nothing = {
    spheres: [], industries: [], customRole: null, customIndustry: null,
    remoteMode: "", location: null,
  };

  it("«тест» не зрозуміло ні на одному кроці", () => {
    for (const step of ["spheres", "industries", "where"] as const) {
      expect(understood(nothing, step), step).toBe(false);
    }
  });

  it("написана посада — зрозуміло", () => {
    expect(understood({ ...nothing, customRole: "комуніті менеджер" }, "spheres")).toBe(true);
  });

  it("виведена сфера без слів людини — теж зрозуміло", () => {
    expect(understood({ ...nothing, spheres: ["devrel"] }, "spheres")).toBe(true);
  });

  /** Відповідь не на те питання не рахується: місця ми так і не почули. */
  it("посада не робить зрозумілим питання про місце", () => {
    expect(understood({ ...nothing, customRole: "developer" }, "where")).toBe(false);
  });

  it("галузь рахується і словом людини, і галочкою", () => {
    expect(understood({ ...nothing, industries: ["web3"] }, "industries")).toBe(true);
    expect(understood({ ...nothing, customIndustry: "кліматтех" }, "industries")).toBe(true);
  });

  it("місце рахується режимом або містом", () => {
    expect(understood({ ...nothing, remoteMode: "remote_only" }, "where")).toBe(true);
    expect(understood({ ...nothing, location: "Берлін" }, "where")).toBe(true);
  });
});
