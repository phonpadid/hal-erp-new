import { expect, test } from '@playwright/test';

// Smoke e2e: the API is up and the root route responds. The app sets a global prefix
// (`api-new`), so the greeting lives there rather than at `/`.
test('GET /api-new responds with the health greeting', async ({ request }) => {
  const res = await request.get('/api-new');
  expect(res.ok()).toBeTruthy();
  expect(await res.text()).toContain('Hello World!');
});
