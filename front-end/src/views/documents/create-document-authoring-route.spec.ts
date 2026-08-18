import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import CreateDocumentView from './CreateDocumentView.vue';

/**
 * Some types keep their content where this wizard cannot write it. Choosing their card must leave
 * for the screen that owns them rather than walking the user through four steps and producing a
 * document that is well-formed and empty — one that submits, sits in an approval queue, and is
 * refused by its post-action when somebody finally clicks approve.
 */
const { TYPES } = vi.hoisted(() => ({
  TYPES: [
    { id: 't-memo', code: 'MEMO', name: 'Memo', category: 'ADMIN', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false },
    { id: 't-plan', code: 'PLAN', name: 'Budget Plan', category: 'FINANCE', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false, authoringRoute: 'budgets' },
    { id: 't-ghost', code: 'GHOST', name: 'Ghost', category: 'ADMIN', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false, authoringRoute: 'no-such-screen' },
  ],
}));

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
      formForType: vi.fn(() =>
        Promise.resolve({ documentTypeId: 't-memo', formTemplateId: 'tmpl', version: 1, fields: [] }),
      ),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/currency', () => ({
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

async function mountWizard(permissions = ['DOC_SUBMIT', 'BUDGET_VIEW']) {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/new',
    routeName: 'document-create',
    permissions,
    // Guarded exactly as the real route is, so the wizard reads the same `meta.permission` the
    // navigation guard reads rather than a copy of it.
    extraRoutes: [{ path: '/budgets', name: 'budgets', meta: { permission: 'BUDGET_VIEW' } }],
  });
  await flushPromises();
  return w;
}

describe('CreateDocumentView authoring route', () => {
  it('stays in the wizard for a type it can author', async () => {
    const w = await mountWizard();
    await w.findAll('[role="radio"]')[0].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.name).toBe('document-create');
  });

  it('leaves for the screen that authors the type', async () => {
    const w = await mountWizard();
    await w.findAll('[role="radio"]')[1].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.name).toBe('budgets');
  });

  it('disables a routed card whose destination permission the user lacks', async () => {
    // The defect this change exists for: the card was offered, navigation fired, and the router's
    // guard bounced the user to the dashboard with nothing said.
    const w = await mountWizard(['DOC_SUBMIT']);
    const blocked = w.find('[data-testid="type-blocked"]');
    expect(blocked.exists()).toBe(true);
    expect(blocked.text()).toContain('BUDGET_VIEW');
    await w.findAll('[role="radio"]')[1].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.name).toBe('document-create');
  });

  it('leaves an unresolvable route enabled — the wizard keeps that type itself', async () => {
    // Treating it as unreachable would turn a misconfiguration into a lockout.
    const w = await mountWizard(['DOC_SUBMIT']);
    const cards = w.findAll('[role="radio"]');
    expect(cards[2].attributes('aria-disabled')).toBeUndefined();
  });

  it('leaves a type the wizard authors itself enabled', async () => {
    const w = await mountWizard(['DOC_SUBMIT']);
    expect(w.findAll('[role="radio"]')[0].attributes('aria-disabled')).toBeUndefined();
  });

  it('falls through to its own steps when the route is unknown', async () => {
    // A misconfigured route must degrade to today's behaviour, not a blank page.
    const w = await mountWizard();
    await w.findAll('[role="radio"]')[2].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.name).toBe('document-create');
  });
});
