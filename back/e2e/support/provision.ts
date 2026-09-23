import { Api } from './api';

/**
 * Everything the lifecycle specs need, provisioned through the PUBLIC API and idempotent, so a
 * re-run reuses what the last run left behind rather than piling up a second sandbox.
 *
 * It builds a sandbox department of its own instead of borrowing a real one. The copied
 * production database maps only BUDGET_PLAN and SPEND_HIST to any department, and the eleven
 * REC* types are mapped nowhere at all — so a document of those types cannot be raised as the
 * data stands. Mapping them into a real department would put an untested workflow in front of
 * real people's budgets; a sandbox department carries its own budgets, its own control points
 * and its own approvers, and leaves the customer's configuration exactly as it was.
 */

export const SANDBOX = {
  deptCode: 'E2E-SBX',
  deptName: 'E2E Sandbox',
  workflowName: 'E2E — two-step approval',
  nodeCode: 'E2E',
  /** Per-budget ceiling, LAK (0 decimal places). Big enough that a flow never runs dry by accident. */
  budgetAmount: '100000000',
} as const;

export interface SandboxUser {
  api: Api;
  userId: string;
  employeeId: string;
  username: string;
}

export interface DocTypeInfo {
  id: string;
  code: string;
  name: string;
  category: string;
  requiresBudget: boolean;
  requiresQuota: boolean;
  requiresVendor: boolean;
  requiresItem: boolean;
  requiresPayee: boolean;
  requiresWarehouse: boolean;
  requiresEmployee: boolean;
  accruesOnApproval: boolean;
  postAction?: string;
  isActive: boolean;
}

export interface Sandbox {
  admin: Api;
  companyId: string;
  fiscalYearId: string;
  departmentId: string;
  workflowId: string;
  requester: SandboxUser;
  approver1: SandboxUser;
  approver2: SandboxUser;
  docTypes: DocTypeInfo[];
  /** Doc type code → the budget its flows charge (ACTIVE, with its own control point). */
  budgetByType: Record<string, string>;
  parentNodeId: string;
  /** Form fields per doc type id, so a spec can fill the required ones. */
  fieldsByType: Record<string, FormFieldInfo[]>;
}

export interface FormFieldInfo {
  id: string;
  fieldName: string;
  fieldType: string;
  isRequired: boolean;
  optionsJson?: string;
  conditionJson?: string;
}

const ADMIN_USERNAME = process.env.BOOTSTRAP_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_PASSWORD!;
const USER_PASSWORD = process.env.USER_PASSWORD!;

export async function provision(): Promise<Sandbox> {
  if (!ADMIN_PASSWORD)
    throw new Error('BOOTSTRAP_PASSWORD is not set — load back/.env first');
  if (!USER_PASSWORD)
    throw new Error('USER_PASSWORD is not set — load back/.env first');

  const admin = await Api.login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const me = await admin.get<{ companyId: string }>('/auth/me');
  const companyId = me.companyId;

  const fiscalYearId = await activeFiscalYear(admin);
  const departmentId = await ensureDepartment(admin);
  const docTypes = await allDocTypes(admin);

  const requester = await ensureUser(
    admin,
    departmentId,
    'e2e.requester',
    'E2E Requester',
    'E2E-REQ',
  );
  const approver1 = await ensureUser(
    admin,
    departmentId,
    'e2e.approver1',
    'E2E Approver One',
    'E2E-AP1',
  );
  const approver2 = await ensureUser(
    admin,
    departmentId,
    'e2e.approver2',
    'E2E Approver Two',
    'E2E-AP2',
  );

  const workflowId = await ensureWorkflow(
    admin,
    approver1.userId,
    approver2.userId,
  );

  const fieldsByType: Record<string, FormFieldInfo[]> = {};
  for (const t of docTypes) {
    await ensureMapping(admin, departmentId, t, workflowId);
  }
  // Read the form through the requester, which is the same read the wizard makes.
  for (const t of docTypes) {
    const form = await requester.api.get<{ fields: FormFieldInfo[] }>(
      `/documents/types/${t.id}/form`,
    );
    fieldsByType[t.id] = form.fields ?? [];
  }

  const parentNodeId = await ensureNode(
    admin,
    fiscalYearId,
    SANDBOX.nodeCode,
    SANDBOX.deptName,
    undefined,
  );
  const budgetByType = await ensureActiveBudgets(
    admin,
    { fiscalYearId, departmentId, parentNodeId },
    docTypes,
    requester,
    approver1,
    approver2,
  );

  return {
    admin,
    companyId,
    fiscalYearId,
    departmentId,
    workflowId,
    requester,
    approver1,
    approver2,
    docTypes,
    budgetByType,
    parentNodeId,
    fieldsByType,
  };
}

// ---- pieces --------------------------------------------------------------------------------

async function activeFiscalYear(admin: Api): Promise<string> {
  const years = await admin.get<{
    items: Array<{ id: string; year: number; status: string }>;
  }>('/fiscal-years?limit=100');
  const open = years.items
    .filter((y) => y.status === 'OPEN')
    .sort((a, b) => b.year - a.year)[0];
  if (!open)
    throw new Error('No OPEN fiscal year — the budget flows cannot be tested');
  return open.id;
}

