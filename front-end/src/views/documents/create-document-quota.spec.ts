import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import { quotasApi } from '../../api/quotas';
import CreateDocumentView from './CreateDocumentView.vue';

// Hoisted so the vi.mock factories (also hoisted) can reference the fixtures.
const { TYPES } = vi.hoisted(() => ({
  TYPES: [
    { id: 't-plain', code: 'MEMO', name: 'Memo', category: 'ADMIN', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false },
    { id: 't-quota', code: 'LV', name: 'Leave Request', category: 'HR', requiresBudget: false, requiresQuota: true, requiresVendor: false, requiresItem: false },
  ],
}));

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
      formForType: vi.fn(() => Promise.resolve({ documentTypeId: 't-quota', formTemplateId: 'tmpl', version: 1, fields: [] })),
    },
    uploadAttachment: vi.fn(),
  };
});

vi.mock('../../api/quotas', () => ({
  quotasApi: {
    selectable: vi.fn(() =>
      Promise.resolve([
        { id: 'q1', quotaType: 'ANNUAL_LEAVE', unit: 'day', resetCycle: 'YEARLY', personal: true, remaining: '8' },
      ]),
    ),
  },
}));

const selectableSpy = vi.mocked(quotasApi.selectable);

// Keep the FX preview quiet (base == doc currency, but guard the module regardless).
vi.mock('../../api/currency', () => ({
  currencyApi: { rates: { resolve: vi.fn(() => Promise.resolve({ rate: '1' })) } },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

async function mountWizard() {
  // DOC_SUBMIT only: skips the MASTER_VIEW / DOC_CREATE / TAX_VIEW reference reads in onMounted.
  const w = await mountView(CreateDocumentView, {
    path: '/documents/new',
    routeName: 'document-create',
    permissions: ['DOC_SUBMIT'],
  });
  await flushPromises();
  return w;
}

describe('CreateDocumentView quota step', () => {
  it('shows no Quota step until a requires_quota type is selected', async () => {
    const w = await mountWizard();
    // Before any type is chosen, the stepper has no Quota step.
    expect(w.text()).not.toContain('Quota');
  });

  it('reveals the Quota step and loads selectable quotas for a requires_quota type', async () => {
    const w = await mountWizard();
    // Select the leave type (the second radio card).
    await w.findAll('[role="radio"]')[1].trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Quota'); // the new step label appears in the stepper
    expect(selectableSpy).toHaveBeenCalled(); // requester-facing quota read was fetched
  });

  it('keeps the Quota step hidden for a non-quota type', async () => {
    const w = await mountWizard();
    await w.findAll('[role="radio"]')[0].trigger('click'); // plain memo type
    await flushPromises();
    expect(w.text()).not.toContain('Quota');
  });
});
