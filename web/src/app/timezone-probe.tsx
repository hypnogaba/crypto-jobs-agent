"use client";

import { useEffect } from "react";
import { recordTimezone } from "./actions";

/**
 * Тихе визначення часового поясу.
 *
 * Зона питається не в людини, а в її браузера — це той самий сигнал, що вже
 * використовує сторінка налаштувань, просто без ручного збереження.
 *
 * Рендериться ЛИШЕ тоді, коли в базі досі стоїть UTC, тож для більшості
 * людей цей код не виконується взагалі. Позначка в sessionStorage не дає
 * слати те саме на кожен перехід сторінкою.
 *
 * Чому це важливо: «щодня о 09:00» без зони означало 09:00 UTC — тобто
 * полудень за Києвом. Із зони ж виводиться ще й країна, а без неї людині
 * не показуються національні дошки.
 */
export default function TimezoneProbe() {
  useEffect(() => {
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return; }
    if (!tz || tz === "UTC") return;

    try {
      if (sessionStorage.getItem("nr_tz_sent") === tz) return;
      sessionStorage.setItem("nr_tz_sent", tz);
    } catch { /* приватне вікно — просто надішлемо ще раз */ }

    void recordTimezone(tz);
  }, []);

  return null;
}
