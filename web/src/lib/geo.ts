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
 * Кирилиця → латиниця, для показу.
 *
 * Локації в jobs_cache лежать так, як їх написало джерело, і жодне з них не
 * нормалізуємо — «Київ, Львів» приїжджає з DOU саме таким. Для англійського
 * чи французького інтерфейсу це стіна, яку людина не прочитає й не впізнає.
 *
 * Два проходи, і порядок важливий. Спершу словник відомих назв: «Київ» має
 * бути «Kyiv», а не «Kyiiv», і жодна побуквенна таблиця цього не дасть —
 * усталений правопис міста не виводиться з правил. Далі, для всього, чого в
 * словнику немає, побуквенна транслітерація за КМУ 55:2010: краще читабельне
 * наближення, ніж кирилиця.
 *
 * Це лише показ. У базі лишається оригінал: за ним шукає сканер, і зіпсувати
 * його транслітерацією означало б розірвати збіги.
 */
const PLACE_LATIN: Record<string, string> = {
  // Україна — звідси майже вся кирилиця в кеші
  київ: "Kyiv", львів: "Lviv", харків: "Kharkiv", одеса: "Odesa", дніпро: "Dnipro",
  вінниця: "Vinnytsia", запоріжжя: "Zaporizhzhia", тернопіль: "Ternopil",
  луцьк: "Lutsk", ужгород: "Uzhhorod", чернівці: "Chernivtsi", житомир: "Zhytomyr",
  черкаси: "Cherkasy", полтава: "Poltava", суми: "Sumy", рівне: "Rivne",
  миколаїв: "Mykolaiv", чернігів: "Chernihiv", херсон: "Kherson", маріуполь: "Mariupol",
  кременчук: "Kremenchuk", хмельницький: "Khmelnytskyi", кропивницький: "Kropyvnytskyi",
  "івано-франківськ": "Ivano-Frankivsk", "кривий ріг": "Kryvyi Rih",
  "біла церква": "Bila Tserkva", україна: "Ukraine",
  // те, що трапляється поряд із містом у тому ж полі
  віддалено: "Remote", удалённо: "Remote", "будь-де": "Anywhere",
  // сусіди, які інколи приїжджають кирилицею з тих самих дощок
  варшава: "Warsaw", краків: "Krakow", вроцлав: "Wroclaw", польща: "Poland",
  берлін: "Berlin", мюнхен: "Munich", німеччина: "Germany",
  прага: "Prague", чехія: "Czechia", париж: "Paris", франція: "France",
  лондон: "London", лісабон: "Lisbon", амстердам: "Amsterdam",
};

/** Побуквенна таблиця, КМУ 55:2010 плюс кілька російських літер. */
const CYR_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "y", і: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ь: "", ю: "iu", я: "ia", є: "ie", ї: "i",
  ы: "y", э: "e", ъ: "", ё: "io",
};

/** На початку слова ці чотири звучать інакше — так вимагає стандарт. */
const CYR_LATIN_HEAD: Record<string, string> = {
  є: "Ye", ї: "Yi", й: "Y", ю: "Yu", я: "Ya",
};

const hasCyrillic = (text: string) => /\p{Script=Cyrillic}/u.test(text);

/** Побуквенно, з великою літерою там, де вона була. */
function translit(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const low = ch.toLowerCase();
    const head = i === 0 && ch !== low ? CYR_LATIN_HEAD[low] : undefined;
    const mapped = head ?? CYR_LATIN[low];
    if (mapped === undefined) { out += ch; continue; }
    out += head ? mapped : (ch === low ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1));
  }
  return out;
}

/**
 * Рядок локації латиницею. Не кирилиця — повертаємо як є, байт у байт.
 */
