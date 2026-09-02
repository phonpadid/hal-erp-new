import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { DocTypeInfo, Sandbox } from './support/provision';
import { M } from './support/money';
import { DISBURSEMENT_TYPES } from './support/expected-types';
import {
  actAsCurrentApprover,
  approveToEnd,
  authorDraft,
  breakdown,
  getDoc,
  ledger,
  approvalLog,
  waitForStatus,
} from './support/flows';

/**
 * The four ways a budget-controlled disbursement can end, run against EVERY CUT_BUDGET document
 * type the company has configured:
 *
 *   submit → approve → approve → COMPLETED   reserve becomes actual
 *   submit → approve → reject                the hold comes back
 *   submit → cancel (by its author)          the hold comes back
 *   submit → return → resubmit → COMPLETED   the hold comes back, then is taken again
 *
 * Each type charges its own sandbox budget, so one type's spending can never explain another
 * type's balance. Money is compared with `M`, never with `Number` (CLAUDE.md).
 */
const AMOUNT = '1500000'; // LAK

let s: Sandbox;
let cutBudgetTypes: DocTypeInfo[];

test.beforeAll(async () => {
  s = await getSandbox();
  cutBudgetTypes = s.docTypes.filter(
    (t) => t.requiresBudget && t.postAction === 'CUT_BUDGET',
  );
  expect(
    cutBudgetTypes.length,
    'no CUT_BUDGET document types to exercise',
  ).toBeGreaterThan(0);
});

for (const code of DISBURSEMENT_TYPES) {
  const typeOf = (): DocTypeInfo => {
    const t = cutBudgetTypes.find((x) => x.code === code);
    if (!t)
      throw new Error(
        `${code} is not an active CUT_BUDGET type in this company`,
      );
    return t;
  };

  test(`${code}: approved through every step settles the reservation`, async () => {
    await completedFlow(typeOf(), s.budgetByType[code]);
  });

  test(`${code}: rejected at the last step gives the budget back`, async () => {
    await rejectedFlow(typeOf(), s.budgetByType[code]);
  });

  test(`${code}: withdrawn by its author gives the budget back`, async () => {
    await cancelledFlow(typeOf(), s.budgetByType[code]);
  });

  test(`${code}: returned, then resubmitted, still reaches COMPLETED`, async () => {
    await returnedThenCompletedFlow(typeOf(), s.budgetByType[code]);
  });
}

// ---- the four flows ------------------------------------------------------------------------

async function completedFlow(t: DocTypeInfo, budgetId: string): Promise<void> {
  const before = await breakdown(s.admin, budgetId);

  const id = await authorDraft(s, t, { amount: AMOUNT });
  const draft = await getDoc(s.requester.api, id);
  expect(draft.status, `${t.code}: fresh document should be DRAFT`).toBe(
    'DRAFT',
  );

  await s.requester.api.post(`/documents/${id}/submit`);
  const submitted = await getDoc(s.admin, id);
  expect(['SUBMITTED', 'IN_APPROVAL'], `${t.code}: after submit`).toContain(
    submitted.status,
  );
  expect(
    M.eq(submitted.budgetBaseTotalAmount ?? '0', AMOUNT),
    `${t.code}: budget basis`,
  ).toBe(true);

  const held = await breakdown(s.admin, budgetId);
  expect(
    M.eq(held.reserved, M.add(before.reserved, AMOUNT)),
    `${t.code}: RESERVE not posted`,
  ).toBe(true);
  expect(
    M.eq(held.available, M.sub(before.available, AMOUNT)),
    `${t.code}: available did not drop`,
  ).toBe(true);

  await approveToEnd(s, id);

  const done = await getDoc(s.admin, id);
  expect(done.status, `${t.code}: after both approvals`).toBe('COMPLETED');

  const after = await breakdown(s.admin, budgetId);
  // ACTUAL converts the hold; it is NOT a second deduction (invariant 3), so available is
  // unchanged from the moment the hold was taken.
  expect(
    M.eq(after.actual, M.add(before.actual, AMOUNT)),
    `${t.code}: ACTUAL not posted`,
  ).toBe(true);
  expect(
    M.eq(after.reserved, M.add(before.reserved, AMOUNT)),
    `${t.code}: RESERVE moved`,
  ).toBe(true);
  expect(
    M.eq(after.released, before.released),
    `${t.code}: nothing should have been released`,
  ).toBe(true);
  expect(
    M.eq(after.available, M.sub(before.available, AMOUNT)),
    `${t.code}: available after settle`,
  ).toBe(true);

  const rows = await ledger(s.admin, budgetId, id);
  expect(rows.map((r) => r.txnType).sort(), `${t.code}: ledger rows`).toEqual([
    'ACTUAL',
    'RESERVE',
  ]);
  for (const r of rows)
    expect(M.eq(r.amount, AMOUNT), `${t.code}: ${r.txnType} amount`).toBe(true);

  const log = await approvalLog(s.admin, id);
  expect(
    log.filter((l) => l.action === 'APPROVE').length,
    `${t.code}: approval trail`,
  ).toBe(2);
}

