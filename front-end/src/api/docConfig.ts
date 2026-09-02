import { api } from './client';
import type { Paginated } from './pagination';

export interface DocType {
  id: string;
  code: string;
  name: string;
  category: string;
  requiresBudget: boolean;
  requiresQuota: boolean;
  requiresVendor: boolean;
  requiresItem: boolean;
  // Whether a document of this type must name a payee bank account before submit. Independent of
  // postAction: a PR settles budget without anyone yet knowing which account will be paid.
  requiresPayee: boolean;
  // This type is the form for recording something that already happened: its documents may
  // state the day their money moved, and the ledger dates their rows by it.
  recordsPastEvents?: boolean;
  defaultGlAccount?: string;
  postAction?: string;
  isActive: boolean;
}
export interface DocCategoryRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface TemplateSummary {
  id: string;
  version: number;
  status: string;
  fieldCount: number;
}
export interface FormFieldRow {
  id: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  optionsJson?: string;
  conditionJson?: string;
}
export interface RefPairing {
  id: string;
  predecessorTypeId: string;
  predecessorCode: string;
  successorTypeId: string;
  successorCode: string;
  // Whether the CREATE_SUCCESSOR post-action auto-creates this successor on the predecessor's approval.
  autoCreate: boolean;
  // Department an auto-created successor lands in; null = the source document's own department.
  // Only auto-create reads it — a manual create-from takes the creating user's department.
  successorDepartmentId: string | null;
}
export interface RefPairings {
  successors: RefPairing[];
  predecessors: RefPairing[];
}
export interface Mapping {
  id: string;
  departmentId: string;
  departmentName: string;
  documentTypeId: string;
  documentTypeCode: string;
  formTemplateId: string;
  templateVersion: number;
  workflowId: string;
  workflowName: string;
  isActive: boolean;
}
export interface WorkflowStepRow {
  id: string;
  stepNo: number;
  stepName?: string;
  approverRoleId?: string;
  approverUserId?: string;
  amountMin?: string;
  amountMax?: string;
  approveMode: string;
  slaHours?: number;
  escalateToRoleId?: string;
  escalateToUserId?: string;
  showSignatureOnPdf: boolean;
  conditionJson?: string;
}
export interface UserOption {
  id: string;
  username: string;
  // Role assignments in the ACTIVE company only — an empty array means the account exists but is
  // not a member here, so it cannot be a step's approver.
  assignments?: Array<{ id: string }>;
}
export interface WorkflowRow {
  id: string;
  name: string;
  isActive: boolean;
  steps: WorkflowStepRow[];
}

const D = '/document-config';

