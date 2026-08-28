/**
 * Усе, що бот каже людині, — у чотирьох мовах.
 *
 * Раніше половина реплік була зашита українською, а онбординг уже говорив
 * мовою Telegram. Виходила суміш: питання англійською, відповідь українською.
 * Мова береться з language_code, який Telegram надсилає в кожному оновленні;
 * якщо її немає серед наших чотирьох — англійська.
 */
import type { Locale } from "./vocab";

type Phrase = { en: string; uk: string; fr: string; ru: string };

const P = {
  alreadyIn: {
    en: "You are already connected. /profile to see it, /time to change the hour, /pause to stop.",
    uk: "Ти вже підключений. /profile — подивитись профіль, /time — змінити годину, /pause — призупинити.",
    fr: "Vous êtes déjà connecté. /profile pour le voir, /time pour changer l'heure, /pause pour arrêter.",
    ru: "Ты уже подключён. /profile — посмотреть профиль, /time — изменить час, /pause — приостановить.",
  },
  greeting: {
    en: "Hi. Every morning I send five jobs picked for you.\nFour questions, thirty seconds.",
    uk: "Привіт. Я щоранку надсилаю п'ять вакансій, підібраних під тебе.\nЧотири питання, тридцять секунд.",
    fr: "Bonjour. Chaque matin je vous envoie cinq offres choisies pour vous.\nQuatre questions, trente secondes.",
    ru: "Привет. Я каждое утро присылаю пять вакансий, подобранных под тебя.\nЧетыре вопроса, тридцать секунд.",
  },
  linked: {
    en: "Done. The first five roles arrive tomorrow at 09:00. Send /time to move it.",
    uk: "Готово. Перші п'ять вакансій прийдуть завтра о 09:00. Щоб змінити годину — /time.",
    fr: "C'est fait. Les cinq premières offres arrivent demain à 09h00. Pour changer l'heure : /time.",
    ru: "Готово. Первые пять вакансий придут завтра в 09:00. Чтобы изменить час — /time.",
  },
  linkExpired: {
    en: "That link has expired. Refresh the connect page and try again.",
    uk: "Посилання застаріло. Онови сторінку підключення й спробуй ще раз.",
    fr: "Ce lien a expiré. Rafraîchissez la page de connexion et réessayez.",
    ru: "Ссылка устарела. Обнови страницу подключения и попробуй ещё раз.",
  },
  moreQueued: {
    en: "Got it. The next digest arrives within the hour.",
    uk: "Прийняв. Наступна добірка прийде протягом години.",
    fr: "Compris. La prochaine sélection arrive dans l'heure.",
    ru: "Принял. Следующая подборка придёт в течение часа.",
  },
  askWhy: {
    en: "What was wrong with them?",
    uk: "Що з ними було не так?",
    fr: "Qu'est-ce qui n'allait pas ?",
    ru: "Что с ними было не так?",
  },
  whySphere: {
    en: "Wrong kind of work", uk: "Не та сфера", fr: "Mauvais domaine", ru: "Не та сфера",
  },
  whyLevel: {
    en: "Wrong level", uk: "Не той рівень", fr: "Mauvais niveau", ru: "Не тот уровень",
  },
  whyPlace: {
    en: "Wrong place", uk: "Не та локація", fr: "Mauvais lieu", ru: "Не та локация",
  },
  whyMoney: {
    en: "Pay too low", uk: "Зарплата замала", fr: "Salaire trop bas", ru: "Зарплата мала",
  },
  whyRemote: {
    en: "Not really remote", uk: "Насправді не віддалено", fr: "Pas vraiment à distance", ru: "На самом деле не удалённо",
  },
  whyIndustry: {
    en: "Wrong industry", uk: "Не та індустрія", fr: "Mauvais secteur", ru: "Не та индустрия",
  },
  whyStale: {
    en: "Already closed", uk: "Вакансію вже закрито", fr: "Offre déjà fermée", ru: "Вакансия уже закрыта",
  },
  whySame: {
    en: "Too similar to each other", uk: "Усі надто схожі між собою", fr: "Trop semblables", ru: "Все слишком похожи",
  },
  whyOther: {
    en: "Something else — I will write it", uk: "Інше — напишу словами",
    fr: "Autre chose — je l'écris", ru: "Другое — напишу словами",
  },
  whyWrite: {
    en: "Tell me in one message what was wrong. Anything at all — I read every one of these.",
    uk: "Напиши одним повідомленням, що саме не так. Будь-що — я читаю кожне таке повідомлення.",
    fr: "Dites-moi en un message ce qui n'allait pas. N'importe quoi — je les lis toutes.",
    ru: "Напиши одним сообщением, что именно не так. Что угодно — я читаю каждое такое сообщение.",
  },
  learnedRemote: {
    en: "Noted. Jobs that are not truly remote will sink for you from now on.",
    uk: "Прийняв. Вакансії, які насправді не віддалені, тепер опускатимуться нижче.",
    fr: "Noté. Les offres qui ne sont pas vraiment à distance descendront désormais.",
    ru: "Принял. Вакансии, которые на самом деле не удалённые, теперь будут опускаться ниже.",
  },
  learnedNote: {
    en: "Noted, and written down. Weights cannot fix this one, but I see it.",
    uk: "Прийняв і записав. Вагами це не лікується, але я це бачу.",
    fr: "Noté et consigné. Les pondérations n'y peuvent rien, mais je le vois.",
    ru: "Принял и записал. Весами это не лечится, но я это вижу.",
  },
  learnedLevel: {
    en: "Noted. Level mismatches will cost more for you from now on.",
    uk: "Прийняв. Невідповідність рівня тепер каратиметься сильніше саме для тебе.",
    fr: "Noté. Les écarts de niveau compteront davantage pour vous.",
    ru: "Принял. Несоответствие уровня теперь будет наказываться сильнее именно для тебя.",
  },
  learnedPlace: {
    en: "Noted. Jobs outside your place will sink for you from now on.",
    uk: "Прийняв. Вакансії поза твоєю локацією тепер опускатимуться нижче.",
    fr: "Noté. Les offres hors de votre zone descendront désormais.",
    ru: "Принял. Вакансии вне твоей локации теперь будут опускаться ниже.",
  },
  learnedMoney: {
    en: "Noted. Pay below your floor will cost more for you from now on.",
    uk: "Прийняв. Зарплата нижча за твій поріг тепер каратиметься сильніше.",
    fr: "Noté. Un salaire sous votre seuil comptera davantage.",
    ru: "Принял. Зарплата ниже твоего порога теперь будет наказываться сильнее.",
  },
  learnedSphere: {
    en: "Noted. Weights will not fix this one — the spheres themselves need changing. Send /start to redo them.",
    uk: "Прийняв. Вагами це не лікується — треба міняти самі сфери. Напиши /start, щоб перезібрати профіль.",
    fr: "Noté. Les pondérations n'y changeront rien — il faut modifier les domaines. Envoyez /start.",
    ru: "Принял. Весами это не лечится — нужно менять сами сферы. Напиши /start, чтобы пересобрать профиль.",
  },
  noted: {
    en: "Thanks, noted. Tomorrow's digest will be closer.",
    uk: "Дякую, врахую. Завтрашня добірка буде точнішою.",
    fr: "Merci, c'est noté. La sélection de demain sera plus juste.",
    ru: "Спасибо, учту. Завтрашняя подборка будет точнее.",
  },
  startFirst: {
    en: "Send /start first, so I know what to look for.",
    uk: "Спершу /start, щоб я знав, кого шукати.",
    fr: "Envoyez d'abord /start, que je sache quoi chercher.",
    ru: "Сначала /start, чтобы я знал, кого искать.",
  },
  paused: {
    en: "Paused. /resume whenever you want them back.",
    uk: "Призупинив. /resume коли захочеш повернутись.",
    fr: "En pause. /resume quand vous voulez reprendre.",
    ru: "Приостановил. /resume когда захочешь вернуться.",
  },
  resumed: {
    en: "Back on. The next digest arrives in the morning.",
    uk: "Відновив. Наступна добірка прийде вранці.",
    fr: "C'est reparti. La prochaine sélection arrive demain matin.",
    ru: "Возобновил. Следующая подборка придёт утром.",
  },
  timeUsage: {
    en: "To change it, send /time and an hour, for example /time 9.",
    uk: "Щоб змінити — напиши /time і годину, наприклад /time 9.",
    fr: "Pour changer, envoyez /time et une heure, par exemple /time 9.",
    ru: "Чтобы изменить — напиши /time и час, например /time 9.",
  },
  timeBad: {
    en: "The hour must be a number from 0 to 23. For example: /time 9",
    uk: "Година має бути числом від 0 до 23. Наприклад: /time 9",
    fr: "L'heure doit être un nombre de 0 à 23. Par exemple : /time 9",
    ru: "Час должен быть числом от 0 до 23. Например: /time 9",
  },
  noProfile: {
    en: "No profile yet. Send /start and I will ask four questions.",
    uk: "Профілю ще немає. Напиши /start, і я поставлю чотири питання.",
    fr: "Pas encore de profil. Envoyez /start et je poserai quatre questions.",
    ru: "Профиля ещё нет. Напиши /start, и я задам четыре вопроса.",
  },
  deleted: {
    en: "Account and all data deleted. Want to come back? Just /start.",
    uk: "Видалив акаунт і всі дані. Захочеш повернутись — просто /start.",
    fr: "Compte et données supprimés. Pour revenir : /start.",
    ru: "Удалил аккаунт и все данные. Захочешь вернуться — просто /start.",
  },
  help: {
    en: "/profile — your profile\n/time — delivery hour\n/pause and /resume — pause\n/site — sign in on the web\n/feedback — tell us what is wrong\n/delete — erase everything",
    uk: "/profile — твій профіль\n/time — година доставки\n/pause і /resume — пауза\n/site — вхід на сайт\n/feedback — сказати, що не так\n/delete — видалити все",
    fr: "/profile — votre profil\n/time — heure d'envoi\n/pause et /resume — pause\n/site — accès au site\n/feedback — dire ce qui ne va pas\n/delete — tout effacer",
    ru: "/profile — твой профиль\n/time — час доставки\n/pause и /resume — пауза\n/site — вход на сайт\n/feedback — сказать, что не так\n/delete — удалить всё",
  },
  feedbackAsk: {
    en: "What is wrong? Write it in one message — it goes straight to the person who builds this.",
    uk: "Що не так? Напиши одним повідомленням — воно йде прямо до людини, яка це робить.",
    fr: "Qu'est-ce qui ne va pas ? Écrivez-le en un message — il va directement à celui qui construit ça.",
    ru: "Что не так? Напиши одним сообщением — оно идёт прямо к человеку, который это делает.",
  },
  feedbackThanks: {
    en: "Got it. Thank you — this is how it gets better.",
    uk: "Прийняв. Дякую — саме так воно й стає кращим.",
    fr: "Bien reçu. Merci — c'est comme ça que ça s'améliore.",
    ru: "Принял. Спасибо — именно так оно и становится лучше.",
  },
  siteLink: {
    en: "One-time sign-in link, valid for 15 minutes:",
    uk: "Разове посилання для входу, дійсне 15 хвилин:",
    fr: "Lien de connexion à usage unique, valable 15 minutes :",
    ru: "Разовая ссылка для входа, действует 15 минут:",
  },
  profileHow: {
    en: "To change it: /start for the four questions again, or just send your CV as a file.",
    uk: "Щоб змінити: /start — чотири питання заново, або просто надішли резюме файлом.",
    fr: "Pour modifier : /start pour refaire les quatre questions, ou envoyez votre CV en fichier.",
    ru: "Чтобы изменить: /start — четыре вопроса заново, или просто пришли резюме файлом.",
  },
  orWrite: {
    en: "Or just write it in one sentence — I will tick the boxes for you. A CV file works too.",
    uk: "Або просто напиши одним реченням — я сам проставлю галочки. Резюме файлом теж підійде.",
    fr: "Ou écrivez-le en une phrase — je cocherai pour vous. Un CV en fichier fonctionne aussi.",
    ru: "Или просто напиши одним предложением — я сам проставлю галочки. Резюме файлом тоже подойдёт.",
  },
  prefilled: {
    en: "I ticked what I understood. Fix anything that is wrong.",
    uk: "Я проставив те, що зрозумів. Виправ те, що не так.",
    fr: "J'ai coché ce que j'ai compris. Corrigez ce qui ne va pas.",
    ru: "Я отметил то, что понял. Исправь то, что не так.",
  },
  cvReading: {
    en: "Reading it — a moment.", uk: "Читаю — хвилинку.",
    fr: "Je le lis — un instant.", ru: "Читаю — минутку.",
  },
  cvDone: {
    en: "Read it. Here is what I understood:", uk: "Прочитав. Ось що я зрозумів:",
    fr: "C'est lu. Voici ce que j'ai compris :", ru: "Прочитал. Вот что я понял:",
  },
  cvUnreadable: {
    en: "I could not read that file. PDF or plain text works; a scan or an image does not.",
    uk: "Не зміг прочитати цей файл. Годиться PDF або звичайний текст; скан чи картинка — ні.",
    fr: "Je n'ai pas pu lire ce fichier. PDF ou texte brut ; un scan ou une image, non.",
    ru: "Не смог прочитать этот файл. Подходит PDF или обычный текст; скан или картинка — нет.",
  },
  cvFailed: {
    en: "Something went wrong while reading it. Try again, or just write a sentence.",
    uk: "Щось пішло не так під час читання. Спробуй ще раз або просто напиши речення.",
    fr: "Un problème est survenu. Réessayez, ou écrivez simplement une phrase.",
    ru: "Что-то пошло не так при чтении. Попробуй ещё раз или просто напиши предложение.",
  },
  unknown: {
    en: "I do not know that command. /help shows what I can do.",
    uk: "Не знаю такої команди. /help покаже, що я вмію.",
    fr: "Je ne connais pas cette commande. /help montre ce que je sais faire.",
    ru: "Не знаю такой команды. /help покажет, что я умею.",
  },
} satisfies Record<string, Phrase>;

