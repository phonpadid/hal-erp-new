import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PrimeVue from 'primevue/config';
import StyleClass from 'primevue/styleclass';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import { can } from '../directives/can';
import AppTopbar from './AppTopbar.vue';
import App from '../App.vue';
import AppLayout from './AppLayout.vue';

/**
 * The application chrome — the bar across the top and the floating support button — has to leave
 * room for the screen underneath it. At 482px the bar put 122px of itself past the right edge,
 * taking the theme toggle and sign-out with it and wrapping the brand to `HA` / `ER`; the support
 * dial rendered on the login form and sat over the wizard's own buttons.
 */
beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

function mountTopbar() {
  const pinia = createTestingPinia({
    createSpy: () => vi.fn(() => Promise.resolve()),
    stubActions: true,
    initialState: {
      auth: {
        token: 't', userId: 'u', activeCompanyId: 'c1',
        permissions: ['NOTIFICATION_VIEW'],
        companies: [{ id: 'c1', nameTh: 'HAL Co' }],
      },
    },
  });
  return mount(AppTopbar, {
    global: {
      plugins: [pinia, i18n, [PrimeVue, { theme: { preset: {} } }]],
      directives: { can, styleclass: StyleClass },
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
        NotificationBell: { template: '<div class="stub-bell" />' },
        AppConfigurator: { template: '<div />' },
      },
      mocks: { $router: { push: vi.fn() } },
    },
  });
}

describe('topbar composition', () => {
  it('keeps the working-context controls out of the overflow menu', () => {
    // These say which company the user is about to act in, and that something needs attention.
    // They must be readable without discovering that the bar has collapsed anything.
    const w = mountTopbar();
    const cfg = w.find('.layout-config-menu');
    expect(cfg.exists()).toBe(true);
    expect(cfg.find('.p-select').exists()).toBe(true);
    expect(cfg.find('.stub-bell').exists()).toBe(true);
  });

  it('puts the preference controls in the overflow menu, so they can fold away', () => {
    // Language is the single widest thing in the bar (185px of 500px). It is set once; the bar
    // has to keep working at 360px every day.
    const w = mountTopbar();
    const menu = w.find('.layout-topbar-menu');
    expect(menu.exists()).toBe(true);
    expect(menu.find('.p-selectbutton').exists()).toBe(true);
    expect(menu.text()).toContain('Language');
    // Sign-out was already here and must stay reachable.
    expect(menu.text()).toContain('Log out');
    // And they are no longer duplicated in the always-visible group.
    expect(w.find('.layout-config-menu .p-selectbutton').exists()).toBe(false);
  });

  it('labels the folded controls, which are icon-only when inline', () => {
    // In the panel each row is icon + text; an unlabelled icon in a vertical list is a guess.
    const w = mountTopbar();
    const menu = w.find('.layout-topbar-menu');
    expect(menu.text()).toContain('Toggle dark mode');
    expect(menu.text()).toContain('Theme');
  });
});

describe('the support dial is scoped to the authenticated app', () => {
  it('is absent from the root component, which also renders the login route', () => {
    // It used to be a sibling of <router-view>, so it appeared before anyone had signed in.
    const w = mount(App, {
      global: { stubs: { RouterView: { template: '<div />' } } },
    });
    expect(w.findComponent({ name: 'WhatsAppSpeedDial' }).exists()).toBe(false);
    expect(w.html()).not.toContain('speeddial');
  });

  it('is rendered by the authenticated layout', () => {
    const pinia = createTestingPinia({
      createSpy: () => vi.fn(() => Promise.resolve()),
      stubActions: true,
      initialState: { auth: { token: 't', userId: 'u', activeCompanyId: 'c1', permissions: [] } },
    });
    const w = mount(AppLayout, {
      global: {
        plugins: [pinia, i18n, [PrimeVue, { theme: { preset: {} } }]],
        directives: { can, styleclass: StyleClass },
        stubs: {
          AppTopbar: true, AppSidebar: true, AppBreadcrumb: true, AppFooter: true,
          RouterView: { template: '<div />' },
          Toast: true, ConfirmDialog: true,
        },
      },
    });
    expect(w.findComponent({ name: 'WhatsAppSpeedDial' }).exists()).toBe(true);
  });
});
