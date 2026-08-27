"use client";

/** Межа помилки. Досі порожній ввід приводив людину на дефолтну сторінку Next. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0d1b26", color: "#e8eef3", fontFamily: "Georgia, serif",
                     minHeight: "100vh", display: "grid", placeItems: "center", margin: 0, padding: "2rem" }}>
        <main style={{ maxWidth: "30rem", textAlign: "center" }}>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: ".7rem", letterSpacing: ".16em",
                      textTransform: "uppercase", color: "#93a5b3" }}>NextRole</p>
          <h1 style={{ fontSize: "2rem", margin: "1rem 0 0", lineHeight: 1.1 }}>Something broke on our side.</h1>
          <p style={{ color: "#93a5b3", marginTop: ".75rem", lineHeight: 1.6 }}>
            Nothing you did caused this, and nothing you entered was lost.
          </p>
          <button onClick={reset}
            style={{ marginTop: "2rem", background: "#b34a1e", color: "#fff", border: "1px solid #b34a1e",
                     borderRadius: 3, padding: ".7rem 1.3rem", cursor: "pointer", font: "inherit", fontSize: ".95rem" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
