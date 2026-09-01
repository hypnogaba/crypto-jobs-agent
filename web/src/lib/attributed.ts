/**
 * Дошки й агрегатори, які ми називаємо поіменно.
 *
 * Це не маркетинг, а зобов'язання: умови Remote OK і Remotive прямо вимагають
 * згадки назви й посилання, що індексується. Без цього вони ріжуть доступ до
 * API.
 *
 * Список живе тут, а не на сторінці, бо його читають ДВОЄ: /sources малює
 * його поіменно, а головна показує його ДОВЖИНУ. Поки число на головній
 * бралося з source_stats, воно казало 59 проти двадцяти одного імені на
 * /sources — тобто рівно те, від чого ця правка й починалась: правдива
 * цифра, яка виглядає брехнею. Одне джерело правди робить розбіжність
 * неможливою, а не малоймовірною.
 */
export const ATTRIBUTED = [
  { name: "Remote OK", url: "https://remoteok.com", note: "remote" },
  { name: "Remotive", url: "https://remotive.com", note: "remote" },
  { name: "Arbeitnow", url: "https://www.arbeitnow.com", note: "EU" },
  { name: "Jobicy", url: "https://jobicy.com", note: "remote" },
  { name: "Himalayas", url: "https://himalayas.app", note: "remote" },
  { name: "Working Nomads", url: "https://www.workingnomads.com", note: "remote" },
  { name: "Landing.jobs", url: "https://landing.jobs", note: "EU" },
  { name: "The Muse", url: "https://www.themuse.com", note: "US" },
  { name: "We Work Remotely", url: "https://weworkremotely.com", note: "remote" },
  { name: "Jobspresso", url: "https://jobspresso.co", note: "remote" },
  { name: "NoDesk", url: "https://nodesk.co", note: "remote" },
  { name: "Cryptocurrency Jobs", url: "https://cryptocurrencyjobs.co", note: "web3" },
  { name: "Hacker News «Who is hiring»", url: "https://news.ycombinator.com", note: "HN" },
  { name: "Getro", url: "https://getro.com", note: "Getro" },
  // Знайдені розвідкою по твіттеру 2026-08-30 і перевірені живим прогоном.
  { name: "GermanTechJobs", url: "https://germantechjobs.de", note: "DE" },
  { name: "Startups North", url: "https://startupsnorth.ca", note: "CA" },
  { name: "Remotech", url: "https://remotech.ai", note: "remote" },
  { name: "Remote Backend Jobs", url: "https://remotebackendjobs.com", note: "remote" },
  { name: "Hireeing", url: "https://hireeing.com", note: "remote" },
  { name: "We Love Product", url: "https://weloveproduct.co", note: "product" },
];
