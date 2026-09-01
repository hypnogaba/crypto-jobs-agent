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
    en: "Hi. Every morning I send five jobs picked for you.\nThree questions, thirty seconds.",
    uk: "Привіт. Я щоранку надсилаю п'ять вакансій, підібраних під тебе.\nТри питання, тридцять секунд.",
    fr: "Bonjour. Chaque matin je vous envoie cinq offres choisies pour vous.\nTrois questions, trente secondes.",
    ru: "Привет. Я каждое утро присылаю пять вакансий, подобранных под тебя.\nТри вопроса, тридцать секунд.",
  },
  // «Протягом години» — бо сайт уже поставив запит на першу добірку в чергу
  // (delivery_requests); ту саму обіцянку дає кабінет. Далі — щодня о
  // вибраній годині, її рухає /time.
  linked: {
    en: "Linked. This chat now gets your batches.",
    uk: "Прив'язано. Добірки тепер приходять сюди.",
    fr: "Lié. Vos sélections arrivent désormais ici.",
    ru: "Привязано. Подборки теперь приходят сюда.",
  },
  // Після CV або прив'язки з сайту — та сама пропозиція, що й після анкети.
  firstOffer: {
    en: "Batches come on weekdays at {h} ({tz}). Next one: {when}.\n\nWant to see how it looks right now?",
    uk: "Добірки приходять у робочі дні о {h} ({tz}). Найближча: {when}.\n\nХочеш побачити, як це виглядає, вже зараз?",
    fr: "Les sélections arrivent en semaine à {h} ({tz}). Prochaine : {when}.\n\nVoir à quoi ça ressemble dès maintenant ?",
    ru: "Подборки приходят в рабочие дни в {h} ({tz}). Ближайшая: {when}.\n\nХочешь увидеть, как это выглядит, прямо сейчас?",
  },

  // Прив'язка через посилання з сайту — лише після підтвердження кнопкою:
  // інакше чуже посилання «отримай 5 вакансій» тихо переписувало б чат на
  // чужий акаунт, і все написане далі йшло б у чужий профіль.
  /** Відповідь на «не цікавить» по конкретній вакансії. */
  hidden: {
    en: "Got it — fewer jobs from this company from now on.",
    uk: "Зрозумів — далі менше вакансій від цієї компанії.",
    fr: "Compris — moins d\u2019offres de cette entreprise désormais.",
    ru: "Понял — дальше меньше вакансий от этой компании.",
  },

  linkAsk: {
    en: "Link this Telegram to the nextrole.info account that opened this link?\n\nSay no if someone else sent you this link — your messages and CV would go to their profile.",
    uk: "Прив'язати цей Telegram до акаунта на nextrole.info, з якого відкрито це посилання?\n\nЯкщо посилання тобі надіслав хтось інший — відмовся: твої повідомлення і резюме йшли б у його профіль.",
    fr: "Lier ce Telegram au compte nextrole.info qui a ouvert ce lien ?\n\nRefusez si quelqu’un d’autre vous a envoyé ce lien — vos messages et votre CV iraient dans son profil.",
    ru: "Привязать этот Telegram к аккаунту на nextrole.info, из которого открыта эта ссылка?\n\nЕсли ссылку прислал кто-то другой — откажись: твои сообщения и резюме шли бы в его профиль.",
  },
  linkYes: { en: "Yes, that’s me", uk: "Так, це я", fr: "Oui, c’est moi", ru: "Да, это я" },
  linkNo:  { en: "No", uk: "Ні", fr: "Non", ru: "Нет" },
  linkCancelled: {
    en: "Not linked. Nothing changed.",
    uk: "Не прив'язано. Нічого не змінилось.",
    fr: "Non lié. Rien n’a changé.",
    ru: "Не привязано. Ничего не изменилось.",
  },
  linkExpired: {
    en: "That link has expired. Refresh the connect page and try again.",
    uk: "Посилання застаріло. Онови сторінку підключення й спробуй ще раз.",
    fr: "Ce lien a expiré. Rafraîchissez la page de connexion et réessayez.",
    ru: "Ссылка устарела. Обнови страницу подключения и попробуй ещё раз.",
  },
  // Сканер розгрібає запити кожні дві хвилини, але має стелю на день —
  // обіцянка мусить збігатися з тим, що він справді робить.
  moreQueued: {
    en: "Searching — it arrives in a couple of minutes. At most 20 jobs a day, the rest tomorrow.",
    uk: "Шукаю — прийде за пару хвилин. Максимум 20 вакансій на день, решта завтра.",
    fr: "Je cherche — ça arrive dans quelques minutes. Au plus 20 offres par jour, le reste demain.",
    ru: "Ищу — придёт через пару минут. Максимум 20 вакансий в день, остальное завтра.",
  },
  // Кнопки під «Готово»: тестова добірка зараз або чекати планової.
  firstNow:    { en: "Send 5 now", uk: "Прислати 5 зараз", fr: "Envoyer 5 maintenant", ru: "Прислать 5 сейчас" },
  firstWait:   { en: "I’ll wait", uk: "Чекатиму", fr: "J’attendrai", ru: "Подожду" },
  firstQueued: {
    en: "Looking — five roles for your profile arrive in a couple of minutes, so you can see how the bot works. Then as agreed: {when}.",
    uk: "Шукаю — п'ять вакансій під твій профіль прийдуть за пару хвилин, щоб ти побачив, як працює бот. Далі — як домовилися: {when}.",
    fr: "Je cherche — cinq postes pour votre profil arrivent dans deux minutes, pour voir comment le bot fonctionne. Ensuite, comme convenu : {when}.",
    ru: "Ищу — пять вакансий под твой профиль придут через пару минут, чтобы ты увидел, как работает бот. Дальше — как договорились: {when}.",
  },
  firstAgreed: {
    en: "Agreed. See you {when}.",
    uk: "Домовились. До зустрічі {when}.",
    fr: "Entendu. À {when}.",
    ru: "Договорились. До встречи {when}.",
  },
  // Вільний текст від підключеної людини — це побажання, а не нова анкета.
  // Раніше такий текст переписував профіль порожніми сферами.
  wishNoted: {
    en: "Saved as a wish: «{text}». To change the profile field by field — /profile.",
    uk: "Записав як побажання: «{text}». Змінити профіль по пунктах — /profile.",
    fr: "Noté comme souhait : « {text} ». Pour modifier le profil champ par champ : /profile.",
    ru: "Записал как пожелание: «{text}». Изменить профиль по пунктам — /profile.",
  },
  wishSaved: {
    en: "Saved.", uk: "Записав.", fr: "Enregistré.", ru: "Записал.",
  },
  // Підсумок тепер стоїть просто над цим рядком, а меню — під ним: радити
  // тут /profile означало б слати людину по те, що вже в неї перед очима.
  fieldSaved: {
    en: "Saved. Pick another field, or you are done.",
    uk: "Записав. Обери ще пункт — або все.",
    fr: "Enregistré. Choisissez un autre champ, ou c'est tout.",
    ru: "Записал. Выбери ещё пункт — или всё.",
  },
  // /start у того, хто вже підключений: два чесні виходи, без мовчазного
  // стирання того, що вже є.
  startExisting: {
    en: "You already have a profile. Start over from scratch, or edit it field by field?",
    uk: "У тебе вже є профіль. Почати заново з нуля чи редагувати по пунктах?",
    fr: "Vous avez déjà un profil. Tout recommencer, ou le modifier champ par champ ?",
    ru: "У тебя уже есть профиль. Начать заново с нуля или редактировать по пунктам?",
  },
  startAgain: { en: "Start over", uk: "Почати заново", fr: "Recommencer", ru: "Начать заново" },
  startEdit:  { en: "Edit field by field", uk: "Редагувати по пунктах", fr: "Modifier champ par champ", ru: "Редактировать по пунктам" },
  langAsk: {
    en: "Which language?", uk: "Яка мова?", fr: "Quelle langue ?", ru: "Какой язык?",
  },
  langSet: {
    en: "Done. I will speak English from now on.",
    uk: "Готово. Далі говоритиму українською.",
    fr: "C'est fait. Je parlerai français désormais.",
    ru: "Готово. Дальше буду говорить по-русски.",
  },
  // Підказуємо той самий підпис, що стоїть у перемикачі на сайті — «ua».
  // Код мови `uk` теж приймається, але вчити треба того, що людина бачить.
  langBad: {
    en: "Use /lang ua, /lang en, /lang fr or /lang ru.",
    uk: "Напиши /lang ua, /lang en, /lang fr або /lang ru.",
    fr: "Utilisez /lang ua, /lang en, /lang fr ou /lang ru.",
    ru: "Напиши /lang ua, /lang en, /lang fr или /lang ru.",
  },
  zoneBad: {
    en: "I do not know that zone. Write it like Europe/Paris, or a city: Kyiv, Berlin, Dubai.",
    uk: "Не знаю такої зони. Напиши як Europe/Paris або містом: Київ, Берлін, Дубай.",
    fr: "Je ne connais pas ce fuseau. Écrivez-le comme Europe/Paris, ou une ville : Kyiv, Berlin, Dubaï.",
    ru: "Не знаю такой зоны. Напиши как Europe/Paris или городом: Киев, Берлин, Дубай.",
  },
  zoneSet: {
    en: "Done. Your zone is {zone}.", uk: "Готово. Твоя зона — {zone}.",
    fr: "C'est fait. Votre fuseau : {zone}.", ru: "Готово. Твоя зона — {zone}.",
  },
  timeBadHour: {
    en: "I could not read that as a time. Write it like 14:30.",
    uk: "Не зрозумів це як час. Напиши як 14:30.",
    fr: "Je n'ai pas compris l'heure. Écrivez-la comme 14:30.",
    ru: "Не понял это как время. Напиши как 14:30.",
  },
  askWhy: {
    en: "What was wrong with them?",
    uk: "Що з ними було не так?",
    fr: "Qu'est-ce qui n'allait pas ?",
    ru: "Что с ними было не так?",
  },
  whySphere: {
    en: "Wrong role", uk: "Не та роль", fr: "Mauvais poste", ru: "Не та роль",
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
    en: "Wrong industry", uk: "Не та галузь", fr: "Mauvais secteur", ru: "Не та отрасль",
  },
  whyStale: {
    en: "Already closed", uk: "Вакансію вже закрито", fr: "Offre déjà fermée", ru: "Вакансия уже закрыта",
  },
  whyLevel: {
    en: "Too senior for me", uk: "Занадто senior для мене",
    fr: "Trop senior pour moi", ru: "Слишком senior для меня",
  },
  askLevelCap: {
    en: "Which level fits you? I will keep anything above it out of your digests.",
    uk: "Який рівень тобі підходить? Усе вище я більше не показуватиму.",
    fr: "Quel niveau vous convient ? Je ne montrerai plus rien au-dessus.",
    ru: "Какой уровень тебе подходит? Всё выше я больше показывать не буду.",
  },
  capJunior: { en: "Junior / entry", uk: "Junior, початковий", fr: "Junior / début", ru: "Junior, начальный" },
  capMid:    { en: "Mid",            uk: "Mid",                fr: "Confirmé",      ru: "Mid" },
  capSenior: { en: "Senior",         uk: "Senior",             fr: "Senior",        ru: "Senior" },
  learnedLevel: {
    en: "Set: nothing above {level}. Head, director and VP roles will not reach you at all. A fresh five is on its way, in a couple of minutes.",
    uk: "Записав: не вище за {level}. Head, director і VP до тебе більше не доїдуть узагалі. Нову п'ятірку вже готую, за пару хвилин.",
    fr: "Noté : rien au-dessus de {level}. Les postes head, director et VP ne vous parviendront plus. Une nouvelle sélection arrive dans deux minutes.",
    ru: "Записал: не выше {level}. Head, director и VP до тебя больше не доедут вообще. Новую пятёрку уже готовлю, через пару минут.",
  },
  noteApplied: {
    en: "Read it, and here is what I changed in your profile:",
    uk: "Прочитав. Ось що я змінив у твоєму профілі:",
    fr: "Lu. Voici ce que j'ai changé dans votre profil :",
    ru: "Прочитал. Вот что я изменил в твоём профиле:",
  },
  noteComing: {
    en: "A fresh five is on its way, in a couple of minutes.",
    uk: "Нову п'ятірку вже готую, за пару хвилин.",
    fr: "Une nouvelle sélection arrive dans deux minutes.",
    ru: "Новую пятёрку уже готовлю, через пару минут.",
  },
  noteUndo: {
    en: "That is not what I meant", uk: "Я мав на увазі не це",
    fr: "Ce n'est pas ce que je voulais dire", ru: "Я имел в виду не это",
  },
  noteUnclear: {
    en: "Written down, and I read every one of these. But I could not turn it into a profile change on my own — the surest way is /profile.",
    uk: "Записав, і я читаю кожне таке повідомлення. Але сам перетворити це на зміну профілю не зміг — найпевніший шлях це /profile.",
    fr: "Consigné, et je les lis toutes. Mais je n'ai pas su en tirer une modification du profil — le plus sûr reste /profile.",
    ru: "Записал, и я читаю каждое такое сообщение. Но сам превратить это в изменение профиля не смог — самый верный путь это /profile.",
  },
  editLevel: {
    en: "Level ceiling: nothing above {level}",
    uk: "Стеля рівня: не вище за {level}",
    fr: "Plafond de niveau : rien au-dessus de {level}",
    ru: "Потолок уровня: не выше {level}",
  },
  editSalaryMin: {
    en: "Pay from {sum} a month", uk: "Зарплата від {sum} на місяць",
    fr: "Salaire à partir de {sum} par mois", ru: "Зарплата от {sum} в месяц",
  },
  editSalaryMax: {
    en: "Pay up to {sum} a month", uk: "Зарплата до {sum} на місяць",
    fr: "Salaire jusqu'à {sum} par mois", ru: "Зарплата до {sum} в месяц",
  },
  editWishes: {
    en: "Added to your wishes: {text}", uk: "Додав у побажання: {text}",
    fr: "Ajouté à vos souhaits : {text}", ru: "Добавил в пожелания: {text}",
  },
  undoDone: {
    en: "Rolled back. The profile is as it was, and the next digest goes by the old rules.",
    uk: "Повернув як було. Профіль у попередньому стані, наступна добірка йде за старими правилами.",
    fr: "Annulé. Le profil est revenu à son état précédent.",
    ru: "Вернул как было. Профиль в прежнем состоянии, следующая подборка идёт по старым правилам.",
  },
  undoNothing: {
    en: "Nothing to roll back — I have not changed your profile.",
    uk: "Скасовувати нічого: твій профіль я не міняв.",
    fr: "Rien à annuler : je n'ai pas modifié votre profil.",
    ru: "Отменять нечего: твой профиль я не менял.",
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
    en: "Noted. Weights will not fix this one — the role itself needs changing: /profile → Role.",
    uk: "Прийняв. Вагами це не лікується — треба міняти саму роль: /profile → Роль.",
    fr: "Noté. Les pondérations n'y changeront rien — il faut modifier le poste : /profile → Poste.",
    ru: "Принял. Весами это не лечится — нужно менять саму роль: /profile → Роль.",
  },
  noted: {
    en: "Thanks, noted. Tomorrow's digest will be closer.",
    uk: "Дякую, врахую. Завтрашня добірка буде точнішою.",
    fr: "Merci, c'est noté. La sélection de demain sera plus juste.",
    ru: "Спасибо, учту. Завтрашняя подборка будет точнее.",
  },
  startFirst: {
    en: "Send /start first, so I know what work to look for.",
    uk: "Спершу /start, щоб я знав, яку роботу шукати.",
    fr: "Envoyez d'abord /start, que je sache quoi chercher.",
    ru: "Сначала /start, чтобы я знал, какую работу искать.",
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
    en: "To change it: /time 9, or with a zone: /time 9 Europe/Paris. The zone alone: /profile → Hour.",
    uk: "Щоб змінити: /time 9, або разом із зоною: /time 9 Europe/Paris. Лише зону — /profile → Година.",
    fr: "Pour changer : /time 9, ou avec le fuseau : /time 9 Europe/Paris. Le fuseau seul : /profile → Heure.",
    ru: "Чтобы изменить: /time 9, или вместе с зоной: /time 9 Europe/Paris. Только зону — /profile → Час.",
  },
  timeZoneHint: {
    en: "The zone comes from your city or the hour you picked, not measured. If it is wrong: /profile → Hour.",
    uk: "Зона — з твого міста або з обраної години, а не виміряна. Якщо вона не та: /profile → Година.",
    fr: "Le fuseau vient de votre ville ou de l'heure choisie, pas mesuré. S'il est faux : /profile → Heure.",
    ru: "Зона — из твоего города или выбранного часа, а не измерена. Если она не та: /profile → Час.",
  },
  timeBad: {
    en: "The hour must be a number from 0 to 23. For example: /time 9",
    uk: "Година має бути числом від 0 до 23. Наприклад: /time 9",
    fr: "L'heure doit être un nombre de 0 à 23. Par exemple : /time 9",
    ru: "Час должен быть числом от 0 до 23. Например: /time 9",
  },
  noProfile: {
    en: "No profile yet. Send /start and I will ask three questions.",
    uk: "Профілю ще немає. Напиши /start, і я поставлю три питання.",
    fr: "Pas encore de profil. Envoyez /start et je poserai trois questions.",
    ru: "Профиля ещё нет. Напиши /start, и я задам три вопроса.",
  },
  deleteAsk: {
    en: "This erases your profile, your history and your CV text. It cannot be undone. Sure?",
    uk: "Це зітре профіль, історію добірок і текст резюме. Скасувати неможливо. Точно?",
    fr: "Cela efface votre profil, votre historique et le texte de votre CV. Irréversible. Sûr ?",
    ru: "Это сотрёт профиль, историю подборок и текст резюме. Отменить нельзя. Точно?",
  },
  deleteYes: { en: "Yes, erase everything", uk: "Так, видалити все", fr: "Oui, tout effacer", ru: "Да, удалить всё" },
  deleteNo:  { en: "Cancel", uk: "Скасувати", fr: "Annuler", ru: "Отмена" },
  deleteKept: {
    en: "Nothing was deleted.", uk: "Нічого не видалено.", fr: "Rien n'a été supprimé.", ru: "Ничего не удалено.",
  },
  deleted: {
    en: "Account and all data deleted. Want to come back? Just /start.",
    uk: "Видалив акаунт і всі дані. Захочеш повернутись — просто /start.",
    fr: "Compte et données supprimés. Pour revenir : /start.",
    ru: "Удалил аккаунт и все данные. Захочешь вернуться — просто /start.",
  },
  help: {
    en: "/profile — your profile, edit any field\n/time — delivery hour\n/lang — language\n/pause and /resume — pause\n/site — sign in on the web\n/feedback — tell us what is wrong\n/delete — erase everything\n\nSend your CV as a file (PDF, DOCX) and I will fill the profile from it.\nAny plain text is saved as a wish.",
    uk: "/profile — твій профіль, правка по пунктах\n/time — година доставки\n/lang — мова\n/pause і /resume — пауза\n/site — вхід на сайт\n/feedback — сказати, що не так\n/delete — видалити все\n\nНадішли резюме файлом (PDF, DOCX) — заповню профіль із нього.\nБудь-який звичайний текст записується як побажання.",
    fr: "/profile — votre profil, champ par champ\n/time — heure d'envoi\n/lang — langue\n/pause et /resume — pause\n/site — accès au site\n/feedback — dire ce qui ne va pas\n/delete — tout effacer\n\nEnvoyez votre CV en fichier (PDF, DOCX) — je remplirai le profil.\nTout texte libre est enregistré comme souhait.",
    ru: "/profile — твой профиль, правка по пунктам\n/time — час доставки\n/lang — язык\n/pause и /resume — пауза\n/site — вход на сайт\n/feedback — сказать, что не так\n/delete — удалить всё\n\nПришли резюме файлом (PDF, DOCX) — заполню профиль из него.\nЛюбой обычный текст записывается как пожелание.",
  },
  feedbackAsk: {
    en: "What is wrong, or what is missing? Anything — a bug, an idea, a feature you want. One message, straight to the person who builds this.",
    uk: "Що не так або чого бракує? Будь-що — поломка, ідея, потрібна функція. Одним повідомленням, прямо до людини, яка це робить.",
    fr: "Qu'est-ce qui ne va pas, ou qu'est-ce qui manque ? N'importe quoi — un bug, une idée, une fonctionnalité. Un message, directement à celui qui construit ça.",
    ru: "Что не так или чего не хватает? Что угодно — поломка, идея, нужная функция. Одним сообщением, прямо к человеку, который это делает.",
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
  // /start у підключеного не перезапускає анкету, тож радити його тут —
  // обман. Правка йде кнопками нижче; резюме файлом лишається.
  profileHow: {
    en: "Pick a field below to change it. A CV file also works — it refills the profile.",
    uk: "Обери пункт нижче, щоб змінити. Резюме файлом теж підійде — воно перезаповнить профіль.",
    fr: "Choisissez un champ ci-dessous pour le modifier. Un CV en fichier fonctionne aussi — il remplit le profil à nouveau.",
    ru: "Выбери пункт ниже, чтобы изменить. Резюме файлом тоже подойдёт — оно перезаполнит профиль.",
  },
  orWrite: {
    en: "Describe yourself in one sentence (role, level, where, salary from) — or send your CV as a file (PDF, DOCX). Or just tap the buttons.",
    uk: "Опиши себе одним реченням (роль, рівень, де, від скільки) — або надішли резюме файлом (PDF, DOCX). Або тисни кнопки.",
    fr: "Décrivez-vous en une phrase (poste, niveau, où, salaire minimum) — ou envoyez votre CV en fichier (PDF, DOCX). Ou appuyez sur les boutons.",
    ru: "Опиши себя одним предложением (роль, уровень, где, от скольких) — или пришли резюме файлом (PDF, DOCX). Или жми кнопки.",
  },
  // Слова людини повертаються їй же. Мовчазне збереження нічим не
  // відрізняється від втраченого: на живому прогоні людина написала свою роль
  // двічі, бо після першого разу в чаті не змінилось нічого.
  ownSaved: {
    en: "Noted: «{value}»",
    uk: "Записав: «{value}»",
    fr: "Noté : «{value}»",
    ru: "Записал: «{value}»",
  },
  prefilled: {
    en: "I ticked what I understood. Fix anything that is wrong.",
    uk: "Я проставив те, що зрозумів. Виправ те, що не так.",
    fr: "J'ai coché ce que j'ai compris. Corrigez ce qui ne va pas.",
    ru: "Я отметил то, что понял. Исправь то, что не так.",
  },
  channel: {
    en: "News and what is new: t.me/nextroleinfo",
    uk: "Новини й що з'явилось: t.me/nextroleinfo",
    fr: "Actualités et nouveautés : t.me/nextroleinfo",
    ru: "Новости и что появилось: t.me/nextroleinfo",
  },
  adminLink: {
    en: "Owner panel, valid 15 minutes. The session then lasts 30 days.",
    uk: "Панель власника, посилання дійсне 15 хвилин. Далі сесія живе 30 днів.",
    fr: "Panneau propriétaire, lien valable 15 minutes. La session dure ensuite 30 jours.",
    ru: "Панель владельца, ссылка действует 15 минут. Дальше сессия живёт 30 дней.",
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
    en: "I could not read that file. PDF, DOCX or plain text works; a scan or a photo does not — there are no letters in a picture, only pixels.",
    uk: "Не зміг прочитати цей файл. Годиться PDF, DOCX або звичайний текст; скан чи фото — ні: у картинці немає літер, лише пікселі.",
    fr: "Je n'ai pas pu lire ce fichier. PDF, DOCX ou texte brut ; un scan ou une photo, non — une image ne contient pas de lettres.",
    ru: "Не смог прочитать этот файл. Подходит PDF, DOCX или обычный текст; скан или фото — нет: в картинке нет букв, только пиксели.",
  },
  /** Завеликий файл. Раніше на це йшов /help — тобто відповідь не про те. */
  cvTooBig: {
    en: "That file is over 4 MB — almost always a scan. A text PDF or DOCX weighs far less; export it again from the original.",
    uk: "Файл більший за 4 МБ — майже завжди це скан. Текстовий PDF чи DOCX важить набагато менше; збережи з оригіналу ще раз.",
    fr: "Ce fichier dépasse 4 Mo — c'est presque toujours un scan. Un PDF ou DOCX texte pèse bien moins ; réexportez-le depuis l'original.",
    ru: "Файл больше 4 МБ — почти всегда это скан. Текстовый PDF или DOCX весит намного меньше; сохрани из оригинала ещё раз.",
  },
  cvFailed: {
    en: "Something went wrong while reading it. Try again, or just write a sentence.",
    uk: "Щось пішло не так під час читання. Спробуй ще раз або просто напиши речення.",
    fr: "Un problème est survenu. Réessayez, ou écrivez simplement une phrase.",
    ru: "Что-то пошло не так при чтении. Попробуй ещё раз или просто напиши предложение.",
  },
  // Текст не команда від того, хто вже підключений. Раніше будь-які три
  // літери від такої людини переписували їй профіль порожніми сферами.
  freeTextHint: {
    en: "You have no profile yet — /start asks the questions. /help lists the rest.",
    uk: "Профілю ще немає — /start поставить питання. /help — решта.",
    fr: "Pas encore de profil — /start pose les questions. /help pour le reste.",
    ru: "Профиля ещё нет — /start задаст вопросы. /help — остальное.",
  },
  /**
   * Підтвердження, яке називає поле й значення.
   *
   * Раніше запис підтверджувало одне слово «Записав.» у хвості довгого
   * підсумку, ще й у ПЕРЕПИСАНОМУ повідомленні — у чаті нічого не
   * з'являлось, тож людина не бачила, чи її слова взагалі дійшли, і писала
   * те саме втретє.
   */
  savedFields: {
    en: "Recorded:",
    uk: "Записав:",
    fr: "Enregistré :",
    ru: "Записал:",
  },
  // Коротке слово посеред питань: кнопки чекають, а слово ні до чого не веде.
  useButtons: {
    en: "Use the buttons above, or write a full sentence about the work you want and I will tick the boxes.",
    uk: "Скористайся кнопками вище або напиши цілим реченням, яку роботу шукаєш, — я проставлю галочки.",
    fr: "Utilisez les boutons ci-dessus, ou écrivez une phrase complète sur le travail voulu et je cocherai pour vous.",
    ru: "Воспользуйся кнопками выше или напиши целым предложением, какую работу ищешь, — я проставлю галочки.",
  },
  // Цей Telegram уже тримає акаунт із історією добірок: мовчки перекинути
  // його на інший — втратити її. Людина сама обирає, куди заходити.
  alreadyLinked: {
    en: "This Telegram is already connected to an account that has received digests. Send /site to sign in to that one on the web.",
    uk: "Цей Telegram уже прив'язаний до акаунта, який отримував добірки. Напиши /site, щоб увійти в нього на сайті.",
    fr: "Ce Telegram est déjà relié à un compte qui a reçu des sélections. Envoyez /site pour y accéder sur le site.",
    ru: "Этот Telegram уже привязан к аккаунту, который получал подборки. Напиши /site, чтобы войти в него на сайте.",
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

/** Те саме з підстановкою `{name}` — для реплік, у яких є текст людини чи зона. */
export const tf = (key: CopyKey, locale: Locale, vars: Record<string, string>): string =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), t(key, locale));

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
  { command: "lang",     label: { en: "Language", uk: "Мова", fr: "Langue", ru: "Язык" } },
  { command: "pause",    label: { en: "Pause digests", uk: "Призупинити добірки", fr: "Mettre en pause", ru: "Приостановить" } },
  { command: "resume",   label: { en: "Resume digests", uk: "Відновити добірки", fr: "Reprendre", ru: "Возобновить" } },
  { command: "site",     label: { en: "Sign in on the web", uk: "Вхід на сайт", fr: "Accès au site", ru: "Вход на сайт" } },
  { command: "feedback", label: { en: "A bug, an idea, a wish", uk: "Поломка, ідея, побажання", fr: "Bug, idée, souhait", ru: "Поломка, идея, пожелание" } },
  { command: "news",     label: { en: "Our channel", uk: "Наш канал", fr: "Notre canal", ru: "Наш канал" } },
  { command: "admin",    label: { en: "Owner panel", uk: "Панель власника", fr: "Panneau propriétaire", ru: "Панель владельца" } },
  { command: "help",     label: { en: "What I can do", uk: "Що я вмію", fr: "Ce que je sais faire", ru: "Что я умею" } },
  { command: "delete",   label: { en: "Erase everything", uk: "Видалити все", fr: "Tout effacer", ru: "Удалить всё" } },
];
