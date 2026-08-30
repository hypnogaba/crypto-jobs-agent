/**
 * Читач тексту з PDF: рівно стільки формату, скільки треба, щоб прочитати
 * резюме. Без залежностей — усе працює у Воркері як є.
 *
 * Чому це не «дістати рядки в дужках».
 *
 * Так виглядав перший читач, і на справжніх резюме він не працював. У PDF
 * текст пишеться не літерами, а КОДАМИ ГЛІФІВ того шрифту, яким його
 * набрано, і майже кожен сучасний генератор (Canva, Figma, Google Docs,
 * Word) вшиває шрифт підмножиною з власною нумерацією. Рядок «CV Ivan
 * Ponyuk» лежить у файлі як <002600390003002C0059004400510003…>, і без
 * таблиці /ToUnicode цього шрифту він не значить нічого. Старий читач такі
 * рядки не бачив узагалі — він брав `(…)`, а туди в таких файлах потрапляють
 * лише службові уламки на кшталт «Adobe UCS». Тобто людина завантажувала
 * резюме, отримувала кількасот символів сміття, і воно ще й проходило
 * перевірку на довжину.
 *
 * Тому тут: покажчик обʼєктів (разом зі стисненими /ObjStm), обхід сторінок
 * заради їхніх шрифтів, розбір /ToUnicode і читання самих операторів тексту.
 *
 * Пробіли — окрема робота. Багато генераторів не пишуть пробіл узагалі: вони
 * ставлять кожен гліф своїм зсувом. Тому пробіл тут ВИВОДИТЬСЯ: береться
 * ширина попереднього гліфа з /Widths або /W і порівнюється з тим, наскільки
 * посунулась позиція. Без цього виходить «I v a n P o n y u k» — читабельно
 * для ока, але жодна регулярка словника такого не впізнає.
 */

/**
 * Зупинка, яку читач не має право проковтнути.
 *
 * `streamOf` навмисно не розрізняє стиснений потік і сирий: коли розпакування
 * падає, це просто нестиснений потік, і читання триває. Але стеля на розмір —
 * інша річ: її кидає той, хто дав `inflate`, і вона мусить дійти нагору, а не
 * перетворитись на «ну то читаємо як є».
 */
export class PdfAbort extends Error {}

/** Байт у символ один в один. Див. застереження в cv.ts про latin1. */
export const toBinaryString = (b: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < b.length; i += 8192) {
    out += String.fromCharCode(...b.subarray(i, i + 8192));
  }
  return out;
};

/** Шрифт: усе, що потрібно, щоб перетворити коди гліфів на текст. */
interface PdfFont {
  /** Код гліфа → символи. Порожня, коли в шрифта немає /ToUnicode. */
  uni: Map<number, string>;
  /** Код гліфа → ширина у власних одиницях шрифта. */
  width: Map<number, number>;
  defaultWidth: number;
  /**
   * Чим ширину множити, щоб дістати частку em.
   *
   * Для Type1, TrueType і складених шрифтів це завжди тисячні. Але Type3 —
   * а саме ним віддають резюме Canva, Figma й Google Docs — має власну
   * /FontMatrix, і там одиниця буває 1/2048. Ділити його ширини на тисячу —
   * це помилитись удвічі, а на цьому числі тримається рішення про пробіл:
   * виходило «I v a n P o n y u k» замість «Ivan Ponyuk».
   */
  scale: number;
  /** Скільки байтів на код: два для Identity-H, один для решти. */
  codeBytes: 1 | 2;
}

const EMPTY_FONT: PdfFont = { uni: new Map(), width: new Map(), defaultWidth: 500, codeBytes: 1, scale: 0.001 };

interface PdfObject {
  dict: string;
  /** Межі потоку В БАЙТАХ: рядковий проміжний крок спотворив би стиснене. */
  stream: [number, number] | null;
}

/** Скільки словника читаємо, коли обʼєкт не має ані потоку, ані кінця. */
const DICT_CAP = 64 * 1024;

