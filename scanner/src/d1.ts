export interface D1Credentials { accountId: string; databaseId: string; token: string }
export interface D1Statement { sql: string; params?: unknown[] }

interface D1Envelope<T> {
  success: boolean;
  result: Array<{ success: boolean; results?: T[]; meta?: unknown }>;
  errors: Array<{ code: number; message: string }>;
}

/** D1 не любить величезні пакети; 50 інструкцій за виклик — безпечно. */
const MAX_PER_CALL = 50;

/**
 * D1 через REST API. Скан живе на звичайному сервері, а не в Worker,
 * тому прив'язки D1 немає — усе йде по HTTPS.
 */
export interface D1Options {
  fetchImpl?: typeof fetch;
  /** Скільки разів пробувати. Мережа й 5xx — повтор; 4xx — ні. */
  attempts?: number;
  /** Пауза перед другою спробою; далі подвоюється. */
  retryDelayMs?: number;
  /** Скільки чекати одну відповідь. */
  timeoutMs?: number;
}

/** Повтор має сенс лише там, де наступна спроба може дати інший результат. */
const RETRYABLE = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524]);

export class D1Client {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly creds: D1Credentials, opts: D1Options | typeof fetch = {}) {
    // Другим аргументом досі приймали fetch напряму — лишаємо це для старих викликів.
    const o: D1Options = typeof opts === "function" ? { fetchImpl: opts } : opts;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.attempts = o.attempts ?? 3;
    this.retryDelayMs = o.retryDelayMs ?? 1_000;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${creds.databaseId}/query`;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const env = await this.post<T>({ sql, params });
    return env.result[0]?.results ?? [];
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.post({ sql, params });
  }

  async batch(statements: D1Statement[]): Promise<void> {
    for (let i = 0; i < statements.length; i += MAX_PER_CALL) {
      const chunk = statements.slice(i, i + MAX_PER_CALL);
      await this.post({ batch: chunk.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    }
  }

  /**
   * Один POST із повторами.
   *
   * Cloudflare API час від часу відповідає 5xx або просто рве з'єднання;
   * без повторів це валило цілий скан або добірку через одну з сотень
   * інструкцій. Повторюємо лише те, де наступна спроба може вдатись:
   * мережеві збої, таймаут і 5xx. 4xx повертаються одразу — там винні ми.
   */
  private async post<T>(body: unknown): Promise<D1Envelope<T>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await this.postOnce<T>(body);
      } catch (e) {
        lastError = e;
        const retryable = e instanceof D1TransientError || !(e instanceof D1HttpError);
        if (!retryable || attempt === this.attempts) throw e;
        const wait = this.retryDelayMs * 2 ** (attempt - 1);
        console.log(`  D1: спроба ${attempt}/${this.attempts} не вдалась (${describe(e)}), повтор через ${wait} мс`);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastError;
  }

  private async postOnce<T>(body: unknown): Promise<D1Envelope<T>> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text();
      // Найчастіша причина мовчазної смерті скану: у /etc покладено тимчасовий
      // OAuth-токен wrangler, який живе близько години. Кажемо це прямо.
      if (res.status === 401 || res.status === 403) {
        // Найчастіша причина мовчазної смерті скану. Самооновити такий токен
        // не можна: refresh-токен Cloudflare одноразовий і ротується, тому
        // сервер і локальний wrangler б'ються за один і той самий, а сам
        // wrangler оновлює доступ лише в пам'яті свого процесу.
        throw new D1HttpError(
          "D1 відмовив у доступі. Майже напевно CF_API_TOKEN — це тимчасовий " +
          "OAuth-токен wrangler, який діє близько години. Потрібен постійний " +
          "API-токен із правом D1:Edit у /etc/nextrole-scanner.env. " +
          "Створити: dash.cloudflare.com → My Profile → API Tokens → Create Custom Token.");
      }
      if (RETRYABLE.has(res.status)) throw new D1TransientError(`D1 HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new D1HttpError(`D1 HTTP ${res.status}: ${body}`);
    }
    const env = (await res.json()) as D1Envelope<T>;
    if (!env.success) {
      // Помилка в самому SQL — повтор не допоможе.
      throw new D1HttpError(`D1 помилка: ${env.errors.map((e) => e.message).join("; ") || "невідома"}`);
    }
    return env;
  }
}

/** Відповідь прийшла, і вона остаточна: наш SQL, наш токен, наш запит. */
export class D1HttpError extends Error { override name = "D1HttpError"; }
/** Відповідь 5xx: сервер, не ми. Варто спробувати ще. */
export class D1TransientError extends D1HttpError { override name = "D1TransientError"; }

const describe = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  return cause instanceof Error ? `${e.message}: ${cause.message}` : e.message;
};
