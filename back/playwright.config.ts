import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// The e2e flows sign in as real accounts, so they need the same secrets the app runs with —
// BOOTSTRAP_PASSWORD for the admin that provisions the sandbox and USER_PASSWORD for the
// accounts it creates. Read straight from back/.env (no dotenv dependency in this workspace);
// anything already in the environment wins, so CI can override without editing the file.
loadEnv(resolve(__dirname, '.env'));

function loadEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// End-to-end tests run against a live API. The webServer boots the Nest app
// (which connects to PostgreSQL — start the docker-compose stack first).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.spec.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // The flows assert on budget balances that other flows also move, and the sandbox is one
  // database. One worker keeps every assertion about a ledger deterministic.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  },
  webServer: {
    command: 'pnpm start',
    url: `${process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`}/api-new`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