/**
 * Значення ключа зі словника як сирий шматок тексту.
 *
 * Повертає `<<…>>`, `[…]`, `12 0 R`, `/Name` або число — тобто те, що далі
 * розбирає той, хто питав. Дужки рахуються, бо словник шрифта майже завжди
 * має вкладені.
 */
function value(dict: string, key: string): string | null {
  const at = new RegExp(`/${key}(?![A-Za-z0-9])`).exec(dict);
  if (!at) return null;
  let i = at.index + at[0].length;
  while (i < dict.length && /\s/.test(dict[i])) i++;

  if (dict.startsWith("<<", i)) {
    let depth = 0;
    for (let k = i; k < dict.length - 1; k++) {
      if (dict.startsWith("<<", k)) { depth++; k++; continue; }
      if (dict.startsWith(">>", k)) { depth--; k++; if (depth === 0) return dict.slice(i, k + 1); }
    }
    return null;
  }
  if (dict[i] === "[") {
    let depth = 0;
    for (let k = i; k < dict.length; k++) {
      if (dict[k] === "[") depth++;
      else if (dict[k] === "]" && --depth === 0) return dict.slice(i, k + 1);
    }
    return null;
  }
  return /^(\d+\s+\d+\s+R|\/[^\s/<>[\]()]+|-?[\d.]+|true|false|null)/.exec(dict.slice(i))?.[0] ?? null;
}

const refNumber = (v: string | null): number | null => {
  const m = v && /^(\d+)\s+\d+\s+R$/.exec(v.trim());
  return m ? Number(m[1]) : null;
};

/** Усі посилання `n 0 R` у шматку — для /Contents і /DescendantFonts. */
const refsIn = (v: string): number[] => [...v.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));

/**
 * Покажчик обʼєктів файлу.
 *
 * Таблиця xref навмисно не читається: вона буває і зламана, і в кількох
 * версіях, а нам однаково потрібні ВСІ обʼєкти, не якась одна ревізія.
 */
export class Pdf {
  private objs = new Map<number, PdfObject>();
  private cache = new Map<number, Uint8Array | null>();

  constructor(private bytes: Uint8Array, private bin: string,
              private inflate: (slice: Uint8Array) => Promise<Uint8Array>) {}

  static async open(bytes: Uint8Array, inflate: (slice: Uint8Array) => Promise<Uint8Array>): Promise<Pdf> {
    const pdf = new Pdf(bytes, toBinaryString(bytes), inflate);
    pdf.index();
    await pdf.indexObjectStreams();
    return pdf;
  }

  /** Прямі обʼєкти: `12 0 obj … endobj`. */
  private index(): void {
    for (const m of this.bin.matchAll(/(\d+)\s+\d+\s+obj\b/g)) {
      const num = Number(m[1]);
      const start = m.index + m[0].length;
      const sAt = this.bin.indexOf("stream", start);
      const eAt = this.bin.indexOf("endobj", start);

      if (sAt !== -1 && (eAt === -1 || sAt < eAt)) {
        let s = sAt + 6;
        if (this.bin.charCodeAt(s) === 0x0d) s++;
        if (this.bin.charCodeAt(s) === 0x0a) s++;
        const close = this.bin.indexOf("endstream", s);
        if (close === -1) continue;
        let end = close;
        if (this.bytes[end - 1] === 0x0a) end--;
        if (this.bytes[end - 1] === 0x0d) end--;
        this.objs.set(num, { dict: this.bin.slice(start, sAt), stream: [s, end] });
      } else {
        this.objs.set(num, { dict: this.bin.slice(start, eAt === -1 ? start + DICT_CAP : eAt), stream: null });
      }
    }
  }

