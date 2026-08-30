/**
 * Локація вакансії -> країни, яких вона стосується.
 *
 * Навіщо. Підбір досі порівнював написане людиною з написаним джерелом як
 * два рядки: `"Illinois".includes("париж")`. Збігу не було ніколи, а
 * розбіжність не коштувала нічого — тож людині в Парижі вакансія в
 * Іллінойсі йшла нарівні з вакансією у Фрайбурзі.
 *
 * Правило точності тут одне й воно несиметричне: **краще не знати, ніж
 * знати неправильно**. Невідома країна не карається й не нагороджується.
 * Тому в таблицях лише те, що не має другого читання: «Georgia» сюди не
 * входить (штат і країна), «Brisbane» теж (Австралія і Каліфорнія).
 *
 * Таблиці зібрані з живого кеша, а не з голови: див. `places.coverage.ts`,
 * який рахує, який відсоток справжніх рядків розбирається.
 */

/** Країни, що трапляються в кеші. Ключ — те, що пишуть джерела. */
const COUNTRY_WORDS: Array<[string, string[]]> = [
  // «us» і «uk» — це слова, але в полі локації вони мають одне читання, і саме
  // ними джерела пишуть 200+ рядків: «Remote - US», «US Remote», «UK».
  ["US", ["united states", "usa", "u.s.a.", "u.s.", "america", "us", "u s"]],
  ["CA", ["canada"]],
  ["RU", ["russia", "russian federation"]],
  ["BD", ["bangladesh"]],
  ["BB", ["barbados"]],
  ["CI", ["cote d ivoire", "cote divoire", "ivory coast"]],
  ["IQ", ["iraq"]],
  ["LB", ["lebanon"]],
  ["GB", ["united kingdom", "great britain", "england", "scotland", "wales", "northern ireland", "uk", "u k"]],
  ["IE", ["ireland"]],
  ["DE", ["germany", "deutschland", "німеччина"]],
  ["FR", ["france"]],
  ["ES", ["spain", "espana", "españa"]],
  ["PT", ["portugal"]],
  ["IT", ["italy", "italia"]],
  ["NL", ["netherlands", "nederland", "holland"]],
  ["BE", ["belgium", "belgique", "belgie", "belgië"]],
  ["CH", ["switzerland", "schweiz", "suisse"]],
  ["AT", ["austria", "osterreich", "österreich"]],
  ["PL", ["poland", "polska", "польща", "польша"]],
  ["CZ", ["czechia", "czech republic"]],
  ["SK", ["slovakia"]],
  ["HU", ["hungary"]],
  ["RO", ["romania"]],
  ["BG", ["bulgaria"]],
  ["UA", ["ukraine", "україна", "украина"]],
  ["SE", ["sweden", "sverige"]],
  ["NO", ["norway", "norge"]],
  ["DK", ["denmark", "danmark"]],
  ["FI", ["finland", "suomi"]],
  ["EE", ["estonia"]],
  ["LV", ["latvia"]],
  ["LT", ["lithuania"]],
  ["GR", ["greece"]],
  ["HR", ["croatia"]],
  ["SI", ["slovenia"]],
  ["RS", ["serbia"]],
  ["TR", ["turkey", "turkiye", "türkiye"]],
  ["IL", ["israel"]],
  ["AE", ["united arab emirates", "uae"]],
  ["SA", ["saudi arabia"]],
  ["IN", ["india"]],
  ["SG", ["singapore"]],
  ["JP", ["japan"]],
  ["KR", ["south korea", "korea, republic of"]],
  ["CN", ["china"]],
  ["HK", ["hong kong"]],
  ["TW", ["taiwan"]],
  ["AU", ["australia"]],
  ["NZ", ["new zealand"]],
  ["BR", ["brazil", "brasil"]],
  ["MX", ["mexico", "méxico"]],
  ["AR", ["argentina"]],
  ["CL", ["chile"]],
  ["CO", ["colombia"]],
  ["ZA", ["south africa"]],
  ["NG", ["nigeria"]],
  ["KE", ["kenya"]],
  ["EG", ["egypt"]],
  ["PH", ["philippines"]],
  ["ID", ["indonesia"]],
  ["VN", ["vietnam"]],
  ["TH", ["thailand"]],
  ["MY", ["malaysia"]],
  ["PK", ["pakistan"]],
  ["TN", ["tunisia"]],
  ["AM", ["armenia"]],
  ["KZ", ["kazakhstan"]],
  ["MA", ["morocco", "maroc"]],
  ["CR", ["costa rica"]],
  ["LU", ["luxembourg"]],
  ["CY", ["cyprus"]],
  ["GE", ["georgia (country)"]],   // саме «Georgia» не беремо: це ще й штат
  ["RS", ["kosovo"]],
];

