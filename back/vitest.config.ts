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
    // `refreshDatabase()` in a `beforeAll` drops and recreates every table with its foreign keys
    // and indexes — 75 of them — and vitest's 10s default was never chosen for that. It holds on a
    // developer machine talking to a local postgres and does not on CI, where postgres is a service
    // container on a shared two-core runner: the same hook that finishes in ~2s here took longer
    // than 10s there, and four suites failed in `beforeAll` having asserted nothing.
    //
    // Generous on purpose. This timeout exists to catch a HANG, not to police how long a schema
    // rebuild is allowed to take, and a limit tight enough to fail on a slow runner reports an
    // infrastructure hiccup as a broken test suite — which, on the deploy path, blocks a release
    // for a reason that has nothing to do with the code.
    hookTimeout: 60_000,
  },
  plugins: [swc.vite()],
});