  /**
   * Обʼєкти всередині /ObjStm.
   *
   * Від PDF 1.5 словники сторінок і шрифтів зазвичай лежать не у файлі, а
   * стисненими всередині одного потоку. Без цього кроку у файлі з Word чи
   * LaTeX не знаходиться ЖОДНОГО шрифта, і читач мовчки віддає порожнечу.
   */
  private async indexObjectStreams(): Promise<void> {
    for (const [, obj] of [...this.objs]) {
      if (!obj.stream || !/\/Type\s*\/ObjStm\b/.test(obj.dict)) continue;
      const first = Number(value(obj.dict, "First") ?? NaN);
      if (!Number.isFinite(first)) continue;
      const body = await this.streamOf(obj);
      if (!body) continue;

      const text = toBinaryString(body);
      const header = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < header.length; i += 2) {
        const num = header[i], off = header[i + 1];
        if (this.objs.has(num) || !Number.isFinite(num) || !Number.isFinite(off)) continue;
        const end = i + 3 < header.length ? first + header[i + 3] : text.length;
        this.objs.set(num, { dict: text.slice(first + off, end), stream: null });
      }
    }
  }

  private async streamOf(obj: PdfObject): Promise<Uint8Array | null> {
    if (!obj.stream) return null;
    const slice = this.bytes.slice(obj.stream[0], obj.stream[1]);
    // Нестиснений потік — теж потік: DecompressionStream на ньому падає, і це
    // не помилка файлу.
    try {
      return await this.inflate(slice);
    } catch (e) {
      if (e instanceof PdfAbort) throw e;
      return slice;
    }
  }

  dict(num: number): string | null { return this.objs.get(num)?.dict ?? null; }

  async stream(num: number): Promise<Uint8Array | null> {
    if (this.cache.has(num)) return this.cache.get(num) ?? null;
    const obj = this.objs.get(num);
    const out = obj ? await this.streamOf(obj) : null;
    this.cache.set(num, out);
    return out;
  }

  /** Значення, яке могло бути і на місці, і посиланням. */
  resolve(v: string | null): string | null {
    if (!v) return null;
    const ref = refNumber(v);
    return ref === null ? v : this.dict(ref);
  }

  entries(): Array<[number, PdfObject]> { return [...this.objs]; }
}

/** Таблиця /ToUnicode: код гліфа → символи. */
function parseCMap(text: string): { uni: Map<number, string>; codeBytes: 1 | 2 } {
  const uni = new Map<number, string>();
  let codeBytes: 1 | 2 = 2;

  const space = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  const first = space && /<([0-9a-fA-F]+)>/.exec(space[1]);
  if (first) codeBytes = first[1].length <= 2 ? 1 : 2;

  /** Значення в CMap — це UTF-16BE, і сурогатна пара тут звичайна річ. */
  const chars = (hex: string): string => {
    let out = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g))
      uni.set(parseInt(pair[1], 16), chars(pair[2]));

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const row of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([\s\S]*?)\])/g)) {
      const lo = parseInt(row[1], 16), hi = parseInt(row[2], 16);
      if (row[3] !== undefined) {
        // Діапазон від одного значення: кожен наступний код на одиницю далі.
        const base = row[3];
        for (let code = lo; code <= hi && code - lo < 0x10000; code++) {
          const tail = (parseInt(base.slice(-4), 16) + (code - lo)).toString(16).padStart(4, "0");
          uni.set(code, chars(base.slice(0, -4) + tail));
        }
      } else {
        let i = 0;
        for (const one of row[4].matchAll(/<([0-9a-fA-F]*)>/g)) uni.set(lo + i++, chars(one[1]));
      }
    }

  return { uni, codeBytes };
}

/** /Widths простого шрифта: ширини підряд, починаючи з /FirstChar. */
function simpleWidths(pdf: Pdf, dict: string): Map<number, number> {
  const out = new Map<number, number>();
  const listRaw = pdf.resolve(value(dict, "Widths"));
  const first = Number(value(dict, "FirstChar") ?? NaN);
  if (!listRaw || !Number.isFinite(first)) return out;
  const list = listRaw.replace(/[[\]]/g, " ").trim().split(/\s+/).map(Number);
  list.forEach((w, i) => { if (Number.isFinite(w)) out.set(first + i, w); });
  return out;
}

