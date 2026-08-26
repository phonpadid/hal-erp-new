import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC transforms decorators + emitDecoratorMetadata so Nest/MikroORM work under Vitest.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    // `scripts/` too: the go-live inspection is script-side logic with the same claim on a spec
    // as anything under src/ — it decides what a deploy reports. The e2e suite is unaffected;
    // those live in `back/e2e/*.e2e.spec.ts` and match neither pattern.
    include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    // DB-backed specs serialize so the throwaway schema isn't raced.
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