/**
 * Штати США повними назвами.
 *
 * «Georgia» свідомо відсутня: це і штат, і країна, а помилка тут дорожча за
 * пропуск. «Washington» лишається — округ Колумбія й штат обидва США.
 */
const US_STATE_WORDS = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas",
  "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
];

/**
 * Дволітерні коди штатів.
 *
 * Половина з них — водночас коди країн: DE це Делавер і Німеччина, CA це
 * Каліфорнія і Канада, IN це Індіана й Індія. Саме тому цей рівень читається
 * ОСТАННІМ, коли ні країни, ні міста в рядку не знайшлося.
 */
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "GA",
]);

/** Коди провінцій Канади. Жоден із них не є кодом штату США, тож плутанини немає. */
/**
 * Провінції словами, а не лише кодами.
 *
 * «Kitchener, Ontario», «Saskatoon, Saskatchewan», «Oakville, Ontario» —
 * у кеші таких рядків десятки, і жоден не читався: коди ON і SK тут є, а
 * повних назв не було. Штати США словами в цьому файлі вже є, тож це просто
 * та сама повнота для другої країни.
 *
 * «Ontario» — це ще й містечко в Каліфорнії, але в полі локації вакансії
 * читання «провінція» переважає настільки, що зворотний випадок можна
 * вважати шумом. Для порівняння: «Brisbane» і «Cambridge» лишаються поза
 * словником саме тому, що там обидва читання однаково живі.
 */
const CA_PROVINCE_WORDS = [
  "ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan",
  "nova scotia", "new brunswick", "newfoundland", "prince edward island",
];

const CA_PROVINCE_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "YT",
]);

/**
 * Міста, назва яких читається однозначно.
 *
 * Тут немає «Brisbane» (Квінсленд і Каліфорнія), «Birmingham» (Англія і
 * Алабама), «Cambridge» (Англія і Массачусетс), «Richmond», «Columbus».
 * Кожне таке місто — це саме той випадок, коли краще не знати.
 */
