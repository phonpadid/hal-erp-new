import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { Sandbox } from './support/provision';
import { Api } from './support/api';
import {
  actAsCurrentApprover,
  authorDraft,
  createActiveBudget,
  getDoc,
  waitForStatus,
} from './support/flows';

/**
 * Real, end-to-end coverage of `record-payment-mid-approval` (tasks 6.2/6.3) — through the live
 * HTTP API against a real server and database, not a stubbed unit test.
 *
 * Needs its OWN department + workflow: the shared sandbox workflow (`support/provision.ts`) maps
 * every active document type to a plain two-step route, and a department can only be mapped to a
 * document type once — reusing it would either collide with that mapping or change the route
 * every other e2e spec in this file's worker already depends on. This spec provisions a second,
 * isolated department + workflow (step 1 gated on `requiresPaymentSlip`).
 *
 * The requester specifically needs to be a NEW account of its own, not the shared sandbox's: `POST
 * /documents` resolves which department (and therefore which workflow) a document routes through
 * from the AUTHOR's own account, not from anything the caller passes — so authoring as the shared
 * requester would always resolve the shared department's plain workflow, gate or no gate. The
 * approvers stay the shared `approver1`/`approver2`: a workflow step names a fixed user, not a
 * department-scoped role, so who they are is unaffected by which department raised the document.
 */
const USER_PASSWORD = process.env.USER_PASSWORD!;
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const AMOUNT = '250000'; // LAK
const DEPT_CODE = 'E2E-MFP';
const WORKFLOW_NAME = 'E2E — mid-flow payment gate';

let s: Sandbox;
let mfp: Sandbox; // same accounts, this spec's own department/workflow/budget

test.beforeAll(async () => {
  s = await getSandbox();

  // RECADMIN, not the bare REC type: this environment's `REC` (and most of its siblings) has no
  // GL account resolvable on its sandbox budget — a pre-existing gap in this dev database, not
  // something this change touches (confirmed: 10-disbursement-lifecycle.e2e.spec.ts fails the
  // same way on REC today). RECADMIN is one of the three REC* types that already resolve.
  const recType = s.docTypes.find((t) => t.code === 'RECADMIN');
  if (!recType) throw new Error('RECADMIN (a CUT_BUDGET disbursement type) is not active in this company');

  const departmentId = await ensureDept();
  const workflowId = await ensureGatedWorkflow();
  await ensureMapping(departmentId, recType.id, workflowId);
  // `createActiveBudget` raises its budget through /budgets/plans (a BUDGET_PLAN document), which
  // needs its own department mapping too — the shared sandbox's department already has one, but
  // this spec's own department starts with none. The plain shared workflow is fine here: nothing
  // about this spec's gate concerns how a budget itself gets approved.
  const planType = s.docTypes.find((t) => t.code === 'BUDGET_PLAN');
  if (planType) await ensureMapping(departmentId, planType.id, s.workflowId);

  const requester = await ensureUser(departmentId, 'e2e.mfp.requester', 'E2E MFP Requester', 'E2E-MFP-REQ');

  // `createActiveBudget` only reads fiscalYearId/parentNodeId/departmentId/requester/admin off
  // its `Sandbox` argument — this reuses it unmodified, pointed at this spec's own department and
  // requester (the plan's approvers are still the shared `approver1`/`approver2`).
  mfp = { ...s, departmentId, workflowId, requester };
  const budgetId = await createActiveBudget(mfp, '100000000', 'mfp');
  mfp = { ...mfp, budgetByType: { ...mfp.budgetByType, RECADMIN: budgetId } };
});

let cachedAdminRoleId: string | undefined;
async function administratorRoleId(): Promise<string> {
  if (cachedAdminRoleId) return cachedAdminRoleId;
  const roles = await s.admin.get<{ items: Array<{ id: string; code: string; name: string }> }>('/rbac/roles');
  const role = roles.items.find((r) => r.code === 'ADMIN' || r.name === 'Administrator');
  if (!role) throw new Error('No Administrator role in this company');
  cachedAdminRoleId = role.id;
  return role.id;
}

async function ensureUser(
  departmentId: string,
  username: string,
  fullName: string,
  empCode: string,
): Promise<Sandbox['requester']> {
  const existing = await s.admin.get<{ items: Array<{ id: string; empCode: string; userId?: string }> }>(
    `/employees?limit=100&search=${encodeURIComponent(empCode)}`,
  );
  let employee = existing.items.find((e) => e.empCode === empCode);
  if (!employee) {
    employee = await s.admin.post<{ id: string; empCode: string; userId?: string }>('/employees', {
      empCode,
      fullName,
      departmentId,
      position: 'E2E',
      jobLevel: 'STAFF',
    });
  }
  if (!employee.userId) {
    const roleId = await administratorRoleId();
    await s.admin.post(`/employees/${employee.id}/onboard`, {
      username,
      email: `${username}@e2e.local`,
      roleId,
      departmentId,
    });
  }
  await s.admin.post(`/employees/${employee.id}/verify-account`).catch(() => undefined);
  const api = await Api.login(username, USER_PASSWORD);
  return { api, userId: api.userId, employeeId: employee.id, username };
}

