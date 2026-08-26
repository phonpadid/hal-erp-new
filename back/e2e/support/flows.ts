import { Api } from './api';
import { M } from './money';
import type {
  DocTypeInfo,
  FormFieldInfo,
  Sandbox,
  SandboxUser,
} from './provision';
import { SANDBOX } from './provision';

/** A one-pixel PNG — the REC templates all carry a required `file` field. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const today = (): string => new Date().toISOString().slice(0, 10);

export interface BudgetBreakdown {
  amountTotal: string;
  adjustIncrease: string;
  adjustDecrease: string;
  transferIn: string;
  transferOut: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface DocumentView {
  id: string;
  docNo: string;
  status: string;
  currentStepNo: number;
  totalAmount?: string;
  subTotal?: string;
  taxTotal?: string;
  grandTotal?: string;
  baseTotalAmount?: string;
  budgetBaseTotalAmount?: string;
  exchangeRate?: string;
  budgetExchangeRate?: string;
}

export interface LedgerEntry {
  id: string;
  txnType: string;
  amount: string;
  documentId: string | null;
  documentNo: string | null;
  txnDate: string;
}

/**
 * Author a complete, submittable draft of `docType` for `amount` — required form fields filled,
 * attachment uploaded if the template asks for one, and one budgeted line.
 *
 * Everything it fills is driven by the template and the type flags rather than by the type's
 * code (invariant 7: configuration, not per-type branches), so a type added to the company is
 * covered without touching this helper.
 */
export async function authorDraft(
  s: Sandbox,
  docType: DocTypeInfo,
  opts: {
    amount: string;
    lines?: number;
    currency?: string;
    budgetId?: string;
    /** Who raises it. Defaults to the sandbox requester; the self-approval rule needs another. */
    author?: SandboxUser;
    /** Leave the budget off every line — for the "must charge a budget" refusal. */
    withoutBudget?: boolean;
  } = { amount: '1000000' },
): Promise<string> {
  const author = opts.author ?? s.requester;
  const api = author.api;
  const doc = await api.post<{ id: string }>('/documents', {
    documentTypeId: docType.id,
    ...(opts.currency ? { currency: opts.currency } : {}),
    // Carried for a type with no lines of its own; a lined document recomputes it at submit.
    totalAmount: opts.amount,
  });

  await fillRequiredFields(s, doc.id, docType, author);

  // A budget-controlled type must charge a budget on every money-bearing line. A type with no
  // budget requirement gets a plain line so the document still carries the amount it claims.
  const lineCount = opts.lines ?? 1;
  const budgetId = opts.budgetId ?? s.budgetByType[docType.code];
  const per = splitEvenly(opts.amount, lineCount);
  await api.put(
    `/documents/${doc.id}/lines`,
    per.map((lineAmount, i) => ({
      lineNo: i + 1,
      description: `E2E ${docType.code} line ${i + 1}`,
      qty: '1',
      unitPrice: lineAmount,
      lineAmount,
      ...(docType.requiresBudget && !opts.withoutBudget ? { budgetId } : {}),
    })),
  );

  return doc.id;
}

/** Fill (and attach) whatever the mapped template marks required. */
export async function fillRequiredFields(
  s: Sandbox,
  documentId: string,
  docType: DocTypeInfo,
  author: SandboxUser = s.requester,
): Promise<void> {
  const api = author.api;
  const fields: FormFieldInfo[] = s.fieldsByType[docType.id] ?? [];
  const scalar = fields.filter(
    (f) => f.fieldType !== 'file' && f.fieldType !== 'line_items',
  );
  if (scalar.length) {
    await api.put(
      `/documents/${documentId}/fields`,
      scalar.map((f) => ({ formFieldId: f.id, value: sampleValue(f) })),
    );
  }
  if (fields.some((f) => f.fieldType === 'file' && f.isRequired)) {
    await api.upload(
      `/documents/${documentId}/attachments/upload`,
      'e2e-evidence.png',
      PNG_1PX,
    );
  }
}

function sampleValue(f: FormFieldInfo & { options?: string[] }): string {
  const options = (f as { options?: string[] }).options;
  if (options?.length) return options[0];
  switch (f.fieldType) {
    case 'date':
      return today();
    case 'number':
      return '1';
    default:
      return `E2E ${f.fieldName}`;
  }
}

/** Split an amount across lines with no rounding drift — the last line absorbs the remainder. */
export function splitEvenly(amount: string, parts: number): string[] {
  if (parts === 1) return [amount];
  const each = String(Math.floor(Number(amount) / parts));
  const out = Array.from({ length: parts - 1 }, () => each);
  let used = '0';
  for (const v of out) used = M.add(used, v);
  out.push(M.sub(amount, used));
  return out;
}