/** /W складеного шрифта: `[ 3 [200 300] 7 9 250 ]` — обидві форми запису. */
function cidWidths(raw: string): Map<number, number> {
  const out = new Map<number, number>();
  const tokens = raw.replace(/\[/g, " [ ").replace(/\]/g, " ] ").trim().split(/\s+/);
  let i = 1;   // перший токен — сама відкривна дужка /W
  while (i < tokens.length) {
    const start = Number(tokens[i]);
    if (!Number.isFinite(start)) { i++; continue; }
    if (tokens[i + 1] === "[") {
      let k = i + 2, code = start;
      while (k < tokens.length && tokens[k] !== "]") out.set(code++, Number(tokens[k++]));
      i = k + 1;
    } else {
      const end = Number(tokens[i + 1]), w = Number(tokens[i + 2]);
      if (Number.isFinite(end) && Number.isFinite(w) && end - start < 0x10000)
        for (let code = start; code <= end; code++) out.set(code, w);
      i += 3;
    }
  }
  return out;
}

async function readFont(pdf: Pdf, dict: string): Promise<PdfFont> {
  const isType0 = /\/Subtype\s*\/Type0\b/.test(dict);
  let uni = new Map<number, string>();
  let codeBytes: 1 | 2 = isType0 ? 2 : 1;

  const toUnicode = refNumber(value(dict, "ToUnicode"));
  if (toUnicode !== null) {
    const body = await pdf.stream(toUnicode);
    if (body) {
      const parsed = parseCMap(toBinaryString(body));
      uni = parsed.uni;
      // Заявлене шрифтом важить більше за здогад із CMap: Identity-H — завжди
      // два байти, хай там що написано в codespacerange.
      if (!isType0) codeBytes = parsed.codeBytes;
    }
  }

  if (!isType0) {
    // /FontMatrix є лише в Type3, і саме там одиниця не тисячна.
    const matrix = value(dict, "FontMatrix");
    const a = matrix ? Number(matrix.replace(/[[\]]/g, " ").trim().split(/\s+/)[0]) : NaN;
    const scale = Number.isFinite(a) && a > 0 ? a : 0.001;
    return { uni, width: simpleWidths(pdf, dict), defaultWidth: 0.5 / scale, codeBytes, scale };
  }

  const child = refsIn(value(dict, "DescendantFonts") ?? "")[0];
  const childDict = child === undefined ? null : pdf.dict(child);
  const w = childDict && pdf.resolve(value(childDict, "W"));
  return {
    uni,
    width: w ? cidWidths(w) : new Map(),
    defaultWidth: Number(childDict && value(childDict, "DW")) || 1000,
    codeBytes,
    scale: 0.001,
  };
}

/** Словник /Font із ресурсів: імʼя в потоці → шрифт. */
async function fontsOf(pdf: Pdf, resources: string | null): Promise<Map<string, PdfFont>> {
  const out = new Map<string, PdfFont>();
  const fonts = resources && pdf.resolve(value(resources, "Font"));
  if (!fonts) return out;
  for (const entry of fonts.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const dict = pdf.dict(Number(entry[2]));
    if (dict) out.set(entry[1], await readFont(pdf, dict));
  }
  return out;
}

// ── Читання самого потоку ───────────────────────────────────────────────

type Token = number | string | { name: string } | { op: string } | Token[];

const DELIM = new Set([..."()<>[]{}/%"]);

