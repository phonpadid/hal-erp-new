import { afterEach, describe, expect, it } from 'vitest';
import { Form } from '@primevue/forms';
import la from '../../i18n/locales/la';
import { mountView } from '../../test/mountView';
import WarehousesAdminView from './WarehousesAdminView.vue';
import { useInventoryStore } from '../../stores/inventory';

const WH = '3f4f2fd0-dccc-495e-bd95-814828cdace0';

const tick = () => new Promise((r) => setTimeout(r, 30));
const setInput = (el: Element, v: string) => {
  const i = el as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('blur', { bubbles: true }));
};

/** Open the create dialog via the toolbar's pi-plus action. */
async function openDialog(wrapper: any) {
  await wrapper.findAll('button').find((b: any) => b.find('.pi-plus').exists())!.trigger('click');
  await tick();
}

/** Type into the dialog's code and name inputs. */
async function fill(code: string, name: string) {
  const inputs = Array.from(document.querySelectorAll('.p-dialog input')) as HTMLInputElement[];
  setInput(inputs[0], code);
  setInput(inputs[1], name);
  await tick();
}

/** Submit the form itself — a click on the button does not drive @primevue/forms in jsdom. */
async function submitForm() {
  (document.querySelector('.p-dialog form') as HTMLFormElement).dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await tick();
}

let wrapperUnderTest: any = null;

// PrimeVue's Dialog teleports to document.body and Vue Test Utils does not unmount for us, so a
// dialog left by an earlier test would be the one `document.querySelector` finds — and the next
// test would type into a dead form.
afterEach(() => {
  wrapperUnderTest?.unmount();
  wrapperUnderTest = null;
  document.body.innerHTML = '';
});

async function mount(state: Record<string, unknown> = {}, permissions?: string[]) {
  wrapperUnderTest = await mountView(WarehousesAdminView, {
    path: '/warehouses',
    routeName: 'warehouses',
    permissions,
    initialState: {
      inventory: {
        warehouses: [{ id: WH, code: 'MAIN', name: 'Main store', isActive: true }],
        warehousesTotal: 1,
        warehousesPage: 1,
        warehousesLimit: 20,
        ...state,
      },
    },
  });
  return wrapperUnderTest;
}

describe('WarehousesAdminView', () => {
  it('lists the active company warehouses on mount', async () => {
    const wrapper = await mount();
    const store = useInventoryStore();
    expect((store.loadWarehouses as any).mock.calls.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('MAIN');
  });

  it('shows a deactivated warehouse as inactive rather than hiding the row', async () => {
    // The row survives deactivation because historical movements still reference it.
    const wrapper = await mount({
      warehouses: [{ id: WH, code: 'OLD', name: 'Old store', isActive: false }],
    });
    expect(wrapper.text()).toContain(la.inventory.warehouses.inactive);
  });

  it('hides the create and edit controls without INV_MANAGE', async () => {
    const wrapper = await mount({}, ['INV_VIEW']);
    // A UX-only guard — the server still enforces — but an admin control that does nothing is
    // worse than no control at all.
    expect(wrapper.text()).not.toContain(la.inventory.warehouses.create);
  });

  it('surfaces a duplicate code on the code field, not as a toast', async () => {
    const wrapper = await mount();
    const store = useInventoryStore();
    (store.createWarehouse as any).mockRejectedValueOnce({
      response: { data: { message: "Warehouse code 'MAIN' already exists in this company" } },
    });

    await openDialog(wrapper);
    await fill('MAIN', 'Duplicate');
    expect((wrapper.findComponent(Form).vm as any).valid).toBe(true);
    await submitForm();

    // A duplicate code is a property of the field the user typed, so it belongs beside it.
    expect(document.body.textContent).toContain(la.inventory.warehouses.duplicateCode);
  });

  it('reloads once after a successful create rather than per row', async () => {
    const wrapper = await mount();
    const store = useInventoryStore();
    const before = (store.loadWarehouses as any).mock.calls.length;

    await openDialog(wrapper);
    await fill('WH2', 'Second store');
    await submitForm();

    expect((store.createWarehouse as any).mock.calls.length).toBe(1);
    // The store action owns the reload, so the view must not fire a second one itself.
    expect((store.loadWarehouses as any).mock.calls.length).toBe(before);
  });
});
