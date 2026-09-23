import { flushPromises } from '@vue/test-utils';
import ToggleSwitch from 'primevue/toggleswitch';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '@/stores/docConfig';
import DocTypesView from './DocTypesView.vue';

const toastAdd = vi.fn();
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: (...a: unknown[]) => toastAdd(...a) }) }));

const TYPES = [
  { id: '1', code: 'REC', name: 'ໃບເບີກຈ່າຍ', category: 'FINANCE', requiresBudget: true, requiresQuota: false, requiresVendor: false, isActive: true },
];

/**
 * A refused toggle must leave the row telling the truth and tell the reader why, in their
 * language. The store's `error` comes through the one seam that translates keyed refusals, so the
 * toast is the Lao sentence naming the type — not the server's English paragraph.
 */
async function mount() {
  const w = await mountView(DocTypesView, {
    path: '/doc-config/types',
    routeName: 'doc-config-types',
    permissions: ['DOC_CONFIG_MANAGE'],
    initialState: { docConfig: { documentTypes: TYPES } },
  });
  await flushPromises();
  return w;
}

describe('document type active switch — a refused toggle', () => {
  it('reverts the switch and toasts the refusal in Lao', async () => {
    (i18n.global.locale as unknown as { value: string }).value = 'la';
    const w = await mount();
    const store = useDocConfigStore();
    // The store's stubbed action: refuse, and leave `error` the way `run()` would after messageOf.
    (store.updateDocumentType as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      store.actionError = i18n.global.t('errors.config.type.wouldStrand', { typeCode: 'CLAIM_RECOVERY' });
      return false;
    });

    const sw = w.findComponent(ToggleSwitch);
    expect(sw.props('modelValue')).toBe(true);
    await sw.vm.$emit('update:modelValue', false);
    await flushPromises();

    expect(store.updateDocumentType).toHaveBeenCalledWith('1', { isActive: false });
    // Stored value re-read; the switch still shows the row as active — and the LIST is still there,
    // not the page-load error panel.
    expect(store.loadDocumentTypes).toHaveBeenCalled();
    expect(w.findAll('.p-datatable-tbody > tr')).toHaveLength(1);
    expect(w.findComponent(ToggleSwitch).props('modelValue')).toBe(true);
    const detail = String(toastAdd.mock.calls.at(-1)?.[0]?.detail ?? '');
    expect(detail).toContain('CLAIM_RECOVERY');
    expect(detail).toMatch(/ຈອງງົບ/);
    expect(detail).not.toContain('This would leave');
  });
});