export const docConfigApi = {
  // Feeds Select options (forms tab + mapping dialog) and the config table; load a large page so
  // options aren't truncated. The admin Configuration area passes includeInactive so the status
  // filter and inline active toggle can see (and re-activate) deactivated types.
  documentTypes: (page = 1, limit = 100, includeInactive = false) =>
    api.get<Paginated<DocType>>(`${D}/document-types`, { params: { page, limit, includeInactive } }).then((r) => r.data),
  createDocumentType: (dto: unknown) => api.post(`${D}/document-types`, dto).then((r) => r.data),
  updateDocumentType: (id: string, dto: unknown) => api.patch(`${D}/document-types/${id}`, dto).then((r) => r.data),
  // Document categories (document_category): the create form's category options come from here
  // (active company, active-only by default); the admin surface passes includeInactive so the
  // status filter and inline active toggle can see (and re-activate) deactivated categories.
  documentCategories: (page = 1, limit = 100, includeInactive = false) =>
    api
      .get<Paginated<DocCategoryRow>>(`${D}/document-categories`, { params: { page, limit, includeInactive } })
      .then((r) => r.data),
  createDocumentCategory: (dto: unknown) => api.post(`${D}/document-categories`, dto).then((r) => r.data),
  updateDocumentCategory: (id: string, dto: unknown) =>
    api.patch(`${D}/document-categories/${id}`, dto).then((r) => r.data),
  removeDocumentCategory: (id: string) => api.delete(`${D}/document-categories/${id}`).then((r) => r.data),
  // Feeds Select options in the mapping dialog; load a large page so options aren't truncated.
  templatesForType: (documentTypeId: string, page = 1, limit = 100) =>
    api
      .get<Paginated<TemplateSummary>>(`${D}/form-templates`, { params: { documentTypeId, page, limit } })
      .then((r) => r.data),
  createTemplate: (documentTypeId: string) => api.post(`${D}/form-templates`, { documentTypeId }).then((r) => r.data),
  publishTemplate: (id: string) => api.post(`${D}/form-templates/${id}/publish`, {}).then((r) => r.data),
  retireTemplate: (id: string) => api.post(`${D}/form-templates/${id}/retire`, {}).then((r) => r.data),
  fields: (templateId: string) => api.get<FormFieldRow[]>(`${D}/form-templates/${templateId}/fields`).then((r) => r.data),
  addField: (dto: unknown) => api.post(`${D}/form-fields`, dto).then((r) => r.data),
  updateField: (id: string, dto: unknown) => api.patch(`${D}/form-fields/${id}`, dto).then((r) => r.data),
  // Reference-chain pairings (document_type_ref) for one document type: the successors it may
  // create and the predecessors it may be created from.
  refPairings: (documentTypeId: string) =>
    api.get<RefPairings>(`${D}/ref-pairings`, { params: { documentTypeId } }).then((r) => r.data),
  addRefPairing: (dto: {
    predecessorTypeId: string;
    successorTypeId: string;
    autoCreate?: boolean;
    successorDepartmentId?: string;
  }) => api.post<RefPairing>(`${D}/ref-pairings`, dto).then((r) => r.data),
  // successorDepartmentId: omit to leave as-is, null to clear (back to the source document's
  // department), a uuid to hand the successor to that department.
  updateRefPairing: (id: string, dto: { autoCreate: boolean; successorDepartmentId?: string | null }) =>
    api.patch<RefPairing>(`${D}/ref-pairings/${id}`, dto).then((r) => r.data),
  removeRefPairing: (id: string) => api.delete(`${D}/ref-pairings/${id}`).then((r) => r.data),
  /**
   * The mapping list. `departmentId`, `documentTypeId` and `isActive` narrow it SERVER-side —
   * the list is paged, so filtering the page the client holds would narrow a fraction of the set
   * while presenting itself as having narrowed all of it.
   *
   * `isActive` is sent only when set, and `false` is a real value: "show me the deactivated ones"
   * is the question the screen exists for, so it must not be dropped as "no filter given".
   */
  mappings: (
    page = 1,
    limit = 20,
    search?: string,
    narrow: { departmentId?: string; documentTypeId?: string; isActive?: boolean } = {},
  ) =>
    api
      .get<Paginated<Mapping>>(`${D}/dept-doc-types`, {
        params: {
          page,
          limit,
          search,
          departmentId: narrow.departmentId || undefined,
          documentTypeId: narrow.documentTypeId || undefined,
          isActive: narrow.isActive === undefined ? undefined : narrow.isActive,
        },
      })
      .then((r) => r.data),
  /** Departments holding at least one mapping — the option list for the filter above. */
  mappingDepartments: () =>
    api.get<Array<{ id: string; name: string }>>(`${D}/dept-doc-types/departments`).then((r) => r.data),
  createMapping: (dto: unknown) => api.post(`${D}/dept-doc-types`, dto).then((r) => r.data),
  updateMapping: (id: string, dto: unknown) => api.patch(`${D}/dept-doc-types/${id}`, dto).then((r) => r.data),
  workflows: () => api.get<WorkflowRow[]>('/workflows').then((r) => r.data),
  createWorkflow: (dto: unknown) => api.post('/workflows', dto).then((r) => r.data),
  updateWorkflow: (id: string, dto: unknown) => api.patch(`/workflows/${id}`, dto).then((r) => r.data),
  deleteWorkflow: (id: string) => api.delete(`/workflows/${id}`).then((r) => r.data),
  addStep: (dto: unknown) => api.post('/workflows/steps', dto).then((r) => r.data),
  updateStep: (id: string, dto: unknown) => api.patch(`/workflows/steps/${id}`, dto).then((r) => r.data),
  deleteStep: (id: string) => api.delete(`/workflows/steps/${id}`).then((r) => r.data),
  departments: () =>
    api
      .get<Paginated<{ id: string; name: string }>>('/departments', { params: { page: 1, limit: 100 } })
      .then((r) => r.data.items),
  roles: () =>
    api
      .get<Paginated<{ id: string; code: string; name: string }>>('/rbac/roles', { params: { page: 1, limit: 100 } })
      .then((r) => r.data.items),
  // Approver-by-person picker for workflow steps. `/rbac/users` lists every account — that is what
  // an admin needs to grant somebody their first role here — but a step may only name a member of
  // the active company, which the server enforces. Filtering on `assignments` keeps the picker from
  // offering a choice that would be refused on save.
  users: () =>
    api
      .get<Paginated<UserOption>>('/rbac/users', { params: { page: 1, limit: 100 } })
      .then((r) => r.data.items.filter((u) => (u.assignments?.length ?? 0) > 0)),
};
