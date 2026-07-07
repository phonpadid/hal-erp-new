import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC transforms decorators + emitDecoratorMetadata so Nest/MikroORM work under Vitest.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    // DB-backed specs serialize so the throwaway schema isn't raced.
    fileParallelism: false,
  },
  plugins: [swc.vite()],
});
