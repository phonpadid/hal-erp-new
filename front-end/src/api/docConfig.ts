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
  defaultGlAccount?: string;
  postAction?: string;
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
  showSignatureOnPdf: boolean;
  conditionJson?: string;
}
export interface UserOption {
  id: string;
  username: string;
}
export interface WorkflowRow {
  id: string;
  name: string;
  isActive: boolean;
  // Workflow-level selection condition (amount band + job levels), read-only for the config UI.
  conditionJson?: string;
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
  mappings: (page = 1, limit = 20) =>
    api.get<Paginated<Mapping>>(`${D}/dept-doc-types`, { params: { page, limit } }).then((r) => r.data),
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
      .get<Paginated<{ id: string; code: string }>>('/rbac/roles', { params: { page: 1, limit: 100 } })
      .then((r) => r.data.items),
  // Approver-by-person picker for workflow steps.
  users: () =>
    api
      .get<Paginated<UserOption>>('/rbac/users', { params: { page: 1, limit: 100 } })
      .then((r) => r.data.items),
};
