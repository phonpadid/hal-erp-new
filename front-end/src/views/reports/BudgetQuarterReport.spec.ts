import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountView } from '../../test/mountView';
import BudgetQuarterReport from './BudgetQuarterReport.vue';
import type { BudgetQuarterReport as Report, QuarterFigure } from '../../api/reports';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const q = (over: Partial<QuarterFigure> & Pick<QuarterFigure, 'quarter'>): QuarterFigure => ({
  consumed: '0',
  elapsedDays: 92,
  days: 92,
  complete: true,
  changeAmount: null,
  changePct: null,
  noComparison: null,
  previousConsumed: null,
  ...over,
});

/**
 * The screen's three rules, all of them about not stating a number that misleads: a quarter still
 * running is marked as such, a comparison with nothing on one side is written in words, and a
 * budget of zero is called overspent rather than drawn at 0%.
 */
const REPORT: Report = {
  fiscalYearId: 'fy',
  year: 2026,
  asOf: '2026-08-24',
  departments: [
    {
      departmentId: 'd1',
      departmentName: 'ພະແນກ ບໍລິຫານ',
      amountTotal: '5000000',
      yearUtilizationPct: 44,
      overspent: false,
      quarters: [
        q({ quarter: 1, consumed: '1000000', noComparison: 'NO_EARLIER_QUARTER' }),
        q({ quarter: 2, consumed: '1200000', changeAmount: '200000', changePct: 20 }),
        // Still running: 55 of 92 days, compared over the same window of Q2.
        q({ quarter: 3, consumed: '0', elapsedDays: 55, complete: false, noComparison: 'STOPPED' }),
        q({ quarter: 4, consumed: '0', elapsedDays: 0, complete: false, noComparison: 'NOT_STARTED' }),
      ],
      budgets: [
        {
          budgetId: 'b1',
          code: '7.502',
          budgetName: 'ເງິນເດືືອນ ພະນັກງານ ພາຫະນະ',
          departmentId: 'd1',
          departmentName: 'ພະແນກ ບໍລິຫານ',
          amountTotal: '0',
          yearUtilizationPct: null,
          overspent: true,
          quarters: [
            q({ quarter: 1, consumed: '3675828099', noComparison: 'NO_EARLIER_QUARTER' }),
            q({ quarter: 2, consumed: '0', noComparison: 'STOPPED' }),
            q({ quarter: 3, consumed: '100', elapsedDays: 55, complete: false, noComparison: 'STARTED' }),
            q({ quarter: 4, consumed: '0', elapsedDays: 0, complete: false, noComparison: 'NOT_STARTED' }),
          ],
        },
      ],
    },
  ],
};

async function mount(report: Report | null = REPORT) {
  const w = await mountView(BudgetQuarterReport, {
    path: '/reports/budget-by-quarter',
    routeName: 'report-budget-quarter',
    permissions: ['REPORT_VIEW'],
    initialState: {
      reports: { quarters: report, loading: false, error: '' },
      // LAK has no decimal places, and every figure in this customer's data is LAK.
      auth: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('BudgetQuarterReport', () => {
  it('shows the four quarters of every department', async () => {
    const text = (await mount()).text();
    expect(text).toContain('Q1');
    expect(text).toContain('Q4');
    expect(text).toContain('ພະແນກ ບໍລິຫານ');
  });

  it('marks a quarter that has not finished, and leaves the finished ones unmarked', async () => {
    // A quarter 55 days into 92 presented as a whole one is how a report says spending collapsed
    // when only the calendar has not caught up.
    const w = await mount();
    expect(w.find('[data-testid="q3-partial"]').exists()).toBe(true);
    expect(w.find('[data-testid="q3-partial"]').text()).toContain('55');
    expect(w.find('[data-testid="q1-partial"]').exists()).toBe(false);
  });

  it('writes a comparison it cannot make in words, never as a number', async () => {
    // Rendered in the app's default locale, which is Lao.
    const text = (await mount()).text();
    expect(text).toContain('ບໍ່ມີໄຕມາດກ່ອນໜ້າ'); // no earlier quarter
    expect(text).toContain('ຢຸດໃຊ້'); // stopped
    // The three renderings this replaces.
    expect(text).not.toContain('-100%');
    expect(text).not.toContain('−100%');
    expect(text).not.toContain('Infinity');
  });

  it('says a quarter has not started, and does not advertise 0 of 92 days for it', async () => {
    const w = await mount();
    expect(w.text()).toContain('ຍັງບໍ່ເລີ່ມ'); // not started
    expect(w.find('[data-testid="q4-partial"]').exists()).toBe(false);
  });

  it('labels a line that started, on a row that has one', async () => {
    const started: Report = {
      ...REPORT,
      departments: [
        {
          ...REPORT.departments[0],
          quarters: REPORT.departments[0].quarters.map((x) =>
            x.quarter === 3 ? { ...x, consumed: '5', noComparison: 'STARTED' as const } : x,
          ),
        },
      ],
    };
    expect((await mount(started)).text()).toContain('ເລີ່ມໃຊ້');
  });

  it('shows a real change as a signed percentage', async () => {
    expect((await mount()).text()).toContain('+20%');
  });

  it('warns on the department when a line beneath it has overspent', async () => {
    // The finding this screen exists downstream of: their spreadsheet's departments all read
    // positive while 31,632,169,758 LAK of overspending sits in the lines underneath. A reader
    // must not have to expand twenty departments to discover it.
    const w = await mount();
    expect(w.find('[data-testid="overspent-below"]').exists()).toBe(true);
  });

  it('calls a zero budget overspent, and prints no percentage for it', async () => {
    // Asserted on a DEPARTMENT with no budget, because the same template renders both levels and a
    // child row is not in the DOM until its department is expanded.
    const zero: Report = {
      ...REPORT,
      departments: [
        {
          ...REPORT.departments[0],
          amountTotal: '0',
          yearUtilizationPct: null,
          overspent: true,
          quarters: REPORT.departments[0].quarters.map((x) =>
            x.quarter === 1 ? { ...x, consumed: '3675828099' } : x,
          ),
        },
      ],
    };
    const w = await mount(zero);
    expect(w.find('[data-testid="no-budget"]').exists()).toBe(true);
    expect(w.text()).toContain('3,675,828,099');
    // The row states its consumption and its overspend, and no proportion of nothing.
    expect(w.text()).not.toMatch(/\b0%/);
  });

  it('formats money to the base currency decimals, never a hardcoded 2', async () => {
    // Every figure in this customer's data is LAK, which has none.
    const text = (await mount()).text();
    expect(text).toContain('5,000,000');
    expect(text).not.toContain('5,000,000.00');
  });

  it('says which day the elapsed figures were measured on', async () => {
    expect((await mount()).text()).toContain('2026-08-24');
  });

  it('shows an empty state rather than a blank page', async () => {
    const w = await mount({ ...REPORT, departments: [] });
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true);
  });
});
