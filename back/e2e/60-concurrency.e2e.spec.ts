import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { DocTypeInfo, Sandbox } from './support/provision';
import { M } from './support/money';
import {
  authorDraft,
  breakdown,
  createActiveBudget,
  getDoc,
  ledger,
} from './support/flows';

/**
 * The two places the design says a lock has to hold (CLAUDE.md, "Concurrency rules"): issuing a
 * document number, and reserving budget. Both are asserted by racing real HTTP requests rather
 * than by reasoning about the code — a lock that is not taken looks exactly like one that is
 * until two callers arrive at once.
 */

let s: Sandbox;
let REC: DocTypeInfo;

test.beforeAll(async () => {
  s = await getSandbox();
  REC = s.docTypes.find((t) => t.code === 'REC')!;
});

test('concurrent creates never issue the same document number', async () => {
  const CONCURRENCY = 8;
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      s.requester.api.post<{ id: string; docNo: string }>('/documents', {
        documentTypeId: REC.id,
        totalAmount: '1000',
      }),
    ),
  );
  const numbers = results.map((r) => r.docNo);
  expect(
    new Set(numbers).size,
    `duplicate document numbers: ${numbers.join(', ')}`,
  ).toBe(CONCURRENCY);
});

test('two submissions racing for the last of a budget cannot both win', async () => {
  // Room for exactly one of the two.
  const budgetId = await createActiveBudget(s, '1000000', 'race');
  const a = await authorDraft(s, REC, { amount: '600000', budgetId });
  const b = await authorDraft(s, REC, { amount: '600000', budgetId });

  const [ra, rb] = await Promise.all([
    s.requester.api.attempt('post', `/documents/${a}/submit`, {}),
    s.requester.api.attempt('post', `/documents/${b}/submit`, {}),
  ]);

  const winners = [ra, rb].filter((r) => r.status >= 200 && r.status < 300);
  const losers = [ra, rb].filter((r) => r.status >= 400);
  expect(
    winners.length,
    `both submissions were accepted: ${JSON.stringify([ra.body, rb.body])}`,
  ).toBe(1);
  expect(losers.length).toBe(1);
  expect(JSON.stringify(losers[0].body)).toContain('BUDGET_EXCEEDED');

  // And the ledger agrees: one hold, not two, and the budget is not over-committed.
  const held = await breakdown(s.admin, budgetId);
  expect(M.eq(held.reserved, '600000'), 'the budget was over-committed').toBe(
    true,
  );
  expect(M.eq(held.available, '400000')).toBe(true);

  const rowsA = await ledger(s.admin, budgetId, a);
  const rowsB = await ledger(s.admin, budgetId, b);
  expect(
    rowsA.length + rowsB.length,
    'a refused submit must leave no ledger row',
  ).toBe(1);

  // The loser stayed a draft and can still be finished later, once there is room.
  const loserId = (await getDoc(s.requester.api, a)).status === 'DRAFT' ? a : b;
  expect((await getDoc(s.requester.api, loserId)).status).toBe('DRAFT');
});

test('the same approval posted twice at once is only counted once', async () => {
  const budgetId = await createActiveBudget(s, '5000000', 'dblapprove');
  const id = await authorDraft(s, REC, { amount: '500000', budgetId });
  await s.requester.api.post(`/documents/${id}/submit`);
  // Wait for the route to open before racing the two approvals.
  for (
    let i = 0;
    i < 100 && (await getDoc(s.admin, id)).status !== 'IN_APPROVAL';
    i++
  ) {
    await new Promise((r) => setTimeout(r, 100));
  }

  const [x, y] = await Promise.all([
    s.approver1.api.attempt('post', `/documents/${id}/actions`, {
      action: 'APPROVE',
    }),
    s.approver1.api.attempt('post', `/documents/${id}/actions`, {
      action: 'APPROVE',
    }),
  ]);
  const accepted = [x, y].filter((r) => r.status < 400).length;
  expect(accepted, 'the same approver cleared the step twice').toBe(1);

  const doc = await getDoc(s.admin, id);
  expect(doc.currentStepNo, 'a duplicate approval must not skip a step').toBe(
    2,
  );
});