export type CopyKey = keyof typeof P;

export const t = (key: CopyKey, locale: Locale): string => P[key][locale] ?? P[key].en;

/** Поточна година доставки — окремо, бо всередині число й пояс. */
export const timeNow = (locale: Locale, hour: number, zone: string): string => {
  const h = `${String(hour).padStart(2, "0")}:00`;
  const map: Phrase = {
    en: `Right now the digest arrives at ${h} your time (${zone}).`,
    uk: `Зараз добірка приходить о ${h} за твоїм часом (${zone}).`,
    fr: `Actuellement la sélection arrive à ${h} votre heure (${zone}).`,
    ru: `Сейчас подборка приходит в ${h} по твоему времени (${zone}).`,
  };
  return map[locale] ?? map.en;
};

export const timeSet = (locale: Locale, hour: number, zone: string): string => {
  const h = `${String(hour).padStart(2, "0")}:00`;
  const map: Phrase = {
    en: `Done. Digests will arrive at ${h} your time (${zone}).`,
    uk: `Готово. Добірки приходитимуть о ${h} за твоїм часом (${zone}).`,
    fr: `C'est fait. Les sélections arriveront à ${h} votre heure (${zone}).`,
    ru: `Готово. Подборки будут приходить в ${h} по твоему времени (${zone}).`,
  };
  return map[locale] ?? map.en;
};

