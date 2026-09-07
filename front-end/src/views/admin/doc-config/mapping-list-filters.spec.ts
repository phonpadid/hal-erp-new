import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { mountView } from '../../../test/mountView';
import { useDocConfigStore } from '../../../stores/docConfig';
import DeptMappingsView from './DeptMappingsView.vue';

vi.mock('../../../api/docConfig', async (orig) => {
  const actual = (await orig()) as { docConfigApi: Record<string, unknown> };
  return {
    ...actual,
    docConfigApi: {
      ...actual.docConfigApi,
      // One page of 20 out of a company holding 80 — the customer's shape, and the one that
      // exposed the "showing 4 of 0" denominator bug.
      // Rows built inside the factory: `vi.mock` is hoisted above the module's consts.
      mappings: vi.fn().mockResolvedValue({
        items: [
          { id: 'm1', departmentId: 'd1', departmentName: 'Administration', documentTypeId: 't1', documentTypeCode: 'PR', formTemplateId: 'tmpl', templateVersion: 1, workflowId: 'w1', workflowName: 'WF', isActive: true },
        ],
        total: 80, page: 1, limit: 20,
      }),
      mappingDepartments: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Administration' }]),
    },
  };
});

vi.mock('../../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: vi.fn(), confirm: vi.fn(() => Promise.resolve(true)) }),
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

/**
 * The screen showed a department column, a document type column and an active column, and offered
 * no way to narrow by any of them. On the customer's data that is 80 mappings over four pages, so
 * the question it exists to answer — which types may this department raise — could only be reached
 * by guessing a word the department's name shares.
 *
 * These assert that each control goes to the SERVER. The list is paged, so a filter over the loaded
 * page would narrow 20 of 80 rows while presenting itself as having narrowed all of them — the
 * defect the search box on this same screen was already fixed for.
 */
const MAPPINGS = [
  { id: 'm1', departmentId: 'd1', departmentName: 'Administration', documentTypeId: 't1', documentTypeCode: 'PR', formTemplateId: 'tmpl', templateVersion: 1, workflowId: 'w1', workflowName: 'WF', isActive: true },
  { id: 'm2', departmentId: 'd2', departmentName: 'Marketing', documentTypeId: 't1', documentTypeCode: 'PR', formTemplateId: 'tmpl', templateVersion: 1, workflowId: 'w1', workflowName: 'WF', isActive: true },
];

async function mount(over: Record<string, unknown> = {}) {
  const w = await mountView(DeptMappingsView, {
    path: '/doc-config/mappings',
    routeName: 'doc-config-mappings',
    permissions: ['DOC_CONFIG_MANAGE'],
    initialState: {
      docConfig: {
        mappings: MAPPINGS,
        mappingsTotal: 2,
        mappingsTotalUnfiltered: 80,
        mappingDepartments: [
          { id: 'd1', name: 'Administration' },
          { id: 'd2', name: 'Marketing' },
        ],
        documentTypes: [{ id: 't1', code: 'PR', name: 'Purchase request' }],
        workflows: [], templatesByType: {},
        ...over,
      },
    },
  });
  await flushPromises();
  return w;
}

/** The `Select` behind one filter, by its test id. */
const filter = (w: Awaited<ReturnType<typeof mount>>, id: string) =>
  w.findAllComponents({ name: 'Select' }).find((s) => s.attributes('data-testid') === id);

describe('the mapping list can be narrowed by what it shows', () => {
  it('offers a control for each column a reader would narrow by', async () => {
    const w = await mount();
    for (const id of ['filter-department', 'filter-type', 'filter-active']) {
      expect(filter(w, id), `${id} is missing`).toBeDefined();
    }
  });

  it('sends the department to the server rather than filtering the loaded page', async () => {
    const w = await mount();
    const store = useDocConfigStore();
    const spy = vi.spyOn(store, 'narrowMappings').mockResolvedValue();

    await filter(w, 'filter-department')!.vm.$emit('update:modelValue', 'd2');
    await flushPromises();

    expect(spy).toHaveBeenCalledWith({ departmentId: 'd2' });
  });

  it('sends the document type the same way', async () => {
    const w = await mount();
    const store = useDocConfigStore();
    const spy = vi.spyOn(store, 'narrowMappings').mockResolvedValue();

    await filter(w, 'filter-type')!.vm.$emit('update:modelValue', 't1');
    await flushPromises();

    expect(spy).toHaveBeenCalledWith({ documentTypeId: 't1' });
  });

  it('clearing a filter sends the empty value, not nothing at all', async () => {
    // `showClear` emits null. Passed through as '' so the store knows to drop the narrowing —
    // swallowing it would leave the list narrowed with no control showing why.
    const w = await mount();
    const store = useDocConfigStore();
    const spy = vi.spyOn(store, 'narrowMappings').mockResolvedValue();

    await filter(w, 'filter-department')!.vm.$emit('update:modelValue', null);
    await flushPromises();

    expect(spy).toHaveBeenCalledWith({ departmentId: '' });
  });

  describe('the active control', () => {
    it('offers three states, not two', async () => {
      // unset / active / inactive. "Show me the deactivated ones" is how an administrator finds
      // out why a department lost a document type, and a checkbox cannot ask it.
      const w = await mount();
      const opts = filter(w, 'filter-active')!.props('options') as Array<{ value: boolean }>;
      expect(opts.map((o) => o.value)).toEqual([true, false]);
      expect(filter(w, 'filter-active')!.props('showClear')).toBe(true);
    });

    it('starts unset, so deactivated mappings are not hidden by default', async () => {
      const w = await mount();
      expect(filter(w, 'filter-active')!.props('modelValue')).toBeNull();
    });

    it('sends false as a real value, not as "no filter"', async () => {
      const w = await mount();
      const store = useDocConfigStore();
      const spy = vi.spyOn(store, 'narrowMappings').mockResolvedValue();

      await filter(w, 'filter-active')!.vm.$emit('update:modelValue', false);
      await flushPromises();

      expect(spy).toHaveBeenCalledWith({ isActive: false });
    });
  });

  describe('the department options', () => {
    it('come from the departments that hold a mapping', async () => {
      const w = await mount();
      const opts = filter(w, 'filter-department')!.props('options') as Array<{ name: string }>;
      expect(opts.map((o) => o.name)).toEqual(['Administration', 'Marketing']);
    });
  });

  describe('what the filter is hiding', () => {
    it('learns the denominator from the unnarrowed load, not from a seed', async () => {
      // The regression the app found: on a first visit the mappings are read unnarrowed, and the
      // whole-list total was never recorded — so the first filter applied rendered "showing 4 of
      // 0". Run against a REAL store, because `mountView` stubs actions: seeding the number this
      // must derive is exactly how the original tests missed it.
      setActivePinia(createPinia());
      const store = useDocConfigStore();
      expect(store.mappingsTotalUnfiltered).toBe(0);

      await store.loadMappings(1, 20);

      expect(store.mappingsTotalUnfiltered).toBe(80);
      expect(store.mappingsTotal).toBe(80);
    });

    it('does not move the denominator once a narrowing is active', async () => {
      // "Showing 4 of 4" is true of every filtered list and says nothing. The denominator may only
      // come from a read with nothing narrowing it.
      setActivePinia(createPinia());
      const store = useDocConfigStore();
      await store.loadMappings(1, 20);

      store.mappingsDepartmentId = 'd1';
      await store.loadMappings(1, 20);

      expect(store.mappingsTotalUnfiltered).toBe(80);
    });

    it('says how many are shown out of how many exist, once narrowed', async () => {
      const w = await mount({ mappingsDepartmentId: 'd1' });
      expect(w.find('[data-testid="showing-of"]').text()).toBe('Showing 2 of 80');
    });

    it('says nothing while the list is whole', async () => {
      // A count beside an unnarrowed list is noise, and invites the reader to wonder what is
      // missing when nothing is.
      const w = await mount();
      expect(w.find('[data-testid="showing-of"]').exists()).toBe(false);
    });
  });
});
