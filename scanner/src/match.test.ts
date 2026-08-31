import { describe, expect, it } from "vitest";
import { customIndustryBonus, explainLocally, explainSystem, linksToAggregator, pickTop, reachable, scoreJob, wishBonus, type CandidateJob, type Profile } from "./match.js";

const p: Profile = {
  userId: "u1", spheres: ["partnerships", "devrel"], industries: ["web3"],
  remoteMode: "remote_only", location: null, salaryMin: 80_000,
};

const job = (o: Partial<CandidateJob> = {}): CandidateJob => ({
  id: "j1", company: "Acme", companyKey: "acme", title: "Partnerships Manager",
  location: "Remote", remote: true, url: "https://x.test/1",
  tags: ["partnerships", "web3", "senior"], postedAt: null,
  salaryMin: null, salaryCurrency: null, ...o });

describe("scoreJob", () => {
  it("нагороджує збіг сфери й індустрії", () => {
    expect(scoreJob(job(), p).score).toBeGreaterThan(10);
  });
  it("сильно карає onsite для того, хто хоче лише віддалено", () => {
    expect(scoreJob(job({ remote: false }), p).score)
      .toBeLessThan(scoreJob(job(), p).score - 8);
  });
  it("рівень у тегах більше нічого не важить", () => {
    // Раніше тут був штраф за розрив у щаблях. Він спирався на тег, якого не
    // мали 62% кеша, а «middle» не існувало взагалі — тож питання прибрано
    // цілком, разом із цим правилом.
    for (const level of ["junior", "senior", "lead"]) {
      expect(scoreJob(job({ tags: ["partnerships", "web3", level] }), p).score)
        .toBe(scoreJob(job({ tags: ["partnerships", "web3"] }), p).score);
    }
  });
  it("НЕ карає вакансію без вказаної вилки", () => {
    expect(scoreJob(job({ salaryMin: null }), p).score)
      .toBe(scoreJob(job({ salaryMin: null }), p).score);
    expect(scoreJob(job({ salaryMin: 40_000 }), p).score)
      .toBeLessThan(scoreJob(job({ salaryMin: null }), p).score);
  });
  it("додає за свіжість", () => {
    const fresh = new Date().toISOString();
    expect(scoreJob(job({ postedAt: fresh }), p).score)
      .toBeGreaterThan(scoreJob(job(), p).score);
  });
});

describe("слова людини", () => {
  it("своя індустрія додає за збіг у тегах, назві компанії й описі", () => {
    const own = { ...p, industries: [], customIndustry: "climate tech" };
    const climate = job({ company: "Climate Works", summary: "Building tech for carbon markets" });
    expect(scoreJob(climate, own).score).toBeGreaterThan(scoreJob(climate, { ...p, industries: [] }).score);
  });

  it("своя індустрія має стелю: довгий рядок не переважує сферу", () => {
    const long = "climate tech carbon markets energy transition renewable";
    expect(customIndustryBonus(
      job({ company: "Climate Carbon Energy", title: "Renewable markets lead", summary: "transition" }),
      long)).toBeLessThanOrEqual(4);
  });

  it("своя індустрія без збігу нічого не карає", () => {
    const own = { ...p, industries: [], customIndustry: "esports" };
    expect(scoreJob(job(), own).score).toBe(scoreJob(job(), { ...p, industries: [] }).score);
  });

  it("слова про рівень тепер працюють через побажання", () => {
    // Куди переїхав «мій варіант» рівня: не в окреме поле, а в той самий
    // вільний текст, який і так шукається в назві й описі.
    const own: Profile = { ...p, wishes: "head of partnerships" };
    const hit = job({ title: "Head of Partnerships", tags: ["partnerships", "web3"] });
    expect(scoreJob(hit, own).score)
      .toBeGreaterThan(scoreJob(hit, p).score);
  });

  it("витяг із резюме не впливає на бали — лише на пояснення", () => {
    const withCv: Profile = { ...p, cvHighlights: "8 років BD, Solana, EN/FR/UA" };
    expect(scoreJob(job(), withCv).score).toBe(scoreJob(job(), p).score);
  });
});

describe("pickTop", () => {
  it("бере не більше однієї ролі на компанію", () => {
    const jobs = [job({ id: "a" }), job({ id: "b", title: "Ecosystem Lead" }), job({ id: "c", companyKey: "other", company: "Other" })];
    const top = pickTop(jobs, p, 5);
    expect(top).toHaveLength(2);
  });
  it("викидає вакансії з нульовим або відʼємним рахунком", () => {
    const bad = job({ tags: ["sales"], remote: false });
    expect(pickTop([bad], p, 5)).toHaveLength(0);
  });
  it("обмежує розмір добірки", () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      job({ id: `j${i}`, companyKey: `c${i}`, company: `C${i}` }));
    expect(pickTop(jobs, p, 5)).toHaveLength(5);
  });
});