export const getDoc = (api: Api, id: string): Promise<DocumentView> =>
  api.get<DocumentView>(`/documents/${id}`);

export const breakdown = (
  api: Api,
  budgetId: string,
): Promise<BudgetBreakdown> =>
  api.get<BudgetBreakdown>(`/budgets/${budgetId}/breakdown`);

export const ledger = async (
  api: Api,
  budgetId: string,
  documentId: string,
): Promise<LedgerEntry[]> => {
  const rows = await api.get<{ items: LedgerEntry[] } | LedgerEntry[]>(
    `/budgets/${budgetId}/ledger?limit=100`,
  );
  const items = Array.isArray(rows) ? rows : rows.items;
  return items.filter((r) => r.documentId === documentId);
};

export const approvalLog = (
  api: Api,
  id: string,
): Promise<
  Array<{
    stepNo: number;
    action: string;
    approverName?: string;
    remark?: string;
  }>
> => api.get(`/documents/${id}/approval-log`);

/**
 * Routing starts from the `document.submitted` event, so SUBMITTED → IN_APPROVAL happens just
 * after the submit call returns. Wait for the state a caller actually needs rather than sleeping.
 */
export async function waitForStatus(
  api: Api,
  documentId: string,
  wanted: string[],
  timeoutMs = 10_000,
): Promise<DocumentView> {
  const deadline = Date.now() + timeoutMs;
  let last: DocumentView | undefined;
  for (;;) {
    last = await getDoc(api, documentId);
    if (wanted.includes(last.status)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `Document ${documentId} is ${last.status} after ${timeoutMs}ms; expected one of ${wanted.join(', ')}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Walk every remaining step with APPROVE, using the approver the step actually names. */
export async function approveToEnd(
  s: Sandbox,
  documentId: string,
): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    const doc = await getDoc(s.admin, documentId);
    if (doc.status !== 'IN_APPROVAL' && doc.status !== 'SUBMITTED') return;
    await actAsCurrentApprover(s, documentId, 'APPROVE');
  }
  throw new Error(
    `Document ${documentId} did not reach a terminal state after 10 approvals`,
  );
}

/** Post `action` as whoever the document is waiting on right now. */
export async function actAsCurrentApprover(
  s: Sandbox,
  documentId: string,
  action: 'APPROVE' | 'REJECT' | 'RETURN',
  remark?: string,
): Promise<string> {
  // `pending-approvers` is participant-visible: only the creator or an eligible actor may read
  // it, so ask as the creator rather than as the admin who provisioned the sandbox.
  await waitForStatus(s.requester.api, documentId, ['IN_APPROVAL']);
  const pending = await s.requester.api.get<{
    pending: { stepNo: number; approvers: Array<{ userId: string }> } | null;
  }>(`/documents/${documentId}/pending-approvers`);
  if (!pending.pending?.approvers.length) {
    throw new Error(
      `Document ${documentId} is waiting on nobody — cannot ${action}`,
    );
  }
  const userId = pending.pending.approvers[0].userId;
  const actor = [s.approver1, s.approver2, s.requester].find(
    (u) => u.userId === userId,
  );
  if (!actor)
    throw new Error(
      `Document ${documentId} is waiting on an actor outside the sandbox (${userId})`,
    );
  await actor.api.post(`/documents/${documentId}/actions`, {
    action,
    ...(remark ? { remark } : {}),
  });
  return userId;
}

let budgetSeq = 0;

/**
 * A budget of exactly `amount`, put in force the only way the product allows — drafted, planned,
 * approved — on a node of its own so its ceiling belongs to this test alone.
 */
export async function createActiveBudget(
  s: Sandbox,
  amount: string,
  label = 'case',
  glAccount?: string,
): Promise<string> {
  const code = `${SANDBOX.nodeCode}.${label}.${Date.now()}.${budgetSeq++}`;
  const node = await s.admin.post<{ id: string }>('/budgets/nodes', {
    fiscalYearId: s.fiscalYearId,
    code,
    name: `E2E ${code}`,
    parentId: s.parentNodeId,
  });
  const budget = await s.admin.post<{ id: string }>('/budgets', {
    fiscalYearId: s.fiscalYearId,
    departmentId: s.departmentId,
    nodeId: node.id,
    budgetName: `E2E ${code}`,
    amountTotal: amount,
    ...(glAccount ? { glAccount } : {}),
  });
  const plan = await s.requester.api.post<{ documentId: string }>(
    '/budgets/plans',
    {
      departmentId: s.departmentId,
      lines: [{ budgetId: budget.id, reason: `e2e ${label}` }],
    },
  );
  await s.requester.api.post(`/documents/${plan.documentId}/submit`);
  await approveToEnd(s, plan.documentId);
  return budget.id;
}