/**
 * Команди, які Telegram показує в меню бота.
 *
 * Реєструються через setMyCommands на кожну мову окремо, тож людина бачить
 * підписи своєю. /start тут обов'язковий: без нього в новому чаті немає навіть
 * кнопки, з якої почати.
 */
export const COMMANDS: Array<{ command: string; label: Phrase }> = [
  { command: "start",    label: { en: "Start over", uk: "Почати спочатку", fr: "Recommencer", ru: "Начать заново" } },
  { command: "profile",  label: { en: "Your profile", uk: "Твій профіль", fr: "Votre profil", ru: "Твой профиль" } },
  { command: "time",     label: { en: "Delivery hour", uk: "Година доставки", fr: "Heure d'envoi", ru: "Час доставки" } },
  { command: "pause",    label: { en: "Pause digests", uk: "Призупинити добірки", fr: "Mettre en pause", ru: "Приостановить" } },
  { command: "resume",   label: { en: "Resume digests", uk: "Відновити добірки", fr: "Reprendre", ru: "Возобновить" } },
  { command: "site",     label: { en: "Sign in on the web", uk: "Вхід на сайт", fr: "Accès au site", ru: "Вход на сайт" } },
  { command: "feedback", label: { en: "Tell us what is wrong", uk: "Сказати, що не так", fr: "Signaler un problème", ru: "Сказать, что не так" } },
  { command: "help",     label: { en: "What I can do", uk: "Що я вмію", fr: "Ce que je sais faire", ru: "Что я умею" } },
  { command: "delete",   label: { en: "Erase everything", uk: "Видалити все", fr: "Tout effacer", ru: "Удалить всё" } },
];
