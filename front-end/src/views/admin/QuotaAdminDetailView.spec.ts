import { describe, expect, it, vi } from 'vitest';
import { Form } from '@primevue/forms';
import Select from 'primevue/select';
import { mountView } from '../../test/mountView';
import QuotaAdminDetailView from './QuotaAdminDetailView.vue';
import { useQuotaAdminStore } from '../../stores/quotaAdmin';

const QUOTA_ID = '3f4f2fd0-dccc-495e-bd95-814828cdace0';
const EMP_ID = 'a3bb189e-8bf9-3888-9912-ace4e6543002';

const tick = () => new Promise((r) => setTimeout(r, 30));
const setInput = (el: Element, v: string) => {
  const i = el as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('blur', { bubbles: true }));
};

async function mount() {
  return mountView(QuotaAdminDetailView, {
    path: '/quota-admin/:id',
    routeName: 'quota-admin-detail',
    routeParams: { id: QUOTA_ID },
    initialState: { quotaAdmin: { employees: [{ id: EMP_ID, name: 'Alice' }] } },
  });
}

describe('QuotaAdminDetailView — set entitlement', () => {
  // Regression: the detail view never loaded employee options, so the dialog's employee
  // Select was empty and no entitlement could be set on a direct visit / refresh.
  it('loads employee options on mount', async () => {
    await mount();
    const store = useQuotaAdminStore();
    expect((store.loadOptions as any).mock.calls.length).toBeGreaterThan(0);
  });

  // Regression: entitlementSchema required `quotaId`, but quotaId is injected in the submit
  // handler rather than rendered as a field. The resolver validated the rendered fields
  // against a schema that still required quotaId → it failed on quotaId, returned no
  // `values`, yet `valid` stayed true (the quotaId error attached to no rendered field).
  // Result: the form "submitted" with e.values === undefined → payload was just { quotaId },
  // and the backend rejected employeeId/year/entitledValue as missing.
  it('submits the complete payload', async () => {
    const wrapper = await mount();
    const store = useQuotaAdminStore();
    let seen: Record<string, unknown> | null = null;
    (store.upsertEntitlement as any) = vi.fn((dto: Record<string, unknown>) => {
      seen = { ...dto };
      return Promise.resolve(true);
    });

    // open the "Set entitlement" dialog (the toolbar's pi-plus action)
    await wrapper.findAll('button').find((b) => b.find('.pi-plus').exists())!.trigger('click');
    await tick();

    // choose an employee via the Select's internal writeValue (what a real option-click calls)
    (wrapper.findComponent(Select).vm as any).writeValue(EMP_ID, new Event('click'));
    await tick();

    const inputs = Array.from(document.querySelectorAll('.p-dialog input')) as HTMLInputElement[];
    const year = inputs.find((i) => i.getAttribute('name') === 'year');
    if (year) setInput(year, '2027');
    const ev = inputs.find((i) => i.getAttribute('name') === 'entitledValue');
    if (ev) setInput(ev, '12');
    await tick();

    expect((wrapper.findComponent(Form).vm as any).valid).toBe(true);

    (document.querySelector('.p-dialog form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await tick();

    expect((store.upsertEntitlement as any).mock.calls.length).toBe(1);
    expect(seen).toMatchObject({
      quotaId: QUOTA_ID,
      employeeId: EMP_ID,
      year: 2027,
      entitledValue: '12',
    });
  });
});
