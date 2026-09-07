import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReportsStore } from '../../stores/reports';
import { mountView } from '../../test/mountView';
import BudgetQuarterReport from './BudgetQuarterReport.vue';
import type { BudgetQuarterReport as Report, QuarterFigure } from '../../api/reports';
import type { VueWrapper } from '@vue/test-utils';

/**
 * `findComponent` given a CSS selector is typed `WrapperLike`, which carries neither `.vm` nor
 * `.props()` — both of which every filter assertion below needs. Narrowed once here rather than
 * cast at each of the nine call sites.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   the located component is a PrimeVue control with no local type, so its props cannot be named
   more precisely than `any` without importing and pinning a vendor type per call site. */
const control = (w: VueWrapper, testId: string): VueWrapper<any> =>
  w.findComponent(`[data-testid="${testId}"]`) as unknown as VueWrapper<any>;

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * A quarter. Its three months default to carrying the whole of its consumption in the middle one,
 * so the fixture keeps the invariant the server guarantees: three months sum to their quarter.
 */
const q = (over: Partial<QuarterFigure> & Pick<QuarterFigure, 'quarter'>): QuarterFigure => {
  const consumed = over.consumed ?? '0';
  const first = (over.quarter - 1) * 3 + 1;
  return {
    consumed,
    months: [
      { month: first, consumed: '0' },
      { month: first + 1, consumed },
      { month: first + 2, consumed: '0' },
    ],
    utilizationPct: null,
    elapsedDays: 92,
    days: 92,
    complete: true,
    changeAmount: null,
    changePct: null,
    noComparison: null,
    previousConsumed: null,
    ...over,
  };
};

/**
 * The screen's three rules, all of them about not stating a number that misleads: a quarter still
 * running is marked as such, a comparison with nothing on one side is written in words, and a
 * budget of zero is called overspent rather than drawn at 0%.
 */
