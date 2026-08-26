import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { Sandbox } from './support/provision';
import { PLAIN_TYPES } from './support/expected-types';
import {
  actAsCurrentApprover,
  approvalLog,
  approveToEnd,
  authorDraft,
  getDoc,
  waitForStatus,
} from './support/flows';

/**
 * The types that neither control budget nor carry a post action: approval is the whole point of
 * the document, and reaching COMPLETED must change nothing else. Same four endings as a
 * disbursement, minus the ledger assertions there is no ledger for.
 */

let s: Sandbox;

test.beforeAll(async () => {
  s = await getSandbox();
});

for (const code of PLAIN_TYPES) {
  const typeOf = () => {
    const t = s.docTypes.find((x) => x.code === code);
    if (!t) throw new Error(`${code} is not an active type in this company`);
    return t;
  };

  test(`${code}: approved through every step reaches COMPLETED`, async () => {
    const t = typeOf();
    const id = await authorDraft(s, t, { amount: '250000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await approveToEnd(s, id);
    const doc = await getDoc(s.admin, id);
    expect(doc.status).toBe('COMPLETED');
    expect(
      (await approvalLog(s.admin, id)).filter((l) => l.action === 'APPROVE')
        .length,
    ).toBe(2);
  });

  test(`${code}: rejected at the first step is terminal`, async () => {
    const t = typeOf();
    const id = await authorDraft(s, t, { amount: '250000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await actAsCurrentApprover(s, id, 'REJECT', 'e2e: no');
    expect((await getDoc(s.admin, id)).status).toBe('REJECTED');
  });

  test(`${code}: withdrawn by its author is terminal`, async () => {
    const t = typeOf();
    const id = await authorDraft(s, t, { amount: '250000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);
    await s.requester.api.post(`/documents/${id}/cancel`, {
      remark: 'e2e: withdrawn',
    });
    expect((await getDoc(s.admin, id)).status).toBe('CANCELLED');
  });

  test(`${code}: returned, then resubmitted, still reaches COMPLETED`, async () => {
    const t = typeOf();
    const id = await authorDraft(s, t, { amount: '250000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await actAsCurrentApprover(s, id, 'RETURN', 'e2e: fix it');
    expect((await getDoc(s.admin, id)).status).toBe('DRAFT');

    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL'], 5_000).catch(
      () => {
        throw new Error(
          `${code}: the resubmitted document never reached IN_APPROVAL — it is stranded in ` +
            'SUBMITTED and no approver was assigned',
        );
      },
    );
    await approveToEnd(s, id);
    expect((await getDoc(s.admin, id)).status).toBe('COMPLETED');
  });
}
