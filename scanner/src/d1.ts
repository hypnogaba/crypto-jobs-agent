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
export class D1Client {
  private readonly endpoint: string;

  constructor(private readonly creds: D1Credentials, private readonly fetchImpl: typeof fetch = fetch) {
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

  private async post<T>(body: unknown): Promise<D1Envelope<T>> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        throw new Error(
          "D1 відмовив у доступі. Майже напевно CF_API_TOKEN — це тимчасовий " +
          "OAuth-токен wrangler, який діє близько години. Потрібен постійний " +
          "API-токен із правом D1:Edit у /etc/nextrole-scanner.env. " +
          "Створити: dash.cloudflare.com → My Profile → API Tokens → Create Custom Token.");
      }
      throw new Error(`D1 HTTP ${res.status}: ${body}`);
    }
    const env = (await res.json()) as D1Envelope<T>;
    if (!env.success) {
      throw new Error(`D1 помилка: ${env.errors.map((e) => e.message).join("; ") || "невідома"}`);
    }
    return env;
  }
}
