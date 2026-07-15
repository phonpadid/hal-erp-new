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
  SubmitDocumentBody,
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
        const [current, approvalLog] = await Promise.all([
          documentsApi.get(id),
          documentsApi.approvalLog(id).catch(() => []),
        ]);
        this.current = current;
        this.approvalLog = approvalLog;
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
      // Clear the previous document's data up front so nothing (esp. attachments, whose
      // ids are document-scoped on the server) leaks across a detail→detail navigation
      // while this fetch is in flight.
      this.current = null;
      this.fieldValues = [];
      this.lines = [];
      this.attachments = [];
      this.refDocument = null;
      this.approvalLog = [];
      this.matching = null;
      try {
        const d = await documentsApi.detail(id);
        this.current = d.document;
        this.fieldValues = d.fieldValues;
        this.lines = d.lines;
        this.attachments = d.attachments;
        this.refDocument = d.refDocument;
        const inApproval = (d.document as { status?: string }).status === 'IN_APPROVAL';
        // These reads only need id / status / refDocument (all known now) and are independent
        // of one another, so fetch them concurrently — turns the detail open from six
        // sequential round-trips into two. Each is guarded so one failure blanks only its own
        // slice; pendingApprovers stays fail-loud (its rejection surfaces via the outer catch).
        const [approvalLog, canAct, sla, pendingApprovers, matching] = await Promise.all([
          documentsApi.approvalLog(id).catch(() => []),
          // canAct/sla are re-fetched each loadDetail so the action buttons vanish as soon as
          // the user acts (the step advances past them).
          inApproval ? documentsApi.canAct(id).catch(() => false) : Promise.resolve(false),
          inApproval ? documentsApi.sla(id).catch(() => null) : Promise.resolve(null),
          // Who the document is waiting on now — only while in approval; empty for non-participants.
          inApproval ? documentsApi.pendingApprovers(id).then((r) => r.pending) : Promise.resolve(null),
          // A document that references a predecessor may be a disbursement → load 3-way match.
          d.refDocument ? documentsApi.matching(id).catch(() => null) : Promise.resolve(null),
        ]);
        this.approvalLog = approvalLog;
        this.canAct = canAct;
        this.sla = sla;
        this.pendingApprovers = pendingApprovers;
        this.matching = matching;
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

    async submit(id: string, body: SubmitDocumentBody = {}): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.submit(id, body);
        // loadDetail (not loadOne): submit moves the doc into approval, so the stepper,
        // pending approvers and SLA must refresh too — loadOne only touches header + log.
        await this.loadDetail(id);
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
        // loadDetail (not loadOne): cancel clears the active approval step, so the stepper
        // and pending-approver panel must refresh, not just the header badge.
        await this.loadDetail(id);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },
  },
});