const CITY_COUNTRY: Record<string, string> = {
  "san francisco": "US", "new york": "US", "new york city": "US", "brooklyn": "US",
  "los angeles": "US", "san jose": "US", "san diego": "US", "seattle": "US",
  "chicago": "US", "boston": "US", "austin": "US", "denver": "US", "atlanta": "US",
  "houston": "US", "dallas": "US", "philadelphia": "US", "phoenix": "US",
  "minneapolis": "US", "pittsburgh": "US", "baltimore": "US", "detroit": "US",
  "miami": "US", "nashville": "US", "salt lake city": "US", "palo alto": "US",
  "mountain view": "US", "menlo park": "US", "sunnyvale": "US", "santa clara": "US",
  "san mateo": "US", "redwood city": "US", "cupertino": "US", "bellevue": "US",
  "redmond": "US", "el segundo": "US", "long beach": "US", "santa monica": "US",
  "costa mesa": "US", "torrance": "US", "irvine": "US", "sacramento": "US",
  "las vegas": "US", "portland": "US", "raleigh": "US", "charlotte": "US",
  "washington dc": "US", "somerville": "US", "hawthorne": "US", "st. louis": "US",
  "kansas city": "US", "indianapolis": "US", "columbus": "US", "milwaukee": "US",
  "tampa": "US", "orlando": "US", "san antonio": "US", "fort worth": "US",
  "nyc": "US", "sf": "US", "bay area": "US", "sf bay area": "US", "silicon valley": "US",
  "alameda": "US", "sausalito": "US", "pleasanton": "US", "lehi": "US",
  "scotts valley": "US", "arvada": "US", "boulder": "US", "ann arbor": "US",

  "toronto": "CA", "vancouver": "CA", "montreal": "CA", "montréal": "CA",
  "ottawa": "CA", "calgary": "CA", "edmonton": "CA", "waterloo": "CA", "mississauga": "CA",

  "london": "GB", "manchester": "GB", "edinburgh": "GB", "glasgow": "GB",
  "bristol": "GB", "leeds": "GB", "belfast": "GB", "oxford": "GB",

  "dublin": "IE", "cork": "IE", "galway": "IE",

  "berlin": "DE", "münchen": "DE", "munich": "DE", "hamburg": "DE", "frankfurt": "DE",
  "köln": "DE", "cologne": "DE", "stuttgart": "DE", "düsseldorf": "DE", "dusseldorf": "DE",
  "leipzig": "DE", "dresden": "DE", "nürnberg": "DE", "nuremberg": "DE", "freiburg": "DE",
  "karlsruhe": "DE", "regensburg": "DE", "bonn": "DE", "hannover": "DE",
  "mainz": "DE", "essen": "DE", "bremen": "DE", "münster": "DE", "aachen": "DE",
  "bochum": "DE", "dortmund": "DE", "wiesbaden": "DE", "heidelberg": "DE",

  "paris": "FR", "lyon": "FR", "marseille": "FR", "toulouse": "FR", "bordeaux": "FR",
  "nantes": "FR", "lille": "FR", "montpellier": "FR", "strasbourg": "FR", "rennes": "FR",
  "sophia antipolis": "FR",

  "madrid": "ES", "barcelona": "ES", "valencia": "ES", "sevilla": "ES", "seville": "ES",
  "bilbao": "ES", "malaga": "ES", "málaga": "ES", "zaragoza": "ES",

  "lisbon": "PT", "lisboa": "PT", "porto": "PT", "braga": "PT",

  "rome": "IT", "roma": "IT", "milan": "IT", "milano": "IT", "turin": "IT",
  "torino": "IT", "naples": "IT", "napoli": "IT", "bologna": "IT",

  "amsterdam": "NL", "rotterdam": "NL", "utrecht": "NL", "eindhoven": "NL",
  "the hague": "NL", "den haag": "NL", "delft": "NL",

  "brussels": "BE", "bruxelles": "BE", "antwerp": "BE", "ghent": "BE", "leuven": "BE",

  "zurich": "CH", "zürich": "CH", "geneva": "CH", "genève": "CH", "basel": "CH",
  "lausanne": "CH", "lugano": "CH", "zug": "CH",

  "vienna": "AT", "wien": "AT", "graz": "AT", "linz": "AT", "salzburg": "AT",

  "warsaw": "PL", "warszawa": "PL", "krakow": "PL", "kraków": "PL", "cracow": "PL",
  "wroclaw": "PL", "wrocław": "PL", "gdansk": "PL", "gdańsk": "PL", "poznan": "PL",
  "poznań": "PL", "katowice": "PL", "lodz": "PL", "łódź": "PL",

  "prague": "CZ", "praha": "CZ", "brno": "CZ", "ostrava": "CZ",
  "bratislava": "SK", "kosice": "SK",
  "budapest": "HU", "debrecen": "HU",
  "bucharest": "RO", "bucurești": "RO", "cluj": "RO", "cluj-napoca": "RO",
  "timisoara": "RO", "timișoara": "RO", "iasi": "RO", "iași": "RO",
  "sofia": "BG", "plovdiv": "BG", "varna": "BG",

  "kyiv": "UA", "kiev": "UA", "київ": "UA", "lviv": "UA", "львів": "UA",
  "kharkiv": "UA", "харків": "UA", "odesa": "UA", "odessa": "UA", "одеса": "UA",
  "dnipro": "UA", "дніпро": "UA", "vinnytsia": "UA", "вінниця": "UA",
  "запоріжжя": "UA", "zaporizhzhia": "UA", "івано-франківськ": "UA", "тернопіль": "UA",
  "чернівці": "UA", "ужгород": "UA", "луцьк": "UA", "житомир": "UA", "полтава": "UA",
  "варшава": "PL", "краків": "PL", "вроцлав": "PL", "берлін": "DE", "прага": "CZ",

  "stockholm": "SE", "gothenburg": "SE", "göteborg": "SE", "malmo": "SE", "malmö": "SE",
  "oslo": "NO", "bergen": "NO", "trondheim": "NO",
  "copenhagen": "DK", "københavn": "DK", "aarhus": "DK",
  "helsinki": "FI", "espoo": "FI", "tampere": "FI",
  "tallinn": "EE", "tartu": "EE",
  "riga": "LV", "vilnius": "LT", "kaunas": "LT",
  "athens": "GR", "thessaloniki": "GR",
  "zagreb": "HR", "ljubljana": "SI", "belgrade": "RS", "beograd": "RS",
  "istanbul": "TR", "ankara": "TR", "izmir": "TR",

  "tel aviv": "IL", "tel aviv-yafo": "IL", "jerusalem": "IL", "haifa": "IL", "herzliya": "IL",
  "dubai": "AE", "abu dhabi": "AE", "riyadh": "SA",

  "bangalore": "IN", "bengaluru": "IN", "hyderabad": "IN", "mumbai": "IN",
  "pune": "IN", "chennai": "IN", "gurgaon": "IN", "gurugram": "IN", "noida": "IN",
  "new delhi": "IN", "kolkata": "IN", "ahmedabad": "IN",

  "tokyo": "JP", "osaka": "JP", "kyoto": "JP",
  "seoul": "KR", "busan": "KR",
  "shanghai": "CN", "beijing": "CN", "shenzhen": "CN", "guangzhou": "CN",
  "taipei": "TW",

  "sydney": "AU", "melbourne": "AU", "perth": "AU", "adelaide": "AU", "canberra": "AU",
  "new south wales": "AU", "queensland": "AU",
  "auckland": "NZ", "wellington": "NZ",

  "sao paulo": "BR", "são paulo": "BR", "rio de janeiro": "BR", "belo horizonte": "BR",
  "mexico city": "MX", "guadalajara": "MX", "monterrey": "MX",
  "buenos aires": "AR", "cordoba": "AR",
  "santiago": "CL", "bogota": "CO", "bogotá": "CO", "medellin": "CO", "medellín": "CO",
  "lima": "PE", "montevideo": "UY", "san jose, costa rica": "CR",

  "cape town": "ZA", "johannesburg": "ZA", "lagos": "NG", "nairobi": "KE", "cairo": "EG",
  "rabat": "MA", "casablanca": "MA", "tunis": "TN", "nicosia": "CY", "limassol": "CY",
  "tbilisi": "GE", "yerevan": "AM", "almaty": "KZ", "astana": "KZ",
  "savannah": "US", "chattanooga": "US", "boise": "US", "omaha": "US",

  "manila": "PH", "cebu": "PH", "jakarta": "ID", "bali": "ID",
  "hanoi": "VN", "ho chi minh city": "VN", "bangkok": "TH",
  "kuala lumpur": "MY", "karachi": "PK", "lahore": "PK", "islamabad": "PK",
  // Додано за частотою нерозпізнаних рядків у живому кеші, не навмання.
  "baghdad": "IQ", "dhaka": "BD", "abidjan": "CI", "beirut": "LB", "metn": "LB",
  "saskatoon": "CA", "kitchener": "CA", "kanata": "CA",
  "cdmx": "MX", "ciudad de mexico": "MX",
  "chon buri": "TH", "chonburi": "TH", "alice springs": "AU", "masterton": "NZ",
  "augsburg": "DE", "orly": "FR", "bergamo": "IT", "treviglio": "IT", "foetz": "LU",
};

