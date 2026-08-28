"use client";

import { useSyncExternalStore } from "react";
import { isLocale, t } from "@/lib/i18n";
import type { Locale } from "@/lib/vocab";

/**
 * Межа помилки для сторінок.
 *
 * Живе ВСЕРЕДИНІ кореневого layout, тому не рендерить власних html і body —
 * це підпис global-error.tsx, який замінює layout цілком. Раніше тут був
 * повний документ, тобто документ у документі.
 *
 * Оскільки layout на місці, тут працюють і токени теми, і шрифти. Мову
 * доводиться читати з куки на клієнті: межі помилок мусять бути клієнтськими
 * компонентами, а detectLocale — серверна.
 */
// Кука — зовнішні дані, тож читаємо їх призначеним для цього способом, а не
// під час рендеру: інакше значення на сервері й на клієнті розходяться.
const NEVER_CHANGES = () => () => {};
const readLocale = (): Locale => {
  const raw = document.cookie.split("; ").find((c) => c.startsWith("nr_locale="))?.slice(10);
  return raw && isLocale(raw) ? raw : "en";
};
const onServer = (): Locale => "en";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const locale = useSyncExternalStore(NEVER_CHANGES, readLocale, onServer);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-6 text-center">
      <div>
        <p className="eyebrow">500</p>
        <h1 className="display mt-3 text-3xl">{t(locale, "err.title")}</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{t(locale, "err.body")}</p>
        <button type="button" onClick={reset} className="btn mt-8">{t(locale, "err.retry")}</button>
      </div>
    </main>
  );
}
