/**
 * Ціни Anthropic за мільйон токенів, USD (перевірено 2026-08-29).
 *
 * Дублікат у scanner/src/pricing.ts — пакети свідомо не імпортують один
 * одного. Змінюєш тут — зміни і там.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5":  { input: 2, output: 10 },
  "claude-opus-5":    { input: 5, output: 25 },
};

/** "claude-haiku-4-5-20251001" → "claude-haiku-4-5". */
function family(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/** Долари за один виклик. Невідома модель — 0, а не вигадана ставка. */
export function costUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const p = PRICES[family(model)];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
