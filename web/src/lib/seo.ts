/**
 * Як сайт представляється пошуку.
 *
 * Тут три речі, які легко зіпсувати поодинці й важко помітити:
 *   1. canonical — власна адреса сторінки;
 *   2. опис — свій на кожну сторінку, а не успадкований від головної;
 *   3. розмітка schema.org.
 *
 * Раніше canonical стояв один на весь сайт, у root layout. Next зливає
 * метадані батька в дитину, тому /faq, /sources і /privacy віддавали
 * <link rel="canonical" href="https://nextrole.info/">. Тобто сайт сам
 * просив пошук викинути власні сторінки. Через це і файл: щоб canonical
 * жив поруч з описом і його не можна було додати, забувши про другий.
 */

import type { Locale } from "./vocab";
import { t } from "./i18n";

export const SITE = "https://nextrole.info";

/** Публічні сторінки. Приватні під Disallow у robots.ts і сюди не входять. */
export const PUBLIC_PATHS = ["/", "/faq", "/sources", "/privacy", "/feedback", "/login"] as const;
export type PublicPath = (typeof PUBLIC_PATHS)[number];

/**
 * Опис сторінки — окремо від i18n.ts навмисно.
 *
 * i18n.ts — це тексти, які людина бачить; тут тексти, які бачить лише пошук.
 * Розділення також тримає мій діф подалі від i18n.ts, який зараз редагує
 * інша гілка.
 */
const DESCRIPTIONS: Record<Locale, Partial<Record<PublicPath, string>>> = {
  en: {
    "/": "Tell us what you are looking for once. Every morning we send five matching roles to your Telegram, each with a live link.",
    "/faq": "What NextRole costs, where the jobs come from, how to apply, and how to stop. Ten straight answers.",
    "/sources": "Every job board and employer hiring system NextRole reads, named and linked. Checked daily; a broken source is replaced, never quietly counted as empty.",
    "/privacy": "What NextRole stores, what it never stores, and how to delete everything. Your CV file is never kept.",
    "/feedback": "Tell us what is missing or wrong. Every message is read.",
    "/login": "Sign in to NextRole through Telegram. No password to remember.",
  },
  uk: {
    "/": "Скажіть один раз, яку роботу шукаєте. Щоранку надсилаємо п'ять відповідних вакансій у Telegram, кожну з живим посиланням.",
    "/faq": "Скільки коштує NextRole, звідки беруться вакансії, як подаватися і як зупинити розсилку. Десять прямих відповідей.",
    "/sources": "Усі дошки вакансій і системи наймання, які читає NextRole — з назвами й посиланнями. Перевіряємо щодня; зламане джерело замінюємо, а не рахуємо тихо як порожнє.",
    "/privacy": "Що NextRole зберігає, чого не зберігає ніколи і як видалити все. Файл резюме не лишається в нас.",
    "/feedback": "Напишіть, чого бракує або що працює не так. Читаємо кожне повідомлення.",
    "/login": "Вхід у NextRole через Telegram. Пароль не потрібен.",
  },
  fr: {
    "/": "Dites-nous une seule fois ce que vous cherchez. Chaque matin, cinq offres correspondantes arrivent sur votre Telegram, chacune avec un lien actif.",
    "/faq": "Le prix de NextRole, l'origine des offres, comment postuler et comment arrêter. Dix réponses directes.",
    "/sources": "Tous les sites d'emploi et systèmes de recrutement que lit NextRole, nommés et liés. Vérifiés chaque jour.",
    "/privacy": "Ce que NextRole conserve, ce qu'il ne conserve jamais, et comment tout supprimer. Votre CV n'est jamais stocké.",
    "/feedback": "Dites-nous ce qui manque ou ne va pas. Chaque message est lu.",
    "/login": "Connexion à NextRole via Telegram. Aucun mot de passe à retenir.",
  },
  ru: {
    "/": "Скажите один раз, какую работу ищете. Каждое утро присылаем пять подходящих вакансий в Telegram, каждую с живой ссылкой.",
    "/faq": "Сколько стоит NextRole, откуда берутся вакансии, как откликаться и как остановить рассылку. Десять прямых ответов.",
    "/sources": "Все доски вакансий и системы найма, которые читает NextRole — с названиями и ссылками. Проверяем ежедневно.",
    "/privacy": "Что NextRole хранит, чего не хранит никогда и как удалить всё. Файл резюме у нас не остаётся.",
    "/feedback": "Напишите, чего не хватает или что работает не так. Читаем каждое сообщение.",
    "/login": "Вход в NextRole через Telegram. Пароль не нужен.",
  },
};

/** Опис сторінки мовою людини. Немає перекладу — англійський, як і в t(). */
export function descriptionFor(locale: Locale, path: PublicPath): string {
  return DESCRIPTIONS[locale]?.[path] ?? DESCRIPTIONS.en[path] ?? DESCRIPTIONS.en["/"]!;
}

/**
 * Метадані публічної сторінки: назва, свій опис, своя canonical, своя картка.
 *
 * Повертає рівно те, що очікує generateMetadata. Сторінка не має складати
 * це вручну — саме ручне складання й дало три різні набори полів на шести
 * сторінках.
 */
export function pageMeta(locale: Locale, path: PublicPath, title: string) {
  const description = descriptionFor(locale, path);
  const url = path === "/" ? SITE : `${SITE}${path}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { url, title, description },
    twitter: { title, description },
  };
}

// ── schema.org ─────────────────────────────────────────────────
//
// Розмітка описує лише те, що на сторінці справді є. Зокрема тут навмисно
// НЕМАЄ WebSite.potentialAction/SearchAction: пошуку по сайту не існує, а
// розмітка неіснуючої можливості — це заявка, яку Google перевіряє й не
// підтверджує.

/** Хто ми. Один раз на сайт, у root layout. */
export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "NextRole",
    url: SITE,
    logo: `${SITE}/icon.svg`,
    description: DESCRIPTIONS.en["/"],
    sameAs: ["https://t.me/nextroleinfo"],
  };
}

/** Сайт як такий. Мови — ті, що сайт справді віддає. */
export function webSiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "NextRole",
    url: SITE,
    inLanguage: ["en", "uk", "fr", "ru"],
    publisher: { "@type": "Organization", name: "NextRole", url: SITE },
  };
}

/**
 * Питання й відповіді з /faq.
 *
 * Ключі приходять зі сторінки, а не дублюються тут: список питань має бути
 * в одному місці, інакше розмітка й видимий текст розійдуться, а це рівно
 * той випадок, за який Google знімає rich result.
 */
export function faqPageLd(locale: Locale, keys: readonly string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: keys.map((k) => ({
      "@type": "Question",
      name: t(locale, `faq.${k}.q`),
      acceptedAnswer: { "@type": "Answer", text: t(locale, `faq.${k}.a`) },
    })),
  };
}

/** Хлібні крихти. Головна плюс поточна сторінка — глибше вкладення нема. */
export function breadcrumbLd(name: string, path: PublicPath) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "NextRole", item: SITE },
      { "@type": "ListItem", position: 2, name, item: `${SITE}${path}` },
    ],
  };
}
