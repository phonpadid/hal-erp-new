import { defineConfig } from '@playwright/test';

// End-to-end tests run against a live API. The webServer boots the Nest app
// (which connects to PostgreSQL — start the docker-compose stack first).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm start',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
