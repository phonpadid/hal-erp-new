import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../../test/mountView';
import TrialBalanceReport from './TrialBalanceReport.vue';

const TB = {
  from: undefined,
  to: undefined,
  accounts: [
    { accountId: 'a1', code: '1000', name: 'Cash', accountType: 'ASSET', debit: '204000.00', credit: '100000.00', balance: '104000.00' },
    { accountId: 'a2', code: '4000', name: 'Revenue', accountType: 'REVENUE', debit: '0.00', credit: '200000.00', balance: '200000.00' },
  ],
  totalDebit: '304000.00',
  totalCredit: '304000.00',
  balanced: true,
};

async function mount() {
  const w = await mountView(TrialBalanceReport, {
    path: '/reports/trial-balance',
    routeName: 'report-trial-balance',
    permissions: ['GL_VIEW'],
    initialState: { financialReports: { trialBalance: TB } },
  });
  await flushPromises();
  return w;
}

describe('TrialBalanceReport', () => {
  it('renders accounts and the balancing totals footer', async () => {
    const w = await mount();
    const text = w.text();
    // Account rows (data, locale-independent).
    expect(text).toContain('1000');
    expect(text).toContain('Cash');
    expect(text).toContain('Revenue');
    // Footer renders a balanced tag only when total debit == total credit.
    expect(w.findComponent({ name: 'Tag' }).props('severity')).toBe('success');
  });
});
