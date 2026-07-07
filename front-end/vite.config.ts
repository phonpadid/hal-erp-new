import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import Components from "unplugin-vue-components/vite";
import { PrimeVueResolver } from "@primevue/auto-import-resolver";
import tailwindcss from "@tailwindcss/vite";
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    Components({
      resolvers: [PrimeVueResolver()],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Resolve the shared package to its TS source so the dev server compiles native
      // ESM (no CJS-interop guesswork, no shared rebuild step). The backend keeps using
      // the CommonJS dist build.
      "@erp/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
