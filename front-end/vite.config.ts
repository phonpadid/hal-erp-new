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
  build: {
    rolldownOptions: {
      output: {
        // Split each npm package into its own vendor chunk so no single chunk
        // carries the whole framework. Keeps the entry small and lets the browser
        // cache stable vendor code across app deploys.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // pnpm nests real packages under node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>,
          // so resolve against the LAST node_modules segment to get the true package name.
          const after = id.split('node_modules/').pop()!;
          const parts = after.split('/');
          const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
          // Let PrimeVue keep its natural per-component splitting so each widget loads
          // with the route that uses it; forcing it into one chunk makes an 800kB+ blob.
          if (pkg === 'primevue') return;
          return `vendor-${pkg.replace('@', '').replace('/', '-')}`;
        },
      },
    },
  },
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
