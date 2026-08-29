/**
 * Країна людини.
 *
 * Окремого питання «з якої ти країни» немає й не буде: ще одне питання в
 * онбордингу коштує більше, ніж дає. Країну виводимо з того, що вже є.
 *
 * Порядок сигналів навмисний:
 *   1. локація, яку людина написала сама — найточніше;
 *   2. часовий пояс — його збирає браузер на сайті, і він лежав у базі
 *      невикористаний із самого початку;
 *   3. нічого — тоді країни немає й людина бачить лише глобальні вакансії.
 *
 * Третій випадок не є помилкою. Здогадуватись за мовою інтерфейсу було б
 * гірше: українською читають і в Польщі, і в Канаді.
 */

/** Розкладка ЙЦУКЕН поверх QWERTY — літера під тією самою клавішею. */
const LAYOUT: Record<string, string> = {
  й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p",
  ф: "a", і: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k", д: "l", ж: ";",
  я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m",
  ы: "s", э: "'", ъ: "]", ё: "`",
};

/**
 * Локація, набрана в неправильній розкладці.
 *
 * У базі лежить профіль із локацією «зфкши». Це «paris», надруковане, поки
 * стояла кирилиця. Ми зберегли сміття й нічого не помітили — тому переклад
 * робимо мовчки, але лише коли він дає щось осмислене.
 *
 * Повертає переклад тільки якщо рядок цілком кириличний І результат
 * упізнається як місце. Інакше — вхідний рядок без змін: справжня кирилична
 * назва («Київ») мусить лишитись собою.
 */
export function fixLayout(text: string): string {
  const t = text.trim();
  if (!t || !/^[а-яіїєґьёъыэ\s,.-]+$/i.test(t)) return text;

  const swapped = [...t.toLowerCase()].map((c) => LAYOUT[c] ?? c).join("");
  return countryFromLocation(swapped) ? swapped : text;
}

/**
 * Пояс → країна.
 *
 * Свідомо неповна: тут лише країни, для яких у нас є або незабаром буде
 * національна дошка. Пояс, якого немає в списку, дає порожню країну, і це
 * правильна відповідь, а не пропуск.
 */
const TZ_COUNTRY: Record<string, string> = {
  "Europe/Kyiv": "UA", "Europe/Kiev": "UA", "Europe/Uzhgorod": "UA", "Europe/Zaporozhye": "UA",
  "Europe/Paris": "FR",
  "Europe/Warsaw": "PL",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Lisbon": "PT",
  "Europe/Amsterdam": "NL",
  "Europe/Prague": "CZ",
  "Europe/Bucharest": "RO",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
};

/**
 * Межа слова, яка працює з кирилицею.
 *
 * `\b` рахує межу лише по латиниці, тож `/\bкиїв\b/` не збігається ніколи —
 * перша ж перевірка це показала. Заміна дивиться на будь-яку літеру Unicode.
 */
const word = (alts: string) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, "iu");

/**
 * Написана локація → країна.
 *
 * Не географічний довідник, а список того, що люди пишуть насправді: назва
 * країни кількома мовами й найбільші міста. Не впізнали — порожньо.
 */
const PLACES: Array<[string, RegExp]> = [
  ["UA", word("ukraine|ukraina|україна|украина|kyiv|kiev|київ|киев|lviv|львів|львов|kharkiv|харків|odesa|odessa|одеса|dnipro|дніпро")],
  ["FR", word("france|франція|франция|paris|париж|lyon|ліон|marseille|марсель|toulouse|bordeaux|nantes|lille|nice")],
  ["PL", word("poland|polska|польща|польша|warsaw|warszawa|варшава|krakow|kraków|краків|wroclaw|wrocław|gdansk|gdańsk|poznan")],
  ["DE", word("germany|deutschland|німеччина|германия|berlin|берлін|берлин|munich|münchen|мюнхен|hamburg|frankfurt|cologne|köln")],
  ["ES", word("spain|españa|espana|іспанія|испания|madrid|мадрид|barcelona|барселона|valencia|seville|sevilla")],
  ["IT", word("italy|italia|італія|италия|rome|roma|рим|milan|milano|мілан|милан|turin|torino|naples|napoli")],
  ["PT", word("portugal|португалія|португалия|lisbon|lisboa|лісабон|лиссабон|porto|oporto|порту")],
  ["NL", word("netherlands|nederland|нідерланди|нидерланды|holland|amsterdam|амстердам|rotterdam|utrecht|eindhoven")],
  ["CZ", word("czechia|czech|чехія|чехия|prague|praha|прага|brno|брно|ostrava")],
  ["RO", word("romania|românia|румунія|румыния|bucharest|bucurești|бухарест|cluj|timisoara|timișoara|iasi|iași")],
  ["GB", word("uk|united kingdom|britain|британія|британия|англія|англия|london|лондон|manchester|edinburgh|bristol|glasgow|leeds")],
  ["IE", word("ireland|ірландія|ирландия|dublin|дублін|дублин|cork|galway")],
];

/** Країна з написаної локації, або null. */
export function countryFromLocation(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  for (const [code, re] of PLACES) if (re.test(text)) return code;
  return null;
}

/** Країна з часового поясу, або null. */
export function countryFromTimezone(tz: string | null | undefined): string | null {
  return (tz && TZ_COUNTRY[tz]) ?? null;
}

/**
 * Підсумковий вивід країни.
 *
 * Тільки з того, що людина СКАЗАЛА у відповідь на «Де хочеш працювати?».
 * Часовий пояс сюди більше не входить, хоч раніше й був запасним сигналом.
 *
 * Причина: країна тут вирішує, чи показувати національні дошки, а це
 * питання наміру, а не місця перебування. Українець, який шукає віддалену
 * роботу будь-де, не просив вакансій із DOU — і пояс не має вирішувати за
 * нього. Так само розробник у відрядженні до Варшави не стає поляком.
 *
 * Пояс лишається у системі, але відповідає лише за одне: КОЛИ надсилати
 * добірку. Дві різні речі, які раніше були сплутані в одну.
 */
export function deriveCountry(
  location: string | null | undefined,
  _timezone?: string | null,
): string | null {
  return countryFromLocation(location ? fixLayout(location) : null);
}
