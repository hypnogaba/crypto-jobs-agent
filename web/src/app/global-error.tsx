"use client";

/**
 * Межа помилки для самого кореневого layout.
 *
 * Замінює документ цілком, тому мусить мати власні html і body — і, за
 * документацією Next, НЕ підхоплює глобальні стилі. Тому кольори тут зашиті:
 * ні токени теми, ні шрифти сюди не доходять, і перемикач теми теж.
 *
 * Це найгірший можливий стан застосунку, тож текст двома мовами й без жодної
 * залежності: якщо сюди дійшло, покладатись уже нема на що.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="uk">
      <body style={{
        margin: 0, minHeight: "100vh", display: "grid", placeItems: "center",
        background: "#0d1b26", color: "#e8eef3", padding: "24px",
        fontFamily: "ui-sans-serif, system-ui, sans-serif", textAlign: "center",
      }}>
        <div style={{ maxWidth: "32rem" }}>
          <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: "0.68rem",
                      letterSpacing: "0.16em", color: "#93a5b3" }}>500</p>
          <h1 style={{ margin: "12px 0 0", fontFamily: "Georgia, serif", fontWeight: 400,
                       fontSize: "1.9rem", lineHeight: 1.1 }}>
            Щось зламалось на нашому боці.
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: "0.95rem", color: "#93a5b3" }}>
            Це не твоя провина. Спробуй ще раз — якщо повторюється, лагодити нам.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "#6c7f8e" }}>
            Something broke on our side. Not your fault — try again.
          </p>
          <button type="button" onClick={reset} style={{
            marginTop: "28px", background: "#b34a1e", color: "#fff", border: "1px solid #b34a1e",
            borderRadius: "3px", padding: "0.7rem 1.3rem", fontSize: "0.95rem", cursor: "pointer",
          }}>
            Спробувати ще раз · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
