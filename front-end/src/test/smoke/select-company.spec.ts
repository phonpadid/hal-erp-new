import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { mountView } from '../mountView';
import { useAuthStore } from '../../stores/auth';
import SelectCompanyView from '../../views/SelectCompanyView.vue';

describe('SelectCompanyView error/empty handling', () => {
  it('shows the empty message when the account has no companies', async () => {
    const w = await mountView(SelectCompanyView, { path: '/select-company', routeName: 'select-company' });
    // Default harness state has no companies loaded.
    expect(w.text()).toContain('ບໍ່ມີບໍລິສັດ'); // la: "No companies…"
  });

  it('surfaces an error when switching company fails', async () => {
    const w = await mountView(SelectCompanyView, {
      path: '/select-company',
      routeName: 'select-company',
      initialState: { auth: { companies: [{ id: 'c1', code: 'AAA', nameTh: 'Acme', isDefault: true }] } },
    });
    const auth = useAuthStore();
    (auth.selectCompany as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    await w.findComponent({ name: 'Button' }).trigger('click');
    await flushPromises();

    expect(w.text()).toContain('ບໍ່ສາມາດປ່ຽນບໍລິສັດ'); // la: "Could not switch company…"
  });
});
