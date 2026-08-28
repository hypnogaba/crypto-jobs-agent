import { run } from "@/lib/db";

/**
 * Облік звернень до моделі.
 *
 * Зараз система витрачає нуль: ключа в проді немає, і обидва місця виклику
 * мовчки переходять на розбір за ключовими словами. Облік з'являється до
 * ключа навмисно — щоб історія почалася з першого ж виклику, а не з дня,
 * коли хтось згадав про облік.
 *
 * Записуємо ТОКЕНИ, а не гроші. Ціна за токен змінюється й залежить від
 * моделі; вигадана ставка на панелі власника виглядала б як факт. Долари
 * рахуємо тоді, коли ставку внесено свідомо.
 */
export interface Usage {
  operation: string;          // parse_profile | match_reason
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
}

/**
 * Ніколи не кидає: облік не має права зламати те, що обліковує. Виклик
 * моделі, який упав через запис у журнал, був би гіршим за відсутність
 * журналу.
 */
export async function logUsage(u: Usage): Promise<void> {
  try {
    await run(
      `INSERT INTO api_usage (id,service,operation,model,input_tokens,output_tokens,cost_usd,ok)
       VALUES (?,'anthropic',?,?,?,?,0,?)`,
      crypto.randomUUID(), u.operation, u.model, u.inputTokens, u.outputTokens, u.ok ? 1 : 0);
  } catch { /* журнал не важливіший за роботу */ }
}

/** Дістає лічильники з відповіді Anthropic; чого немає — нуль. */
export function readUsage(data: unknown): { input: number; output: number } {
  const u = (data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
  return { input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0 };
}
