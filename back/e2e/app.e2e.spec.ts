import { expect, test } from '@playwright/test';

// Smoke e2e: the API is up and the root route responds. Real capability flows
// (auth → submit → approve) extend this once their endpoints exist.
test('GET / responds with the health greeting', async ({ request }) => {
  const res = await request.get('/');
  expect(res.ok()).toBeTruthy();
  expect(await res.text()).toContain('Hello World!');
});
