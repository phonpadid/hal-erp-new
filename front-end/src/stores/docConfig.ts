import { defineStore } from 'pinia';
import { docConfigApi } from '../api/docConfig';
import type { DocType, FormFieldRow, Mapping, TemplateSummary, UserOption, WorkflowRow } from '../api/docConfig';
import { messageOf } from '../utils/apiError';

interface DocConfigState {
  documentTypes: DocType[];
  templatesByType: Record<string, TemplateSummary[]>;
  fieldsByTemplate: Record<string, FormFieldRow[]>;
  mappings: Mapping[];
  mappingsTotal: number;
  mappingsPage: number;
  mappingsLimit: number;
  workflows: WorkflowRow[];
  departments: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; code: string }>;
  users: UserOption[];
  loading: boolean;
  error: string;
}


export const useDocConfigStore = defineStore('docConfig', {
  state: (): DocConfigState => ({
    documentTypes: [], templatesByType: {}, fieldsByTemplate: {}, mappings: [],
    mappingsTotal: 0, mappingsPage: 1, mappingsLimit: 20,
    workflows: [], departments: [], roles: [], users: [], loading: false, error: '',
  }),
  getters: {
    // Resolve a single workflow from the already-loaded list (no dedicated endpoint —
    // `loadAll()` carries every workflow with its steps). Returns undefined until loaded.
    workflowById: (state) => (id: string): WorkflowRow | undefined =>
      state.workflows.find((w) => w.id === id),
  },
  actions: {
    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        const [documentTypes, mappings, workflows, departments, roles, users] = await Promise.all([
          docConfigApi.documentTypes(1, 100, true), docConfigApi.mappings(this.mappingsPage, this.mappingsLimit), docConfigApi.workflows(),
          docConfigApi.departments().catch(() => []), docConfigApi.roles().catch(() => []),
          docConfigApi.users().catch(() => []),
        ]);
        this.documentTypes = documentTypes.items;
        this.mappings = mappings.items;
        this.mappingsTotal = mappings.total;
        this.mappingsPage = mappings.page;
        this.mappingsLimit = mappings.limit;
        this.workflows = workflows;
        this.departments = departments;
        this.roles = roles;
        this.users = users;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadDocumentTypes() {
      try {
        this.documentTypes = (await docConfigApi.documentTypes(1, 100, true)).items;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadWorkflows() {
      try {
        this.workflows = await docConfigApi.workflows();
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadMappings(page?: number, limit?: number) {
      try {
        const res = await docConfigApi.mappings(page ?? this.mappingsPage, limit ?? this.mappingsLimit);
        this.mappings = res.items;
        this.mappingsTotal = res.total;
        this.mappingsPage = res.page;
        this.mappingsLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadTemplates(documentTypeId: string) {
      try {
        this.templatesByType[documentTypeId] = (await docConfigApi.templatesForType(documentTypeId)).items;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadFields(templateId: string) {
      try {
        this.fieldsByTemplate[templateId] = await docConfigApi.fields(templateId);
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    /**
     * Run a mutation, then refresh only the slice it can affect (`reload`). The option lists
     * this store also holds — departments/roles/users and the document-type catalog — are not
     * touched by most mutations, so re-fetching all six via loadAll() after every single-row
     * change was pure waste (worst case: moveField's two swaps ≈ 12 requests). Omitting `reload`
     * still falls back to loadAll() for anything that genuinely needs the whole graph.
     */
    async run(fn: () => Promise<unknown>, reload?: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        await (reload ? reload() : this.loadAll());
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    createDocumentType(dto: unknown) {
      return this.run(() => docConfigApi.createDocumentType(dto), () => this.loadDocumentTypes());
    },
    updateDocumentType(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateDocumentType(id, dto), () => this.loadDocumentTypes());
    },
    createTemplate(documentTypeId: string) {
      return this.run(() => docConfigApi.createTemplate(documentTypeId), () => this.loadTemplates(documentTypeId));
    },
    publishTemplate(id: string, documentTypeId: string) {
      return this.run(() => docConfigApi.publishTemplate(id), () => this.loadTemplates(documentTypeId));
    },
    retireTemplate(id: string, documentTypeId: string) {
      return this.run(() => docConfigApi.retireTemplate(id), () => this.loadTemplates(documentTypeId));
    },
    addField(dto: { formTemplateId: string }) {
      return this.run(() => docConfigApi.addField(dto), () => this.loadFields(dto.formTemplateId));
    },
    updateField(id: string, dto: unknown, formTemplateId: string) {
      return this.run(() => docConfigApi.updateField(id, dto), () => this.loadFields(formTemplateId));
    },
    createMapping(dto: unknown) {
      return this.run(() => docConfigApi.createMapping(dto), () => this.loadMappings());
    },
    updateMapping(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateMapping(id, dto), () => this.loadMappings());
    },
    createWorkflow(dto: unknown) {
      return this.run(() => docConfigApi.createWorkflow(dto), () => this.loadWorkflows());
    },
    updateWorkflow(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateWorkflow(id, dto), () => this.loadWorkflows());
    },
    deleteWorkflow(id: string) {
      return this.run(() => docConfigApi.deleteWorkflow(id), () => this.loadWorkflows());
    },
    addStep(dto: unknown) {
      return this.run(() => docConfigApi.addStep(dto), () => this.loadWorkflows());
    },
    updateStep(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateStep(id, dto), () => this.loadWorkflows());
    },
    deleteStep(id: string) {
      return this.run(() => docConfigApi.deleteStep(id), () => this.loadWorkflows());
    },
  },
});