/**
 * Регіони. Не країна, але й не порожнеча: «Europe» для людини з Франції —
 * це «так», а для людини з Індії — «ні».
 */
const REGION_WORDS: Array<[string, string[]]> = [
  ["europe", ["europe", "european union", "emea", "eea", "cet", "cest", "europe/"]],
  ["americas", ["americas", "north america", "latam", "latin america", "south america"]],
  ["apac", ["apac", "asia", "asia pacific", "asia-pacific", "southeast asia", "sea region"]],
];

/** Країни кожного регіону. Свідомо неповні: лише ті, з яких у нас є люди. */
const REGION_COUNTRIES: Record<string, string[]> = {
  europe: ["GB", "IE", "DE", "FR", "ES", "PT", "IT", "NL", "BE", "CH", "AT", "PL", "CZ",
           "SK", "HU", "RO", "BG", "UA", "SE", "NO", "DK", "FI", "EE", "LV", "LT", "GR",
           "HR", "SI", "RS"],
  americas: ["US", "CA", "BR", "MX", "AR", "CL", "CO"],
  apac: ["SG", "JP", "KR", "CN", "HK", "TW", "AU", "NZ", "IN", "PH", "ID", "VN", "TH", "MY"],
};

/** «Будь-де»: вакансія без прив'язки до місця взагалі. */
/**
 * «Remote» саме по собі сюди НЕ входить, і це перевірено спробою.
 *
 * Це найчастіший нерозпізнаний рядок у кеші — 557 записів, більше за всі
 * міста разом, і спокуса зарахувати його як «будь-де» велика. Але вона
 * нічого не дає й дечого коштує.
 *
 * Не дає: у reachable() вакансія з прапорцем remote і так проходить першою
 * ж умовою, а в scoreJob штраф placeMiss однаково мовчить і на «hit», і на
 * «unknown».
 *
 * Коштує: для людини, що обрала «віддалено або офіс у моєму місті», fit
 * став би «hit» — тобто +3 за збіг МІСЦЯ і факт place з назвою її міста
 * під вакансією, у якої місця не названо взагалі. Картка сказала б
 * «Берлін» там, де в оголошенні написано лише «Remote».
 *
 * Тому «Remote» лишається нерозібраним, і це стан «ми не знаємо», а не
 * «підходить усім». Те саме стосується «Homeoffice» і «Nationwide Remote».
 */
