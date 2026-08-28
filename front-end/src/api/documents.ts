import { api } from './client';
import type { Paginated } from './pagination';

export interface DocumentTypeOption {
  id: string;
  code: string;
  name: string;
}

export interface CreatableType {
  id: string;
  code: string;
  name: string;
  category: string;
  requiresBudget: boolean;
  requiresQuota: boolean;
  requiresVendor: boolean;
  requiresItem: boolean;
  // Whether the form must ask for a payee bank account before submit.
  requiresPayee: boolean;
  // When true, a document of this type may state the day its money moved.
  recordsPastEvents?: boolean;
  // Whether the expense is recognised at approval — and so whether this document claims the input
  // VAT, which is what makes the supplier's tax invoice required on it.
  accruesOnApproval: boolean;
  defaultGlAccount?: string;
  // Whether the form must ask for a warehouse (and, for TRANSFER_STOCK, a destination) before
  // submit. Absent from this payload until now, which is why the wizard could not render either.
  requiresWarehouse: boolean;
  // Whether the form must name the employee the document acts on.
  requiresEmployee: boolean;
  // What full approval does — the wizard reads it only to know a transfer needs a second warehouse.
  postAction?: string;
  // Null/absent = this wizard authors the type. A value names the route of the screen that does.
  authoringRoute?: string;
}

export interface FormFieldDef {
  id: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  /**
   * A dropdown's choices, already parsed by the server (it reads `form_field.options_json` and
   * returns an array). The client used to look for `optionsJson` here, which the endpoint has never
   * sent — every dropdown rendered empty. Nothing surfaced it because no seeded field was a
   * dropdown until the promotion's job level became one.
   */
  options?: string[];
  conditionJson?: string;
}

export interface FormDef {
  documentTypeId: string;
  formTemplateId: string;
  version: number;
  fields: FormFieldDef[];
}

export interface DocumentLineInput {
  lineNo: number;
  itemId?: string;
  description: string;
  qty: string;
  unit?: string;
  unitPrice: string;
  lineAmount: string;
  budgetId?: string;
  glAccount?: string;
  taxCodeId?: string;
  receivedQty?: string;
  lineStatus?: string;
  id?: string;
}

export interface MatchLine {
  lineNo: number;
  orderedQty: string;
  receivedQty: string;
  invoicedQty: string;
  orderedAmount: string;
  invoicedAmount: string;
  pass: boolean;
  reason?: string;
}
export interface MatchResult {
  ok: boolean;
  lines: MatchLine[];
}

export interface FieldValueInput {
  formFieldId: string;
  value?: string;
}

/**
 * One quota reservation sent in the submit body for a `requires_quota` document. Mirrors the
 * server's `QuotaReservationInput`. `qty` is a decimal string — never a JS number. No beneficiary
 * employee: the server resolves a personal quota's beneficiary to the requester themselves.
 */
export interface QuotaReservationInput {
  quotaId: string;
  qty: string;
}

/** Body of `POST /documents/:id/submit`. Empty for non-quota types. */
export interface SubmitDocumentBody {
  quotaReservations?: QuotaReservationInput[];
}

export interface CreateDocumentDto {
  documentTypeId: string;
  currency?: string;
  vendorId?: string;
  /** The SUPPLIER's tax invoice. Required at submit when the document claims input VAT. */
  vendorInvoiceNo?: string;
  vendorInvoiceDate?: string;

  /**
   * The day this document's money actually moved. Accepted only on a type whose
   * `recordsPastEvents` is set, and a past day only from a caller holding `DOC_BACKDATE`.
   */
  moneyMovedOn?: string;

  // The payee bank account — required at submit when the type's requiresPayee is set. Must be an
  // active account of `vendorId`.
  vendorBankAccountId?: string;
  relatedEmployeeId?: string;
  // Where stock moves from, and for a TRANSFER_STOCK where it moves to. Required at submit when the
  // type's requiresWarehouse is set; the server DTO has accepted both since before any client sent
  // them, which is why goods issues could be drafted but never submitted.
  warehouseId?: string;
  destWarehouseId?: string;
  refDocumentId?: string;
  totalAmount?: string;
  lines?: DocumentLineInput[];
  fieldValues?: FieldValueInput[];
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  fileSizeKb?: number;
  mimeType?: string;
  uploadedAt?: string;
}