async function rejectedFlow(t: DocTypeInfo, budgetId: string): Promise<void> {
  const before = await breakdown(s.admin, budgetId);

  const id = await authorDraft(s, t, { amount: AMOUNT });
  await s.requester.api.post(`/documents/${id}/submit`);
  await actAsCurrentApprover(s, id, 'APPROVE', 'e2e: first approver agrees');
  await actAsCurrentApprover(s, id, 'REJECT', 'e2e: second approver refuses');

  const doc = await getDoc(s.admin, id);
  expect(doc.status, `${t.code}: after reject`).toBe('REJECTED');

  const after = await breakdown(s.admin, budgetId);
  expect(
    M.eq(after.released, M.add(before.released, AMOUNT)),
    `${t.code}: reject did not release`,
  ).toBe(true);
  expect(
    M.eq(after.available, before.available),
    `${t.code}: available not restored by reject`,
  ).toBe(true);
  expect(
    M.eq(after.actual, before.actual),
    `${t.code}: a rejected document must post no ACTUAL`,
  ).toBe(true);

  const rows = await ledger(s.admin, budgetId, id);
  expect(
    rows.map((r) => r.txnType).sort(),
    `${t.code}: ledger after reject`,
  ).toEqual(['RELEASE', 'RESERVE']);
}

async function cancelledFlow(t: DocTypeInfo, budgetId: string): Promise<void> {
  const before = await breakdown(s.admin, budgetId);

  const id = await authorDraft(s, t, { amount: AMOUNT });
  await s.requester.api.post(`/documents/${id}/submit`);
  // Withdraw once the document is genuinely in the approvers' queue. Cancelling in the window
  // between submit and the routing listener is its own case — see 20-approval-edge-cases.
  await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);
  await s.requester.api.post(`/documents/${id}/cancel`, {
    remark: 'e2e: author withdraws',
  });

  const doc = await getDoc(s.admin, id);
  expect(doc.status, `${t.code}: after cancel`).toBe('CANCELLED');

  const after = await breakdown(s.admin, budgetId);
  expect(
    M.eq(after.released, M.add(before.released, AMOUNT)),
    `${t.code}: cancel did not release`,
  ).toBe(true);
  expect(
    M.eq(after.available, before.available),
    `${t.code}: available not restored by cancel`,
  ).toBe(true);

  // Withdrawal is the author's act and is recorded as one.
  const log = await approvalLog(s.admin, id);
  expect(
    log.some((l) => l.action === 'CANCEL'),
    `${t.code}: cancel not in the trail`,
  ).toBe(true);
}

async function returnedThenCompletedFlow(
  t: DocTypeInfo,
  budgetId: string,
): Promise<void> {
  const before = await breakdown(s.admin, budgetId);

  const id = await authorDraft(s, t, { amount: AMOUNT });
  await s.requester.api.post(`/documents/${id}/submit`);
  await actAsCurrentApprover(s, id, 'RETURN', 'e2e: send it back for a fix');

  const returned = await getDoc(s.admin, id);
  expect(returned.status, `${t.code}: after return`).toBe('DRAFT');
  const releasedOnReturn = await breakdown(s.admin, budgetId);
  expect(
    M.eq(releasedOnReturn.available, before.available),
    `${t.code}: a returned document must not keep holding budget`,
  ).toBe(true);

  // The author fixes it and sends it again; the second pass takes a fresh hold and completes.
  await s.requester.api.post(`/documents/${id}/submit`);
  // Asserted on its own, with its own message: a resubmission that never routes leaves the
  // document SUBMITTED, holding budget, in nobody's queue — and that is not a timeout, it is a
  // stranded document.
  await waitForStatus(s.requester.api, id, ['IN_APPROVAL'], 5_000).catch(() => {
    throw new Error(
      `${t.code}: the resubmitted document never reached IN_APPROVAL — it is stranded in ` +
        'SUBMITTED with its budget reserved and no approver assigned',
    );
  });
  await approveToEnd(s, id);

  const done = await getDoc(s.admin, id);
  expect(done.status, `${t.code}: after resubmit and approvals`).toBe(
    'COMPLETED',
  );

  const after = await breakdown(s.admin, budgetId);
  expect(
    M.eq(after.available, M.sub(before.available, AMOUNT)),
    `${t.code}: available after resubmit`,
  ).toBe(true);
  expect(
    M.eq(after.actual, M.add(before.actual, AMOUNT)),
    `${t.code}: ACTUAL after resubmit`,
  ).toBe(true);
}