const ANYWHERE = [
  "anywhere", "worldwide", "world wide", "global", "globally", "fully remote",
  "remote - global", "remote (global)", "location agnostic", "no location",
  "за кордоном",
];

export interface Place {
  /** Країни, яких стосується вакансія. Порожньо — не розібрали. */
  countries: string[];
  /** Регіони: europe, americas, apac. */
  regions: string[];
  /** «Будь-де у світі» — прямо сказано в рядку. */
  anywhere: boolean;
  /** Чи вдалося витягти хоч якийсь географічний сигнал. */
  known: boolean;
}

const EMPTY: Place = { countries: [], regions: [], anywhere: false, known: false };

const CHUNK_SPLIT = /[|;\u00b7\u2022\n]|\s+\/\s+|\s+&\s+|\s+and\s+/i;

/** Діакритика геть: «M\u00fcnchen» і «Munchen» мають читатись однаково. */
const strip = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Один довідник замість чотирьох проходів регулярками.
 *
 * Пошук іде по словах, а не підрядках: інакше «Cork» знаходився б у
 * «Corkscrew», а «US» — усередині будь-чого. Ключ — нормалізований n-gram
 * довжиною до трьох слів («new york city», «tel aviv-yafo»).
 */
type Hit =
  | { kind: "country"; v: string }   // країну названо прямо: «Germany», «Illinois»
  | { kind: "city"; v: string }      // країна виведена з міста: «Berlin»
  | { kind: "region"; v: string }
  | { kind: "anywhere" };

const LOOKUP = new Map<string, Hit>();
const addLookup = (phrase: string, hit: Hit): void => {
  const key = strip(phrase).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (key && !LOOKUP.has(key)) LOOKUP.set(key, hit);
};

for (const [iso, words] of COUNTRY_WORDS) for (const w of words) addLookup(w, { kind: "country", v: iso });
for (const w of US_STATE_WORDS) addLookup(w, { kind: "country", v: "US" });
for (const w of CA_PROVINCE_WORDS) addLookup(w, { kind: "country", v: "CA" });
for (const [city, iso] of Object.entries(CITY_COUNTRY)) addLookup(city, { kind: "city", v: iso });
for (const [region, words] of REGION_WORDS) for (const w of words) addLookup(w, { kind: "region", v: region });
for (const w of ANYWHERE) addLookup(w, { kind: "anywhere" });

/** Найдовший n-gram виграє: «new york» не має читатись як «york». */
const MAX_NGRAM = 3;

/**
 * Дволітерний хвіст рядка: «Toronto, ca» і «Brisbane, CA» — різні країни.
 *
 * Регістр тут не косметика, а єдиний сигнал, який відрізняє ці два рядки, і
 * джерела його тримають послідовно: коди штатів пишуть великими, коди країн
 * у цьому форматі — малими. Тому нижній регістр читаємо як ISO-код країни,
 * верхній — як штат США.
 */
const COUNTRY_ISO = new Set(COUNTRY_WORDS.map(([iso]) => iso));

export function trailingCode(raw: string): string[] {
  // Не лише в кінці рядка: «Columbia, MO (Headquarters)» і «Arvada, CO - US»
  // теж називають штат, просто з хвостом після нього.
  const out: string[] = [];
  for (const m of raw.matchAll(/,\s*([A-Za-z]{2})(?![A-Za-z])/g)) {
    const code = m[1]!;
    if (code === code.toUpperCase() && US_STATE_CODES.has(code)) { out.push("US"); continue; }
    if (code === code.toUpperCase() && CA_PROVINCE_CODES.has(code)) { out.push("CA"); continue; }
    const up = code.toUpperCase();
    if (code === code.toLowerCase() && COUNTRY_ISO.has(up)) out.push(up);
  }
  return out;
}

