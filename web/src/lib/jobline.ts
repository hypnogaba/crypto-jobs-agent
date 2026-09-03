/**
 * Чистка полів, які приходять із чужих дошок: локація й назва компанії.
 *
 * Та сама пара живе в scanner/src/digest.ts, бо сканер це окремий пакет і
 * коду веба не бачить. Копія навмисна: єдина альтернатива це спільний пакет
 * заради двадцяти рядків. Правити треба обидві, і про це знає тест.
 */

/** Скільки символів локації ще схожі на локацію, а не на абзац. */
const LOCATION_MAX = 60;

/**
 * Локація, якою її можна показати.
 *
 * Дошки на кшталт JobStash кладуть у поле location увесь текст оголошення.
 * У кабінеті це виглядало абзацом англійського тексту в рядку, де мало б
 * стояти місто.
 */
export function tidyLocation(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().replace(/[;,·|\-\s]+$/, "");
  if (!s) return null;
  if (s.length <= LOCATION_MAX) return s;
  const head = s.split(/(?<=[.;!?])\s/)[0]!.trim().replace(/[;,]$/, "");
  return head.length > 0 && head.length <= LOCATION_MAX ? head : null;
}

/** Назва компанії без доменного хвоста: «Oscilar.com» → «Oscilar». */
export function tidyCompany(name: string): string {
  const raw = name.trim();
  const m = /^([\p{L}\d][\p{L}\d&'-]{1,30})\.(?:com|io|net|org|xyz|ai|co|app|info|dev|finance|tech)$/iu.exec(raw);
  const stem = m ? m[1]! : raw;
  return /\p{Lu}/u.test(stem) ? stem : stem.charAt(0).toUpperCase() + stem.slice(1);
}