describe("explainLocally", () => {
  it("пише про людину, а не переказує вакансію", () => {
    const [top] = pickTop([job()], p, 1);
    const why = explainLocally(top!, p, "uk");
    expect(why).toContain("Партнерства і BD");
    expect(why).not.toContain("partnerships");
    expect(why).toContain("віддалено");
  });
  it("ніколи не повертає порожній рядок", () => {
    const [top] = pickTop([job({ tags: ["partnerships"] })], p, 1);
    expect(explainLocally(top!, p).length).toBeGreaterThan(5);
  });
  it("говорить мовою людини, а не лише українською", () => {
    // Без ключа Anthropic це єдиний рядок «чому ти», який бачить француз.
    const [top] = pickTop([job()], p, 1);
    expect(explainLocally(top!, p, "fr")).toBe("Partenariats et BD, un de vos domaines, secteur Web3 et crypto, entièrement à distance.");
    expect(explainLocally(top!, p, "ru")).toContain("Партнёрства и BD");
    expect(explainLocally(top!, p, "en")).toContain("fully remote");
    expect(explainLocally(top!, p, "ru")).toContain("удалённо");
    expect(explainLocally(top!, p)).not.toMatch(/[а-яіїє]/i);
  });
  it("без жодної причини — запасний рядок теж локалізований", () => {
    const only = { ...p, spheres: [], industries: [], remoteMode: "any", salaryMin: null };
    const [top] = pickTop([job({ tags: ["senior"], title: "Anything" })], { ...only, customRole: "anything" }, 1);
    expect(explainLocally(top!, only, "en")).toBe("role title matches your profile.");
  });
});

describe("сфера важливіша за індустрію", () => {
  it("робота в потрібній індустрії, але чужій сфері, програє", () => {
    const rightSphere = job({ tags: ["partnerships", "senior"] });
    const rightIndustryOnly = job({ tags: ["marketing", "web3", "senior"] });
    expect(scoreJob(rightSphere, p).score).toBeGreaterThan(scoreJob(rightIndustryOnly, p).score);
  });
  it("чужа сфера дає відʼємний рахунок і не потрапляє в добірку", () => {
    expect(pickTop([job({ tags: ["marketing", "web3"] })], p, 5)).toHaveLength(0);
  });
});

