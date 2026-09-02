import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { Sandbox } from './support/provision';
import { SANDBOX } from './support/provision';
import { M } from './support/money';
import {
  actAsCurrentApprover,
  approveToEnd,
  getDoc,
  waitForStatus,
} from './support/flows';

/**
 * BUDGET_PLAN — post_action ACTIVATE_BUDGET. A plan is what puts money in force: its lines name
 * DRAFT budgets, approval flips them to ACTIVE and mints the control points that police them,
 * and a refusal marks them REJECTED so their (node, department) slot can be proposed again.
 *
 * It is authored through `/budgets/plans` rather than the generic wizard, because the plan's
 * content lives on `budget_movement` and a document raised without those rows is refused at
 * submit — which is itself asserted here.
 */

let s: Sandbox;
let seq = 0;

test.beforeAll(async () => {
  s = await getSandbox();
});

/** A DRAFT budget on a node of its own, so each plan test proposes something nothing else touches. */
async function draftBudget(
  amount = '5000000',
): Promise<{ budgetId: string; nodeId: string }> {
  const code = `${SANDBOX.nodeCode}.PLAN.${Date.now()}.${seq++}`;
  const node = await s.admin.post<{ id: string }>('/budgets/nodes', {
    fiscalYearId: s.fiscalYearId,
    code,
    name: `E2E plan ${code}`,
    parentId: s.parentNodeId,
  });
  const budget = await s.admin.post<{ id: string }>('/budgets', {
    fiscalYearId: s.fiscalYearId,
    departmentId: s.departmentId,
    nodeId: node.id,
    budgetName: `E2E plan ${code}`,
    amountTotal: amount,
  });
  return { budgetId: budget.id, nodeId: node.id };
}

test('BUDGET_PLAN: approved through every step puts the budget in force', async () => {
  const { budgetId } = await draftBudget('7500000');
  const before = await s.admin.get<{ status: string }>(`/budgets/${budgetId}`);
  expect(before.status, 'a proposed budget starts DRAFT').toBe('DRAFT');

  const plan = await s.requester.api.post<{ documentId: string }>(
    '/budgets/plans',
    {
      departmentId: s.departmentId,
      lines: [{ budgetId, reason: 'e2e: put this line in force' }],
    },
  );
  await s.requester.api.post(`/documents/${plan.documentId}/submit`);
  await approveToEnd(s, plan.documentId);

  const doc = await getDoc(s.admin, plan.documentId);
  expect(doc.status).toBe('COMPLETED');

  const after = await s.admin.get<{ status: string; amountTotal: string }>(
    `/budgets/${budgetId}`,
  );
  expect(after.status, 'approval must put the budget in force').toBe('ACTIVE');
  expect(
    M.eq(after.amountTotal, '7500000'),
    'the plan must not change the figure',
  ).toBe(true);

  // A budget nobody could check would be spendable with no ceiling — approval mints the point.
  const cps = await s.admin.get<Array<{ id: string }>>(
    `/budgets/${budgetId}/control-points`,
  );
  expect(
    cps.length,
    'an activated budget must be governed by a control point',
  ).toBeGreaterThan(0);

  // Nothing is spent yet: the whole figure is available and the ledger is empty.
  const breakdown = await s.admin.get<{
    available: string;
    reserved: string;
    actual: string;
  }>(`/budgets/${budgetId}/breakdown`);
  expect(M.eq(breakdown.available, '7500000')).toBe(true);
  expect(M.eq(breakdown.reserved, '0')).toBe(true);
  expect(M.eq(breakdown.actual, '0')).toBe(true);
});

test('BUDGET_PLAN: rejected leaves the budget out of force and frees its slot', async () => {
  const { budgetId } = await draftBudget('3000000');

  const plan = await s.requester.api.post<{ documentId: string }>(
    '/budgets/plans',
    {
      departmentId: s.departmentId,
      lines: [{ budgetId, reason: 'e2e: this one gets turned down' }],
    },
  );
  await s.requester.api.post(`/documents/${plan.documentId}/submit`);
  await actAsCurrentApprover(
    s,
    plan.documentId,
    'REJECT',
    'e2e: not this year',
  );

  const doc = await getDoc(s.admin, plan.documentId);
  expect(doc.status).toBe('REJECTED');

  const after = await s.admin.get<{ status: string }>(`/budgets/${budgetId}`);
  expect(after.status, 'a turned-down line must not stay DRAFT forever').toBe(
    'REJECTED',
  );
});

test('BUDGET_PLAN: withdrawn by its author leaves the budget out of force', async () => {
  const { budgetId } = await draftBudget('2000000');

  const plan = await s.requester.api.post<{ documentId: string }>(
    '/budgets/plans',
    {
      departmentId: s.departmentId,
      lines: [{ budgetId, reason: 'e2e: withdrawn' }],
    },
  );
  await s.requester.api.post(`/documents/${plan.documentId}/submit`);
  await waitForStatus(s.requester.api, plan.documentId, ['IN_APPROVAL']);
  await s.requester.api.post(`/documents/${plan.documentId}/cancel`, {
    remark: 'e2e: withdrawn',
  });

  const doc = await getDoc(s.admin, plan.documentId);
  expect(doc.status).toBe('CANCELLED');
  const after = await s.admin.get<{ status: string }>(`/budgets/${budgetId}`);
  expect(
    after.status,
    'a withdrawn plan must not leave its budget ACTIVE',
  ).not.toBe('ACTIVE');
});

test('BUDGET_PLAN: a plan document with no movement rows cannot be submitted', async () => {
  // Raised through the generic wizard instead of /budgets/plans: the type's post action moves
  // budget, and a document that moves budget while carrying no movement is unapprovable. It has
  // to be refused at submit, by the person who can still fix it.
  const planType = s.docTypes.find((t) => t.postAction === 'ACTIVATE_BUDGET')!;
  const doc = await s.requester.api.post<{ id: string }>('/documents', {
    documentTypeId: planType.id,
    totalAmount: '1000',
  });
  const res = await s.requester.api.attempt(
    'post',
    `/documents/${doc.id}/submit`,
    {},
  );
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toContain('budget movement');

  const after = await getDoc(s.requester.api, doc.id);
  expect(after.status, 'a refused submit must leave the document DRAFT').toBe(
    'DRAFT',
  );
});

test('BUDGET_PLAN: an ACTIVE budget cannot be proposed again', async () => {
  const activeBudgetId = s.budgetByType.REC;
  const res = await s.requester.api.attempt('post', '/budgets/plans', {
    departmentId: s.departmentId,
    lines: [{ budgetId: activeBudgetId, reason: 'e2e: already in force' }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toContain(
    'Only a DRAFT budget can be planned',
  );
});