async function ensureDept(): Promise<string> {
  const list = await s.admin.get<{ items: Array<{ id: string; deptCode: string }> }>('/departments?limit=100');
  const found = list.items.find((d) => d.deptCode === DEPT_CODE);
  if (found) return found.id;
  const created = await s.admin.post<{ id: string }>('/departments', {
    deptCode: DEPT_CODE,
    name: 'E2E mid-flow payment',
  });
  return created.id;
}

async function ensureGatedWorkflow(): Promise<string> {
  const flows = await s.admin.get<Array<{ id: string; name: string; steps: Array<{ stepNo: number }> }>>('/workflows');
  const found = flows.find((w) => w.name === WORKFLOW_NAME);
  if (found && found.steps.length >= 2) return found.id;
  const wf = found ?? (await s.admin.post<{ id: string; steps?: Array<{ stepNo: number }> }>('/workflows', { name: WORKFLOW_NAME }));
  const steps = wf.steps ?? [];
  if (!steps.some((st) => st.stepNo === 1)) {
    await s.admin.post('/workflows/steps', {
      workflowId: wf.id,
      stepNo: 1,
      stepName: 'E2E gated step (finance — requires a transfer slip)',
      approverUserId: s.approver1.userId,
      approveMode: 'SEQUENTIAL',
      requiresPaymentSlip: true,
    });
  }
  if (!steps.some((st) => st.stepNo === 2)) {
    await s.admin.post('/workflows/steps', {
      workflowId: wf.id,
      stepNo: 2,
      stepName: 'E2E step 2',
      approverUserId: s.approver2.userId,
      approveMode: 'SEQUENTIAL',
    });
  }
  return wf.id;
}

async function ensureMapping(departmentId: string, documentTypeId: string, workflowId: string): Promise<void> {
  for (let page = 1; ; page++) {
    const mapped = await s.admin.get<{
      items: Array<{ id: string; departmentId: string; documentTypeId: string }>;
      total: number;
      limit: number;
    }>(`/document-config/dept-doc-types?limit=100&page=${page}`);
    if (mapped.items.some((m) => m.documentTypeId === documentTypeId && m.departmentId === departmentId)) return;
    if (!mapped.items.length || page * mapped.limit >= mapped.total) break;
  }
  const templates = await s.admin.get<{ items: Array<{ id: string; version: number; status: string }> }>(
    `/document-config/form-templates?limit=100&documentTypeId=${documentTypeId}`,
  );
  const usable = templates.items.filter((t) => t.status !== 'RETIRED').sort((a, b) => b.version - a.version)[0];
  if (!usable) throw new Error('RECADMIN has no mappable form template');
  await s.admin.post('/document-config/dept-doc-types', {
    departmentId,
    documentTypeId,
    formTemplateId: usable.id,
    workflowId,
  });
}

/**
 * Test-fixture only: no public API returns a REJECTED document to DRAFT for editing (RETURN
 * does this for its own case; a plain resubmit of a REJECTED document is a separate, pre-existing
 * question this change does not own or attempt to answer). This is the same escape hatch the
 * unit-level spec uses via a direct ORM update — here, over the same live database the running
 * server writes to, since this process only has an HTTP client.
 */
function forceBackToDraft(documentId: string): void {
  execSync(
    `psql -h "${process.env.DB_HOST}" -p "${process.env.DB_PORT}" -U "${process.env.DB_USER}" -d "${process.env.DB_NAME}" ` +
      `-c "update document set status = 'DRAFT' where id = '${documentId}'"`,
    { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, stdio: 'pipe' },
  );
}

const recType = () => s.docTypes.find((t) => t.code === 'RECADMIN')!;

