import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { pageParams, type Paginated } from '../../common/pagination/pagination';
import type { PendingInboxQueryDto } from './dto/workflow.dto';
import { DocStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import type { DocumentApprovalStep } from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { SlaService } from './sla.service';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PendingApproval {
  id: string;
  docNo: string;
  documentType: { code: string; name: string };
  requesterName: string;
  baseTotalAmount: string | null;
  currentStepNo: number | null;
  submittedAt: Date | null;
  slaDueAt: Date | null;
  overdue: boolean;
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
  ) {}

  async pending(q: PendingInboxQueryDto = {}): Promise<Paginated<PendingApproval>> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    const now = new Date();

    const docs = await this.em.find(
      Document,
      { company: companyId, status: DocStatus.IN_APPROVAL },
      { populate: ['documentType', 'createdBy', 'company', 'workflow'], ...FILTER_OFF },
    );

    // Eligibility (incl. self-approval) is decided per-document in JS, so the page window
    // is applied to the fully-filtered set — `total` is the count the user can act on.
    const out: PendingApproval[] = [];
    for (const doc of docs) {
      const step = await this.openStepFor(doc, userId);
      if (!step) continue;

      // SLA due time for the current step, in working hours from when THAT step opened.
      let slaDueAt: Date | null = null;
      const stepStart = step.startedAt ?? doc.submittedAt;
      if (step.slaHours && stepStart) {
        slaDueAt = await this.sla.stepDueAt(stepStart, step.slaHours, doc.company.id);
      }

      out.push({
        id: doc.id,
        docNo: doc.docNo,
        documentType: { code: doc.documentType.code, name: doc.documentType.name },
        requesterName: doc.createdBy.username,
        baseTotalAmount: doc.baseTotalAmount ?? null,
        currentStepNo: doc.currentStepNo,
        submittedAt: doc.submittedAt ?? null,
        slaDueAt,
        overdue: slaDueAt != null && now > slaDueAt,
      });
    }

    // Searched BEFORE the page window, so a term reaches documents on every page of the queue —
    // an approver with more pending documents than fit on one page has no other way to find one.
    // Matched against what the inbox actually shows to identify a document: its number and who
    // raised it.
    const term = q.search?.trim().toLowerCase();
    const matched = term
      ? out.filter(
          (a) =>
            a.docNo.toLowerCase().includes(term) ||
            a.requesterName.toLowerCase().includes(term),
        )
      : out;

    const { page, limit, offset } = pageParams(q);
    return { items: matched.slice(offset, offset + limit), total: matched.length, page, limit };
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

