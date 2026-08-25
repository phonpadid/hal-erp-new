import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, h } from 'vue';
import { evaluateGuard, type GuardState } from './index';
import { routes } from './routes';
import { i18n } from '../i18n';
import ForbiddenView from '../views/ForbiddenView.vue';
import NotFoundView from '../views/NotFoundView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * A navigation the shell refuses used to land on the home page, which made four situations look
 * identical: a mistyped address, a retired page, a permission this user lacks, and a permission
 * NO user can hold because the catalog has no row for it. The last is how closing an accounting
 * period sat unreachable for a whole installation with nothing on any screen admitting it.
 */
describe('a refused navigation', () => {
  const limited: GuardState = { isAuthenticated: true, hasCompany: true, can: () => false };

  it('names the permission it wanted, for every gated route in the table', () => {
    const gated = routes
      .flatMap((r) => r.children ?? [])
      .filter((r) => (r.meta as { permission?: string } | undefined)?.permission);
    expect(gated.length).toBeGreaterThan(20);

    for (const route of gated) {
      const code = (route.meta as { permission: string }).permission;
      expect(evaluateGuard(limited, { name: route.name as string, meta: route.meta as never })).toEqual({
        name: 'forbidden',
        query: { code },
      });
    }
  });

  it('leaves the guard\'s other branches alone', () => {
    const anon: GuardState = { isAuthenticated: false, hasCompany: false, can: () => false };
    expect(evaluateGuard(anon, { name: 'budgets', meta: { permission: 'BUDGET_VIEW' } })).toEqual({
      name: 'login',
    });

    const noCompany: GuardState = { isAuthenticated: true, hasCompany: false, can: () => true };
    expect(evaluateGuard(noCompany, { name: 'budgets', meta: { permission: 'BUDGET_VIEW' } })).toEqual({
      name: 'select-company',
    });
  });

  it('is a route the router can resolve, so a pasted address reaches it', () => {
    const r = createRouter({ history: createMemoryHistory(), routes });
    const forbidden = r.getRoutes().find((x) => x.name === 'forbidden');
    expect(forbidden).toBeDefined();
    // No permission of its own: a refusal that could itself be refused has nowhere to land.
    expect((forbidden!.meta as { permission?: string }).permission).toBeUndefined();
  });

  it('does not resolve to the same place as an address matching no route', () => {
    const r = createRouter({ history: createMemoryHistory(), routes });
    expect(r.resolve('/new/nothing-is-here').name).toBe('not-found');
    expect(r.resolve({ name: 'forbidden' }).name).toBe('forbidden');
    expect(r.resolve('/new/nothing-is-here').name).not.toBe('forbidden');
  });
});

/** The two views the guard now sends people to. */
describe('the views a refusal and a wrong address land on', () => {
  const Host = (component: unknown) =>
    defineComponent({
      setup: () => () => h(component as never),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  async function mountView(component: unknown, query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div />' } },
        { path: '/x', name: 'x', component: component as never },
      ],
    });
    await router.push({ name: 'x', query });
    await router.isReady();
    const w = mount(Host(component), {
      global: {
        plugins: [
          createTestingPinia({ createSpy: () => vi.fn(), stubActions: true }),
          i18n,
          router,
          [PrimeVue, { theme: { preset: {} } }],
        ],
      },
    });
    await flushPromises();
    wrapper = w;
    return w;
  }

  it('shows the permission code the navigation required', async () => {
    const w = await mountView(ForbiddenView, { code: 'PERIOD_VIEW' });
    expect(w.find('[data-testid="forbidden-code"]').text()).toBe('PERIOD_VIEW');
  });

  it('still says what happened when no code came through', async () => {
    const w = await mountView(ForbiddenView);
    expect(w.find('[data-testid="forbidden-code"]').exists()).toBe(false);
    // Rendered in the app's default locale, which is Lao.
    expect(w.text()).toContain('ທ່ານເປີດໜ້ານີ້ບໍ່ໄດ້');
  });

  it('says something different for an address that matches no route', async () => {
    const w = await mountView(NotFoundView);
    expect(w.text()).toContain('ບໍ່ມີໜ້າຢູ່ບ່ອນຢູ່ນີ້');
    expect(w.text()).not.toContain('ທ່ານເປີດໜ້ານີ້ບໍ່ໄດ້');
  });
});
