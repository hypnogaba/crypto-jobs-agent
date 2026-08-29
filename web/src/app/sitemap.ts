import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE, URL_LOCALES, pathFor } from "@/lib/seo";

/**
 * Карта сайту.
 *
 * Список адрес тримає seo.ts, а не цей файл: robots.ts і метадані сторінок
 * рахують ті самі шляхи, і три окремі копії списку розійшлися б при першому ж
 * додаванні сторінки.
 *
 * Кожен запис несе `alternates.languages` — той самий набір hreflang, що й у
 * <head> сторінки. Google приймає обидва способи, але вимагає, щоб вони
 * збігалися; тому й там, і тут вони будуються з одного pathFor().
 *
 * lastModified — дата збірки, і це чесно саме тому, що весь текст цих сторінок
 * лежить у коді. Живі числа на головній беруться з бази, але вони не той
 * вміст, за яким пошук вирішує переобходити сторінку.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const abs = (p: string) => (p === "/" ? SITE : `${SITE}${p}`);

  const languages = (path: (typeof PUBLIC_PATHS)[number]) =>
    Object.fromEntries(URL_LOCALES.map((l) => [l, abs(pathFor(l, path))]));

  return PUBLIC_PATHS.flatMap((path) =>
    URL_LOCALES.map((locale) => ({
      url: abs(pathFor(locale, path)),
      lastModified,
      changeFrequency: path === "/" ? ("daily" as const) : ("monthly" as const),
      // Українські сторінки трохи нижче за англійські не тому, що гірші, а
      // тому, що пріоритет — це підказка про порядок обходу всередині сайту,
      // а англійських даних у нас на порядок більше.
      priority: (path === "/" ? 1 : 0.6) * (locale === "en" ? 1 : 0.9),
      alternates: { languages: languages(path) },
    })),
  );
}
