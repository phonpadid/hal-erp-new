import { defineStore } from 'pinia';
import { docConfigApi } from '../api/docConfig';
import type { DocCategoryRow, DocType, FormFieldRow, Mapping, TemplateSummary, UserOption, WorkflowRow } from '../api/docConfig';
import { jobLevelsApi } from '../api/jobLevels';
import type { SelectableJobLevel } from '../api/jobLevels';
import { messageOf } from '../utils/apiError';

interface DocConfigState {
  documentTypes: DocType[];
  // Document categories of the active company (includeInactive: the admin surface manages all;
  // the create-form options use the `activeCategories` getter).
  categories: DocCategoryRow[];
  templatesByType: Record<string, TemplateSummary[]>;
  fieldsByTemplate: Record<string, FormFieldRow[]>;
  mappings: Mapping[];
  mappingsTotal: number;
  mappingsPage: number;
  mappingsLimit: number;
  workflows: WorkflowRow[];
  departments: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; code: string; name: string }>;
  users: UserOption[];
  // Active job levels of the active company — options for the workflow/step "Engage for levels"
  // condition, so the condition and the requester's level reference the same value set.
  jobLevels: SelectableJobLevel[];
  /**
   * The search term the server is answering, per list. Kept in the store rather than passed
   * per call so paging keeps it: page 2 of a search is page 2 of that same search.
   */
  mappingsSearch: string;
  /** The three dimensions the mapping list narrows by. `undefined` on isActive means "unset". */
  mappingsDepartmentId: string;
  mappingsDocumentTypeId: string;
  mappingsIsActive?: boolean;
  /** Departments holding a mapping — the filter's options, never the org directory. */
  mappingDepartments: Array<{ id: string; name: string }>;
  /**
   * How many mappings exist with nothing narrowing the list. Refreshed only on a load with no
   * narrowing active, which includes the first — so "showing 4 of 80" can be said truthfully. A
   * filter can be set and scrolled past in a way a search term cannot.
   */
  mappingsTotalUnfiltered: number;
  loading: boolean;
  error: string;
}


export const useDocConfigStore = defineStore('docConfig', {
  state: (): DocConfigState => ({
    documentTypes: [], categories: [], templatesByType: {}, fieldsByTemplate: {}, mappings: [],
    mappingsTotal: 0, mappingsPage: 1, mappingsLimit: 20, mappingsSearch: '',
    mappingsDepartmentId: '', mappingsDocumentTypeId: '', mappingsIsActive: undefined, mappingDepartments: [], mappingsTotalUnfiltered: 0,
    workflows: [], departments: [], roles: [], users: [], jobLevels: [], loading: false, error: '',
  }),
  getters: {
    /** Whether anything is narrowing the mapping list right now. A count beside a whole list is noise. */
    mappingsNarrowing: (state): boolean =>
      !!state.mappingsSearch || !!state.mappingsDepartmentId || !!state.mappingsDocumentTypeId
      || state.mappingsIsActive !== undefined,

    // Resolve a single workflow from the already-loaded list (no dedicated endpoint —
    // `loadAll()` carries every workflow with its steps). Returns undefined until loaded.
    workflowById: (state) => (id: string): WorkflowRow | undefined =>
      state.workflows.find((w) => w.id === id),
    // Active categories only — the options offered when creating a document type (a deactivated
    // category is no longer a valid choice, though existing types keep their category code).
    activeCategories: (state): DocCategoryRow[] => state.categories.filter((c) => c.isActive),
  },
  actions: {
    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        const [documentTypes, categories, mappings, workflows, departments, roles, users, jobLevels] = await Promise.all([
          docConfigApi.documentTypes(1, 100, true), docConfigApi.documentCategories(1, 100, true),
          docConfigApi.mappings(this.mappingsPage, this.mappingsLimit), docConfigApi.workflows(),
          docConfigApi.departments().catch(() => []), docConfigApi.roles().catch(() => []),
          docConfigApi.users().catch(() => []), jobLevelsApi.selectable().catch(() => []),
        ]);
        this.documentTypes = documentTypes.items;
        this.categories = categories.items;
        this.mappings = mappings.items;
        this.mappingsTotal = mappings.total;
        // The denominator for "showing N of M". `loadAll` reads the mappings unnarrowed, so this is
        // the only place the whole-list total is known on a first visit — and without it the screen
        // said "showing 4 of 0" the moment a filter was applied. Caught in the running app, not by
        // a test, because the test seeded the number it was meant to derive.
        this.mappingsTotalUnfiltered = mappings.total;
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

    async loadDocumentTypes() {
      try {
        this.documentTypes = (await docConfigApi.documentTypes(1, 100, true)).items;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async loadCategories() {
      try {
        this.categories = (await docConfigApi.documentCategories(1, 100, true)).items;
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

    async loadMappings(page?: number, limit?: number, search?: string) {
      if (search !== undefined) this.mappingsSearch = search;
      try {
        const res = await docConfigApi.mappings(
          page ?? this.mappingsPage, limit ?? this.mappingsLimit, this.mappingsSearch || undefined,
          {
            departmentId: this.mappingsDepartmentId || undefined,
            documentTypeId: this.mappingsDocumentTypeId || undefined,
            isActive: this.mappingsIsActive,
          },
        );
        this.mappings = res.items;
        this.mappingsTotal = res.total;
        this.mappingsPage = res.page;
        this.mappingsLimit = res.limit;
        // The denominator, taken only from an unnarrowed read — otherwise "showing 4 of 4" would
        // be true of every filtered list and would say nothing.
        if (!this.mappingsNarrowing) this.mappingsTotalUnfiltered = res.total;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    /**
     * Change what the mapping list is narrowed by, and reload it from page 1.
     *
     * Back to page 1 every time: a filter applied while on page 3 would otherwise show page 3 of a
     * shorter list, which is usually empty and always confusing.
     */
    async narrowMappings(next: { search?: string; departmentId?: string; documentTypeId?: string; isActive?: boolean | undefined }) {
      if (next.search !== undefined) this.mappingsSearch = next.search;
      if (next.departmentId !== undefined) this.mappingsDepartmentId = next.departmentId;
      if (next.documentTypeId !== undefined) this.mappingsDocumentTypeId = next.documentTypeId;
      if ('isActive' in next) this.mappingsIsActive = next.isActive;
      await this.loadMappings(1, this.mappingsLimit);
    },

    /** Whether anything is narrowing the list right now — drives the "showing N of M" line. */
    async loadMappingDepartments() {
      try {
        this.mappingDepartments = await docConfigApi.mappingDepartments();
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
    createDocumentCategory(dto: unknown) {
      return this.run(() => docConfigApi.createDocumentCategory(dto), () => this.loadCategories());
    },
    updateDocumentCategory(id: string, dto: unknown) {
      return this.run(() => docConfigApi.updateDocumentCategory(id, dto), () => this.loadCategories());
    },
    removeDocumentCategory(id: string) {
      return this.run(() => docConfigApi.removeDocumentCategory(id), () => this.loadCategories());
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
