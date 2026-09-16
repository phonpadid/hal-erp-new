import { defineStore } from 'pinia';
import { emptyOptions, loadOptions, type OptionList } from './loadState';
import { documentsApi } from '../api/documents';
import type {
  AttachmentRow,
  CanActResult,
  BudgetMovementRow,
  DocumentTypeOption,
  CreateDocumentDto,
  DetailFieldValue,
  DocumentListFilters,
  DocumentBudget,
  DocumentLineInput,
  DocumentSelections,
  DocumentSummary,
  FieldValueInput,
  MatchResult,
  PendingStep,
  SlaStatus,
  SubmitDocumentBody,
} from '../api/documents';
import { codeOf, messageOf } from '../utils/apiError';

interface DocumentsState {
  list: DocumentSummary[];
  total: number;
  page: number;
  limit: number;
  filters: DocumentListFilters;
  typeOptions: OptionList<DocumentTypeOption>;
  current: any | null;
  /** Whether the open document has payment evidence to read — from the detail response. */
  hasPayment: boolean;
  /** The current step demands a transfer slip, and whether one is attached. */
  slipRequired: boolean;
  hasSlip: boolean;
  /** Whether the open document's rate can still be restated — from the detail response. */
  canRestateRate: boolean;
  accountRecodeAllowed: boolean;
  canRecodeAccount: boolean;
  /** The budgets the open document charges, with what is left in each — from the detail response. */
  budgets: DocumentBudget[];
  fieldValues: DetailFieldValue[];
  lines: DocumentLineInput[];
  /**
   * What the open document does to the budget. Empty for a document whose content is lines — which
   * is most of them — and the ONLY content a budget plan or an adjustment has.
   */
  budgetMovements: BudgetMovementRow[];
  attachments: AttachmentRow[];
  refDocument: { id: string; docNo: string; status: string } | null;
  approvalLog: any[];
  /** Server-computed: may the active user act on the current approval step now? */
  canAct: boolean;
  /** Why Approve alone is unavailable although `canAct` is true (SIGNATURE_REQUIRED), else null. */
  canActReason: CanActResult['reason'] | null;
  /** Coded failure of the last submit, when the backend named one (e.g. SIGNATURE_REQUIRED). */
  errorCode: string | undefined;
  sla: SlaStatus | null;
  /** Current step's pending approvers (null unless in approval / not a participant). */
  pendingApprovers: PendingStep | null;
  matching: MatchResult | null;
  loading: boolean;
  error: string;
}