/** Формат Workday: «US-CA-Menlo Park», «DE-BY-M\u00fcnchen». */
export function workdayPrefix(raw: string): string | null {
  const m = /^([A-Z]{2})-[A-Z0-9]{2,3}-/.exec(raw.trim());
  if (!m) return null;
  return COUNTRY_ISO.has(m[1]!) ? m[1]! : null;
}

/**
 * Розбір локації вакансії.
 *
 * Рядок ріжеться на шматки за роздільниками, кожен шматок — на слова, далі
 * найдовший відомий n-gram виграє. «Berlin, Germany» дає DE один раз;
 * «San Francisco, CA | New York City, NY» дає US.
 */
export function placeOf(location: string | null | undefined): Place {
  const raw = (location ?? "").trim();
  if (!raw) return EMPTY;

  const countries = new Set<string>();
  const regions = new Set<string>();
  let anywhere = false;

  // Формат Workday сам називає країну першими двома літерами, і це надійніше
  // за все інше в рядку: «US-CA-Dublin» — це Дублін у Каліфорнії, а не в
  // Ірландії, і словник міст тут лише нашкодив би.
  const wd = workdayPrefix(raw);
  if (wd) return { countries: [wd], regions: [], anywhere: false, known: true };

  for (const chunk of raw.split(CHUNK_SPLIT)) {
    if (!chunk.trim()) continue;
    const words = strip(chunk).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

    // Три рівні певності, від сильного до слабкого. Береться найсильніший
    // непорожній, решта мовчить.
    //
    //   1. Названа країна або штат: «Germany», «Illinois», «USA».
    //   2. Місто зі словника: «Berlin», «Toronto».
    //   3. Дволітерний код після коми: «, MA», «, ca».
    //
    // Порядок не декоративний, кожен рівень поставлено живою помилкою.
    // «Lake Zurich, Illinois, United States» ставало Швейцарією, поки місто
    // не поступилося штату. «Berlin, DE» ставало США, бо DE — це ще й
    // Делавер, і код читався раніше за місто. «London, Canada» ставало
    // Британією. Місто — здогад, названа країна — факт, а дволітерний код
    // однаково читається двома способами й тому йде останнім.
    const explicit = new Set<string>();
    const fromCity = new Set<string>();

    for (let i = 0; i < words.length;) {
      let step = 1;
      for (let n = Math.min(MAX_NGRAM, words.length - i); n >= 1; n--) {
        const hit = LOOKUP.get(words.slice(i, i + n).join(" "));
        if (!hit) continue;
        if (hit.kind === "country") explicit.add(hit.v);
        else if (hit.kind === "city") fromCity.add(hit.v);
        else if (hit.kind === "region") regions.add(hit.v);
        else anywhere = true;
        step = n;
        break;
      }
      i += step;
    }

    const fromCode = explicit.size === 0 && fromCity.size === 0
      ? trailingCode(chunk) : [];

    const best = explicit.size > 0 ? explicit : fromCity.size > 0 ? fromCity : fromCode;
    for (const iso of best) countries.add(iso);
  }

  // Регіон без жодної країни лишається регіоном: «Europe» не є переліком
  // тридцяти рядків, і робити з нього перелік означало б вигадати точність.
  return {
    countries: [...countries],
    regions: [...regions],
    anywhere,
    known: countries.size > 0 || regions.size > 0 || anywhere,
  };
}

/**
 * Чи адресована вакансія людині з країни `country`.
 *
 * Три відповіді, а не дві. «Не знаємо» — повноцінний результат, і саме він
 * рятує від хибних штрафів: рядок «Devens, MA» ми читаємо, а «Starbase» —
 * ні, і карати вакансію за наше незнання було б нечесно.
 */
export type PlaceFit = "hit" | "miss" | "unknown";

export function placeFit(place: Place, country: string | null | undefined): PlaceFit {
  if (!country) return "unknown";
  if (place.anywhere) return "hit";
  if (place.countries.includes(country)) return "hit";
  if (place.regions.some((r) => REGION_COUNTRIES[r]?.includes(country))) return "hit";
  if (!place.known) return "unknown";
  return "miss";
}
