import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deptDocTypeSchema, documentTypeSchema, formFieldSchema, workflowStepSchema } from '@erp/shared';
import { useDocConfigStore } from './docConfig';
import { docConfigApi } from '../api/docConfig';

vi.mock('../api/docConfig', () => ({
  docConfigApi: {
    documentTypes: vi.fn(), createDocumentType: vi.fn(), updateDocumentType: vi.fn(),
    documentCategories: vi.fn(), createDocumentCategory: vi.fn(), updateDocumentCategory: vi.fn(), removeDocumentCategory: vi.fn(),
    templatesForType: vi.fn(), createTemplate: vi.fn(), publishTemplate: vi.fn(),
    fields: vi.fn(), addField: vi.fn(), mappings: vi.fn(), createMapping: vi.fn(),
    workflows: vi.fn(), createWorkflow: vi.fn(), addStep: vi.fn(),
    departments: vi.fn(), roles: vi.fn(), users: vi.fn(),
  },
}));

const m = docConfigApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const UUID = '11111111-1111-1111-1111-111111111111';

describe('doc-config shared schemas', () => {
  it('accepts valid payloads', () => {
    expect(documentTypeSchema.safeParse({ code: 'PO', name: 'PO', category: 'PROCUREMENT' }).success).toBe(true);
    expect(formFieldSchema.safeParse({ formTemplateId: UUID, fieldName: 'a', fieldLabel: 'A', fieldType: 'text' }).success).toBe(true);
    expect(deptDocTypeSchema.safeParse({ departmentId: UUID, documentTypeId: UUID, formTemplateId: UUID, workflowId: UUID }).success).toBe(true);
    // A step must name an approver — a role or a person. Both fields stay individually optional,
    // so neither is required on its own; what is refused is naming nobody at all.
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: UUID }).success).toBe(true);
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', approverUserId: UUID }).success).toBe(true);
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: UUID, amountMin: '100', amountMax: '500' }).success).toBe(true);
  });

  it('rejects a workflow step that names no approver', () => {
    // The form and the server refuse the same thing: a step naming nobody resolves to an empty
    // principal list, opens with zero actors, and leaves the document in nobody's queue.
    const parsed = workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/approver/i);
  });

  it('rejects an inverted amount range on a workflow step', () => {
    expect(
      workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', approverRoleId: UUID, amountMin: '500', amountMax: '100' }).success,
    ).toBe(false);
  });

  it('rejects bad enums and missing required', () => {
    // category is now a free-form code (validated server-side against the company's categories),
    // so an arbitrary non-empty code is accepted client-side; an empty category is still rejected.
    expect(documentTypeSchema.safeParse({ code: 'X', name: 'X', category: 'ANY_CODE' }).success).toBe(true);
    expect(documentTypeSchema.safeParse({ code: 'X', name: 'X', category: '' }).success).toBe(false);
    expect(formFieldSchema.safeParse({ formTemplateId: UUID, fieldName: 'a', fieldLabel: 'A', fieldType: 'blob' }).success).toBe(false);
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'NOPE' }).success).toBe(false);
    expect(documentTypeSchema.safeParse({ name: 'no code', category: 'HR' }).success).toBe(false);
  });

  // The flag reaches the create/edit dialogs and the backend DTO accepts it; the schema has to
  // carry it too, or client and server validation drift (a shared-schema invariant).
  it('carries requiresPayee', () => {
    const parsed = documentTypeSchema.safeParse({ code: 'DISB', name: 'Disbursement', category: 'FINANCE', requiresPayee: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.requiresPayee).toBe(true);
    expect(documentTypeSchema.safeParse({ code: 'X', name: 'X', category: 'HR', requiresPayee: 'yes' }).success).toBe(false);
  });

  // The dialogs surface these strings verbatim, so a blocked submit reads as a sentence rather
  // than zod's default ("String must contain at least 1 character(s)").
  it('states why a required field is rejected', () => {
    const r = documentTypeSchema.safeParse({ code: '', name: '', category: '' });
    expect(r.success).toBe(false);
    const messages = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(['A code is required', 'A name is required', 'Choose a category']));
  });
});

describe('useDocConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const emptyPage = { items: [], total: 0, page: 1, limit: 20 };
    for (const k of ['documentTypes', 'documentCategories', 'mappings']) m[k].mockResolvedValue(emptyPage);
    for (const k of ['workflows', 'departments', 'roles', 'users']) m[k].mockResolvedValue([]);
  });

  it('loadAll populates the config collections', async () => {
    m.documentTypes.mockResolvedValueOnce({ items: [{ id: 't1', code: 'PR' }], total: 1, page: 1, limit: 20 });
    m.workflows.mockResolvedValueOnce([{ id: 'w1', name: 'WF', steps: [] }]);
    const s = useDocConfigStore();
    await s.loadAll();
    expect(s.documentTypes).toHaveLength(1);
    expect(s.workflows).toHaveLength(1);
  });

  it('loadTemplates keys templates by type', async () => {
    m.templatesForType.mockResolvedValueOnce({ items: [{ id: 'tpl1', version: 1, status: 'DRAFT', fieldCount: 0 }], total: 1, page: 1, limit: 20 });
    const s = useDocConfigStore();
    await s.loadTemplates('t1');
    expect(s.templatesByType['t1']).toHaveLength(1);
  });

  it('addField calls the endpoint and refreshes the fields', async () => {
    m.addField.mockResolvedValueOnce(undefined);
    m.fields.mockResolvedValueOnce([{ id: 'f1', fieldName: 'reason' }]);
    const s = useDocConfigStore();
    const ok = await s.addField({ formTemplateId: 'tpl1', fieldName: 'reason' } as any);
    expect(ok).toBe(true);
    expect(m.addField).toHaveBeenCalled();
    expect(s.fieldsByTemplate['tpl1']).toHaveLength(1);
  });

  it('captures a server error', async () => {
    m.documentTypes.mockRejectedValueOnce({ response: { data: { message: 'denied' } } });
    const s = useDocConfigStore();
    await s.loadAll();
    expect(s.error).toBe('denied');
  });
});
