/**
 * Сказати власнику, коли щось зламалось.
 *
 * Досі все — впалий скан, вердикт watchdog, збій доставки окремій людині —
 * ішло в `console.log`, тобто в journald на сервері. При шести тестових
 * акаунтах цього досить: власник і так дивиться. При ста живих людях
 * мовчазний збій у понеділок вранці означає сто людей без добірки й нікого,
 * хто про це знає, доки хтось не поскаржиться. А не поскаржиться майже ніхто
 * — люди просто йдуть.
 *
 * ПРАВИЛО: говоримо лише про погане. Щоденне «все добре» привчає його не
 * читати, і тоді перше справжнє повідомлення теж лишиться непрочитаним.
 *
 * Сповіщення НІКОЛИ не має права зламати те, про що воно сповіщає: усі збої
 * тут гасяться, і найгірше, що може статися, — рядок у журналі.
 */

/** Кому писати. Немає адреси — мовчимо, але голосно кажемо про це в журнал. */
const chatId = (): string | null => {
  const v = process.env.ADMIN_CHAT_ID?.trim();
  return v ? v : null;
};

const token = (): string | null => {
  const v = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return v ? v : null;
};

/** Telegram не любить довгих повідомлень, а власнику довгі й не потрібні. */
const MAX = 3500;

export async function notifyOwner(text: string): Promise<void> {
  const to = chatId();
  const tok = token();
  if (!to || !tok) {
    console.log(`[сповіщення нікуди не пішло: ${!tok ? "немає TELEGRAM_BOT_TOKEN" : "немає ADMIN_CHAT_ID"}] ${text}`);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: to,
        text: text.length > MAX ? `${text.slice(0, MAX)}…` : text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.log(`сповіщення не доставлено: ${res.status}`);
  } catch (e) {
    console.log(`сповіщення не доставлено: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Рядок про те, скільки людей постраждало.
 *
 * «Збій» без числа не дає вирішити, чи бігти до компʼютера. «Збій, троє з
 * шести» — дає.
 */
export const affected = (bad: number, total: number): string =>
  total > 0 ? `${bad} з ${total}` : String(bad);
