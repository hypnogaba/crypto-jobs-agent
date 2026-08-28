"use client";

import { useRouter } from "next/navigation";

/**
 * Посилання, а не форма: браузер має відкрити вакансію в новій вкладці, а
 * маршрут /apply — лишити слід. Без JavaScript це працює так само, просто
 * мітка «Подано» з'явиться лише після оновлення сторінки; router.refresh()
 * прибирає цю затримку.
 */
export default function ApplyButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <a href={`/apply/${id}`} target="_blank" rel="noreferrer"
       onClick={() => setTimeout(() => router.refresh(), 400)}
       className="btn btn-quiet whitespace-nowrap px-3 py-1.5 text-xs">
      {label} ↗
    </a>
  );
}