const REPORT: Report = {
  fiscalYearId: 'fy',
  year: 2026,
  asOf: '2026-08-24',
  // Nothing left out of this fixture — the excluded notice has its own spec.
  excluded: null,
  // Whole lists, whatever the filters did to the rows — that is the point of the two fields.
  fiscalYears: [
    { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
    { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
  ],
  departmentOptions: [
    { id: 'd1', name: 'ພະແນກ ບໍລິຫານ' },
    { id: 'd2', name: 'ພະແນກ ບຸກຄະລາກອນ' },
  ],
  departments: [
    {
      departmentId: 'd1',
      departmentName: 'ພະແນກ ບໍລິຫານ',
      amountTotal: '5000000',
      yearConsumed: '2200000',
      remaining: '2800000',
      yearUtilizationPct: 44,
      remainingPct: 56,
      overspent: false,
      quarters: [
        q({ quarter: 1, consumed: '1000000', utilizationPct: 20, noComparison: 'NO_EARLIER_QUARTER' }),
        q({ quarter: 2, consumed: '1200000', utilizationPct: 24, changeAmount: '200000', changePct: 20 }),
        // Still running: 55 of 92 days, compared over the same window of Q2.
        q({ quarter: 3, consumed: '0', utilizationPct: 0, elapsedDays: 55, complete: false, noComparison: 'STOPPED' }),
        q({ quarter: 4, consumed: '0', utilizationPct: 0, elapsedDays: 0, complete: false, noComparison: 'NOT_STARTED' }),
      ],
      budgets: [
        {
          budgetId: 'b1',
          code: '7.502',
          budgetName: 'ເງິນເດືືອນ ພະນັກງານ ພາຫະນະ',
          departmentId: 'd1',
          departmentName: 'ພະແນກ ບໍລິຫານ',
          amountTotal: '0',
          yearConsumed: '3675828199',
          remaining: '-3675828199',
          yearUtilizationPct: null,
          remainingPct: null,
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

  it('carries the status in a column of its own, not inside the department name', async () => {
    // Sharing the name column made a long Lao label wrap the name beside it, so the one column a
    // reader uses to find their row was the one the tag pushed around.
    const w = await mount();
    // Its own header, from the budgetQuarter key path — the first attempt put the key in the
    // budgetBalance block, where it resolved through the English fallback on a Lao page.
    expect(w.findAll('thead th').map((h) => h.text())).toContain('ສະຖານະ');

    const cells = w.findAll('tbody tr td');
    const nameCell = cells.find((c) => c.text().includes('ພະແນກ ບໍລິຫານ'))!;
    expect(nameCell.exists()).toBe(true);
    expect(nameCell.find('[data-testid="overspent-below"]').exists()).toBe(false);

    const statusCell = cells.find((c) => c.find('[data-testid="overspent-below"]').exists());
    expect(statusCell).toBeDefined();
    expect(statusCell!.text()).not.toContain('ພະແນກ ບໍລິຫານ');
  });

  it('says a row has nothing to warn about, rather than leaving the cell blank', async () => {
    const clean: Report = {
      ...REPORT,
      departments: [{ ...REPORT.departments[0], overspent: false, budgets: [] }],
    };
    const w = await mount(clean);
    expect(w.find('[data-testid="status-none"]').exists()).toBe(true);
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
          yearConsumed: '3675828099',
          remaining: '-3675828099',
          yearUtilizationPct: null,
          remainingPct: null,
          overspent: true,
          quarters: REPORT.departments[0].quarters.map((x) => ({
            ...x,
            // No budget, so no share — in any quarter, not only in the year.
            utilizationPct: null,
            ...(x.quarter === 1 ? { consumed: '3675828099' } : {}),
          })),
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

  // ---- the months inside a quarter ----------------------------------------------------------

  it('keeps every month collapsed until one is asked for', async () => {
    // Four quarters of three months beside the quarter, share and year columns is a table nobody
    // reads. The default view is the one the department opens twenty times a day.
    const w = await mount();
    for (const i of [1, 2, 3, 4]) {
      expect(w.find(`[data-testid="q${i}-m1"]`).exists()).toBe(false);
    }
  });

  it('reveals the months of ONE quarter, leaving the other three collapsed', async () => {
    const w = await mount();
    await w.find('[data-testid="q2-months-toggle"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="q2-m1"]').exists()).toBe(true);
    expect(w.find('[data-testid="q2-m2"]').exists()).toBe(true);
    expect(w.find('[data-testid="q2-m3"]').exists()).toBe(true);
    for (const i of [1, 3, 4]) {
      expect(w.find(`[data-testid="q${i}-m1"]`).exists()).toBe(false);
    }
    // The middle month of Q2 carries the quarter's 1,200,000 in this fixture.
    expect(w.find('[data-testid="q2-m2"]').text()).toContain('1,200,000');
  });

  it('closes the months again', async () => {
    const w = await mount();
    await w.find('[data-testid="q2-months-toggle"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="q2-months-toggle"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="q2-m1"]').exists()).toBe(false);
  });

  // ---- the share and the year -----------------------------------------------------------------

  it('shows each quarter share of the annual budget under its total', async () => {
    const w = await mount();
    expect(w.find('[data-testid="q1-pct"]').text()).toBe('20%');
    expect(w.find('[data-testid="q2-pct"]').text()).toBe('24%');
  });

  it('shows the year columns on every row', async () => {
    const w = await mount();
    expect(w.find('[data-testid="year-consumed"]').text()).toContain('2,200,000');
    expect(w.find('[data-testid="remaining"]').text()).toContain('2,800,000');
    expect(w.find('[data-testid="year-pct"]').text()).toBe('44%');
    expect(w.find('[data-testid="remaining-pct"]').text()).toBe('56%');
  });

  it('leaves an overspent remainder negative, and marks it', async () => {
    // Flooring it at zero is how the customer own sheet shows every department with something
    // still left while 31.6 billion kip of overspend sits underneath.
    const over: Report = {
      ...REPORT,
      departments: [
        {
          ...REPORT.departments[0],
          amountTotal: '1000000',
          yearConsumed: '2200000',
          remaining: '-1200000',
          yearUtilizationPct: 220,
          remainingPct: -120,
          overspent: true,
        },
      ],
    };
    const w = await mount(over);
    const cell = w.find('[data-testid="remaining"]');
    expect(cell.text()).toContain('-1,200,000');
    expect(cell.classes().join(' ')).toContain('text-red-600');
  });

  it('prints no percentage where there is no share, never 0%', async () => {
    const noShare: Report = {
      ...REPORT,
      departments: [
        {
          ...REPORT.departments[0],
          amountTotal: '0',
          yearConsumed: '0',
          remaining: '0',
          yearUtilizationPct: null,
          remainingPct: null,
          overspent: false,
          quarters: REPORT.departments[0].quarters.map((x) => ({ ...x, utilizationPct: null })),
        },
      ],
    };
    const w = await mount(noShare);
    expect(w.find('[data-testid="year-pct"]').text()).toBe('—');
    expect(w.find('[data-testid="remaining-pct"]').text()).toBe('—');
    expect(w.find('[data-testid="q1-pct"]').text()).toBe('—');
    expect(w.text()).not.toMatch(/\b0%/);
  });

  // ---- nothing on either side -----------------------------------------------------------------

  it('says a line has had no activity rather than calling it stopped', async () => {
    // The defect this change was opened on: on the customer own data every quarter of every line
    // never spent against read `ຢຸດໃຊ້` — stopped — asserting a run that never happened.
    const idle: Report = {
      ...REPORT,
      departments: [
        {
          ...REPORT.departments[0],
          yearConsumed: '0',
          quarters: REPORT.departments[0].quarters.map((x) =>
            x.quarter === 1
              ? { ...x, consumed: '0', noComparison: 'NO_EARLIER_QUARTER' as const }
              : { ...x, consumed: '0', changePct: null, noComparison: 'NO_ACTIVITY' as const },
          ),
          budgets: [],
        },
      ],
    };
    const w = await mount(idle);
    expect(w.text()).toContain('ຍັງບໍ່ໄດ້ໃຊ້'); // no activity
    expect(w.text()).not.toContain('ຢຸດໃຊ້'); // stopped
    expect(w.text()).not.toContain('-100%');
  });

  it('keeps the department column in view while the row scrolls sideways', async () => {
    // The row is wide by design — four quarters, their months on demand, four year columns — and a
    // figure whose row you can no longer name is not a figure. PrimeVue only honours `frozen` on a
    // scrollable table, so the two are asserted together or neither works.
    const w = await mount();
    const table = w.findComponent({ name: 'TreeTable' });
    expect(table.props('scrollable')).toBe(true);
    expect(table.props('scrollHeight')).toBe('500px');
    // Gridlines: with eleven columns of figures, a row without them is read across by eye alone.
    expect(table.props('showGridlines')).toBe(true);
    expect(w.find('thead th[data-p-frozen-column="true"]').exists()).toBe(true);
  });

  it('right-aligns every figure and its header, and never wraps one', async () => {
    // The header alignment has to reach inside the `th`: PrimeVue puts the label in a flex child
    // and the `th` is a table-cell, where `justify-content` does nothing. Aligning the `th` read
    // correctly in the markup and left every header hugging the left edge above right-aligned
    // figures — so this asserts the selector that actually bites, not just `text-right`.
    const w = await mount();
    const money = w.findAll('tbody tr td').filter((c) => /[\d,]{3,}/.test(c.text()));
    expect(money.length).toBeGreaterThan(0);
    for (const cell of money) {
      const cls = cell.classes().join(' ');
      expect(cls).toContain('whitespace-nowrap');
      // `text-right` alone is NOT enough and this assertion once passed while the figures sat up to
      // 106px short of the edge: PrimeVue wraps body content in `.p-treetable-body-cell-content`,
      // a row flex container, and a flex item ignores the `td`'s text-align entirely.
      expect(cls).toContain('.p-treetable-body-cell-content]:justify-end');
    }
    const headers = w.findAll('thead th').filter((h) => /Q1|ຍອດ|ງົບປະມານ\/ປີ/.test(h.text()));
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(h.classes().join(' ')).toContain('.p-treetable-column-header-content]:justify-end');
    }
  });

  it('keeps a long name on one line, with the whole of it reachable', async () => {
    // A wrapped name makes its row twice as tall as its neighbours, and the figures beside it stop
    // lining up across the table.
    const w = await mount();
    const name = w.findAll('tbody tr td span').find((sp) => sp.text().includes('ພະແນກ ບໍລິຫານ'))!;
    expect(name.classes()).toContain('truncate');
    expect(name.attributes('title')).toBe('ພະແນກ ບໍລິຫານ');
  });

  // ---- the filters ----------------------------------------------------------------------------

  it('re-runs the read on the server when a department is chosen', async () => {
    // `web-dashboards` → Report Filters: applying a filter re-runs the report. Hiding rows already
    // on screen is not a filter under that requirement.
    const w = await mount();
    const store = useReportsStore();
    vi.mocked(store.loadBudgetByQuarter).mockClear();

    const dept = control(w, 'dept-filter');
    await dept.setValue('d2');
    dept.vm.$emit('change');
    await flushPromises();

    expect(store.loadBudgetByQuarter).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 'd2' }),
    );
  });

  it('keeps every option in both pickers after a filter is applied', async () => {
    // The failure this change exists to prevent. Derive the options from the rows and a filtered
    // response offers only the department already chosen, stranding the reader with no way back.
    const filtered: Report = {
      ...REPORT,
      // The server returned ONE department's rows...
      departments: [REPORT.departments[0]],
      // ...and both whole lists beside them.
    };
    const w = await mount(filtered);
    const depts = control(w, 'dept-filter');
    expect((depts.props('options') as Array<{ value: string }>).map((o) => o.value)).toEqual([
      'd1',
      'd2',
    ]);
    const years = control(w, 'year-filter');
    expect((years.props('options') as Array<{ value: string }>).map((o) => o.value)).toEqual([
      'fy',
      'fy25',
    ]);
  });

  it('clears the department when the fiscal year changes', async () => {
    // A department belongs to a year's budgets and may hold none in the year now chosen; carrying
    // the selection across would filter the new year down to nothing and read as "no data".
    const w = await mount();
    const store = useReportsStore();
    const dept = control(w, 'dept-filter');
    await dept.setValue('d2');
    dept.vm.$emit('change');
    await flushPromises();
    vi.mocked(store.loadBudgetByQuarter).mockClear();

    const year = control(w, 'year-filter');
    await year.setValue('fy25');
    year.vm.$emit('change');
    await flushPromises();

    const arg = vi.mocked(store.loadBudgetByQuarter).mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({ fiscalYearId: 'fy25' });
    expect(arg.departmentId).toBeUndefined();
  });

  it('opens the year picker on the year actually being reported', async () => {
    const w = await mount();
    expect(control(w, 'year-filter').props('modelValue')).toBe('fy');
  });

  // ---- the in-page narrowings -----------------------------------------------------------------

  it('searches in place, without asking the server', async () => {
    // The response already answers it. A round-trip would be slower and would open a window where
    // the tiles and the table disagree.
    const w = await mount();
    const store = useReportsStore();
    vi.mocked(store.loadBudgetByQuarter).mockClear();

    await w.find('[data-testid="search"]').setValue('7.502');
    await flushPromises();

    expect(store.loadBudgetByQuarter).not.toHaveBeenCalled();
  });

  it('keeps the department of a matching line', async () => {
    // A search for a budget code that dropped its department would drop the row it was meant to
    // find: the department is the parent the line hangs from.
    const w = await mount();
    await w.find('[data-testid="search"]').setValue('7.502');
    await flushPromises();
    expect(w.text()).toContain('ພະແນກ ບໍລິຫານ');
    expect(w.find('[data-testid="no-match"]').exists()).toBe(false);
  });

  it('shows only overspent rows when asked', async () => {
    const clean: Report = {
      ...REPORT,
      departments: [
        { ...REPORT.departments[0], overspent: false, budgets: [] },
        {
          ...REPORT.departments[0],
          departmentId: 'd2',
          departmentName: 'ພະແນກ ບຸກຄະລາກອນ',
          overspent: true,
          budgets: [],
        },
      ],
    };
    const w = await mount(clean);
    expect(w.text()).toContain('ພະແນກ ບໍລິຫານ');

    await control(w, 'overspent-only').setValue(true);
    await flushPromises();

    expect(w.text()).toContain('ພະແນກ ບຸກຄະລາກອນ');
    expect(w.text()).not.toContain('ພະແນກ ບໍລິຫານ');
  });

  it('states the tiles over the rows shown, not the rows removed', async () => {
    // A total that counts rows the table is not displaying contradicts the table beneath it.
    const w = await mount();
    expect(w.text()).toContain('2,200,000');

    await w.find('[data-testid="search"]').setValue('no-such-code');
    await flushPromises();

    expect(w.text()).not.toContain('2,200,000');
  });

  it('says an empty match differently from an empty fiscal year', async () => {
    const w = await mount();
    await w.find('[data-testid="search"]').setValue('no-such-code');
    await flushPromises();

    expect(w.find('[data-testid="no-match"]').exists()).toBe(true);
    // Not the message that means the year holds no budgets — that sends the reader elsewhere.
    expect(w.text()).not.toContain('ຍັງບໍ່ມີການນຳໃຊ້ໃນປີງົບປະມານນີ້');
  });

  it('renders the filter labels in Lao, not through the English fallback', async () => {
    // The guard against the misplaced-key mistake this screen has already made once: identical
    // strings live in the budgetBalance block, and a key put there resolves through English.
    const w = await mount();
    expect(control(w, 'dept-filter').props('placeholder')).toBe('ທຸກພະແນກ');
    expect(control(w, 'year-filter').props('placeholder')).toBe('ປີງົບປະມານ');
    expect(w.find('[data-testid="search"]').attributes('placeholder')).toBe('ຄົ້ນຫາລະຫັດ ຫຼື ຊື່');
  });

  it('shows an empty state rather than a blank page', async () => {
    const w = await mount({ ...REPORT, departments: [] });
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true);
  });
});

/**
 * What the report did not count.
 *
 * It used to count everything the fiscal year held. On the customer's data that put 700,000,000 of
 * refused proposals into one department's annual ceiling and listed the same plan line three times.
 * Correcting it makes a number the customer reads get smaller, and a number that shrinks with
 * nothing on screen to explain it is indistinguishable from a number that broke.
 */
describe('the report says what it left out', () => {
  it('states the count and the amount when budgets were excluded', async () => {
    const w = await mount({ ...REPORT, excluded: { count: 2, amountTotal: '700000000' } });
    const notice = w.find('[data-testid="excluded-notice"]');

    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('2');
    // Formatted through the base-currency formatter like every other figure on this screen —
    // LAK has no decimal places, so 700,000,000 and never 700000000.
    expect(notice.text()).toContain('700,000,000');
  });

  it('says nothing when the report counted everything', async () => {
    // `null`, not a zeroed object: the absence of a fact is not a fact, and stating it invites the
    // reader to wonder what is missing when nothing is.
    const w = await mount({ ...REPORT, excluded: null });
    expect(w.find('[data-testid="excluded-notice"]').exists()).toBe(false);
  });
});
