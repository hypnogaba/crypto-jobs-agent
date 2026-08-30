"use client";

import { useFormStatus } from "react-dom";

/**
 * Кнопка, яка каже, що вона працює.
 *
 * Приймання посилань ходить у мережу за кожним із них — вісім посилань це
 * близько чотирьох секунд. Звичайна кнопка форми на цей час не змінюється
 * ніяк, і людина, яка не бачить руху, тисне ще раз. Так і сталось: у журналі
 * лежало п'ять однакових спроб поспіль.
 */
export function SubmitButton({ children, busy, className = "btn px-4 py-2 text-sm" }: {
  children: React.ReactNode; busy: string; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}
            style={pending ? { opacity: 0.6, cursor: "progress" } : undefined}>
      {pending ? busy : children}
    </button>
  );
}
