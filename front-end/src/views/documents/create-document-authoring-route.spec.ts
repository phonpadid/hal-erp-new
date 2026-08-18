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

async function mountWizard() {
  const w = await mountView(CreateDocumentView, {
    path: '/documents/new',
    routeName: 'document-create',
    permissions: ['DOC_SUBMIT'],
    extraRoutes: [{ path: '/budgets', name: 'budgets' }],
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

  it('falls through to its own steps when the route is unknown', async () => {
    // A misconfigured route must degrade to today's behaviour, not a blank page.
    const w = await mountWizard();
    await w.findAll('[role="radio"]')[2].trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.name).toBe('document-create');
  });
});
