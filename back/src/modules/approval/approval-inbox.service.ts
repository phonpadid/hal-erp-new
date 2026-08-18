import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { pageParams, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { DocStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
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

  async pending(q: PaginationQueryDto = {}): Promise<Paginated<PendingApproval>> {
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
      if (!doc.workflow || doc.createdBy.id === userId) continue; // self-approval excluded
      const step = await this.route.routeStep(doc.id, doc.currentStepNo);
      if (!step) continue;
      const actors = await this.resolver.eligible(step, doc);
      if (!actors.some((a) => a.userId === userId)) continue;

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

    const { page, limit, offset } = pageParams(q);
    return { items: out.slice(offset, offset + limit), total: out.length, page, limit };
  }
}
