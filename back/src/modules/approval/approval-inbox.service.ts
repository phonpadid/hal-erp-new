import { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import { Injectable, Optional } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { pageParams, type Paginated } from '../../common/pagination/pagination';
import { localMidnightInstant } from '../../common/time/company-clock';
import type { PendingInboxQueryDto } from './dto/workflow.dto';
import { DocStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { DocumentPermissions } from '../document/permissions';
import { intakeStateFor, NOT_RECEIVED, type IntakeState } from '../document/intake-read';
import { requesterIdentities } from '../document/requester-identity';
import { Company } from '../multi-company/multi-company.entities';
import type { DocumentApprovalStep } from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { SlaService } from './sla.service';
import { nextDay } from './pending-summary.service';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PendingApproval {
  id: string;
  docNo: string;
  documentType: { code: string; name: string };
  /** Resolved as the documents list resolves it: the employee's full name, else the login. */
  requesterName: string;
  requesterDepartment: string | null;
  baseTotalAmount: string | null;
  currentStepNo: number | null;
  submittedAt: Date | null;
  slaDueAt: Date | null;
  overdue: boolean;
  /** Finance's intake state, from the same read the documents list uses. */
  intake: IntakeState;
}

/** One actionable document before the page is decorated. */
interface Actionable {
  doc: Document;
  slaDueAt: Date | null;
}

/**
 * The active user's actionable approvals. Reuses ApproverResolverService.eligible so the
 * inbox applies the SAME eligibility + self-approval rules as acting — it never lists a
 * document the user cannot actually act on (invariant 8).
 */
@Injectable()
export class ApprovalInboxService {
  constructor(
    private readonly em: EntityManager,
    private readonly resolver: ApproverResolverService,
    private readonly sla: SlaService,
    private readonly route: DocumentRouteService,
    // Optional to construct, required to export: only the payables export reaches into the document
    // module, and the unit tests that exercise listing and eligibility build this positionally.
    @Optional() private readonly documents?: DocumentService,
  ) {}

  async pending(q: PendingInboxQueryDto = {}): Promise<Paginated<PendingApproval>> {
    const matched = await this.actionableSet(q);
    const { page, limit, offset } = pageParams(q);
    const window = matched.slice(offset, offset + limit);

    // Decorated for the page only: a fixed number of batch reads, never a query per row. `canReceive`
    // costs two more queries, so it is asked only for a reader who could act on it — exactly as the
    // documents list asks it, so the two screens cannot disagree about a row.
    const em = this.em.fork();
    const docs = window.map((a) => a.doc);
    const raisedBy = await requesterIdentities(em, docs);
    const viewerId = RequestContext.permissions().includes(DocumentPermissions.DOC_INTAKE_RECEIVE)
      ? RequestContext.userId()
      : undefined;
    const intake = await intakeStateFor(em, docs.map((d) => d.id), viewerId ?? undefined);

    const items = window.map(({ doc, slaDueAt }): PendingApproval => {
      const who = raisedBy.get(doc.id);
      return {
        id: doc.id,
        docNo: doc.docNo,
        documentType: { code: doc.documentType.code, name: doc.documentType.name },
        requesterName: who?.name || doc.createdBy.username,
        requesterDepartment: who?.department ?? null,
        baseTotalAmount: doc.baseTotalAmount ?? null,
        currentStepNo: doc.currentStepNo,
        submittedAt: doc.submittedAt ?? null,
        slaDueAt,
        overdue: slaDueAt != null && new Date() > slaDueAt,
        intake: intake.get(doc.id) ?? NOT_RECEIVED,
      };
    });
    return { items, total: matched.length, page, limit };
  }

  /**
   * Finance's payables sheet of this reader's inbox: every document `pending` would list for the
   * same filters and search, with no page window. Built from THIS set rather than re-queried by
   * `DOC_VIEW` visibility, so the workbook can never hold a row the inbox would not, nor drop one it
   * shows.
   */
  async exportPayables(q: PendingInboxQueryDto = {}) {
    if (!this.documents) throw new Error('ApprovalInboxService was built without DocumentService');
    const matched = await this.actionableSet(q);
    return this.documents.payablesForIds(matched.map((a) => a.doc.id));
  }

  /**
   * The reader's actionable documents under the filters and search, unpaged — the one set both the
   * page and the export are cut from.
   *
   * The filters go into the read, before eligibility: they only narrow, eligibility does not depend
   * on them, and every document they drop is a route read and a resolver call not paid. The search
   * stays after eligibility because it also matches the requester, which is resolved per document.
   */
  private async actionableSet(q: PendingInboxQueryDto): Promise<Actionable[]> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    const now = new Date();

    const where: Record<string, unknown> = { company: companyId, status: DocStatus.IN_APPROVAL };
    Object.assign(where, await this.narrowing(q, companyId));

    const docs = await this.em.find(Document, where as FilterQuery<Document>, {
      populate: ['documentType', 'createdBy', 'company', 'workflow'],
      ...FILTER_OFF,
    });

    // Eligibility (incl. self-approval) is decided per-document in JS, so the page window
    // is applied to the fully-filtered set — `total` is the count the user can act on.
    const out: Array<Actionable & { requester: string }> = [];
    for (const doc of docs) {
      const step = await this.openStepFor(doc, userId);
      if (!step) continue;

      // SLA due time for the current step, in working hours from when THAT step opened.
      let slaDueAt: Date | null = null;
      const stepStart = step.startedAt ?? doc.submittedAt;
      if (step.slaHours && stepStart) {
        slaDueAt = await this.sla.stepDueAt(stepStart, step.slaHours, doc.company.id);
      }
      out.push({ doc, slaDueAt, requester: doc.createdBy.username });
    }

    // Searched BEFORE the page window, so a term reaches documents on every page of the queue —
    // an approver with more pending documents than fit on one page has no other way to find one.
    // Matched against what identifies a document: its number and who raised it.
    const term = q.search?.trim().toLowerCase();
    let matched = out;
    if (term) {
      const names = await requesterIdentities(this.em.fork(), out.map((a) => a.doc));
      matched = out.filter(
        (a) =>
          a.doc.docNo.toLowerCase().includes(term) ||
          a.requester.toLowerCase().includes(term) ||
          (names.get(a.doc.id)?.name ?? '').toLowerCase().includes(term),
      );
    }

    // Intake is DERIVED from the receive/reverse log, not a column, so it cannot go into the read
    // with the other filters; it is applied here, before the page window, like the search. Read
    // without a viewer: whether a document IS received does not depend on who asks.
    if (!q.intake) return matched;
    const intake = await intakeStateFor(this.em.fork(), matched.map((a) => a.doc.id));
    const wantReceived = q.intake === 'RECEIVED';
    return matched.filter((a) => (intake.get(a.doc.id)?.received ?? false) === wantReceived);
  }

  /**
   * The three filters as a `where` fragment. Department and amount are columns; the day range is
   * the company's calendar (as the pending summary reads it), `submittedTo` inclusive to the end of
   * that day. Amount bounds stay decimal strings — Postgres compares them as numerics.
   */
  private async narrowing(q: PendingInboxQueryDto, companyId: string): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {};
    if (q.departmentId) where.department = q.departmentId;

    if (q.submittedFrom || q.submittedTo) {
      const company = await this.em.findOne(Company, { id: companyId }, FILTER_OFF);
      const timezone = company?.timezone ?? 'Asia/Bangkok';
      const submittedAt: Record<string, Date> = {};
      if (q.submittedFrom) submittedAt.$gte = localMidnightInstant(q.submittedFrom.slice(0, 10), timezone);
      if (q.submittedTo) {
        submittedAt.$lte = new Date(localMidnightInstant(nextDay(q.submittedTo), timezone).getTime() - 1);
      }
      where.submittedAt = submittedAt;
    }

    const amount: Record<string, string> = {};
    if (q.minAmount != null) amount.$gte = q.minAmount;
    if (q.maxAmount != null) amount.$lte = q.maxAmount;
    if (Object.keys(amount).length) where.baseTotalAmount = amount;
    return where;
  }

  /**
   * The step this user may act on for this document right now, or null.
   *
   * The ONE implementation of "may I act" in the read path — the inbox and the documents list both
   * come through here, so a screen can never offer an action the other would refuse. It applies the
   * self-approval exclusion (invariant 8) before anything else and resolves eligibility with the
   * same `ApproverResolverService.eligible` the approve path itself uses, delegation and escalation
   * included.
   */
  private async openStepFor(doc: Document, userId: string): Promise<DocumentApprovalStep | null> {
    if (!doc.workflow || doc.createdBy.id === userId) return null; // self-approval excluded
    const step = await this.route.routeStep(doc.id, doc.currentStepNo);
    if (!step) return null;
    const actors = await this.resolver.eligible(step, doc);
    return actors.some((a) => a.userId === userId) ? step : null;
  }

  /**
   * Which of these documents the caller may act on.
   *
   * For the documents list, which shows an Approve action per row and must not offer one the
   * server would refuse. Answered for the ids on the visible page rather than by intersecting with
   * `pending()`: that read is paginated over a different set, so a document on list page 3 may sit
   * on inbox page 1 and the intersection would be wrong whenever either list runs past a page.
   *
   * Ids outside the active company simply do not come back from the read (invariant 1).
   */
  async actionable(documentIds: string[]): Promise<string[]> {
    if (!documentIds.length) return [];
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;

    const docs = await this.em.find(
      Document,
      { id: { $in: documentIds }, company: companyId, status: DocStatus.IN_APPROVAL },
      { populate: ['documentType', 'createdBy', 'company', 'workflow'], ...FILTER_OFF },
    );

    const out: string[] = [];
    for (const doc of docs) if (await this.openStepFor(doc, userId)) out.push(doc.id);
    return out;
  }
}

