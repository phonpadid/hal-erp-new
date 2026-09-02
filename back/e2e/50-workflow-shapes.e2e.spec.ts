import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { DocTypeInfo, Sandbox } from './support/provision';
import {
  approvalLog,
  approveToEnd,
  authorDraft,
  createActiveBudget,
  getDoc,
  today,
  waitForStatus,
} from './support/flows';

/**
 * The shapes a workflow can take, and what each one decides:
 *
 *   amount bands        which steps engage at all for this document's figure
 *   PARALLEL_ALL/ANY    how many of a step's approvers have to act
 *   delegation          who else may act for a principal, one hop only (invariant 8)
 *
 * Each case runs against a workflow built for it, temporarily bound to one document type's
 * mapping and unbound afterwards, so the sandbox's own two-step workflow stays as every other
 * file expects to find it.
 */

const HOST_TYPE = 'RECWH'; // the type whose mapping is borrowed for these cases
const APPROVER_ROLE_CODE = 'E2E_APPROVERS';

let s: Sandbox;
let host: DocTypeInfo;
let mappingId: string;
let approverRoleId: string;

test.beforeAll(async () => {
  s = await getSandbox();
  host = s.docTypes.find((t) => t.code === HOST_TYPE)!;
  mappingId = await findMapping(HOST_TYPE);
  approverRoleId = await ensureApproverRole();
});

test.afterAll(async () => {
  // Whatever a case bound, put the sandbox workflow back.
  if (mappingId)
    await s.admin.patch(`/document-config/dept-doc-types/${mappingId}`, {
      workflowId: s.workflowId,
    });
});

async function findMapping(code: string): Promise<string> {
  for (let page = 1; ; page++) {
    const res = await s.admin.get<{
      items: Array<{
        id: string;
        departmentId: string;
        documentTypeCode: string;
      }>;
      total: number;
      limit: number;
    }>(`/document-config/dept-doc-types?limit=100&page=${page}`);
    const hit = res.items.find(
      (m) => m.departmentId === s.departmentId && m.documentTypeCode === code,
    );
    if (hit) return hit.id;
    if (!res.items.length || page * res.limit >= res.total)
      throw new Error(`no ${code} mapping in the sandbox`);
  }
}

/** A role held by both sandbox approvers, so a role-targeted step has more than one principal. */
async function ensureApproverRole(): Promise<string> {
  const roles = await s.admin.get<{
    items: Array<{ id: string; code: string }>;
  }>('/rbac/roles');
  let role = roles.items.find((r) => r.code === APPROVER_ROLE_CODE);
  if (!role) {
    role = await s.admin.post<{ id: string; code: string }>('/rbac/roles', {
      code: APPROVER_ROLE_CODE,
      name: 'E2E Approvers',
      description: 'Sandbox role targeted by parallel approval steps',
    });
    await s.admin.post('/rbac/role-permissions/bulk', {
      roleId: role.id,
      grants: [
        { permissionCode: 'DOC_APPROVE', scope: 'COMPANY' },
        { permissionCode: 'DOC_VIEW', scope: 'COMPANY' },
      ],
      detach: [],
    });
  }
  for (const u of [s.approver1, s.approver2]) {
    await s.admin
      .post('/rbac/assignments', {
        userId: u.userId,
        roleId: role.id,
        departmentId: s.departmentId,
      })
      .catch(() => undefined); // already assigned
  }
  return role.id;
}

/** Build a workflow from a step list; the caller decides what each step targets. */
async function buildWorkflow(
  name: string,
  steps: Array<{
    stepNo: number;
    approverUserId?: string;
    approverRoleId?: string;
    amountMin?: string;
    amountMax?: string;
    approveMode?: string;
  }>,
): Promise<string> {
  const existing =
    await s.admin.get<Array<{ id: string; name: string }>>('/workflows');
  const found = existing.find((w) => w.name === name);
  if (found) return found.id;
  const wf = await s.admin.post<{ id: string }>('/workflows', { name });
  for (const step of steps) {
    await s.admin.post('/workflows/steps', {
      workflowId: wf.id,
      stepName: `${name} #${step.stepNo}`,
      ...step,
    });
  }
  return wf.id;
}

/** Bind `workflowId` to the host type for the duration of `fn`, then put the sandbox one back. */
async function withWorkflow(
  workflowId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await s.admin.patch(`/document-config/dept-doc-types/${mappingId}`, {
    workflowId,
  });
  try {
    await fn();
  } finally {
    await s.admin.patch(`/document-config/dept-doc-types/${mappingId}`, {
      workflowId: s.workflowId,
    });
  }
}

// ---- amount bands --------------------------------------------------------------------------

test('a step whose amount band the document misses does not engage', async () => {
  const wf = await buildWorkflow('E2E — band on the second step', [
    {
      stepNo: 1,
      approverUserId: s.approver1.userId,
      approveMode: 'SEQUENTIAL',
    },
    {
      stepNo: 2,
      approverUserId: s.approver2.userId,
      amountMin: '10000000',
      approveMode: 'SEQUENTIAL',
    },
  ]);

  await withWorkflow(wf, async () => {
    const budgetId = await createActiveBudget(s, '50000000', 'bands');

    const small = await authorDraft(s, host, { amount: '2000000', budgetId });
    await s.requester.api.post(`/documents/${small}/submit`);
    await approveToEnd(s, small);
    expect((await getDoc(s.admin, small)).status).toBe('COMPLETED');
    expect(
      (await approvalLog(s.admin, small)).filter((l) => l.action === 'APPROVE')
        .length,
      'a document below the second band needs one approval, not two',
    ).toBe(1);

    const large = await authorDraft(s, host, { amount: '20000000', budgetId });
    await s.requester.api.post(`/documents/${large}/submit`);
    await approveToEnd(s, large);
    expect((await getDoc(s.admin, large)).status).toBe('COMPLETED');
    expect(
      (await approvalLog(s.admin, large)).filter((l) => l.action === 'APPROVE')
        .length,
      'a document inside the second band needs both approvals',
    ).toBe(2);
  });
});

