import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentSummaryReport from './DocumentSummaryReport.vue';
import type { DocumentSummaryRow } from '../../api/reports';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * A document type's `typeCode` and a category's `code` are per-company configuration — a
 * customer invents `BUDGET_PLAN` and `FINANCE` themselves — so neither can be translated by a
 * shipped catalog. The screen has the configured names and must use them, in the chart as much
 * as in the table: this report used to label its bar axis `BUDGET_PLAN` while the table two
 * cards below called the same thing ແຜນງົບປະມານ.
 */
const ROWS: DocumentSummaryRow[] = [
  {
    documentTypeId: 't1',
    typeCode: 'BUDGET_PLAN',
    typeName: 'ແຜນງົບປະມານ',
    category: 'FINANCE',
    categoryName: 'ການເງິນ',
    status: 'COMPLETED',
    count: 20,
    baseTotal: '0',
  },
];

async function mount(rows: DocumentSummaryRow[] = ROWS) {
  const w = await mountView(DocumentSummaryReport, {
    path: '/reports/documents',
    routeName: 'report-documents',
    permissions: ['REPORT_VIEW'],
    initialState: {
      reports: {
        documents: { rows, byStatus: [{ status: 'COMPLETED', count: 20, baseTotal: '0' }] },
        loading: false,
        error: '',
      },
      auth: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('DocumentSummaryReport', () => {
  it('labels the type chart with the configured name, not the code', async () => {
    const w = await mount();
    const chart = w.findComponent({ name: 'BarChart' }) ?? w.findComponent({ name: 'Chart' });
    const labels = (chart?.props('labels') ?? chart?.props('data')?.labels) as string[] | undefined;
    expect(labels).toEqual(['ແຜນງົບປະມານ']);
  });

  it('shows the category name in the table, not its code', async () => {
    const text = (await mount()).text();
    expect(text).toContain('ການເງິນ');
  });

  it('shows neither the type code nor the category code anywhere on the page', async () => {
    const text = (await mount()).text();
    expect(text).not.toContain('BUDGET_PLAN');
    expect(text).not.toContain('FINANCE');
  });
});
