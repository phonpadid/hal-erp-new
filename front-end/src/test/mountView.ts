import { createTestingPinia } from '@pinia/testing';
import { mount, type VueWrapper } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import StyleClass from 'primevue/styleclass';
import { vi } from 'vitest';
import type { Component } from 'vue';
import { createMemoryHistory, createRouter, type RouteParamsRaw } from 'vue-router';
import { can } from '../directives/can';
import { i18n } from '../i18n';
import { useAuthStore } from '../stores/auth';

/**
 * Smoke-mount a routed view with the same plugins the real app registers
 * (Pinia, i18n, PrimeVue + Toast/Confirmation, the custom `can`/`styleclass`
 * directives) plus a memory-history router.
 *
 * Store ACTIONS are stubbed by @pinia/testing, so a view's onMounted data
 * fetch is a no-op — the view renders its loading/empty branch without
 * touching the network. Pass `initialState` to drive a populated branch and
 * `routeParams` for detail routes that read `useRoute().params`.
 *
 * By default the auth `can()` getter is overridden to grant every permission,
 * so permission-gated controls render; pass `permissions` to test gating.
 */
export interface MountViewOptions {
  path?: string;
  routeName?: string;
  routeParams?: RouteParamsRaw;
  query?: Record<string, string>;
  initialState?: Record<string, unknown>;
  /** When set, `can(code)` is true only for these codes. Omit to grant all. */
  permissions?: string[];
  props?: Record<string, unknown>;
}

export async function mountView(
  component: Component,
  options: MountViewOptions = {},
): Promise<VueWrapper> {
  const {
    path = '/',
    routeName = 'view-under-test',
    routeParams = {},
    query = {},
    initialState = {},
    permissions,
    props = {},
  } = options;

  // A router with the view mounted on a parametric path plus a catch-all, so
  // `<router-link>` and programmatic `router.push({ name })` never throw.
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path, name: routeName, component },
      { path: '/:catchAll(.*)*', name: 'catch-all', component: { template: '<div />' } },
    ],
  });

  const pinia = createTestingPinia({
    // Stubbed actions resolve to a promise so a view's onMounted
    // `store.load().catch(...)`/`.then(...)` chains don't blow up.
    createSpy: () => vi.fn(() => Promise.resolve()),
    stubActions: true,
    initialState: {
      auth: {
        token: 'test-token',
        userId: 'user-1',
        activeCompanyId: 'company-1',
        departmentId: 'dept-1',
        permissions: permissions ?? [],
        baseCurrency: { code: 'THB', decimalPlaces: 2 },
      },
      ...initialState,
    },
  });

  // Grant-all unless the caller pins a permission set. `can` is a getter that
  // returns a function; override it directly on the store instance.
  const auth = useAuthStore(pinia);
  if (permissions === undefined) {
    // @ts-expect-error overriding a getter for the test
    auth.can = () => true;
  }

  await router.push({ name: routeName, params: routeParams, query });
  await router.isReady();

  return mount(component, {
    props,
    global: {
      plugins: [pinia, i18n, router, [PrimeVue, { theme: { preset: {} } }], ToastService, ConfirmationService],
      directives: { can, styleclass: StyleClass },
    },
  });
}