async function ensureDepartment(admin: Api): Promise<string> {
  const list = await admin.get<{
    items: Array<{ id: string; deptCode: string }>;
  }>('/departments?limit=100');
  const found = list.items.find((d) => d.deptCode === SANDBOX.deptCode);
  if (found) return found.id;
  const created = await admin.post<{ id: string }>('/departments', {
    deptCode: SANDBOX.deptCode,
    name: SANDBOX.deptName,
  });
  return created.id;
}

async function allDocTypes(admin: Api): Promise<DocTypeInfo[]> {
  const page = await admin.get<{ items: DocTypeInfo[]; total: number }>(
    '/document-config/document-types?limit=100',
  );
  return page.items
    .filter((t) => t.isActive)
    .sort((a, b) => a.code.localeCompare(b.code));
}

async function ensureUser(
  admin: Api,
  departmentId: string,
  username: string,
  fullName: string,
  empCode: string,
): Promise<SandboxUser> {
  const existing = await admin.get<{
    items: Array<{ id: string; empCode: string; userId?: string }>;
  }>(`/employees?limit=100&search=${encodeURIComponent(empCode)}`);
  let employee = existing.items.find((e) => e.empCode === empCode);
  if (!employee) {
    employee = await admin.post<{
      id: string;
      empCode: string;
      userId?: string;
    }>('/employees', {
      empCode,
      fullName,
      departmentId,
      position: 'E2E',
      // A workflow with position-level steps refuses a requester with no job level; the sandbox
      // workflow has none, but setting it keeps the fixture usable if one is ever added.
      jobLevel: 'STAFF',
    });
  }
  if (!employee.userId) {
    const roleId = await administratorRoleId(admin);
    await admin.post(`/employees/${employee.id}/onboard`, {
      username,
      email: `${username}@e2e.local`,
      roleId,
      departmentId,
    });
  }
  // Idempotent: an already-verified account is unaffected, and login refuses an unverified one.
  await admin
    .post(`/employees/${employee.id}/verify-account`)
    .catch(() => undefined);
  const api = await Api.login(username, USER_PASSWORD);
  await ensureSignature(api);
  return { api, userId: api.userId, employeeId: employee.id, username };
}

/** A one-pixel PNG — enough for a signature the server will accept and stamp. */
const SIGNATURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Submitting and approving refuse a person with no signature on file (SIGNATURE_REQUIRED), so every
 * sandbox person gets one the way a real one would — through their own upload endpoint. Idempotent:
 * a user who already has one is left alone, so re-running the sandbox never piles up files.
 */
async function ensureSignature(api: Api): Promise<void> {
  const current = await api.get<{ hasSignature: boolean }>('/auth/signature');
  if (current.hasSignature) return;
  await api.upload('/auth/signature/upload', 'signature.png', SIGNATURE_PNG);
}

let cachedRoleId: string | undefined;
async function administratorRoleId(admin: Api): Promise<string> {
  if (cachedRoleId) return cachedRoleId;
  const roles = await admin.get<{
    items: Array<{ id: string; code: string; name: string }>;
  }>('/rbac/roles');
  const role = roles.items.find(
    (r) => r.code === 'ADMIN' || r.name === 'Administrator',
  );
  if (!role) throw new Error('No Administrator role in this company');
  cachedRoleId = role.id;
  return role.id;
}

async function ensureWorkflow(
  admin: Api,
  approver1: string,
  approver2: string,
): Promise<string> {
  const flows =
    await admin.get<
      Array<{ id: string; name: string; steps: Array<{ stepNo: number }> }>
    >('/workflows');
  const found = flows.find((w) => w.name === SANDBOX.workflowName);
  if (found) {
    if (found.steps.length >= 2) return found.id;
    // Half-built from an interrupted run — finish it rather than leaving an unroutable workflow.
    for (const [stepNo, userId] of [
      [1, approver1],
      [2, approver2],
    ] as const) {
      if (!found.steps.some((s) => s.stepNo === stepNo)) {
        await admin.post('/workflows/steps', {
          workflowId: found.id,
          stepNo,
          stepName: `E2E step ${stepNo}`,
          approverUserId: userId,
          approveMode: 'SEQUENTIAL',
        });
      }
    }
    return found.id;
  }
  const wf = await admin.post<{ id: string }>('/workflows', {
    name: SANDBOX.workflowName,
  });
  await admin.post('/workflows/steps', {
    workflowId: wf.id,
    stepNo: 1,
    stepName: 'E2E step 1',
    approverUserId: approver1,
    approveMode: 'SEQUENTIAL',
  });
  await admin.post('/workflows/steps', {
    workflowId: wf.id,
    stepNo: 2,
    stepName: 'E2E step 2',
    approverUserId: approver2,
    approveMode: 'SEQUENTIAL',
  });
  return wf.id;
}

