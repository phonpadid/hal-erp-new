import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@erp/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.spec.ts'],
    // Vitest's 5s default was never chosen for this suite. Mounting a view here builds a whole
    // PrimeVue tree in jsdom: the budget plan-tree specs spend ~3.7s of it even when run alone,
    // and the same files then fail on a loaded machine — two different ones failed on two
    // different runs of the full suite on the same green code, which is exactly what a timeout
    // set below the work's real cost looks like from the outside.
    //
    // Generous on purpose, for the reason `back/vitest.config.ts` gives about its hook timeout:
    // this limit exists to catch a HANG, not to police how long mounting a component may take. A
    // limit tight enough to fail on a busy CI runner reports a scheduling hiccup as a broken
    // suite — and on the deploy path that blocks a release for a reason unrelated to the code.
    testTimeout: 30_000,
  },
});
