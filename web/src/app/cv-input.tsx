"use client";

import { useRef, useState } from "react";

/**
 * Поле «прикріпи резюме»: скріпка, підказка з межею і назва обраного файлу.
 *
 * Три речі, яких тут бракувало.
 *
 * По-перше, межа була невидима. Копія казала лише «PDF або звичайний текст»,
 * а чотири мегабайти жили в коді — тобто людина дізнавалась про стелю тільки
 * тоді, коли в неї впирався її файл.
 *
 * По-друге, завеликий файл усе одно вирушав на сервер: браузер тягнув
 * мегабайти, дія їх приймала й відповідала помилкою. Тепер `size` видно ще
 * до відправки, тож зайвого завантаження немає взагалі.
 *
 * По-третє, обраний файл ніяк не показувався: поле сховане (`sr-only`) у
 * підписі, і після вибору сторінка виглядала так само, як до нього.
 *
 * Без JavaScript усе це просто не працює — і нічого не ламає: `accept` і
 * перевірка в cv.ts лишаються на місці, а завеликий файл отримує ту саму
 * помилку `err.tooBig` з сервера.
 */
export default function CvInput({
  maxBytes, label, hint, tooBig,
}: {
  maxBytes: number;
  /** Підпис для читача з екрана — сама скріпка нічого не каже. */
  label: string;
  /** Готова підказка: число в неї вже підставила сторінка. */
  hint: string;
  /** Готова копія `err.tooBig`: та сама, що прийшла б із сервера. */
  tooBig: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState(false);

  return (
    <>
      <label className="icon-btn" title={label}>
        <span className="sr-only">{label}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <input
          ref={input} type="file" name="cv" className="sr-only"
          accept=".pdf,.txt,.md,text/plain,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) { setPicked(null); setError(false); return; }
            if (file.size > maxBytes) {
              // Поле чистимо: інакше форма понесе файл, який ми щойно
              // назвали завеликим, і людина побачить ту саму помилку вдруге.
              if (input.current) input.current.value = "";
              setPicked(null);
              setError(true);
              return;
            }
            setPicked(file.name);
            setError(false);
          }}
        />
      </label>
      <span className="min-w-0 truncate text-xs" style={{ color: error ? "var(--ember)" : "var(--muted)" }}>
        {error ? tooBig : picked ?? hint}
      </span>
    </>
  );
}
