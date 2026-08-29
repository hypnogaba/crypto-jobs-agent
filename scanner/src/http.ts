import type { RawJob, SourceResult } from "./types.js";

/**
 * Джерело недоступне — двері зачинені, а не кімната порожня.
 * Уся драбина, самолікування й watchdog спираються саме на цю різницю.
 */
export class SourceUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}

/**
 * Двері зачинені назавжди. 429 сюди НЕ входить: це «занадто швидко»,
 * а не «мертве» — його треба перечекати, інакше живе джерело помилково
 * потрапляє в мертві.
 */
const BROKEN = new Set([401, 402, 403, 404, 406, 410]);
export const isBrokenStatus = (s: number): boolean => BROKEN.has(s);

const CHALLENGE = ["just a moment", "attention required", "checking your browser", "enable javascript and cookies"];

/**
 * Getro прискіпливий до Accept: без нього віддає 406, і з переліком типів
 * (application/json плюс application/xml плюс зірочка) — теж 406. Приймає рівно
 * "application/json". Тому JSON і XML мають різні набори заголовків.
 */
const JSON_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; nextrole-scanner/1.0; +https://nextrole.info)",
};

const XML_HEADERS: Record<string, string> = {
  Accept: "application/xml, text/xml, application/rss+xml, */*",
  "User-Agent": "Mozilla/5.0 (compatible; nextrole-scanner/1.0; +https://nextrole.info)",
};

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

async function fetchText(url: string, init: RequestInit, o: FetchOptions, base: Record<string, string> = JSON_HEADERS): Promise<string> {
  const { fetchImpl = fetch, timeoutMs = 25_000, retries = 2, retryDelayMs = 800 } = o;
  let last = "невідома помилка";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { ...base, ...(init.headers as Record<string, string> | undefined) },
      });
      if (isBrokenStatus(res.status)) {
        throw new SourceUnavailableError(`${url} → ${res.status}`, res.status);
      }
      if (res.status === 429) {
        // Поважаємо Retry-After, але не чекаємо довше хвилини
        const hinted = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        const waitMs = Math.min(
          Number.isNaN(hinted) ? retryDelayMs * 2 ** (attempt + 1) : hinted * 1000,
          60_000);
        last = `${url} → 429, чекаю ${Math.round(waitMs / 1000)} с`;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new SourceUnavailableError(`${url} → 429 після ${retries + 1} спроб`, 429);
      }
      if (!res.ok) {
        last = `${url} → ${res.status}`;
      } else {
        const text = await res.text();
        if (CHALLENGE.some((m) => text.slice(0, 600).toLowerCase().includes(m))) {
          throw new SourceUnavailableError(`${url} віддав сторінку-заглушку захисту`);
        }
        return text;
      }
    } catch (e) {
      if (e instanceof SourceUnavailableError) throw e;
      last = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries && retryDelayMs > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  throw new SourceUnavailableError(`${url} не відповів після повторів: ${last}`);
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, o: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, init, o);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceUnavailableError(`${url} віддав не JSON`);
  }
}

export async function fetchXml(url: string, init: RequestInit = {}, o: FetchOptions = {}): Promise<string> {
  return fetchText(url, init, o, XML_HEADERS);
}

/** Обгортка: збій джерела стає даними, а не винятком. */
export async function runSource(source: string, fn: () => Promise<RawJob[]>): Promise<SourceResult> {
  try {
    return { source, ok: true, jobs: await fn() };
  } catch (e) {
    const rateLimited = e instanceof SourceUnavailableError && e.status === 429;
    return {
      source,
      ok: false,
      jobs: [],
      broken: e instanceof SourceUnavailableError && !rateLimited,
      rateLimited,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Обмежувач паралелізму — щоб не бомбити один провайдер сотнями запитів. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
