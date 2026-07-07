// jsdom omits a few browser APIs that PrimeVue components touch on mount
// (Select reads matchMedia for responsive behaviour). Polyfill them so views
// can be smoke-mounted without throwing.
import { vi } from 'vitest';

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
