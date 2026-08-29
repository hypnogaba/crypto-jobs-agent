import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE } from "@/lib/seo";

/**
 * Карта сайту.
 *
 * Список адрес тримає seo.ts, а не цей файл: robots.ts і метадані сторінок
 * рахують ті самі шість шляхів, і три окремі копії списку розійшлися б при
 * першому ж додаванні сторінки.
 *
 * lastModified — дата збірки, і це чесно саме тому, що весь вміст цих шести
 * сторінок лежить у коді. Живі числа на головній беруться з бази, але вони
 * не той вміст, за яким пошук вирішує переобходити сторінку.
 *
 * hreflang тут поки немає свідомо: чотири мови віддаються на одній адресі
 * через куку, тож альтернативної адреси, на яку можна послатись, не існує.
 * З'явиться разом із /uk/ — інакше ми оголосили б посилання в нікуди.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((p) => ({
    url: p === "/" ? SITE : `${SITE}${p}`,
    lastModified,
    changeFrequency: p === "/" ? ("daily" as const) : ("monthly" as const),
    priority: p === "/" ? 1 : 0.6,
  }));
}