export function toLatin(text: string): string {
  if (!hasCyrillic(text)) return text;

  // Спершу двослівні назви цілком: «Кривий Ріг» — одне місто, не два слова.
  let out = text;
  for (const [cyr, lat] of Object.entries(PLACE_LATIN)) {
    if (!cyr.includes(" ") && !cyr.includes("-")) continue;
    out = out.replace(new RegExp(`(?<!\\p{L})${cyr}(?!\\p{L})`, "giu"), lat);
  }

  return out.replace(/[\p{Script=Cyrillic}\u2019'-]+/gu, (word) => {
    const known = PLACE_LATIN[word.toLowerCase()];
    if (known) return known;
    return hasCyrillic(word) ? translit(word) : word;
  });
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
  // Порядок має значення: перший збіг перемагає. Країни, де людей найбільше,
  // стоять вище — не з поваги, а щоб рідкісний омонім не перехопив частий
  // випадок.
  ["UA", word("ukraine|ukraina|україна|украина|kyiv|kiev|київ|киев|lviv|львів|львов|kharkiv|харків|харьков|odesa|odessa|одеса|одесса|dnipro|дніпро|днепр|vinnytsia|вінниця|ivano-frankivsk|івано-франківськ|ternopil|тернопіль|zhytomyr|житомир|chernivtsi|чернівці|rivne|рівне|poltava|полтава")],
  ["PL", word("poland|polska|польща|польша|warsaw|warszawa|варшава|krakow|kraków|краків|краков|wroclaw|wrocław|вроцлав|gdansk|gdańsk|гданськ|poznan|poznań|познань|katowice|катовіце|lodz|łódź|лодзь|szczecin|lublin|люблін|rzeszow|rzeszów|gdynia|bydgoszcz")],
  ["DE", word("germany|deutschland|німеччина|германия|berlin|берлін|берлин|munich|münchen|muenchen|мюнхен|hamburg|гамбург|frankfurt|франкфурт|cologne|köln|koeln|кельн|кёльн|stuttgart|штутгарт|düsseldorf|duesseldorf|дюссельдорф|leipzig|лейпциг|dresden|дрезден|nuremberg|nürnberg|нюрнберг|hannover|bremen|бремен|karlsruhe|mannheim|essen|dortmund|bonn|бонн")],
  ["FR", word("france|франція|франция|paris|париж|lyon|ліон|лион|marseille|марсель|toulouse|тулуза|bordeaux|бордо|nantes|нант|lille|лілль|лилль|strasbourg|страсбург|montpellier|монпельє|rennes|grenoble|гренобль|sophia antipolis")],
  ["GB", word("uk|united kingdom|britain|great britain|британія|британия|англія|англия|england|scotland|wales|london|лондон|manchester|манчестер|edinburgh|единбург|эдинбург|bristol|брістоль|бристоль|glasgow|глазго|leeds|лідс|birmingham|бірмінгем|бирмингем|cambridge|кембридж|oxford|оксфорд|belfast|белфаст|liverpool|ліверпуль|ливерпуль|newcastle|sheffield|nottingham|brighton|брайтон|reading|беркшир")],
  ["ES", word("spain|españa|espana|іспанія|испания|madrid|мадрид|barcelona|барселона|valencia|валенсія|валенсия|seville|sevilla|севілья|севилья|malaga|málaga|малага|bilbao|більбао|бильбао|zaragoza|сарагоса|alicante|аліканте|palma|мальорка|mallorca|canarias|tenerife|тенеріфе")],
  ["IT", word("italy|italia|італія|италия|rome|roma|рим|milan|milano|мілан|милан|turin|torino|турин|naples|napoli|неаполь|bologna|болонья|florence|firenze|флоренція|флоренция|venice|venezia|венеція|венеция|genoa|genova|генуя|verona|верона|padova|padua|bari|catania|palermo|палермо")],
  ["PT", word("portugal|португалія|португалия|lisbon|lisboa|лісабон|лиссабон|porto|oporto|порту|braga|брага|coimbra|коїмбра|faro|фару|aveiro|madeira|мадейра|funchal|algarve|алгарве")],
  ["NL", word("netherlands|nederland|нідерланди|нидерланды|holland|голландія|голландия|amsterdam|амстердам|rotterdam|роттердам|utrecht|утрехт|eindhoven|ейндговен|эйндховен|the hague|den haag|гаага|groningen|гронінген|delft|делфт|leiden|лейден|haarlem|tilburg|breda|nijmegen|maastricht|маастрихт")],
  // Приклад, з якого все почалось: «Антверпен» не давав нічого, бо Бельгії
  // в цьому списку не було взагалі.
  ["BE", word("belgium|belgique|belgië|belgie|бельгія|бельгия|brussels|bruxelles|brussel|брюссель|antwerp|antwerpen|anvers|антверпен|ghent|gent|gand|гент|leuven|льовен|лёвен|liege|liège|льєж|льеж|bruges|brugge|брюгге|charleroi|namur|mechelen|hasselt|kortrijk|louvain")],
  ["CZ", word("czechia|czech|česko|чехія|чехия|prague|praha|прага|brno|брно|ostrava|острава|plzen|plzeň|пльзень|olomouc|оломоуц|liberec|budweis|budějovice")],
  ["RO", word("romania|românia|румунія|румыния|bucharest|bucurești|bucuresti|бухарест|cluj|клуж|timisoara|timișoara|тімішоара|iasi|iași|ясси|brasov|brașov|брашов|constanta|constanța|sibiu|сібіу|oradea|craiova")],
  ["IE", word("ireland|éire|ірландія|ирландия|dublin|дублін|дублин|cork|корк|galway|голуей|limerick|лімерик|waterford")],
  ["AT", word("austria|österreich|oesterreich|австрія|австрия|vienna|wien|відень|вена|graz|грац|linz|лінц|линц|salzburg|зальцбург|innsbruck|інсбрук|klagenfurt")],
  ["CH", word("switzerland|schweiz|suisse|svizzera|швейцарія|швейцария|zurich|zürich|цюрих|geneva|genève|genf|женева|basel|базель|bern|берн|lausanne|лозанна|lugano|zug|цуг|winterthur")],
  ["SE", word("sweden|sverige|швеція|швеция|stockholm|стокгольм|gothenburg|göteborg|goteborg|гетеборг|гётеборг|malmo|malmö|мальме|мальмё|uppsala|уппсала|lund|линчепинг|linköping")],
  ["NO", word("norway|norge|норвегія|норвегия|oslo|осло|bergen|берген|trondheim|тронгейм|stavanger|ставангер|tromso|tromsø")],
  ["DK", word("denmark|danmark|данія|дания|copenhagen|københavn|kobenhavn|копенгаген|aarhus|århus|орхус|odense|оденсе|aalborg|ольборг")],
  ["FI", word("finland|suomi|фінляндія|финляндия|helsinki|гельсінкі|хельсинки|espoo|еспоо|tampere|тампере|turku|турку|oulu|оулу|vantaa")],
  ["EE", word("estonia|eesti|естонія|эстония|tallinn|таллінн|таллин|tartu|тарту|narva|нарва|parnu|pärnu")],
  ["LV", word("latvia|latvija|латвія|латвия|riga|rīga|рига|daugavpils|даугавпілс|liepaja|liepāja|jurmala|юрмала")],
  ["LT", word("lithuania|lietuva|литва|vilnius|вільнюс|вильнюс|kaunas|каунас|klaipeda|klaipėda|клайпеда|siauliai|šiauliai")],
  ["HU", word("hungary|magyarország|magyarorszag|угорщина|венгрия|budapest|будапешт|debrecen|дебрецен|szeged|сегед|miskolc|pecs|pécs|gyor|győr")],
  ["SK", word("slovakia|slovensko|словаччина|словакия|bratislava|братислава|kosice|košice|кошице|zilina|žilina|nitra|banska bystrica")],
  ["SI", word("slovenia|slovenija|словенія|словения|ljubljana|любляна|maribor|марибор|celje|koper")],
  ["HR", word("croatia|hrvatska|хорватія|хорватия|zagreb|загреб|rijeka|рієка|osijek|осієк|dubrovnik|дубровник|zadar|задар")],
  ["RS", word("serbia|srbija|сербія|сербия|belgrade|beograd|белград|novi sad|нови сад|nis|niš|ниш|kragujevac|subotica")],
  ["BG", word("bulgaria|българия|болгарія|болгария|sofia|софія|софия|plovdiv|пловдив|varna|варна|burgas|бургас|ruse|русе")],
  ["GR", word("greece|ελλάδα|hellas|греція|греция|athens|афіни|афины|thessaloniki|салоніки|салоники|patras|патри|heraklion|іракліон|crete|крит")],
  ["TR", word("turkey|türkiye|turkiye|туреччина|турция|istanbul|стамбул|ankara|анкара|izmir|ізмір|измир|antalya|анталія|анталия|bursa|бурса|konya")],
  ["CY", word("cyprus|κύπρος|кіпр|кипр|nicosia|нікосія|никосия|limassol|лімасол|лимассол|larnaca|ларнака|paphos|пафос")],
  ["MT", word("malta|мальта|valletta|валлетта|sliema|st julian")],
  ["LU", word("luxembourg|luxemburg|люксембург")],
  ["IS", word("iceland|ísland|island|ісландія|исландия|reykjavik|reykjavík|рейк'явік|рейкьявик")],
  ["MD", word("moldova|молдова|молдавія|молдавия|chisinau|chișinău|кишинів|кишинёв|кишинев|balti|bălți")],
  ["GE", word("საქართველო|sakartvelo|грузія|грузия|sakartvelo|tbilisi|тбілісі|тбилиси|batumi|батумі|батуми|kutaisi|кутаїсі|кутаиси")],
  ["AM", word("armenia|հայաստան|вірменія|армения|yerevan|єреван|ереван|gyumri|гюмрі|гюмри")],
  ["AZ", word("azerbaijan|азербайджан|baku|баку|ganja|гянджа|sumqayit")],
  ["KZ", word("kazakhstan|казахстан|almaty|алмати|алматы|алма-ата|astana|астана|nur-sultan|нур-султан|shymkent|шимкент|karaganda|караганда")],
  ["IL", word("israel|ישראל|ізраїль|израиль|tel aviv|тель-авів|тель-авив|jerusalem|єрусалим|иерусалим|haifa|хайфа|herzliya|герцлія|beer sheva|be'er sheva|ramat gan|netanya")],
  ["AE", word("uae|united arab emirates|емірати|эмираты|оае|dubai|дубай|abu dhabi|абу-дабі|абу-даби|sharjah|шарджа|ajman")],
  ["SA", word("saudi arabia|саудівська|саудовская|riyadh|ер-ріяд|эр-рияд|jeddah|джидда|dammam|khobar")],
  ["QA", word("qatar|катар|doha|доха")],
  ["EG", word("egypt|мصر|єгипет|египет|cairo|каїр|каир|alexandria|александрія|александрия|giza|гіза")],
  ["ZA", word("south africa|південна африка|південноафриканська|южная африка|юар|johannesburg|йоганнесбург|йоханнесбург|cape town|кейптаун|durban|дурбан|pretoria|преторія|претория|stellenbosch|sandton")],
  ["NG", word("nigeria|нігерія|нигерия|lagos|лагос|abuja|абуджа|ibadan|port harcourt|kano")],
  ["KE", word("kenya|кенія|кения|nairobi|найробі|найроби|mombasa|момбаса|kisumu")],
  ["GH", word("ghana|гана|accra|аккра|kumasi")],
  ["MA", word("morocco|maroc|марокко|casablanca|касабланка|rabat|рабат|marrakech|марракеш|tangier")],
  ["IN", word("india|भारत|індія|индия|bangalore|bengaluru|бангалор|mumbai|мумбаї|мумбаи|бомбей|delhi|делі|дели|noida|gurgaon|gurugram|гургаон|hyderabad|хайдарабад|pune|пуна|chennai|ченнаї|ченнаи|kolkata|калькутта|ahmedabad|jaipur|kochi|coimbatore|indore|chandigarh")],
  ["PK", word("pakistan|пакистан|karachi|карачі|карачи|lahore|лахор|islamabad|ісламабад|исламабад|rawalpindi")],
  ["BD", word("bangladesh|бангладеш|dhaka|дакка|chittagong")],
  ["SG", word("singapore|сінгапур|сингапур")],
  ["MY", word("malaysia|малайзія|малайзия|kuala lumpur|куала-лумпур|penang|пенанг|johor|cyberjaya")],
  ["ID", word("indonesia|індонезія|индонезия|jakarta|джакарта|bali|балі|бали|surabaya|bandung|denpasar")],
  ["TH", word("thailand|таїланд|таиланд|bangkok|бангкок|chiang mai|чіангмай|чиангмай|phuket|пхукет")],
  ["VN", word("vietnam|việt nam|вʼєтнам|в'єтнам|вьетнам|hanoi|ханой|ho chi minh|saigon|сайгон|хошимін|хошимин|da nang|дананг")],
  ["PH", word("philippines|філіппіни|филиппины|manila|маніла|манила|cebu|себу|makati|quezon city|davao")],
  ["JP", word("japan|日本|японія|япония|tokyo|токіо|токио|osaka|осака|kyoto|кіото|киото|yokohama|иокогама|fukuoka|nagoya")],
  ["KR", word("south korea|대한민국|корея|корея|seoul|сеул|busan|пусан|incheon|інчхон|инчхон|daejeon|pangyo")],
  ["CN", word("china|中国|китай|beijing|пекін|пекин|shanghai|шанхай|shenzhen|шеньчжень|шэньчжэнь|guangzhou|гуанчжоу|hangzhou|ханчжоу|chengdu|ченду|чэнду")],
  ["HK", word("hong kong|гонконг|гонконґ|香港")],
  ["TW", word("taiwan|тайвань|taipei|тайбей|тайпей|hsinchu|kaohsiung")],
  ["AU", word("australia|австралія|австралия|sydney|сідней|сидней|melbourne|мельбурн|brisbane|брісбен|брисбен|perth|перт|adelaide|аделаїда|аделаида|canberra|канберра|gold coast")],
  ["NZ", word("new zealand|нова зеландія|новая зеландия|auckland|окленд|wellington|веллінгтон|веллингтон|christchurch|крайстчерч")],
  ["CA", word("canada|канада|toronto|торонто|vancouver|ванкувер|montreal|montréal|монреаль|calgary|калгарі|калгари|ottawa|оттава|edmonton|едмонтон|эдмонтон|waterloo|kitchener|quebec|québec|квебек|winnipeg|halifax|mississauga")],
  ["US", word("usa|u\\.s\\.a|united states|сша|америка|new york|нью-йорк|нью йорк|nyc|brooklyn|бруклін|бруклин|san francisco|сан-франциско|сан франциско|bay area|silicon valley|кремнієва долина|кремниевая долина|palo alto|пало-альто|mountain view|sunnyvale|santa clara|san jose|сан-хосе|los angeles|лос-анджелес|seattle|сіетл|сиэтл|boston|бостон|chicago|чикаго|austin|остін|остин|denver|денвер|atlanta|атланта|miami|маямі|майами|dallas|даллас|houston|х'юстон|хьюстон|philadelphia|філадельфія|филадельфия|washington dc|вашингтон|san diego|сан-дієго|сан-диего|portland|портленд|phoenix|фінікс|финикс|raleigh|роли|pittsburgh|піттсбург|питтсбург|minneapolis|detroit|детройт|salt lake city|nashville|нашвілл|charlotte|columbus|redmond|bellevue|cupertino|купертіно|menlo park")],
  ["MX", word("mexico|méxico|мексика|mexico city|ciudad de méxico|cdmx|мехіко|мехико|guadalajara|гвадалахара|monterrey|монтеррей|queretaro|querétaro|puebla|tijuana")],
  ["BR", word("brazil|brasil|бразилія|бразилия|sao paulo|são paulo|сан-паулу|rio de janeiro|ріо-де-жанейро|рио-де-жанейро|belo horizonte|белу-орізонті|curitiba|курітіба|porto alegre|порту-алегрі|brasilia|brasília|бразиліа|recife|ресіфі|florianopolis|florianópolis|campinas")],
  ["AR", word("argentina|аргентина|buenos aires|буенос-айрес|буэнос-айрес|cordoba|córdoba|кордова|rosario|росаріо|mendoza|мендоса|la plata")],
  ["CL", word("chile|чилі|чили|santiago de chile|сантьяго|valparaiso|valparaíso|вальпараїсо|concepcion|concepción")],
  ["CO", word("colombia|колумбія|колумбия|bogota|bogotá|богота|medellin|medellín|медельїн|медельин|cali|калі|barranquilla|cartagena")],
  ["PE", word("peru|perú|перу|lima|ліма|лима|arequipa|арекіпа|trujillo")],
  ["UY", word("uruguay|уругвай|montevideo|монтевідео|монтевидео")],
  ["CR", word("costa rica|коста-ріка|коста-рика")],
];