/** Розбір потоку на числа, рядки, імена й оператори. */
function* tokens(s: string): Generator<Token> {
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === "%") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (/\s/.test(c)) { i++; continue; }

    if (c === "(") {
      let depth = 1, out = "";
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "\\") {
          const next = s[i + 1];
          const octal = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
          if (octal) { out += String.fromCharCode(parseInt(octal[0], 8)); i += 1 + octal[0].length; continue; }
          out += ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next ?? "";
          i += 2; continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")" && --depth === 0) { i++; break; }
        out += ch;
        i++;
      }
      yield out;
      continue;
    }

    if (c === "<" && s[i + 1] === "<") { yield { op: "<<" }; i += 2; continue; }
    if (c === ">" && s[i + 1] === ">") { yield { op: ">>" }; i += 2; continue; }

    if (c === "<") {
      const close = s.indexOf(">", i);
      const hex = s.slice(i + 1, close === -1 ? s.length : close).replace(/[^0-9a-fA-F]/g, "");
      let out = "";
      // Шістнадцятковий рядок — це БАЙТИ. У символи їх складе шрифт, не ми.
      for (let k = 0; k + 2 <= hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      if (hex.length % 2) out += String.fromCharCode(parseInt(hex.slice(-1) + "0", 16));
      yield out;
      i = close === -1 ? s.length : close + 1;
      continue;
    }

    if (c === "[" || c === "]") { yield { op: c }; i++; continue; }

    if (c === "/") {
      let k = i + 1;
      while (k < s.length && !DELIM.has(s[k]) && !/\s/.test(s[k])) k++;
      yield { name: s.slice(i + 1, k) };
      i = k;
      continue;
    }

    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) { yield Number(num[0]); i += num[0].length; continue; }

    let k = i;
    while (k < s.length && !DELIM.has(s[k]) && !/\s/.test(s[k])) k++;
    if (k === i) { i++; continue; }
    yield { op: s.slice(i, k) };
    i = k;
  }
}

const isOp = (t: Token): t is { op: string } => typeof t === "object" && t !== null && "op" in t;
const isName = (t: Token): t is { name: string } => typeof t === "object" && t !== null && "name" in t;

/**
 * Текст одного потоку.
 *
 * Пробіл ставиться там, де позиція стрибнула далі, ніж займав попередній
 * гліф; новий рядок — там, де змінилась вертикаль. Через це читаються і
 * файли, де кожна літера має власний зсув, і файли зі звичайними рядками.
 */
function renderStream(content: string, fonts: Map<string, PdfFont>): string {
  const out: string[] = [];
  let stack: Token[] = [];
  let font = EMPTY_FONT, size = 12, leading = 0;

  /**
   * Дві позиції, а не одна.
   *
   * `Td` рухає ПОЧАТОК РЯДКА, а не перо: його зсув відлічується від того
   * місця, де рядок почався, і вже містить у собі ширину показаного гліфа.
   * Якщо додавати його до пера, ширина зараховується двічі — і кожен
   * проміжок між літерами виглядає як пробіл. Саме так з'являлось
   * «I v a n P o n y u k».
   */
  let lineX = 0, lineY = 0;
  let penX = 0, penY = 0;
  /** Де скінчився попередній показаний шматок: з ним і порівнюємо. */
  let lastX = 0, lastY = 0, shown = false;

  const advanceOf = (codes: number[]): number =>
    codes.reduce((sum, c) => sum + (font.width.get(c) ?? font.defaultWidth), 0) * font.scale * size;

  const decode = (raw: string): { text: string; codes: number[] } => {
    const codes: number[] = [];
    for (let i = 0; i + font.codeBytes <= raw.length; i += font.codeBytes)
      codes.push(font.codeBytes === 2 ? (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1) : raw.charCodeAt(i));
    const text = codes.map((c) => font.uni.get(c) ?? (font.uni.size ? "" : String.fromCharCode(c))).join("");
    return { text, codes };
  };

  /** Новий рядок: перо повертається на його початок. */
  const startLine = (dx: number, dy: number): void => {
    lineX += dx; lineY += dy;
    penX = lineX; penY = lineY;
  };

  const show = (raw: string): void => {
    const { text, codes } = decode(raw);
    if (shown) {
      if (penY !== lastY) out.push("\n");
      else if (penX - lastX > 0.18 * size) out.push(" ");
    }
    shown = true;
    out.push(text);
    penX += advanceOf(codes);
    lastX = penX; lastY = penY;
  };

  for (const token of tokens(content)) {
    if (!isOp(token)) { stack.push(token); continue; }
    const op = token.op;
    const num = (k: number): number => { const v = stack[stack.length - k]; return typeof v === "number" ? v : 0; };
    const str = (k: number): string | null => {
      const v = stack[stack.length - k];
      return typeof v === "string" ? v : null;
    };

    switch (op) {
      case "[": stack.push({ op: "[" }); continue;
      case "]": {
        const arr: Token[] = [];
        while (stack.length && !(isOp(stack[stack.length - 1]) && (stack[stack.length - 1] as { op: string }).op === "["))
          arr.unshift(stack.pop() as Token);
        stack.pop();
        stack.push(arr);
        continue;
      }
      case "Tf": {
        const name = stack[stack.length - 2];
        font = (isName(name) && fonts.get(name.name)) || EMPTY_FONT;
        size = num(1) || 12;
        break;
      }
      case "TL": leading = num(1); break;
      case "Td": startLine(num(2), num(1)); break;
      case "TD": leading = -num(1); startLine(num(2), num(1)); break;
      case "T*": startLine(0, -leading); break;
      case "Tm": lineX = num(2); lineY = num(1); penX = lineX; penY = lineY; break;
      case "BT": lineX = lineY = penX = penY = 0; break;
      case "Tj": { const v = str(1); if (v !== null) show(v); break; }
      case "'": { startLine(0, -leading); const v = str(1); if (v !== null) show(v); break; }
      case '"': { startLine(0, -leading); const v = str(1); if (v !== null) show(v); break; }
      case "TJ": {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) for (const part of arr) {
          if (typeof part === "string") show(part);
          // Число в масиві — зсув назад у тисячних одиниці тексту. Саме ним
          // більшість генераторів і робить пробіл між словами.
          else if (typeof part === "number") penX -= part / 1000 * size;
        }
        break;
      }
    }
    stack = [];
  }

  return out.join("");
}

