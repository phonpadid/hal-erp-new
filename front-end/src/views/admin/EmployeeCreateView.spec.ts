import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../test/mountView';
import { useJobLevelsStore } from '../../stores/jobLevels';
import EmployeeCreateView from './EmployeeCreateView.vue';

// The employee create form sources its job-level field from the company's active job_level master
// (a Select), not a free-text input, so employee.job_level and the workflow condition can't drift.
describe('EmployeeCreateView job level', () => {
  it('loads the active job levels for the Select on mount', async () => {
    await mountView(EmployeeCreateView, {
      routeName: 'employee-create',
      initialState: {
        jobLevels: { selectable: [{ id: 'l1', code: 'MANAGER', name: 'Manager', rank: 30 }] },
      },
    });
    await flushPromises();
    const jobLevels = useJobLevelsStore();
    // Options come from the master via the store (stubbed action asserted).
    expect(jobLevels.loadSelectable).toHaveBeenCalled();
  });

  it('renders the job level as a Select bound to the master options', async () => {
    const w = await mountView(EmployeeCreateView, {
      routeName: 'employee-create',
      initialState: {
        jobLevels: { selectable: [{ id: 'l1', code: 'MANAGER', name: 'Manager', rank: 30 }] },
      },
    });
    await flushPromises();
    // A PrimeVue Select renders a combobox trigger (not a plain text input) for the field.
    expect(w.findAll('[role="combobox"]').length).toBeGreaterThan(0);
  });
});
