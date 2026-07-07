import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';
import { mountView } from '../mountView';
import EmptyState from '../../components/EmptyState.vue';
import BudgetBalanceReport from '../../views/reports/BudgetBalanceReport.vue';
import BudgetAuditReport from '../../views/reports/BudgetAuditReport.vue';
import ApprovalAgingReport from '../../views/reports/ApprovalAgingReport.vue';
import QuotaRemainingReport from '../../views/reports/QuotaRemainingReport.vue';
import GroupBudgetReport from '../../views/reports/GroupBudgetReport.vue';

// Regression guard for the bug this change fixed: report views passed `:message`
// to <EmptyState>, which REQUIRES `title`, so an empty report table rendered a
// blank heading. With no data loaded each view shows its empty state — assert
// every EmptyState carries a non-blank `title` (locale-agnostic).
const REPORTS: [name: string, component: Component][] = [
  ['BudgetBalanceReport', BudgetBalanceReport],
  ['ApprovalAgingReport', ApprovalAgingReport],
  ['QuotaRemainingReport', QuotaRemainingReport],
  ['BudgetAuditReport', BudgetAuditReport],
  ['GroupBudgetReport', GroupBudgetReport],
];

describe('report empty states render a non-blank title', () => {
  it.each(REPORTS)('%s: every EmptyState has a non-empty title', async (_name, component) => {
    const w = await mountView(component, { path: '/reports', routeName: 'reports' });
    const states = w.findAllComponents(EmptyState);
    expect(states.length).toBeGreaterThan(0);
    for (const s of states) {
      expect(s.props('title')).toBeTruthy();
      expect(String(s.props('title')).trim().length).toBeGreaterThan(0);
    }
  });
});