export interface DetailFieldValue {
  formFieldId: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  value?: string;
}

/** A budget as a movement names it. `name` is absent when the budget and its node carry none. */
export interface BudgetRef {
  id: string;
  code: string;
  name?: string;
  department?: { id: string; deptCode: string; name: string };
}

/**
 * One thing a document does to the budget.
 *
 * The content of a `BUDGET_PLAN`, `BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC` or a transfer, which lives on
 * `budget_movement` rather than on lines — so a screen rendering only lines says "no items" about a
 * document that activates twelve million kip. `amount` is a decimal string, like every other sum
 * on the wire. A transfer names both budgets; every other movement names only `toBudget`.
 */
export interface BudgetMovementRow {
  id: string;
  movementType: string;
  amount: string;
  reason?: string;
  effectiveDate?: string;
  fromBudget: BudgetRef | null;
  toBudget: BudgetRef | null;
}

export interface DocumentDetail {
  document: Record<string, unknown> & { id: string; docNo: string; status: string };
  fieldValues: DetailFieldValue[];
  lines: DocumentLineInput[];
  attachments: AttachmentRow[];
  refDocument: { id: string; docNo: string; status: string } | null;
  /** Whether a payment was recorded, i.e. whether there is payment evidence to read. */
  hasPayment: boolean;
  /** Always present; empty for a document that moves no budget. */
  budgetMovements: BudgetMovementRow[];
}

export interface DocumentSummary {
  id: string;
  docNo: string;
  status: string;
  totalAmount?: string;
  baseTotalAmount?: string;
  createdAt?: string;
}

/**
 * Server-side filters for the document list (mirrors the backend `DocumentListQueryDto`).
 * Amount bounds are decimal strings — never JS numbers.
 */
export interface DocumentListFilters {
  status?: string[];
  documentTypeId?: string;
  departmentId?: string;
  vendorId?: string;
  createdFrom?: string;
  createdTo?: string;
  docNo?: string;
  minAmount?: string;
  maxAmount?: string;
}