/** Ресурси сторінки: власні або успадковані від /Pages. */
function resourcesOf(pdf: Pdf, dict: string, depth = 0): string | null {
  const own = pdf.resolve(value(dict, "Resources"));
  if (own || depth > 8) return own;
  const parent = refNumber(value(dict, "Parent"));
  const parentDict = parent === null ? null : pdf.dict(parent);
  return parentDict ? resourcesOf(pdf, parentDict, depth + 1) : null;
}

/**
 * Текст усього документа.
 *
 * Сторінками, а не потоками поспіль: імена шрифтів (`/F4`) живуть у ресурсах
 * СТОРІНКИ, і на різних сторінках те саме імʼя буває різним шрифтом. Читати
 * потоки без прив'язки до ресурсів — значить іноді розкодувати текст чужою
 * таблицею й отримати правдоподібне сміття.
 */
export async function readPdfText(bytes: Uint8Array,
                                  inflate: (slice: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  const pdf = await Pdf.open(bytes, inflate);
  const parts: string[] = [];

  for (const [, obj] of pdf.entries()) {
    if (!/\/Type\s*\/Page(?![a-zA-Z])/.test(obj.dict)) continue;
    const resources = resourcesOf(pdf, obj.dict);
    const fonts = await fontsOf(pdf, resources);

    for (const num of refsIn(value(obj.dict, "Contents") ?? "")) {
      const body = await pdf.stream(num);
      if (body) parts.push(renderStream(toBinaryString(body), fonts));
    }

    // Форми з /XObject: у них лежить текст із Figma, Canva й іншої верстки.
    const xobjects = resources && pdf.resolve(value(resources, "XObject"));
    if (!xobjects) continue;
    for (const entry of xobjects.matchAll(/\/[^\s/<>[\]()]+\s+(\d+)\s+\d+\s+R/g)) {
      const num = Number(entry[1]);
      const dict = pdf.dict(num);
      if (!dict || !/\/Subtype\s*\/Form\b/.test(dict)) continue;
      const body = await pdf.stream(num);
      if (!body) continue;
      const formFonts = await fontsOf(pdf, resourcesOf(pdf, dict) ?? resources);
      parts.push(renderStream(toBinaryString(body), formFonts.size ? formFonts : fonts));
    }
  }

  return parts.join("\n");
}
