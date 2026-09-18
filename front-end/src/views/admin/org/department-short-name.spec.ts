import { afterEach, describe, expect, it } from 'vitest';
import { mountView } from '../../../test/mountView';
import { useOrgStore } from '../../../stores/org';
import DepartmentsView from './DepartmentsView.vue';

const ADM = { id: 'd-adm', deptCode: 'ADM', name: 'ພະແນກບໍລິຫານ', shortName: 'ບຫ', parentDept: null, isActive: true };
const HR = { id: 'd-hr', deptCode: 'HR', name: 'ບຸກຄະລາກອນ', shortName: null, parentDept: null, isActive: true };

type Mocked = { mockResolvedValue: (v: unknown) => void; mock: { calls: unknown[][] } };

const tick = () => new Promise((r) => setTimeout(r, 30));
const setInput = (el: Element, v: string) => {
  const i = el as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('blur', { bubbles: true }));
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wrapperUnderTest: any = null;

// PrimeVue's Dialog teleports to document.body and Vue Test Utils does not unmount for us, so a
// dialog left by an earlier test would be the one `document.querySelector` finds.
afterEach(() => {
  wrapperUnderTest?.unmount();
  wrapperUnderTest = null;
  document.body.innerHTML = '';
});

async function mount() {
  wrapperUnderTest = await mountView(DepartmentsView, {
    path: '/org-admin/departments',
    routeName: 'org-departments',
    permissions: ['DEPARTMENT_VIEW', 'DEPARTMENT_MANAGE'],
    initialState: { org: { departments: [ADM, HR], departmentsTotal: 2 } },
  });
  await tick();
  return wrapperUnderTest;
}

/** Open the edit dialog for the first row (ADM, sorted by code). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openEdit(wrapper: any) {
  await wrapper.findAll('button').find((b: any) => b.find('.pi-pencil').exists())!.trigger('click');
  await tick();
}

/** The dialog's text inputs in markup order: code, name, short name, cost center. */
const shortNameInput = () =>
  (Array.from(document.querySelectorAll('.p-dialog input[type="text"]')) as HTMLInputElement[])[2];

/** Submit the form itself — a click on the button does not drive @primevue/forms in jsdom. */
async function submitForm() {
  (document.querySelector('.p-dialog form') as HTMLFormElement).dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await tick();
}

/**
 * `department.short_name` — the abbreviation stamped in a paper document number. Round-trips
 * through the edit dialog; a blank box is sent as null so the server clears it.
 */
describe('department short name', () => {
  it('lists the abbreviation beside the code, and a dash where none is set', async () => {
    const wrapper = await mount();
    expect(wrapper.text()).toContain('ບຫ');
    expect(wrapper.text()).toContain('—');
  });

  it('shows the stored abbreviation on edit and sends an edited one', async () => {
    const wrapper = await mount();
    const org = useOrgStore();
    (org.updateDepartment as unknown as Mocked).mockResolvedValue(true);

    await openEdit(wrapper);
    const input = shortNameInput();
    expect(input.value).toBe('ບຫ');
    setInput(input, ' ບຫ2 ');
    await tick();
    await submitForm();

    expect(org.updateDepartment).toHaveBeenCalledTimes(1);
    const [id, payload] = (org.updateDepartment as unknown as Mocked).mock.calls[0];
    expect(id).toBe('d-adm');
    expect(payload).toMatchObject({ shortName: 'ບຫ2' });
  });

  it('sends null when the box is left blank', async () => {
    const wrapper = await mount();
    const org = useOrgStore();
    (org.updateDepartment as unknown as Mocked).mockResolvedValue(true);

    await openEdit(wrapper);
    setInput(shortNameInput(), '');
    await tick();
    await submitForm();

    const payload = (org.updateDepartment as unknown as Mocked).mock.calls[0][1];
    expect(payload).toMatchObject({ shortName: null });
  });
});