/** Drop empty values and join `status` into the comma form the backend DTO accepts. */
function filterParams(f: DocumentListFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status?.length) out.status = f.status.join(',');
  for (const k of ['documentTypeId', 'departmentId', 'vendorId', 'createdFrom', 'createdTo', 'docNo', 'minAmount', 'maxAmount'] as const) {
    const v = f[k];
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * The four type-driven selections, as a correction to an existing draft. Every key is optional and
 * every value nullable, and the two differ: absent means "leave alone", `null` means "clear".
 */
export interface DocumentSelections {
  warehouseId?: string | null;
  destWarehouseId?: string | null;
  relatedEmployeeId?: string | null;
  vendorId?: string | null;
}

/** Typed wrappers over the document-engine + approval endpoints. */
export const documentsApi = {
  list: (page = 1, limit = 20, filters: DocumentListFilters = {}) =>
    api
      .get<Paginated<DocumentSummary>>('/documents', { params: { page, limit, ...filterParams(filters) } })
      .then((r) => r.data),
  get: (id: string) => api.get(`/documents/${id}`).then((r) => r.data),
  detail: (id: string) => api.get<DocumentDetail>(`/documents/${id}/detail`).then((r) => r.data),
  creatableTypes: () => api.get<CreatableType[]>('/documents/creatable-types').then((r) => r.data),
  /**
   * Types occurring in the list the caller can see — the option list for the list's type filter.
   * Distinct from `creatableTypes`, which answers "what may I author"; a reviewer who authors
   * nothing still has to filter what other people raised.
   */
  typesInView: () => api.get<DocumentTypeOption[]>('/documents/types').then((r) => r.data),
  formForType: (id: string) => api.get<FormDef>(`/documents/types/${id}/form`).then((r) => r.data),
  create: (dto: CreateDocumentDto) => api.post('/documents', dto).then((r) => r.data),
  createFrom: (refId: string, documentTypeId: string) =>
    api.post(`/documents/from/${refId}`, { documentTypeId }).then((r) => r.data),
  setFields: (id: string, values: FieldValueInput[]) => api.put(`/documents/${id}/fields`, values).then((r) => r.data),
  setLines: (id: string, lines: DocumentLineInput[]) => api.put(`/documents/${id}/lines`, lines).then((r) => r.data),
  // The selections a draft's TYPE asks for, corrected on a document that is still a draft. Written
  // only at create until now, which left a draft missing one — because it was saved without it, or
  // because its type gained the flag afterwards — impossible to finish and impossible to fix.
  // An absent key leaves a selection alone; an explicit null clears it.
  setSelections: (id: string, dto: DocumentSelections) =>
    api.patch(`/documents/${id}/selections`, dto).then((r) => r.data),
  submit: (id: string, body: SubmitDocumentBody = {}) => api.post(`/documents/${id}/submit`, body).then((r) => r.data),
  // The reason travels with the withdrawal: the server keeps it on the CANCEL row in the
  // document's audit trail. Optional — an omitted reason must not refuse the act.
  cancel: (id: string, remark?: string) =>
    api.post(`/documents/${id}/cancel`, remark ? { remark } : {}).then((r) => r.data),
  // Attachments: the file is POSTed (multipart) to the API, which writes it to storage.
  listAttachments: (id: string) =>
    api.get<AttachmentRow[]>(`/documents/${id}/attachments`).then((r) => r.data),
  downloadUrl: (id: string, attId: string) =>
    api.get<{ url: string }>(`/documents/${id}/attachments/${attId}/download-url`).then((r) => r.data),
  approvalLog: (id: string) => api.get(`/documents/${id}/approval-log`).then((r) => r.data),
  // UX gate: may the active user act on the current approval step now? Server-computed
  // (eligibility for the current step + not creator); the server still enforces on act.
  canAct: (id: string) => api.get<{ canAct: boolean }>(`/documents/${id}/can-act`).then((r) => r.data.canAct),
  // Current-step SLA status (null unless the document is in approval).
  sla: (id: string) =>
    api
      .get<{ currentStepNo: number; slaDueAt: string | null; overdue: boolean } | null>(`/documents/${id}/sla`)
      .then((r) => r.data),
  // Who the current step is waiting on (participant-visible; null unless in approval).
  pendingApprovers: (id: string) =>
    api
      .get<PendingApproversResult>(`/documents/${id}/pending-approvers`)
      .then((r) => r.data)
      .catch(() => ({ pending: null }) as PendingApproversResult),
  // Goods receipt: accumulate received qty on the document's lines.
  receive: (id: string, lines: Array<{ lineId: string; qty: string }>) =>
    api.post(`/documents/${id}/receipts`, { lines }).then((r) => r.data),
  // 3-way match result for a disbursement that references a PO.
  matching: (id: string) => api.get<MatchResult>(`/documents/${id}/matching`).then((r) => r.data),
  // Export the document + approval trail (with stamped per-step signatures) as a PDF blob.
  exportPdf: (id: string) =>
    api.get(`/documents/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data as Blob),
};

/** Trigger a browser download of a PDF blob under the given filename. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface SlaStatus {
  currentStepNo: number;
  slaDueAt: string | null;
  overdue: boolean;
}

export interface PendingApprover {
  userId: string;
  name: string;
  delegatedFrom?: string;
}

export interface PendingStep {
  stepNo: number;
  stepName?: string;
  approveMode: string;
  roleName?: string;
  approvers: PendingApprover[];
}

export interface PendingApproversResult {
  pending: PendingStep | null;
}

/**
 * Upload one attachment for a document: the file is POSTed (multipart) to the API, which
 * validates it, writes the bytes to object storage, and records the metadata. Requires a
 * persisted document id, so staged files must wait until the draft exists.
 */
export async function uploadAttachment(documentId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  await api.post(`/documents/${documentId}/attachments/upload`, form);
}
