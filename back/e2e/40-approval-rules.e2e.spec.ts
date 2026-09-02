import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { DocTypeInfo, Sandbox } from './support/provision';
import { M } from './support/money';
import {
  actAsCurrentApprover,
  approvalLog,
  approveToEnd,
  authorDraft,
  breakdown,
  createActiveBudget,
  getDoc,
  ledger,
  waitForStatus,
} from './support/flows';

/**
 * The rules that decide whether a document may move at all — who may act, what may be submitted,
 * and what the ledger is allowed to say afterwards. One representative budget-controlled type
 * carries these: they are properties of the engine, not of any one type's configuration, and the
 * per-type files already prove the configuration is read.
 */

let s: Sandbox;
let REC: DocTypeInfo;

test.beforeAll(async () => {
  s = await getSandbox();
  REC = s.docTypes.find((t) => t.code === 'REC')!;
  expect(REC, 'REC is not configured in this company').toBeTruthy();
});

// ---- who may act ---------------------------------------------------------------------------

test('a document cannot be approved by the person who raised it', async () => {
  // Raised BY the first-step approver, so eligibility and authorship land on one person and the
  // only thing that can refuse the approval is the self-approval rule itself (invariant 8).
  const id = await authorDraft(s, REC, {
    amount: '400000',
    author: s.approver1,
  });
  await s.approver1.api.post(`/documents/${id}/submit`);
  await waitForStatus(s.approver1.api, id, ['IN_APPROVAL']);

  const res = await s.approver1.api.attempt(
    'post',
    `/documents/${id}/actions`,
    { action: 'APPROVE' },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(JSON.stringify(res.body)).toContain(
    'cannot be approved by its creator',
  );

  // And the client-side gate agrees with the server, so the button is not offered either.
  const gate = await s.approver1.api.get<{ canAct: boolean }>(
    `/documents/${id}/can-act`,
  );
  expect(gate.canAct).toBe(false);

  // Left where it was — refusing an act must not move the document.
  expect((await getDoc(s.admin, id)).status).toBe('IN_APPROVAL');
  await s.approver1.api.post(`/documents/${id}/cancel`, {
    remark: 'e2e: tidy up',
  });
});

test('someone who is not an approver of the current step cannot act on it', async () => {
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

  // The second-step approver may not reach forward and clear the first step.
  const early = await s.approver2.api.attempt(
    'post',
    `/documents/${id}/actions`,
    { action: 'APPROVE' },
  );
  expect(early.status, JSON.stringify(early.body)).toBe(403);
  expect(JSON.stringify(early.body)).toContain('Not an eligible approver');

  await approveToEnd(s, id);
  expect((await getDoc(s.admin, id)).status).toBe('COMPLETED');
});

test('a document that has finished cannot be acted on again', async () => {
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await approveToEnd(s, id);

  const again = await s.approver2.api.attempt(
    'post',
    `/documents/${id}/actions`,
    { action: 'APPROVE' },
  );
  expect(again.status, JSON.stringify(again.body)).toBe(400);
  expect(JSON.stringify(again.body)).toContain('not in approval');

  const cancel = await s.requester.api.attempt(
    'post',
    `/documents/${id}/cancel`,
    {},
  );
  expect(cancel.status, JSON.stringify(cancel.body)).toBe(400);

  // The settlement stands: one RESERVE, one ACTUAL, nothing added by the refused calls.
  const rows = await ledger(s.admin, s.budgetByType.REC, id);
  expect(rows.map((r) => r.txnType).sort()).toEqual(['ACTUAL', 'RESERVE']);
});

test('only the author may withdraw a request', async () => {
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

  const res = await s.approver1.api.attempt('post', `/documents/${id}/cancel`, {
    remark: 'e2e: not mine',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect((await getDoc(s.admin, id)).status).toBe('IN_APPROVAL');

  await s.requester.api.post(`/documents/${id}/cancel`, {
    remark: 'e2e: mine to withdraw',
  });
  expect((await getDoc(s.admin, id)).status).toBe('CANCELLED');
});

test('withdrawing between submit and routing must not be undone by the router', async () => {
  // Routing starts from an event after the submit commits, so there is a window in which the
  // document is SUBMITTED and the route has not opened. A withdrawal accepted in that window has
  // to stick: the alternative is a request its author cancelled reappearing in an approver's
  // queue with its budget already released.
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await s.requester.api.post(`/documents/${id}/cancel`, {
    remark: 'e2e: withdrawn immediately',
  });

  const log = await approvalLog(s.admin, id);
  expect(
    log.some((l) => l.action === 'CANCEL'),
    'the withdrawal was not recorded',
  ).toBe(true);

  const doc = await getDoc(s.admin, id);
  expect(
    doc.status,
    'the withdrawal was accepted and recorded, but the document is not CANCELLED',
  ).toBe('CANCELLED');

  const rows = await ledger(s.admin, s.budgetByType.REC, id);
  expect(rows.map((r) => r.txnType).sort()).toEqual(['RELEASE', 'RESERVE']);
});

// ---- what may be submitted -----------------------------------------------------------------

test('a document cannot be submitted twice', async () => {
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  const again = await s.requester.api.attempt(
    'post',
    `/documents/${id}/submit`,
    {},
  );
  expect(again.status, JSON.stringify(again.body)).toBe(400);
  expect(JSON.stringify(again.body)).toContain('INVALID_STATE');

  // One hold, not two.
  const rows = await ledger(s.admin, s.budgetByType.REC, id);
  expect(rows.filter((r) => r.txnType === 'RESERVE').length).toBe(1);
  await s.requester.api.post(`/documents/${id}/cancel`, {});
});

test('a budget-controlled line with no budget is refused, and nothing is held', async () => {
  const before = await breakdown(s.admin, s.budgetByType.REC);
  const id = await authorDraft(s, REC, {
    amount: '400000',
    withoutBudget: true,
  });
  const res = await s.requester.api.attempt(
    'post',
    `/documents/${id}/submit`,
    {},
  );
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toContain('must charge a budget');

  expect((await getDoc(s.requester.api, id)).status).toBe('DRAFT');
  const after = await breakdown(s.admin, s.budgetByType.REC);
  expect(
    M.eq(after.reserved, before.reserved),
    'a refused submit must reserve nothing',
  ).toBe(true);
});

test('a missing required field is refused, and nothing is held', async () => {
  const budgetId = s.budgetByType.REC;
  const before = await breakdown(s.admin, budgetId);

  // Author the document WITHOUT filling the template's required fields.
  const doc = await s.requester.api.post<{ id: string }>('/documents', {
    documentTypeId: REC.id,
    totalAmount: '400000',
  });
  await s.requester.api.put(`/documents/${doc.id}/lines`, [
    {
      lineNo: 1,
      description: 'E2E incomplete',
      qty: '1',
      unitPrice: '400000',
      lineAmount: '400000',
      budgetId,
    },
  ]);
  const res = await s.requester.api.attempt(
    'post',
    `/documents/${doc.id}/submit`,
    {},
  );
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toMatch(/Required field/i);

  expect((await getDoc(s.requester.api, doc.id)).status).toBe('DRAFT');
  const after = await breakdown(s.admin, budgetId);
  expect(M.eq(after.reserved, before.reserved)).toBe(true);
});

test('a document in a currency with no rate is refused, and nothing is held', async () => {
  const budgetId = s.budgetByType.REC;
  const before = await breakdown(s.admin, budgetId);
  const id = await authorDraft(s, REC, { amount: '400000', currency: 'USD' });
  const res = await s.requester.api.attempt(
    'post',
    `/documents/${id}/submit`,
    {},
  );
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toMatch(/exchange rate/i);

  expect((await getDoc(s.requester.api, id)).status).toBe('DRAFT');
  const after = await breakdown(s.admin, budgetId);
  expect(M.eq(after.reserved, before.reserved)).toBe(true);
});

// ---- the budget ceiling --------------------------------------------------------------------

test('spending past the control point ceiling is blocked, and the budget is untouched', async () => {
  const budgetId = await createActiveBudget(s, '1000000', 'ceiling');

  const overspend = await authorDraft(s, REC, { amount: '1000001', budgetId });
  const res = await s.requester.api.attempt(
    'post',
    `/documents/${overspend}/submit`,
    {},
  );
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(JSON.stringify(res.body)).toContain('BUDGET_EXCEEDED');

  const afterBlock = await breakdown(s.admin, budgetId);
  expect(
    M.eq(afterBlock.reserved, '0'),
    'a blocked submit must reserve nothing',
  ).toBe(true);
  expect(M.eq(afterBlock.available, '1000000')).toBe(true);

  // Exactly the ceiling still goes through — BLOCK is at 100%, not below it.
  const exact = await authorDraft(s, REC, { amount: '1000000', budgetId });
  await s.requester.api.post(`/documents/${exact}/submit`);
  const atCeiling = await breakdown(s.admin, budgetId);
  expect(M.eq(atCeiling.available, '0')).toBe(true);

  // And with nothing left, even the smallest request is refused.
  const oneMore = await authorDraft(s, REC, { amount: '1', budgetId });
  const refused = await s.requester.api.attempt(
    'post',
    `/documents/${oneMore}/submit`,
    {},
  );
  expect(refused.status, JSON.stringify(refused.body)).toBe(400);
  expect(JSON.stringify(refused.body)).toContain('BUDGET_EXCEEDED');

  // Withdrawing the first frees the room again.
  await waitForStatus(s.requester.api, exact, ['IN_APPROVAL']);
  await s.requester.api.post(`/documents/${exact}/cancel`, {
    remark: 'e2e: free the ceiling',
  });
  const freed = await breakdown(s.admin, budgetId);
  expect(
    M.eq(freed.available, '1000000'),
    'withdrawing must give the ceiling back',
  ).toBe(true);
});

// ---- the numbers ---------------------------------------------------------------------------

test('several lines on one budget reserve their sum, once', async () => {
  const budgetId = await createActiveBudget(s, '9000000', 'multiline');
  const id = await authorDraft(s, REC, {
    amount: '3000000',
    lines: 3,
    budgetId,
  });

  const draft = await s.requester.api.get<{
    lines: Array<{ lineAmount: string }>;
  }>(`/documents/${id}/detail`);
  expect(draft.lines.length).toBe(3);

  await s.requester.api.post(`/documents/${id}/submit`);
  const rows = await ledger(s.admin, budgetId, id);
  const reserves = rows.filter((r) => r.txnType === 'RESERVE');
  expect(reserves.length, 'one RESERVE per budget, not per line').toBe(1);
  expect(
    M.eq(reserves[0].amount, '3000000'),
    'the reservation is the sum of the lines',
  ).toBe(true);

  await approveToEnd(s, id);
  const after = await breakdown(s.admin, budgetId);
  expect(M.eq(after.actual, '3000000')).toBe(true);
  expect(M.eq(after.available, '6000000')).toBe(true);
});

test('the approval trail records every act, in order, and nothing else', async () => {
  const id = await authorDraft(s, REC, { amount: '400000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await actAsCurrentApprover(s, id, 'APPROVE', 'e2e: step one');
  await actAsCurrentApprover(s, id, 'APPROVE', 'e2e: step two');

  const log = await approvalLog(s.admin, id);
  expect(log.map((l) => `${l.stepNo}:${l.action}`)).toEqual([
    '1:APPROVE',
    '2:APPROVE',
  ]);
  expect(log.map((l) => l.remark)).toEqual(['e2e: step one', 'e2e: step two']);
});
