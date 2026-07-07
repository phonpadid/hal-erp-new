import { flushPromises } from '@vue/test-utils';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import { describe, expect, it } from 'vitest';
import EmptyState from '@/components/EmptyState.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import { mountView } from '../../../test/mountView';
import DocTypesView from './DocTypesView.vue';

// Three types spanning categories, active state, and flag combinations so each filter
// dimension has something to include and something to exclude.
const TYPES = [
  { id: '1', code: 'PR', name: 'Purchase Req', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: true, isActive: true },
  { id: '2', code: 'LEAVE', name: 'Leave', category: 'HR', requiresBudget: false, requiresQuota: true, requiresVendor: false, isActive: true },
  { id: '3', code: 'OLDPO', name: 'Old PO', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: false, isActive: false },
];

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

// The toolbar #filters slot renders, in order: category Select, active-state Select, flags MultiSelect.
const categorySelect = (w: Awaited<ReturnType<typeof mount>>) => w.findAllComponents(Select)[0];
const activeSelect = (w: Awaited<ReturnType<typeof mount>>) => w.findAllComponents(Select)[1];
const flagSelect = (w: Awaited<ReturnType<typeof mount>>) => w.findComponent(MultiSelect);

// Codes of the rows the DataTable currently renders (empty-message row has no code cell).
function renderedCodes(w: Awaited<ReturnType<typeof mount>>): string[] {
  // The first column is the row-number (#); the code lives in a later cell. Match the
  // code across all cells so the helper is robust to leading/trailing column changes.
  return w
    .findAll('.p-datatable-tbody > tr')
    .map((r) => r.findAll('td').map((c) => c.text()).find((txt) => TYPES.some((t) => t.code === txt)) ?? '')
    .filter(Boolean);
}

describe('DocTypesView filters', () => {
  it('renders all types before any filter', async () => {
    const w = await mount();
    expect(renderedCodes(w).sort()).toEqual(['LEAVE', 'OLDPO', 'PR']);
  });

  it('filters by category', async () => {
    const w = await mount();
    await categorySelect(w).vm.$emit('update:modelValue', 'HR');
    await flushPromises();
    expect(renderedCodes(w)).toEqual(['LEAVE']);
  });

  it('filters by active state', async () => {
    const w = await mount();
    await activeSelect(w).vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(renderedCodes(w)).toEqual(['OLDPO']);
  });

  it('filters by requirement flag as an AND set', async () => {
    const w = await mount();
    // budget + vendor: only PR has both (OLDPO has budget but not vendor).
    await flagSelect(w).vm.$emit('update:modelValue', ['budget', 'vendor']);
    await flushPromises();
    expect(renderedCodes(w)).toEqual(['PR']);
  });

  it('composes structured filters with the global search (AND)', async () => {
    const w = await mount();
    await categorySelect(w).vm.$emit('update:modelValue', 'PROCUREMENT');
    await flushPromises();
    expect(renderedCodes(w).sort()).toEqual(['OLDPO', 'PR']);
    // Global search narrows the already-category-filtered set to just the "Old PO" row.
    await w.findComponent(PageToolbar).vm.$emit('update:search', 'Old');
    await flushPromises();
    expect(renderedCodes(w)).toEqual(['OLDPO']);
  });

  it('shows the empty state when nothing matches', async () => {
    const w = await mount();
    // HR + budget flag: no HR type requires budget.
    await categorySelect(w).vm.$emit('update:modelValue', 'HR');
    await flagSelect(w).vm.$emit('update:modelValue', ['budget']);
    await flushPromises();
    expect(renderedCodes(w)).toEqual([]);
    expect(w.findComponent(EmptyState).exists()).toBe(true);
  });
});
