import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import DocTypeFormView from './DocTypeFormView.vue';
import DocTypesView from './DocTypesView.vue';

const TYPE_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORIES = [{ id: 'c1', code: 'FINANCE', name: 'Finance', isActive: true }];
const EXISTING = {
  id: TYPE_ID, code: 'PR', name: 'ໃບສະເໜີ', shortName: 'ຈຊຈ', category: 'FINANCE',
  requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
  requiresPayee: false, isActive: true,
};
const LIST_ROUTE = [{ path: '/doc-config/types', name: 'doc-config-types' }];

type Mocked = { mockResolvedValue: (v: unknown) => void; mock: { calls: unknown[][] } };

const mountEdit = async (existing = EXISTING) => {
  const w = await mountView(DocTypeFormView, {
    path: '/doc-config/types/:id/edit',
    routeName: 'doc-config-type-edit',
    routeParams: { id: TYPE_ID },
    permissions: ['DOC_CONFIG_MANAGE'],
    extraRoutes: LIST_ROUTE,
    initialState: { docConfig: { documentTypes: [existing], categories: CATEGORIES } },
  });
  await flushPromises();
  return w;
};

/**
 * `document_type.short_name` — the abbreviation stamped in a paper document number. Round-trips
 * through the edit form; a blank box is sent as null so the server clears it rather than storing ''.
 */
describe('document type short name', () => {
  it('shows the stored abbreviation and sends an edited one', async () => {
    const w = await mountEdit();
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as Mocked).mockResolvedValue(true);

    const input = w.find('#dt-short-name');
    expect((input.element as HTMLInputElement).value).toBe('ຈຊຈ');
    await input.setValue(' ຈຊ ');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.updateDocumentType as unknown as Mocked).mock.calls[0][1];
    expect(payload).toMatchObject({ shortName: 'ຈຊ' });
  });

  it('sends null when the box is left blank', async () => {
    const w = await mountEdit();
    const cfg = useDocConfigStore();
    (cfg.updateDocumentType as unknown as Mocked).mockResolvedValue(true);

    await w.find('#dt-short-name').setValue('');
    await w.find('form').trigger('submit');
    await flushPromises();
    await flushPromises();

    const payload = (cfg.updateDocumentType as unknown as Mocked).mock.calls[0][1];
    expect(payload).toMatchObject({ shortName: null });
  });

  it('refuses one longer than the server allows, on the form', async () => {
    const w = await mountEdit();
    const cfg = useDocConfigStore();
    await w.find('#dt-short-name').setValue('a'.repeat(21));
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(cfg.updateDocumentType).not.toHaveBeenCalled();
    expect(w.find('#dt-short-name-err').exists()).toBe(true);
  });

  it('lists the abbreviation beside the code, and a dash where none is set', async () => {
    const w = await mountView(DocTypesView, {
      path: '/doc-config/types',
      routeName: 'doc-config-types',
      permissions: ['DOC_CONFIG_MANAGE'],
      initialState: {
        docConfig: {
          documentTypes: [EXISTING, { ...EXISTING, id: 'other', code: 'REC', shortName: null }],
          categories: CATEGORIES,
        },
      },
    });
    await flushPromises();
    const text = w.text();
    expect(text).toContain('ຈຊຈ');
    expect(text).toContain('—');
  });
});
