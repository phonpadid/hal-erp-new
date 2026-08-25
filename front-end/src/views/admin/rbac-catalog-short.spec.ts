import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import RbacAdminView from './RbacAdminView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const PERMS = ['RBAC_MANAGE'];

/**
 * A permission code with no row in `permission` can be granted to nobody, so the capability behind
 * it is unreachable for the whole installation — including an administrator holding every code the
 * catalog does offer. This screen lists what is grantable; without a statement about what is not,
 * a reader has no way to tell "no role has this yet" from "no role can".
 */
async function mount(missingPermissionCodes: string[]) {
  const w = await mountView(RbacAdminView, {
    path: '/rbac-admin',
    routeName: 'rbac-admin',
    permissions: PERMS,
    initialState: {
      rbacAdmin: {
        roles: [],
        permissions: [],
        missingPermissionCodes,
        users: [],
        usersTotal: 0,
        usersPage: 1,
        usersLimit: 20,
        loading: false,
        error: '',
      },
      // mountView spreads initialState over its own auth defaults, so an auth override has to
      // carry `permissions` through or it un-grants what the mount just granted.
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('RbacAdminView: a catalog that is short', () => {
  it('says so, and names every code it cannot offer', async () => {
    const w = await mount(['PERIOD_CLOSE', 'GL_JV_POST', 'VAT_FILE']);

    const notice = w.find('[data-testid="catalog-short"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('PERIOD_CLOSE');
    expect(notice.text()).toContain('GL_JV_POST');
    expect(notice.text()).toContain('VAT_FILE');
  });

  it('says nothing when the catalog holds every declared code', async () => {
    const w = await mount([]);

    expect(w.find('[data-testid="catalog-short"]').exists()).toBe(false);
  });

  it('states the reason in the reader\'s language, not only the codes', async () => {
    const w = await mount(['PERIOD_CLOSE']);

    // Rendered in the app's default locale, which is Lao.
    expect(w.find('[data-testid="catalog-short"]').text()).toContain('ບາງສິດອະນຸຍາດມອບບໍ່ໄດ້ຢູ່ນີ້');
  });
});