describe("посилання має вести на роботодавця", () => {
  it("впізнає хости агрегаторів, включно з піддоменами", () => {
    expect(linksToAggregator("https://jobicy.com/jobs/151908-x")).toBe(true);
    expect(linksToAggregator("https://www.workingnomads.com/job/go/1/")).toBe(true);
    expect(linksToAggregator("https://himalayas.app/companies/x/jobs/y")).toBe(true);
    expect(linksToAggregator("https://job-boards.greenhouse.io/alpaca/jobs/1")).toBe(false);
    expect(linksToAggregator("https://jobs.ashbyhq.com/sanity/abc")).toBe(false);
  });

  it("не судить те, чого не розібрав", () => {
    expect(linksToAggregator("не посилання")).toBe(false);
  });

  it("викидає їх із добірки, хоч би як добре вони набрали балів", () => {
    const top = pickTop([
      job({ id: "a", companyKey: "a", url: "https://jobicy.com/jobs/1" }),
      job({ id: "b", companyKey: "b", url: "https://jobs.lever.co/finn/1" }),
    ], p);
    expect(top.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("різноманітність добірки", () => {
  const wide: Profile = { ...p, spheres: ["partnerships", "devrel", "marketing"] };

  it("бере найкраще з кожної обраної сфери, а не п'ять із найсильнішої", () => {
    // Перша справжня доставка дала п'ять вакансій із двох сфер, хоча профіль
    // був ширший: добірка сповзала в ту сферу, де балів більше.
    const jobs = [
      job({ id: "p1", companyKey: "c1", tags: ["partnerships", "senior"] }),
      job({ id: "p2", companyKey: "c2", tags: ["partnerships", "senior"] }),
      job({ id: "p3", companyKey: "c3", tags: ["partnerships", "senior"] }),
      job({ id: "d1", companyKey: "c4", tags: ["devrel"] }),
      job({ id: "m1", companyKey: "c5", tags: ["marketing"] }),
    ];
    const top = pickTop(jobs, wide, 3);
    const spheres = top.map((t) => t.tags.find((x) => wide.spheres.includes(x)));
    expect(new Set(spheres).size).toBe(3);
  });

  it("не бере двічі одну компанію навіть заради різноманітності", () => {
    const jobs = [
      job({ id: "a", companyKey: "same", tags: ["partnerships"] }),
      job({ id: "b", companyKey: "same", tags: ["devrel"] }),
      job({ id: "c", companyKey: "other", tags: ["marketing"] }),
    ];
    expect(pickTop(jobs, wide, 5).map((t) => t.companyKey)).toEqual(["same", "other"]);
  });

  it("порядок у повідомленні — за силою збігу", () => {
    const top = pickTop([
      job({ id: "weak", companyKey: "c1", tags: ["devrel"] }),
      job({ id: "strong", companyKey: "c2", tags: ["partnerships", "web3", "senior"] }),
    ], wide, 5);
    expect(top[0]!.id).toBe("strong");
  });
});

describe("навчання на скаргах", () => {
  it("без скарг поведінка така сама, як була", () => {
    const j = job({ location: "Berlin" });
    const withLoc = { ...p, location: "Lisbon" };
    expect(scoreJob(j, withLoc).score)
      .toBe(scoreJob(j, { ...withLoc, tuning: { location: 1, salary: 1 } }).score);
  });

  it("скарга на локацію карає невідповідність, якої раніше просто не помічали", () => {
    const j = job({ location: "Berlin" });
    const withLoc = { ...p, location: "Lisbon" };
    expect(scoreJob(j, { ...withLoc, tuning: { location: 3, salary: 1 } }).score)
      .toBeLessThan(scoreJob(j, withLoc).score);
  });
});

describe("країна", () => {
  const ua = { ...p, country: "UA" };
  const nobody = { ...p, country: null };
  const kyiv = job({ id: "ua", country: "UA", source: "board:dou-design" });
  const global = job({ id: "g", country: null, source: "greenhouse:acme", companyKey: "glob", company: "Glob" });

  it("вакансія з країною йде лише своїм", () => {
    expect(pickTop([kyiv], ua).map((j) => j.id)).toEqual(["ua"]);
    expect(pickTop([kyiv], { ...p, country: "FR" })).toEqual([]);
  });

  // Людині без визначеної країни нав'язувати національну вакансію не можна:
  // ботові акаунти всі мають пояс UTC, і країни в них просто немає.
  it("не нав'язує національну вакансію тому, чиєї країни ми не знаємо", () => {
    expect(pickTop([kyiv], nobody)).toEqual([]);
  });

  it("вакансія без країни лишається доступною всім", () => {
    expect(pickTop([global], nobody).map((j) => j.id)).toEqual(["g"]);
    expect(pickTop([global], ua).map((j) => j.id)).toEqual(["g"]);
  });

  // Одиниця штрафу — це нічия, а не витіснення: дошка мусить програвати
  // рівному, але не сильнішому збігу.
  it("дошка програє прямому посиланню лише в нічию", () => {
    expect(scoreJob(kyiv, ua).score).toBe(scoreJob(job({ country: "UA" }), ua).score - 1);

    const weakAts = job({ id: "w", companyKey: "w", tags: ["web3"], source: "greenhouse:w" });
    const strongBoard = job({ id: "s", companyKey: "s", country: "UA", source: "board:dou-design" });
    expect(pickTop([weakAts, strongBoard], ua)[0]!.id).toBe("s");
  });
});


// ── Факти збігу ───────────────────────────────────────────────
import type { MatchFact } from "./match.js";

const prof = (over: Partial<Profile> = {}): Profile => ({
  userId: "u1", spheres: ["operations"], industries: ["fintech"],
  remoteMode: "remote_only", location: null, salaryMin: null, ...over,
});

const cand = (over: Partial<CandidateJob> = {}): CandidateJob => ({
  id: "j1", company: "Acme", companyKey: "acme", title: "Ops Associate",
  location: "Remote", remote: true, url: "https://acme.com/1",
  tags: ["operations", "fintech", "senior"], postedAt: null,
  salaryMin: null, salaryCurrency: null, ...over,
});

describe("facts", () => {
  it("пише ідентифікатори, а не готовий текст", () => {
    const f = scoreJob(cand(), prof()).facts;
    expect(f).toContainEqual({ k: "sphere", v: "operations" } satisfies MatchFact);
    expect(f).toContainEqual({ k: "industry", v: "fintech" } satisfies MatchFact);
    expect(f).toContainEqual({ k: "remote" } satisfies MatchFact);
  });

  it("тримає порядок від сильнішого до слабшого", () => {
    const ks = scoreJob(cand({ postedAt: new Date().toISOString() }), prof()).facts.map((x) => x.k);
    expect(ks.indexOf("sphere")).toBeLessThan(ks.indexOf("industry"));
    expect(ks.indexOf("industry")).toBeLessThan(ks.indexOf("remote"));
    expect(ks.at(-1)).toBe("fresh");
  });

  it("дає різні факти різним вакансіям — саме цього бракувало", () => {
    const a = scoreJob(cand(), prof()).facts;
    const b = scoreJob(cand({ id: "j2", remote: false, location: "Berlin", tags: ["operations"] }),
                       prof({ remoteMode: "relocate" })).facts;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  // «Тільки віддалено» — це тепер набір з одного елемента, а не одне значення.
  // Хто згоден і на офіс у своєму місті, і на переїзд, не має отримувати
  // мінус шість за кожну вакансію з адресою.
  it("не карає за офіс того, хто обрав і місто, і переїзд", () => {
    const onsite = cand({ id: "j3", remote: false, location: "Berlin" });
    const strict = scoreJob(onsite, prof({ remoteMode: "remote_only" })).score;
    const open = scoreJob(onsite, prof({ remoteMode: "remote_or_city,relocate" })).score;
    expect(open).toBeGreaterThan(strict);
  });

  it("своя роль дає факт role, а не sphere", () => {
    const f = scoreJob(cand({ tags: [], title: "Solidity Auditor" }),
      prof({ spheres: [], customRole: "solidity audit" })).facts;
    expect(f).toContainEqual({ k: "role", v: "solidity audit" } satisfies MatchFact);
  });
});

describe("побажання (wishes)", () => {
  it("+2 за кожне окреме слово ≥4 символів у назві чи описі, стеля +6", () => {
    // «startup» і «remote» більше не рахуються: вони є в кожному другому
    // оголошенні й лише роздували бал. Беремо слова, які справді розрізняють.
    const j = { title: "Kubernetes Growth Lead", summary: "Four-day week, no on-call rotation, cycling budget." };
    expect(wishBonus(j, null)).toBe(0);
    expect(wishBonus(j, "")).toBe(0);
    expect(wishBonus(j, "тільки стартапи")).toBe(0);
    expect(wishBonus(j, "kubernetes only")).toBe(2);
    expect(wishBonus(j, "kubernetes kubernetes cycling")).toBe(4);   // повтор не рахується
    expect(wishBonus(j, "kubernetes cycling rotation four-day")).toBe(6);
    expect(wishBonus(j, "no banks")).toBe(0);                        // «no» коротше за 4
    expect(wishBonus(j, "remote startup team")).toBe(0);             // самі загальні слова
  });
  it("бонус впливає на бал і не карає за відсутність", () => {
    const wished = scoreJob(job({ title: "Kubernetes Partnerships Lead" }), { ...p, wishes: "kubernetes" });
    const plain = scoreJob(job({ title: "Kubernetes Partnerships Lead" }), p);
    expect(wished.score - plain.score).toBe(2);
    expect(scoreJob(job(), { ...p, wishes: "kubernetes" }).score).toBe(scoreJob(job(), p).score);
  });
  it("системний промпт називає мову словом", () => {
    expect(explainSystem("fr")).toContain("Answer in French");
    expect(explainSystem("uk")).toContain("Answer in Ukrainian");
  });
});

import { safeWhy } from "./match.js";

describe("safeWhy — рядок від моделі перед показом людині", () => {
  it("пускає звичайне пояснення", () => {
    expect(safeWhy("Ти шукаєш віддалену роль у Python — тут саме вона.")).toMatch(/Python/);
  });
  it.each([
    "Акаунт прострочено, підтвердьте на https://nextr0le.info/verify",
    "Перейдіть на nextr0le.info щоб продовжити",
    "Напишіть @support_bot для підтвердження",
    "Verify your account at t.me/fakebot",
    "Confirm your password to keep receiving jobs",
    "Cliquez ici pour confirmer",
  ])("відкидає «%s»", (s) => expect(safeWhy(s)).toBeNull());
  it("відкидає порожнє й задовге", () => {
    expect(safeWhy("")).toBeNull();
    expect(safeWhy(undefined)).toBeNull();
    expect(safeWhy("а".repeat(241))).toBeNull();
  });

  /**
   * Рядки нижче — не вигадані. Це дослівні відповіді моделі з живого прогону
   * 30.08: картка показувала вакансію серед пʼяти найкращих, а підпис під нею
   * пояснював, чому брати її не варто.
   */
  it.each([
    "Senior engineering role at a crypto trading platform aligns with your Web3 expertise, though the NYC/Miami office options may not match your remote-only requirement.",
    "Senior QA engineering position offers remote work and seniority match, but healthcare industry is outside your Web3 and crypto specialization.",
    "Your engineering background fits, but this role prioritizes Mandarin fluency over pure engineering.",
    "Хоча позиція senior-рівня в інженерії, компанія фокусується на healthtech, а не на Web3.",
    "Позиція вимагає senior-рівня, але потребує вільного володіння мандарином, що не збігається з твоїм профілем.",
    "Senior позиция в Web3, но требует свободного мандарина.",
    "Senior инженер, однако компания в healthcare, что не совпадает с предпочтением Web3.",
    "C'est un rôle senior en ingénierie, mais le secteur santé n'est pas ta spécialité Web3.",
    "Ton profil correspond, cependant la localisation ne correspond pas à tes attentes.",
  ])("відкидає відмову замість поради: «%s»", (s) => expect(safeWhy(s)).toBeNull());

  /**
   * Зворотний бік: перевірка не має зʼїдати звичайні схвальні рядки. Кожен
   * із них — те, що людина й має прочитати під карткою.
   */
  /**
   * Захист від інʼєкцій не має різати живу мову. «Expérience confirmée» —
   * найзвичайніша похвала у французькому резюме, і саме нею словник називає
   * рівень Middle; голе стебло «confirm» її зʼїдало.
   */
  it("не плутає французьке «confirmée» із закликом підтвердити", () => {
    expect(safeWhy("Expérience confirmée en design de produit, exactement ce que demande ce poste."))
      .not.toBeNull();
  });
  it.each([
    "Confirm your password to keep receiving jobs",
    "Please confirm your account to continue",
    "Confirmation required: verify your login",
  ])("але заклик підтвердити далі відкидає: «%s»", (s) => expect(safeWhy(s)).toBeNull());

  it.each([
    "Senior engineering role at a crypto trading platform — your Web3 expertise and remote-first preference in one place.",
    "Це «Інженерія», одна з твоїх сфер, і повністю віддалено.",
    "Твій стек Solana збігається з тим, що вони шукають.",
    "Это «Инженерия», одна из твоих сфер, полностью удалённо.",
    "Ingénierie, un de vos domaines, secteur Web3 et crypto, entièrement à distance.",
    "Your eight years in BD and the Solana ecosystem are exactly what they ask for.",
  ])("пускає схвальний рядок: «%s»", (s) => expect(safeWhy(s)).not.toBeNull());
});

// ── Порожній профіль ──────────────────────────────────────────
import { hasSearchSignal } from "./match.js";

describe("hasSearchSignal", () => {
  it("сфера або своя роль — і є що шукати", () => {
    expect(hasSearchSignal({ spheres: ["engineering"], customRole: null })).toBe(true);
    expect(hasSearchSignal({ spheres: [], customRole: "solidity auditor" })).toBe(true);
  });

  it("порожньо — і шукати нема за чим", () => {
    expect(hasSearchSignal({ spheres: [], customRole: null })).toBe(false);
    expect(hasSearchSignal({ spheres: [], customRole: "  " })).toBe(false);
    // Слово з двох літер матчер ігнорує, тож і пошуком воно не є.
    expect(hasSearchSignal({ spheres: [], customRole: "ai" })).toBe(false);
  });
});

describe("pickTop з порожнім профілем", () => {
  const job = (id: string, title: string): CandidateJob => ({
    id, company: `Co${id}`, companyKey: `co${id}`, title, location: null, remote: true,
    url: `https://co${id}.test/1`, tags: ["remote"], postedAt: null,
    salaryMin: null, salaryCurrency: null,
  });

  it("не вигадує добірку з нічого", () => {
    // До цієї перевірки кожна віддалена вакансія набирала +5 (віддалено +3,
    // свіжість +2) без жодного збігу, бо штраф −8 стоїть під умовою «людина
    // щось назвала». Людина отримувала юриста, HR-партнера й дата-саєнтиста
    // з упевненим поясненням під кожним.
    const jobs = [job("1", "Senior commercial counsel"), job("2", "People Business Partner")];
    const empty = {
      userId: "u", spheres: [], industries: [],
      remoteMode: "remote_only", location: null, salaryMin: null, customRole: null,
    };
    expect(pickTop(jobs, empty, 5)).toEqual([]);
    // Та сама людина, що назвала свою роль, добірку отримує.
    expect(pickTop(jobs, { ...empty, customRole: "commercial counsel" }, 5).length).toBe(1);
  });
});

// ── Межа доречності ───────────────────────────────────────────
import { onTopic } from "./match.js";

describe("onTopic", () => {
  const p = { spheres: ["devrel"], customRole: null };

  it("збіг за сферою або своєю роллю — доречно", () => {
    expect(onTopic({ facts: [{ k: "sphere", v: "devrel" }] }, p)).toBe(true);
    expect(onTopic({ facts: [{ k: "role", v: "community lead" }] }, p)).toBe(true);
  });

  it("індустрія, рівень, віддаленість і свіжість самі збігу не роблять", () => {
    // Саме ця комбінація давала +2 попри штраф −8 і добивала добірку
    // вакансіями, під якими стояло «далеко від DevRel».
    expect(onTopic({ facts: [
      { k: "industry", v: "web3" }, { k: "level" }, { k: "remote" }, { k: "fresh" },
    ] }, p)).toBe(false);
  });

  it("без жодного факту — теж ні", () => {
    expect(onTopic({ facts: [] }, p)).toBe(false);
  });
});

describe("pickTop із межею доречності", () => {
  const job = (id: string, title: string, tags: string[]): CandidateJob => ({
    id, company: `Co${id}`, companyKey: `co${id}`, title, location: null, remote: true,
    url: `https://co${id}.test/1`, tags, postedAt: null, salaryMin: null, salaryCurrency: null,
  });
  const devrel = {
    userId: "u", spheres: ["devrel"], industries: ["web3"],
    remoteMode: "remote_only", location: null, salaryMin: null, customRole: null,
  };

  it("краще дві доречні, ніж дві доречні й три чужі", () => {
    const jobs = [
      job("1", "Community Manager", ["devrel"]),
      job("2", "Developer Advocate", ["devrel", "web3"]),
      // Ці троє — web3 + senior + remote, тобто рівно те, що раніше
      // пролізало з +2: Stock Administrator, HR Operations і подібні.
      job("3", "Senior Stock Administrator", ["web3", "senior"]),
      job("4", "HR Operations Senior Manager", ["web3", "operations", "senior"]),
      job("5", "Senior Commercial Counsel", ["finance-legal", "senior"]),
    ];
    const top = pickTop(jobs, devrel, 5);
    expect(top.map((j) => j.title)).toEqual(["Developer Advocate", "Community Manager"]);
  });

  it("своя роль пускає вакансію без жодної галочки", () => {
    const jobs = [job("1", "Solidity Auditor", ["engineering"])];
    const top = pickTop(jobs, { ...devrel, spheres: [], customRole: "solidity auditor" }, 5);
    expect(top).toHaveLength(1);
  });

  it("широкому профілю межа нічого не забирає", () => {
    const jobs = [
      job("1", "Backend Engineer", ["engineering"]),
      job("2", "Platform Engineer", ["engineering"]),
      job("3", "Site Reliability Engineer", ["engineering"]),
    ];
    const wide = { ...devrel, spheres: ["engineering"], industries: [] };
    expect(pickTop(jobs, wide, 5)).toHaveLength(3);
  });
});

/**
 * Резерв під локальні вакансії.
 *
 * Глобальних у кеші двадцять тисяч проти шестисот національних, тож самим
 * балом місцева вакансія в добірку не потрапляла майже ніколи — навіть коли
 * людина сама написала місто.
 */
describe("pickTop — місце під локальні", () => {
  const local: Profile = { ...p, country: "BE" };
  const beJob = (id: string, over: Partial<CandidateJob> = {}): CandidateJob =>
    job({ id, companyKey: `be-${id}`, company: `BE ${id}`, country: "BE", ...over });
  const globalJob = (id: string): CandidateJob =>
    job({ id, companyKey: `gl-${id}`, company: `Global ${id}`,
          postedAt: new Date().toISOString() });

  it("бере локальні, навіть коли глобальні сильніші за балом", () => {
    // Глобальні свіжі, отже мають вищий бал; локальні — ні.
    const jobs = [...Array.from({ length: 8 }, (_, i) => globalJob(`g${i}`)),
                  beJob("b1"), beJob("b2")];
    const top = pickTop(jobs, local, 5);
    expect(top.filter((j) => j.country === "BE")).toHaveLength(2);
    expect(top).toHaveLength(5);
  });

  it("не резервує місця, коли країни в профілі немає", () => {
    const jobs = [...Array.from({ length: 8 }, (_, i) => globalJob(`g${i}`))];
    const top = pickTop(jobs, p, 5);
    expect(top.every((j) => !j.country)).toBe(true);
  });

  /**
   * Головна межа: резерв не є приводом надіслати не ту роботу. Місцева
   * вакансія не з тієї сфери мусить відпасти на тих самих фільтрах, що й
   * будь-яка інша.
   */
  it("не тягне локальну вакансію, яка не пройшла доречність", () => {
    const offTopic = beJob("bad", { title: "Plumber", tags: ["trades"] });
    const jobs = [offTopic, ...Array.from({ length: 4 }, (_, i) => globalJob(`g${i}`))];
    const top = pickTop(jobs, local, 5);
    expect(top.find((j) => j.id === "bad")).toBeUndefined();
  });

  it("порожній резерв віддає місця далі, а не лишає дірку", () => {
    const jobs = Array.from({ length: 5 }, (_, i) => globalJob(`g${i}`));
    expect(pickTop(jobs, local, 5)).toHaveLength(5);
  });

  // Одна роль на компанію діє й тут: дві вакансії одного місцевого
  // роботодавця — це одна можливість, а не дві.
  it("не бере дві вакансії однієї місцевої компанії", () => {
    const jobs = [beJob("b1", { companyKey: "same", company: "Same" }),
                  beJob("b2", { companyKey: "same", company: "Same" }),
                  ...Array.from({ length: 5 }, (_, i) => globalJob(`g${i}`))];
    const top = pickTop(jobs, local, 5);
    expect(top.filter((j) => j.country === "BE")).toHaveLength(1);
  });
});


describe("офіс без локації", () => {
  const job = (over: Partial<CandidateJob> = {}): CandidateJob => ({
    id: "j", company: "Acme", companyKey: "acme", title: "Product Owner",
    location: null, remote: false, url: "https://acme.test/1", tags: ["product"],
    postedAt: null, salaryMin: null, salaryCurrency: null, ...over,
  });
  const berlin: Profile = {
    userId: "u", spheres: ["product"], industries: [], seniority: null,
    remoteMode: "remote_or_city", location: "Berlin", country: "DE", salaryMin: null,
  } as unknown as Profile;

  it("не доходить до того, хто не погоджувався переїжджати", () => {
    expect(reachable(job(), berlin)).toBe(false);
    expect(reachable(job({ location: "   " }), berlin)).toBe(false);
  });

  it("написане місто лишається, навіть якщо словник його не знає", () => {
    // «Wallingford, Oxfordshire» наш словник не розбирає, але людина прочитає.
    expect(reachable(job({ location: "Wallingford, Oxfordshire" }), berlin)).toBe(true);
  });

  it("віддаленої вакансії правило не стосується", () => {
    expect(reachable(job({ remote: true }), berlin)).toBe(true);
  });

  it("готовому переїхати правило теж не заважає", () => {
    expect(reachable(job(), { ...berlin, remoteMode: "relocate" })).toBe(true);
  });
});

describe("надто загальні слова не вважаються збігом", () => {
  const j = { title: "Senior Product/Growth Designer (EdTech Unit)", summary: null,
              tags: ["design"], company: "Applyft" };

  it("«climate tech» не збігається з EdTech через слово tech", () => {
    // Живий прогін: дизайнерка написала про climate tech і першою карткою
    // отримала EdTech із підписом «індустрія climate tech».
    expect(customIndustryBonus(j, "climate tech")).toBe(0);
  });

  it("справжня назва галузі далі працює", () => {
    expect(customIndustryBonus({ ...j, company: "Climate Systems" }, "climate tech"))
      .toBeGreaterThan(0);
  });

  it("побажання не набирають балів на «remote» і «team»", () => {
    expect(wishBonus({ title: "Remote Designer", summary: "great team" },
                     "remote work in a small team")).toBe(0);
    expect(wishBonus({ title: "Designer", summary: "no on-call rotation" },
                     "no on-call")).toBeGreaterThan(0);
  });
});

describe("пам'ять про власні дії людини", () => {
  const base = { userId: "u1", spheres: ["engineering"], industries: [],
    remoteMode: "remote_only", location: null, salaryMin: null } as Profile;
  const job = (companyKey: string) => ({
    id: "1", url: "https://x/1", company: companyKey, companyKey,
    title: "Backend Engineer", location: null, remote: true,
    tags: ["engineering"], postedAt: new Date().toISOString(), source: "ats:x",
    salaryMin: null, salaryMax: null, summary: null,
  }) as CandidateJob;

  /**
   * Кнопка «не цікавить» писала рядок і не змінювала нічого: підбір таблицю
   * feedback не читав жодного разу. Тепер сховане тягне компанію вниз.
   */
  it("сховане тягне компанію вниз", () => {
    const plain = scoreJob(job("acme"), base).score;
    const after = scoreJob(job("acme"), { ...base, companySignal: { acme: -1 } }).score;
    expect(after).toBeLessThan(plain);
  });

  it("подане тягне компанію вгору", () => {
    const plain = scoreJob(job("acme"), base).score;
    const after = scoreJob(job("acme"), { ...base, companySignal: { acme: 1 } }).score;
    expect(after).toBeGreaterThan(plain);
  });

  /**
   * Одне «не цікавить» — про одну вакансію, а не вирок компанії. Стеля не дає
   * кільком дотикам перекрити збіг за роллю.
   */
  it("десять дотиків важать не більше за шість балів", () => {
    const plain = scoreJob(job("acme"), base).score;
    const many = scoreJob(job("acme"), { ...base, companySignal: { acme: -10 } }).score;
    expect(plain - many).toBe(6);
  });

  it("інші компанії не зачеплені", () => {
    const plain = scoreJob(job("other"), base).score;
    const after = scoreJob(job("other"), { ...base, companySignal: { acme: -5 } }).score;
    expect(after).toBe(plain);
  });
});

// ─────────────────────────────────────────────────────────────────────────
import { levelsIn, jobLevel, splitWishes, wishPenalty, STRONG_SCORE, matchPercent } from "./match.js";

/**
 * Скарга 31.08: людина написала, що шукає вхідний рівень, і отримала middle
 * та senior. Тести нижче стережуть саме той ланцюжок, а не абстрактне
 * «рівень враховується».
 */
describe("рівень зі слів людини", () => {
  const junior: Profile = {
    userId: "u2", spheres: ["product"], industries: [],
    remoteMode: "remote_ok", location: null, salaryMin: null,
    customRole: "junior product manager",
  };
  const pm = (title: string): CandidateJob => ({
    id: title, company: "Acme", companyKey: "acme", title,
    location: "Remote", remote: true, url: "https://x.test/1",
    tags: ["product"], postedAt: null, salaryMin: null, salaryCurrency: null,
  });

  it("читає рівень із назви ролі й з назви вакансії", () => {
    expect(levelsIn("junior product manager")).toEqual(new Set([1]));
    expect(levelsIn("шукаю вхідного рівня")).toEqual(new Set([1]));
    expect(jobLevel("Senior Product Manager")).toBe(3);
    expect(jobLevel("Product Manager")).toBeNull();
    // Старше з двох слів і є посадою.
    expect(jobLevel("Senior Staff Engineer")).toBe(4);
  });

  it("«lead» не вважається рівнем: Lead Generation — це продажі", () => {
    expect(jobLevel("Lead Generation Specialist")).toBeNull();
  });

  it("свій рівень стоїть вище за чужий — те, чого просила людина", () => {
    const own = scoreJob(pm("Junior Product Manager"), junior).score;
    const near = scoreJob(pm("Middle Product Manager"), junior).score;
    const far = scoreJob(pm("Senior Product Manager"), junior).score;
    expect(own).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
  });

  it("названий рівень не з'їдає точного збігу за роллю", () => {
    // «junior product manager» проти «Product Manager» — це повний збіг:
    // рівень рахується окремим правилом і з назви ролі виймається.
    expect(scoreJob(pm("Product Manager"), junior).score)
      .toBe(scoreJob(pm("Product Manager"), { ...junior, customRole: "product manager" }).score);
  });

  it("вакансія без рівня в назві стоїть вище за чужий рівень", () => {
    // «не знаємо» має бути дешевшим за «не той» — так само, як у географії.
    expect(scoreJob(pm("Product Manager"), junior).score)
      .toBeGreaterThan(scoreJob(pm("Senior Product Manager"), junior).score);
  });

  it("senior-вакансія лишається в списку, а не зникає", () => {
    // У вузькій сфері порожня добірка гірша за добірку не свого рівня.
    expect(scoreJob(pm("Senior Product Manager"), junior).score).toBeGreaterThan(0);
  });

  it("рівень мовчить, коли його не назвала жодна сторона", () => {
    const noLevel: Profile = { ...junior, customRole: "product manager" };
    expect(scoreJob(pm("Product Manager"), noLevel).parts.some((x) => x.k.startsWith("level"))).toBe(false);
  });
});

describe("побажання в обидва боки", () => {
  it("ділить написане на «хочу» і «не хочу» по частинах", () => {
    const { want, avoid } = splitWishes("готовий переїхати, але не в Азію");
    expect(want).toContain("переїхати");
    expect(avoid).toContain("Азію");
  });

  it("«не хочу стартапів» більше не важить те саме, що «хочу стартапи»", () => {
    // Текст англійською навмисно: у профілі поруч живе wishesEn, і підбір
    // читає саме переклад — порівнювати українське слово з англійським
    // оголошенням не має сенсу в жодному напрямку.
    const j = { title: "Growth Manager", summary: "Fast-growing fintech scaleup, agency background welcome" };
    expect(wishPenalty(j, "not interested in agency work")).toBeLessThan(0);
    expect(wishPenalty(j, "agency background is a plus")).toBe(0);
  });

  it("«no on-call» проти «no on-call rotation» — це згода, а не сутичка", () => {
    const j = { title: "Designer", summary: "no on-call rotation" };
    expect(wishBonus(j, "no on-call")).toBeGreaterThan(0);
    expect(wishPenalty(j, "no on-call")).toBe(0);
  });
});

describe("стеля бала", () => {
  it("сфера плюс точна роль дають повні сто відсотків", () => {
    expect(matchPercent(STRONG_SCORE)).toBe(100);
    // Раніше в стелі жили три бали за прибране правило, і 18 давало 86%.
    expect(matchPercent(18)).toBeGreaterThan(86);
  });
});

describe("порожній пошук, який виглядав осмисленим", () => {
  it("роль лише зі слова рівня не вважається пошуком", () => {
    // «junior» — це прикметник без іменника. Раніше профіль проходив як
    // осмислений, а потім кожна вакансія падала на offTopic −8 і onTopic
    // відсікав усе: добірка не приходила ніколи й нічого про це не казало.
    expect(hasSearchSignal({ spheres: [], customRole: "junior" })).toBe(false);
    expect(hasSearchSignal({ spheres: [], customRole: "senior" })).toBe(false);
    expect(hasSearchSignal({ spheres: [], customRole: "junior product manager" })).toBe(true);
    expect(hasSearchSignal({ spheres: ["product"], customRole: "junior" })).toBe(true);
  });
});
