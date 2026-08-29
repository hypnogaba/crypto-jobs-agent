import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Той самий псевдонім, що в tsconfig: без нього тест не може імпортувати
  // модуль, який десь усередині тягне «@/lib/…», і падає ще до першої перевірки.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
  },
});
