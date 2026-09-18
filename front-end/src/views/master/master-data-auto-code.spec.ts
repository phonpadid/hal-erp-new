import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import { budgetsApi } from '../../api/budgets';
import { useMasterDataStore } from '../../stores/masterData';
import MasterDataView from './MasterDataView.vue';

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

type Vm = {
  newVendor: () => void;
  editVendor: (v: Record<string, unknown>) => void;
  newItem: () => void;
  onSubmit: (e: { valid: boolean; values: Record<string, unknown> }) => Promise<void>;
  dialog: { open: boolean; values: Record<string, unknown> };
};

const VENDORS = [{ id: 'v1', vendorCode: 'V-00003', name: 'Acme', enabled: true, hasBankAccount: true }];

/**
 * A vendor or item code is issued by the server (V-00001, I-00001, …), never typed: the create
 * dialog has no code field, and the code the server chose is what the confirmation names.
 */
describe('master registry: codes are assigned, not typed', () => {
  let wrapper: VueWrapper | undefined;
  beforeEach(() => {
    toastAdd.mockClear();
    vi.spyOn(budgetsApi, 'glOptions').mockResolvedValue([]);
  });
  // Dialogs teleport to <body>; a previous test's dialog would otherwise still be there.
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
  });

  async function mount() {
    const w = (wrapper = await mountView(MasterDataView, {
      path: '/master-data',
      routeName: 'master-data',
      initialState: { masterData: { vendors: VENDORS, vendorTotal: 1, vendorPage: 1, vendorLimit: 20 } },
    }));
    await flushPromises();
    return w;
  }

  it('the new-vendor dialog asks for no code and says one will be assigned', async () => {
    const w = await mount();
    (w.vm as unknown as Vm).newVendor();
    await flushPromises();

    expect(document.body.querySelector('[data-testid="master-code"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="master-code-hint"]')).not.toBeNull();
    expect((w.vm as unknown as Vm).dialog.values).not.toHaveProperty('vendorCode');
  });

  it('the new-item dialog likewise', async () => {
    const w = await mount();
    (w.vm as unknown as Vm).newItem();
    await flushPromises();

    expect(document.body.querySelector('[data-testid="master-code"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="master-code-hint"]')).not.toBeNull();
  });

  it('the edit dialog shows the code, read-only', async () => {
    const w = await mount();
    (w.vm as unknown as Vm).editVendor(VENDORS[0]);
    await flushPromises();

    const code = document.body.querySelector('[data-testid="master-code"]') as HTMLInputElement | null;
    expect(code).not.toBeNull();
    expect(code!.value).toBe('V-00003');
    expect(code!.disabled).toBe(true);
    expect(document.body.querySelector('[data-testid="master-code-hint"]')).toBeNull();
  });

  it('names the issued code when the record is created', async () => {
    const w = await mount();
    const md = useMasterDataStore();
    (md.saveVendor as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('V-00004');
    const vm = w.vm as unknown as Vm;
    vm.newVendor();

    await vm.onSubmit({ valid: true, values: { name: 'New Co' } });
    await flushPromises();

    expect(md.saveVendor).toHaveBeenCalledWith({ name: 'New Co' }, undefined);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: expect.stringContaining('V-00004') }));
    expect(vm.dialog.open).toBe(false);
  });
});
