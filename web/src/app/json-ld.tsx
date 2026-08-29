/**
 * Розмітка schema.org у розмітці сторінки.
 *
 * `<` екрануємо навмисно. JSON.stringify лишає його як є, тому рядок, що
 * містить "</script>", закрив би тег і решта розмітки поїхала б у видимий
 * текст. Тексти сюди приходять зі словника, але словник редагують люди, і
 * покладатись на те, що ніхто ніколи не напише там тег, не варто.
 */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