test('a document that engages no step at all is refused at submit, holding nothing', async () => {
  const wf = await buildWorkflow('E2E — high value only', [
    {
      stepNo: 1,
      approverUserId: s.approver1.userId,
      amountMin: '10000000',
      approveMode: 'SEQUENTIAL',
    },
  ]);

  await withWorkflow(wf, async () => {
    const budgetId = await createActiveBudget(s, '50000000', 'noband');

    const tooSmall = await authorDraft(s, host, {
      amount: '1000000',
      budgetId,
    });
    const res = await s.requester.api.attempt(
      'post',
      `/documents/${tooSmall}/submit`,
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toContain('No approval step applies');
    expect((await getDoc(s.requester.api, tooSmall)).status).toBe('DRAFT');

    // The same workflow must still accept a document its band DOES cover.
    const bigEnough = await authorDraft(s, host, {
      amount: '20000000',
      budgetId,
    });
    await s.requester.api.post(`/documents/${bigEnough}/submit`);
    await waitForStatus(
      s.requester.api,
      bigEnough,
      ['IN_APPROVAL'],
      5_000,
    ).catch(() => {
      throw new Error(
        "a document inside the workflow's only band was submitted but never routed — the " +
          'routability gate and the router disagree about its amount',
      );
    });
    await approveToEnd(s, bigEnough);
    expect((await getDoc(s.admin, bigEnough)).status).toBe('COMPLETED');
  });
});

// ---- parallel steps ------------------------------------------------------------------------

test('PARALLEL_ANY closes its step on the first approval', async () => {
  const wf = await buildWorkflow('E2E — parallel any', [
    { stepNo: 1, approverRoleId, approveMode: 'PARALLEL_ANY' },
  ]);

  await withWorkflow(wf, async () => {
    const budgetId = await createActiveBudget(s, '5000000', 'parany');
    const id = await authorDraft(s, host, { amount: '500000', budgetId });
    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

    await s.approver1.api.post(`/documents/${id}/actions`, {
      action: 'APPROVE',
    });
    expect(
      (await getDoc(s.admin, id)).status,
      'one approval should be enough',
    ).toBe('COMPLETED');
  });
});

test('PARALLEL_ALL waits for every principal of the step', async () => {
  const wf = await buildWorkflow('E2E — parallel all', [
    { stepNo: 1, approverRoleId, approveMode: 'PARALLEL_ALL' },
  ]);

  await withWorkflow(wf, async () => {
    const budgetId = await createActiveBudget(s, '5000000', 'parall');
    const id = await authorDraft(s, host, { amount: '500000', budgetId });
    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

    await s.approver1.api.post(`/documents/${id}/actions`, {
      action: 'APPROVE',
    });
    expect(
      (await getDoc(s.admin, id)).status,
      'one of two approvals is not enough',
    ).toBe('IN_APPROVAL');

    await s.approver2.api.post(`/documents/${id}/actions`, {
      action: 'APPROVE',
    });
    expect((await getDoc(s.admin, id)).status).toBe('COMPLETED');
  });
});

// ---- delegation ----------------------------------------------------------------------------

test('a delegate may act for the approver, and the trail names the principal', async () => {
  // approver2 stands in for approver1 on step 1 of the sandbox workflow.
  const del = await s.admin.post<{ id: string }>('/workflows/delegations', {
    delegatorId: s.approver1.userId,
    delegateId: s.approver2.userId,
    startDate: today(),
    endDate: today(),
    reason: 'e2e: standing in',
  });
  try {
    const rec = s.docTypes.find((t) => t.code === 'REC')!;
    const id = await authorDraft(s, rec, { amount: '300000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

    await s.approver2.api.post(`/documents/${id}/actions`, {
      action: 'APPROVE',
      remark: 'e2e: as delegate',
    });
    const afterStep1 = await getDoc(s.admin, id);
    expect(afterStep1.currentStepNo, 'the delegate cleared step 1').toBe(2);

    await s.approver2.api.post(`/documents/${id}/actions`, {
      action: 'APPROVE',
      remark: 'e2e: own step',
    });
    expect((await getDoc(s.admin, id)).status).toBe('COMPLETED');

    const log = await approvalLog(s.admin, id);
    expect(log.length).toBe(2);
  } finally {
    await s.admin.post(`/workflows/delegations/${del.id}/cancel`);
  }
});

test('delegation cannot hand a document to its own author', async () => {
  // approver1 delegates to the requester, who raised the document: the self-approval rule
  // (invariant 8) has to hold through the delegation, not around it.
  const del = await s.admin.post<{ id: string }>('/workflows/delegations', {
    delegatorId: s.approver1.userId,
    delegateId: s.requester.userId,
    startDate: today(),
    endDate: today(),
    reason: 'e2e: delegate to the author',
  });
  try {
    const rec = s.docTypes.find((t) => t.code === 'REC')!;
    const id = await authorDraft(s, rec, { amount: '300000' });
    await s.requester.api.post(`/documents/${id}/submit`);
    await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

    const res = await s.requester.api.attempt(
      'post',
      `/documents/${id}/actions`,
      { action: 'APPROVE' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(
      'cannot be approved by its creator',
    );

    await s.requester.api.post(`/documents/${id}/cancel`, {
      remark: 'e2e: tidy up',
    });
  } finally {
    await s.admin.post(`/workflows/delegations/${del.id}/cancel`);
  }
});
