import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import { SANDBOX } from './support/provision';
import { M } from './support/money';
import { ALL_EXPECTED_TYPES } from './support/expected-types';

/**
 * Provisioning IS a test: it drives department, employee, onboarding, workflow, dept_doc_type,
 * budget node, budget and budget-plan endpoints, and every later flow depends on all of them.
 * Failing here should read as "the sandbox could not be built", not as a mysterious failure
 * three files later.
 */
test.describe.configure({ mode: 'serial' });

test('the sandbox provisions: department, approvers, workflow, mappings and active budgets', async () => {
  const s = await getSandbox();

  expect(s.companyId).toBeTruthy();
  expect(s.departmentId).toBeTruthy();
  expect(s.workflowId).toBeTruthy();
  expect(s.requester.userId).not.toBe(s.approver1.userId);
  expect(s.approver1.userId).not.toBe(s.approver2.userId);

  // Every active document type of the company is raisable from the sandbox department.
  const creatable = await s.requester.api.get<
    Array<{ id: string; code: string }>
  >('/documents/creatable-types');
  const creatableCodes = creatable.map((t) => t.code).sort();
  expect(creatableCodes).toEqual(s.docTypes.map((t) => t.code).sort());

  // And every one of them has an ACTIVE budget with its own governing control point, put in
  // force through the real ACTIVATE_BUDGET route rather than written straight to the table.
  for (const t of s.docTypes) {
    const budgetId = s.budgetByType[t.code];
    expect(budgetId, `no sandbox budget for ${t.code}`).toBeTruthy();
    const budget = await s.admin.get<{ status: string; amountTotal: string }>(
      `/budgets/${budgetId}`,
    );
    expect(budget.status, `${t.code} budget is ${budget.status}`).toBe(
      'ACTIVE',
    );
    // NUMERIC(15,2) on the wire vs. the plain figure that was posted — compare as money, not text.
    expect(M.eq(budget.amountTotal, SANDBOX.budgetAmount)).toBe(true);
    const cps = await s.admin.get<unknown[]>(
      `/budgets/${budgetId}/control-points`,
    );
    expect(cps.length, `${t.code} budget has no control point`).toBeGreaterThan(
      0,
    );
  }
});

test('the suite covers every active document type the company has configured', async () => {
  const s = await getSandbox();
  // The guard behind the hand-written per-type test lists: a type added to (or dropped from)
  // this company fails HERE, rather than quietly leaving a document type untested.
  expect(s.docTypes.map((t) => t.code).sort()).toEqual(
    [...ALL_EXPECTED_TYPES].sort(),
  );
});
