import { defineStore } from 'pinia';
import { docConfigApi } from '../api/docConfig';
import type { DocType, FormFieldRow, Mapping, TemplateSummary, UserOption, WorkflowRow } from '../api/docConfig';
import { jobLevelsApi } from '../api/jobLevels';
import type { SelectableJobLevel } from '../api/jobLevels';
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
  // Active job levels of the active company — options for the workflow/step "Engage for levels"
  // condition, so the condition and the requester's level reference the same value set.
  jobLevels: SelectableJobLevel[];
  loading: boolean;
  error: string;
}


export const useDocConfigStore = defineStore('docConfig', {
  state: (): DocConfigState => ({
    documentTypes: [], templatesByType: {}, fieldsByTemplate: {}, mappings: [],
    mappingsTotal: 0, mappingsPage: 1, mappingsLimit: 20,
    workflows: [], departments: [], roles: [], users: [], jobLevels: [], loading: false, error: '',
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
        const [documentTypes, mappings, workflows, departments, roles, users, jobLevels] = await Promise.all([
          docConfigApi.documentTypes(1, 100, true), docConfigApi.mappings(this.mappingsPage, this.mappingsLimit), docConfigApi.workflows(),
          docConfigApi.departments().catch(() => []), docConfigApi.roles().catch(() => []),
          docConfigApi.users().catch(() => []), jobLevelsApi.selectable().catch(() => []),
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
        this.jobLevels = jobLevels;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
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

    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        await this.loadAll();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    createDocumentType(dto: unknown) {
      return this.run(() => docConfigApi.createDocumentType(dto));
    },
    updateDocumentType(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateDocumentType(id, dto));
    },
    async createTemplate(documentTypeId: string) {
      const ok = await this.run(() => docConfigApi.createTemplate(documentTypeId));
      if (ok) await this.loadTemplates(documentTypeId);
      return ok;
    },
    async publishTemplate(id: string, documentTypeId: string) {
      const ok = await this.run(() => docConfigApi.publishTemplate(id));
      if (ok) await this.loadTemplates(documentTypeId);
      return ok;
    },
    async retireTemplate(id: string, documentTypeId: string) {
      const ok = await this.run(() => docConfigApi.retireTemplate(id));
      if (ok) await this.loadTemplates(documentTypeId);
      return ok;
    },
    async addField(dto: { formTemplateId: string }) {
      const ok = await this.run(() => docConfigApi.addField(dto));
      if (ok) await this.loadFields(dto.formTemplateId);
      return ok;
    },
    async updateField(id: string, dto: unknown, formTemplateId: string) {
      const ok = await this.run(() => docConfigApi.updateField(id, dto));
      if (ok) await this.loadFields(formTemplateId);
      return ok;
    },
    createMapping(dto: unknown) {
      return this.run(() => docConfigApi.createMapping(dto));
    },
    updateMapping(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateMapping(id, dto));
    },
    createWorkflow(dto: unknown) {
      return this.run(() => docConfigApi.createWorkflow(dto));
    },
    updateWorkflow(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateWorkflow(id, dto));
    },
    deleteWorkflow(id: string) {
      return this.run(() => docConfigApi.deleteWorkflow(id));
    },
    addStep(dto: unknown) {
      return this.run(() => docConfigApi.addStep(dto));
    },
    updateStep(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateStep(id, dto));
    },
    deleteStep(id: string) {
      return this.run(() => docConfigApi.deleteStep(id));
    },
  },
});