test('a payment recorded early settles once the document completes, and needs no second record()', async () => {
  const id = await authorDraft(mfp, recType(), { amount: AMOUNT });
  await mfp.requester.api.post(`/documents/${id}/submit`);
  await waitForStatus(mfp.requester.api, id, ['IN_APPROVAL']);

  // Cannot record yet: the gated step has no evidence.
  const early = await s.approver1.api.attempt('post', `/payments/${id}`, { actualRate: '1' });
  expect(early.status, 'record before evidence should be refused').toBeGreaterThanOrEqual(400);

  // Cannot approve yet either — the same gate the slip-required feature already covers.
  const blocked = await s.approver1.api.attempt('post', `/documents/${id}/actions`, { action: 'APPROVE' });
  expect(blocked.status, 'approve before evidence should be refused').toBeGreaterThanOrEqual(400);

  await s.approver1.api.upload(`/payments/${id}/slips/upload`, 'slip.png', PNG_1PX);

  // Record mid-flow: no file needed, the evidence just attached already covers it.
  const recorded = await s.approver1.api.post<{ documentId: string; fxKind: string }>(`/payments/${id}`, {
    actualRate: '1',
    method: 'TRANSFER',
    reference: 'E2E-MFP-REF-1',
  });
  expect(recorded.documentId).toBe(id);

  // Still IN_APPROVAL, still step 1 — recording did not itself advance the route.
  const stillWaiting = await getDoc(s.admin, id);
  expect(stillWaiting.status).toBe('IN_APPROVAL');

  await actAsCurrentApprover(mfp, id, 'APPROVE'); // step 1, now unblocked
  await actAsCurrentApprover(mfp, id, 'APPROVE'); // step 2

  const done = await getDoc(s.admin, id);
  expect(done.status, 'both steps approved').toBe('COMPLETED');

  const detail = await s.admin.get<{ hasPayment: boolean; paymentRecoveryPending: boolean }>(`/documents/${id}/detail`);
  expect(detail.hasPayment, 'the early payment is still the document’s payment').toBe(true);
  expect(detail.paymentRecoveryPending).toBe(false);

  // Reused the early row rather than requiring a fresh record(): the queue has nothing to offer
  // for a document that already has a payment.
  const queue = await s.admin.get<Array<{ documentId: string }>>('/payments/handoffs');
  expect(queue.some((q) => q.documentId === id), 'a paid document must not sit in the unpaid queue').toBe(false);

  // A second record() is refused — one payment per document, unchanged by this feature.
  const dupe = await s.approver1.api.attempt('post', `/payments/${id}`, { actualRate: '1' });
  expect(dupe.status).toBeGreaterThanOrEqual(400);
});

test('rejecting a document with an early-recorded payment flags it, and resubmission waits on recovery', async () => {
  const id = await authorDraft(mfp, recType(), { amount: AMOUNT });
  await mfp.requester.api.post(`/documents/${id}/submit`);
  await waitForStatus(mfp.requester.api, id, ['IN_APPROVAL']);
  await s.approver1.api.upload(`/payments/${id}/slips/upload`, 'slip.png', PNG_1PX);
  await s.approver1.api.post(`/payments/${id}`, { actualRate: '1', method: 'TRANSFER', reference: 'E2E-MFP-REF-2' });
  await actAsCurrentApprover(mfp, id, 'APPROVE'); // step 1 — money already recorded

  // Step 2 rejects instead of approving. Real money already left the company for this
  // submission; the reservation is still released in full (invariant 5 is not touched by this
  // feature), and separately the payment is flagged for recovery.
  await actAsCurrentApprover(mfp, id, 'REJECT', 'e2e: second approver refuses after the fact');

  const rejected = await getDoc(s.admin, id);
  expect(rejected.status).toBe('REJECTED');

  const flaggedDetail = await s.admin.get<{ paymentRecoveryPending: boolean }>(`/documents/${id}/detail`);
  expect(flaggedDetail.paymentRecoveryPending, 'a rejected doc with an early payment must be flagged').toBe(true);

  const pending = await s.admin.get<Array<{ id: string; document: { id: string } }>>('/payments/recovery-pending');
  const flagged = pending.find((p) => p.document.id === id);
  expect(flagged, 'the flagged payment must appear in the recovery queue').toBeTruthy();

  // Resubmission is blocked while the flag is open. `forceBackToDraft` only reaches the state a
  // rejected document would need to be in to attempt resubmission at all (see its own comment) —
  // the refusal under test is submit()'s new guard, not the DRAFT transition itself.
  forceBackToDraft(id);
  const blockedResubmit = await mfp.requester.api.attempt('post', `/documents/${id}/submit`);
  expect(blockedResubmit.status, 'resubmit must be refused while recovery is pending').toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(blockedResubmit.body).toLowerCase()).toContain('recovery');

  // Resolve it — the reference is required, and this action must not touch the GL itself
  // (payment-recovery); this spec only checks the flow's own contract, not GL posting.
  const noReference = await s.admin.attempt('post', `/payments/recovery/${flagged!.id}/resolve`, { reference: '' });
  expect(noReference.status, 'resolve with no reference must be refused').toBeGreaterThanOrEqual(400);

  await s.admin.post(`/payments/recovery/${flagged!.id}/resolve`, { reference: 'E2E-JV-0001' });

  const afterResolve = await s.admin.get<Array<{ document: { id: string } }>>('/payments/recovery-pending');
  expect(afterResolve.some((p) => p.document.id === id), 'resolved payment must leave the queue').toBe(false);

  // Resubmission now proceeds — same guard, now finding nothing pending.
  const resubmitted = await mfp.requester.api.post<{ id: string; status: string }>(`/documents/${id}/submit`);
  expect(['SUBMITTED', 'IN_APPROVAL']).toContain(resubmitted.status);
});