/** Країна з написаної локації, або null. */
export function countryFromLocation(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  for (const [code, re] of PLACES) if (re.test(text)) return code;
  return null;
}

/**
 * УСІ країни, названі в рядку, а не перша.
 *
 * Жива скарга 31.08: людина написала «Bratislava, Vienna, Budapest, Prague»
 * і отримувала вакансії в APAC та Америці. Причина не в підборі — у виводі:
 * країна лишалась одна, CZ. Три з чотирьох її міст ставали для системи
 * такими самими «промахами», як Джакарта, і коштували рівно стільки ж.
 *
 * Порядок збережено за PLACES, а не за появою в тексті: він і так лише для
 * читабельності, бо далі це множина.
 */
export function deriveCountries(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const fixed = fixLayout(text);
  const out: string[] = [];
  for (const [code, re] of PLACES) if (re.test(fixed) && !out.includes(code)) out.push(code);
  return out;
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

/**
 * Зона для акаунта, створеного в боті.
 *
 * Telegram поясу не надсилає, тому ботові акаунти досі отримували UTC — і
 * «09:00» приходило об 11:00 у Париж і о 12:00 у Київ. Два підказки, обидві
 * чесно приблизні: місто, яке людина написала (Львів → Europe/Kyiv), а без
 * нього — мова інтерфейсу (uk → Київ, fr → Париж). Англійська й російська
 * не кажуть про місце нічого — лишається UTC.
 *
 * Це здогад про розклад, не про країну: країну визначає лише deriveCountry.
 */
const LOCALE_TZ: Record<string, string> = { uk: "Europe/Kyiv", fr: "Europe/Paris" };

export function timezoneFor(locale: string, location: string | null | undefined): string {
  const country = deriveCountry(location);
  if (country) {
    const zone = Object.entries(TZ_COUNTRY).find(([, c]) => c === country)?.[0];
    if (zone) return zone;
  }
  return LOCALE_TZ[locale] ?? "UTC";
}
