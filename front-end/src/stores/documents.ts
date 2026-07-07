import { defineStore } from 'pinia';
import { documentsApi } from '../api/documents';
import type {
  AttachmentRow,
  CreatableType,
  CreateDocumentDto,
  DetailFieldValue,
  DocumentListFilters,
  DocumentLineInput,
  DocumentSummary,
  FieldValueInput,
  MatchResult,
  PendingStep,
  SlaStatus,
} from '../api/documents';
import { messageOf } from '../utils/apiError';

interface DocumentsState {
  list: DocumentSummary[];
  total: number;
  page: number;
  limit: number;
  filters: DocumentListFilters;
  types: CreatableType[];
  current: any | null;
  fieldValues: DetailFieldValue[];
  lines: DocumentLineInput[];
  attachments: AttachmentRow[];
  refDocument: { id: string; docNo: string; status: string } | null;
  approvalLog: any[];
  /** Server-computed: may the active user act on the current approval step now? */
  canAct: boolean;
  sla: SlaStatus | null;
  /** Current step's pending approvers (null unless in approval / not a participant). */
  pendingApprovers: PendingStep | null;
  matching: MatchResult | null;
  loading: boolean;
  error: string;
}


export const useDocumentsStore = defineStore('documents', {
  state: (): DocumentsState => ({ list: [], total: 0, page: 1, limit: 20, filters: {}, types: [], current: null, fieldValues: [], lines: [], attachments: [], refDocument: null, approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null, loading: false, error: '' }),
  actions: {
    async loadList(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await documentsApi.list(page ?? this.page, limit ?? this.limit, this.filters);
        this.list = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Apply new filters and reload from page 1 (filters change the whole result set). */
    async applyFilters(filters: DocumentListFilters) {
      this.filters = filters;
      await this.loadList(1, this.limit);
    },

    /** Clear all filters and reload the unfiltered list from page 1. */
    async clearFilters() {
      this.filters = {};
      await this.loadList(1, this.limit);
    },

    /** Document types for the type filter (requester-facing; needs DOC_CREATE). Best-effort. */
    async loadTypes() {
      this.types = await documentsApi.creatableTypes().catch(() => []);
    },

    async loadOne(id: string) {
      this.loading = true;
      this.error = '';
      try {
        this.current = await documentsApi.get(id);
        this.approvalLog = await documentsApi.approvalLog(id).catch(() => []);
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Full detail: header + field values + lines + attachments + predecessor + log. */
    async loadDetail(id: string) {
      this.loading = true;
      this.error = '';
      try {
        const d = await documentsApi.detail(id);
        this.current = d.document;
        this.fieldValues = d.fieldValues;
        this.lines = d.lines;
        this.attachments = d.attachments;
        this.refDocument = d.refDocument;
        this.approvalLog = await documentsApi.approvalLog(id).catch(() => []);
        const inApproval = (d.document as { status?: string }).status === 'IN_APPROVAL';
        // Only meaningful while in approval; re-fetched on each loadDetail so the action
        // buttons vanish as soon as the user acts (the step advances past them).
        this.canAct = inApproval ? await documentsApi.canAct(id).catch(() => false) : false;
        this.sla = inApproval ? await documentsApi.sla(id).catch(() => null) : null;
        // Who the document is waiting on now — only while in approval; empty for non-participants.
        this.pendingApprovers = inApproval ? (await documentsApi.pendingApprovers(id)).pending : null;
        // A document that references a predecessor may be a disbursement → load 3-way match.
        this.matching = d.refDocument ? await documentsApi.matching(id).catch(() => null) : null;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /** Re-fetch just the attachment list (after an upload). */
    async reloadAttachments(id: string) {
      this.attachments = await documentsApi.listAttachments(id).catch(() => this.attachments);
    },

    /** Record goods receipt against the document's lines, then reload the detail. */
    async receive(id: string, lines: Array<{ lineId: string; qty: string }>): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.receive(id, lines);
        await this.loadDetail(id);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    /** Create a draft, then persist its field values and lines. Returns the new id. */
    async createDraft(dto: CreateDocumentDto): Promise<string> {
      const created: any = await documentsApi.create({ documentTypeId: dto.documentTypeId, currency: dto.currency, vendorId: dto.vendorId });
      if (dto.fieldValues?.length) await documentsApi.setFields(created.id, dto.fieldValues);
      if (dto.lines?.length) await documentsApi.setLines(created.id, dto.lines);
      return created.id;
    },

    /** Create a draft successor from an approved predecessor. Returns the new id. */
    async createFrom(refId: string, documentTypeId: string): Promise<string> {
      const created: any = await documentsApi.createFrom(refId, documentTypeId);
      return created.id;
    },

    /** Save edits to an existing draft's field values and lines. */
    async saveDraft(id: string, fieldValues: FieldValueInput[], lines: DocumentLineInput[]): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.setFields(id, fieldValues);
        await documentsApi.setLines(id, lines);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async submit(id: string): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.submit(id);
        await this.loadOne(id);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    async cancel(id: string): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.cancel(id);
        await this.loadOne(id);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
