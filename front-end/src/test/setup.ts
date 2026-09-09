// jsdom omits a few browser APIs that PrimeVue components touch on mount
// (Select reads matchMedia for responsive behaviour). Polyfill them so views
// can be smoke-mounted without throwing.
import { vi } from 'vitest';

/**
 * The suite talks to nobody.
 *
 * Vitest runs in mode `test`, so Vite loads `.env.test` — which points `VITE_API_URL` at the SHARED
 * TEST SERVER. Any endpoint a spec forgets to mock then becomes a real request to a real machine,
 * and that server answers an unauthenticated call with 401. The api client treats 401 as a dead
 * session and calls `auth.logout()`, which `$reset()`s the store — so a spec that set up its
 * permissions and mounted a view had them WIPED mid-test by a reply arriving from the network. The
 * button under `v-can` turned `display: none` and the assertion read "no permission".
 *
 * It is a race with the network, which is why it passed on a developer machine and failed on a CI
 * runner, in a file nobody had touched. Pointing the client at the discard port turns any unmocked
 * call into an immediate connection error — visible to the spec that forgot the mock, invisible to
 * every store the reply used to reach through.
 */
vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:9/api-new');

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// PrimeVue Tabs/DataTable observe element size; jsdom has no ResizeObserver.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