export const useDocumentsStore = defineStore('documents', {
  state: (): DocumentsState => ({ list: [], total: 0, page: 1, limit: 20, filters: {}, typeOptions: emptyOptions<DocumentTypeOption>(), current: null, hasPayment: false, slipRequired: false, hasSlip: false, canRestateRate: false, accountRecodeAllowed: false, canRecodeAccount: false, budgets: [], fieldValues: [], lines: [], budgetMovements: [], attachments: [], refDocument: null, approvalLog: [], canAct: false, canActReason: null, errorCode: undefined, sla: null, pendingApprovers: null, matching: null, loading: false, error: '' }),
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

    /**
     * Options for the list's type filter: the types present in the list this reader can see.
     *
     * Was `creatableTypes()` behind `.catch(() => [])` — the wrong list, and a failed read of it
     * was indistinguishable from a company with no document types at all.
     */
    async loadTypeOptions() {
      await loadOptions(this.typeOptions, documentsApi.typesInView);
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
      this.budgetMovements = [];
      this.attachments = [];
      this.refDocument = null;
      this.hasPayment = false;
      this.slipRequired = false;
      this.hasSlip = false;
      this.canRestateRate = false;
      this.accountRecodeAllowed = false;
      this.canRecodeAccount = false;
      this.budgets = [];
      this.approvalLog = [];
      this.matching = null;
      try {
        const d = await documentsApi.detail(id);
        this.current = d.document;
        this.hasPayment = d.hasPayment;
        this.slipRequired = d.slipRequired;
        this.hasSlip = d.hasSlip;
        this.canRestateRate = d.canRestateRate ?? false;
        this.accountRecodeAllowed = d.accountRecodeAllowed ?? false;
        this.canRecodeAccount = d.canRecodeAccount ?? false;
        this.budgets = d.budgets ?? [];
        this.fieldValues = d.fieldValues;
        this.lines = d.lines;
        // `?? []` because an older server does not send the key at all; a client that let it go
        // undefined would render the movement section as broken rather than as absent.
        this.budgetMovements = d.budgetMovements ?? [];
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
          inApproval ? documentsApi.canAct(id).catch((): CanActResult => ({ canAct: false })) : Promise.resolve<CanActResult>({ canAct: false }),
          inApproval ? documentsApi.sla(id).catch(() => null) : Promise.resolve(null),
          // Who the document is waiting on now — only while in approval; empty for non-participants.
          inApproval ? documentsApi.pendingApprovers(id).then((r) => r.pending) : Promise.resolve(null),
          // A document that references a predecessor may be a disbursement → load 3-way match.
          d.refDocument ? documentsApi.matching(id).catch(() => null) : Promise.resolve(null),
        ]);
        this.approvalLog = approvalLog;
        this.canAct = canAct.canAct;
        this.canActReason = canAct.reason ?? null;
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

    /**
     * Create a draft — header, field values and lines in ONE request. Returns the new id.
     *
     * This used to be three: create, then setFields, then setLines. The server writes all three in
     * a single flush, so nothing was gained by splitting them, and something was lost: a create
     * that succeeded followed by a setLines the server refused left a header-only draft behind
     * with a document number spent on it, while the screen stayed in create mode and made
     * another one on every retry. One request is all-or-nothing — a refused draft is no draft.
     *
     * The DTO also used to be a hand-written allowlist of four fields, and the comment it carried
     * recorded the bug that shape produces: "vendorBankAccountId must travel with the create ...
     * Dropping it here made every disbursement unsubmittable." Everything goes, as given.
     */
    async createDraft(dto: CreateDocumentDto): Promise<string> {
      const created: any = await documentsApi.create(dto);
      return created.id;
    },

    /** Create a draft successor from an approved predecessor. Returns the new id. */
    async createFrom(refId: string, documentTypeId: string): Promise<string> {
      const created: any = await documentsApi.createFrom(refId, documentTypeId);
      return created.id;
    },

    /** Save edits to an existing draft's field values and lines. */
    /**
     * Save an open draft.
     *
     * `selections` are the four the document's TYPE asks for — warehouse, destination warehouse,
     * related employee, vendor. They go FIRST, before the fields and lines: they are what the
     * submit gates read, so a failure to apply them should stop the save rather than half-write it.
     * Omitted entirely by a caller that has none to send, which keeps the request count where it
     * was for every screen that does not collect them.
     */
    async saveDraft(
      id: string,
      fieldValues: FieldValueInput[],
      lines: DocumentLineInput[],
      selections?: DocumentSelections,
    ): Promise<boolean> {
      this.error = '';
      try {
        if (selections && Object.keys(selections).length) {
          await documentsApi.setSelections(id, selections);
        }
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
      this.errorCode = undefined;
      try {
        await documentsApi.submit(id, body);
        // loadDetail (not loadOne): submit moves the doc into approval, so the stepper,
        // pending approvers and SLA must refresh too — loadOne only touches header + log.
        await this.loadDetail(id);
        return true;
      } catch (e) {
        this.error = messageOf(e);
        // A refusal the screen answers differently — SIGNATURE_REQUIRED offers the profile page
        // rather than repeating the message — is kept by code, the way approvals keeps its own.
        this.errorCode = codeOf(e);
        return false;
      }
    },

    async cancel(id: string, remark?: string): Promise<boolean> {
      this.error = '';
      try {
        await documentsApi.cancel(id, remark);
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
