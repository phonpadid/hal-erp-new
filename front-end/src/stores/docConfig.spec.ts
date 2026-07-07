import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deptDocTypeSchema, documentTypeSchema, formFieldSchema, workflowStepSchema } from '@erp/shared';
import { useDocConfigStore } from './docConfig';
import { docConfigApi } from '../api/docConfig';

vi.mock('../api/docConfig', () => ({
  docConfigApi: {
    documentTypes: vi.fn(), createDocumentType: vi.fn(), updateDocumentType: vi.fn(),
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
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL' }).success).toBe(true);
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', amountMin: '100', amountMax: '500' }).success).toBe(true);
  });

  it('rejects an inverted amount range on a workflow step', () => {
    expect(
      workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'SEQUENTIAL', amountMin: '500', amountMax: '100' }).success,
    ).toBe(false);
  });

  it('rejects bad enums and missing required', () => {
    expect(documentTypeSchema.safeParse({ code: 'X', name: 'X', category: 'BOGUS' }).success).toBe(false);
    expect(formFieldSchema.safeParse({ formTemplateId: UUID, fieldName: 'a', fieldLabel: 'A', fieldType: 'blob' }).success).toBe(false);
    expect(workflowStepSchema.safeParse({ workflowId: UUID, stepNo: 1, approveMode: 'NOPE' }).success).toBe(false);
    expect(documentTypeSchema.safeParse({ name: 'no code', category: 'HR' }).success).toBe(false);
  });
});

describe('useDocConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const emptyPage = { items: [], total: 0, page: 1, limit: 20 };
    for (const k of ['documentTypes', 'mappings']) m[k].mockResolvedValue(emptyPage);
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