async function ensureMapping(
  admin: Api,
  departmentId: string,
  docType: DocTypeInfo,
  workflowId: string,
): Promise<void> {
  // `dept-doc-types` takes pagination only (forbidNonWhitelisted rejects a departmentId filter),
  // so page through and match locally.
  for (let page = 1; ; page++) {
    const mapped = await admin.get<{
      items: Array<{
        id: string;
        departmentId: string;
        documentTypeId: string;
      }>;
      total: number;
      limit: number;
    }>(`/document-config/dept-doc-types?limit=100&page=${page}`);
    if (
      mapped.items.some(
        (m) =>
          m.documentTypeId === docType.id && m.departmentId === departmentId,
      )
    )
      return;
    if (!mapped.items.length || page * mapped.limit >= mapped.total) break;
  }

  const templates = await admin.get<{
    items: Array<{ id: string; version: number; status: string }>;
  }>(`/document-config/form-templates?limit=100&documentTypeId=${docType.id}`);
  const usable = templates.items
    .filter((t) => t.status !== 'RETIRED')
    .sort((a, b) => b.version - a.version)[0];
  if (!usable)
    throw new Error(
      `Document type ${docType.code} has no mappable form template`,
    );

  await admin.post('/document-config/dept-doc-types', {
    departmentId,
    documentTypeId: docType.id,
    formTemplateId: usable.id,
    workflowId,
  });
}

async function ensureNode(
  admin: Api,
  fiscalYearId: string,
  code: string,
  name: string,
  parentId: string | undefined,
): Promise<string> {
  const nodes =
    await admin.get<Array<{ id: string; code: string; fiscalYearId: string }>>(
      '/budgets/nodes',
    );
  const found = nodes.find(
    (n) => n.code === code && n.fiscalYearId === fiscalYearId,
  );
  if (found) return found.id;
  const created = await admin.post<{ id: string }>('/budgets/nodes', {
    fiscalYearId,
    code,
    name,
    ...(parentId ? { parentId } : {}),
  });
  return created.id;
}

/**
 * One ACTIVE budget per document type, each on its own node so each gets its own control point
 * and one type's spending can never move another type's ceiling.
 *
 * Activation runs the real ACTIVATE_BUDGET route — draft the budgets, raise a plan, approve it —
 * because that is the only way a budget becomes spendable, and a fixture that reached ACTIVE by
 * any other means would be testing against a state the product cannot produce.
 */
async function ensureActiveBudgets(
  admin: Api,
  ids: { fiscalYearId: string; departmentId: string; parentNodeId: string },
  docTypes: DocTypeInfo[],
  requester: SandboxUser,
  approver1: SandboxUser,
  approver2: SandboxUser,
): Promise<Record<string, string>> {
  const byType: Record<string, string> = {};
  const toPlan: string[] = [];

  for (const t of docTypes) {
    const nodeId = await ensureNode(
      admin,
      ids.fiscalYearId,
      `${SANDBOX.nodeCode}.${t.code}`,
      `E2E ${t.code}`,
      ids.parentNodeId,
    );
    const existing = await findBudget(admin, nodeId, ids.departmentId);
    if (existing) {
      byType[t.code] = existing.id;
      if (existing.status === 'DRAFT') toPlan.push(existing.id);
      continue;
    }
    const created = await admin.post<{ id: string }>('/budgets', {
      fiscalYearId: ids.fiscalYearId,
      departmentId: ids.departmentId,
      nodeId,
      budgetName: `E2E ${t.code}`,
      amountTotal: SANDBOX.budgetAmount,
    });
    byType[t.code] = created.id;
    toPlan.push(created.id);
  }

  if (toPlan.length) {
    const plan = await requester.api.post<{ documentId: string }>(
      '/budgets/plans',
      {
        departmentId: ids.departmentId,
        lines: toPlan.map((budgetId) => ({
          budgetId,
          reason: 'E2E sandbox provisioning',
        })),
      },
    );
    await requester.api.post(`/documents/${plan.documentId}/submit`);
    await approver1.api.post(`/documents/${plan.documentId}/actions`, {
      action: 'APPROVE',
    });
    await approver2.api.post(`/documents/${plan.documentId}/actions`, {
      action: 'APPROVE',
    });
  }

  return byType;
}

async function findBudget(
  admin: Api,
  nodeId: string,
  departmentId: string,
): Promise<{ id: string; status: string } | undefined> {
  // `/budgets` is paged and this database holds hundreds, so page through rather than guessing
  // that the sandbox budget lands on the first page.
  for (let page = 1; ; page++) {
    const res = await admin.get<{
      items: Array<{
        id: string;
        status: string;
        node: { id: string };
        department: { id: string };
      }>;
      total: number;
      limit: number;
    }>(`/budgets?limit=100&page=${page}`);
    for (const b of res.items) {
      if (b.node?.id === nodeId && b.department?.id === departmentId) return b;
    }
    if (res.items.length === 0 || page * res.limit >= res.total)
      return undefined;
  }
}
