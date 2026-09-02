import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalDelegation } from './approval.entities';
import type { Document } from '../document/document.entities';

const FILTER_OFF = { filters: { company: false } } as const;



/**
 * What resolution needs from a step: who it targets. Structural rather than `WorkflowStep`, so the
 * same resolver serves a CONFIGURED step (at submit, when the route is being written) and a
 * RECORDED one (`document_approval_step`, which every reader uses afterwards). The two carry the
 * same targets by construction — the recorded row is a copy of the configured one.
 */
export interface StepTarget {
  approverUser?: AppUser;
  approverRole?: Role;
  /**
   * Who an overdue step was escalated to, if it was. An additional eligible actor — escalation
   * changes WHO may act, never how many approvals the document needs.
   */
  escalatedToUser?: AppUser;
}

/** An actor allowed to act on a step; delegatedFrom is set when acting for a principal. */
export interface EligibleActor {
  userId: string;
  delegatedFrom?: string;
}

/**
 * Resolves who may act on a step: the targeted user or the holders of the targeted
 * company role, plus active delegates (one hop only — invariant 8: no chaining).
 */
@Injectable()
export class ApproverResolverService {
  constructor(private readonly em: EntityManager) {}

  async eligible(step: StepTarget, document: Document): Promise<EligibleActor[]> {
    const today = await this.companyDay(document.company.id);
    const principals = await this.principals(step, document.company.id, today);

    const actors: EligibleActor[] = [];
    for (const principalId of principals) {
      actors.push({ userId: principalId }); // the principal may act if present
      const delegate = await this.activeDelegate(principalId, document, today);
      if (delegate) actors.push({ userId: delegate, delegatedFrom: principalId });
    }
    // An escalated step gains an actor rather than losing its approval. The creator is never one:
    // no-self-approval holds after escalation exactly as it does after delegation (invariant 8).
    const escalatedTo = step.escalatedToUser?.id;
    if (escalatedTo && escalatedTo !== document.createdBy.id && !actors.some((a) => a.userId === escalatedTo)) {
      actors.push({ userId: escalatedTo });
    }
    return actors;
  }

  /**
   * Today, on the DOCUMENT COMPANY's calendar — never the server's UTC day.
   *
   * A delegation's window decides which side of a boundary a fact falls on, and `gl-journal`
   * settled that argument for `entry_date`: a date is the company's own day, resolved from
   * `company.timezone`. Read in UTC, a delegation written "to the 31st" for a company in UTC+7
   * stopped working at 07:00 on the 31st, local.
   *
   * The company is LOADED rather than read off the document's relation, which may be an
   * uninitialised reference — falling back to UTC when the timezone happens not to be populated
   * would put the bug back exactly where it was, and silently.
   */
  private async companyDay(companyId: string): Promise<string> {
    const company = await this.em.findOne(Company, { id: companyId }, FILTER_OFF);
    return localDateIn(new Date(), company?.timezone ?? 'UTC');
  }

  /**
   * The approver's superior, used as an escalation target. The current schema models no
   * reporting/manager relationship, so this always returns null and escalation forwards to
   * the next step. Seam for a future schema that adds reporting lines (e.g. employee.manager_id).
   */
  async superior(_userId: string, _companyId: string): Promise<string | null> {
    return null;
  }

  /** Just the principal approver ids (no delegates) — used for PARALLEL_ALL coverage. */
  async principals(step: StepTarget, companyId: string, today = new Date().toISOString().slice(0, 10)): Promise<string[]> {
    if (step.approverUser) return [step.approverUser.id];
    if (!step.approverRole) return [];
    const holders = await this.em.find(
      UserCompanyRole,
      {
        role: step.approverRole.id,
        company: companyId,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: today } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: today } }] },
        ],
      },
      { filters: { company: false }, populate: ['user'] },
    );
    return [...new Set(holders.map((h) => h.user.id))];
  }

  /** The active delegate for a principal on this document, or null. Not recursive. */
  private async activeDelegate(
    principalId: string,
    document: Document,
    today: string,
  ): Promise<string | null> {
    const del = await this.em.findOne(
      ApprovalDelegation,
      {
        delegator: principalId,
        company: document.company.id,
        status: 'ACTIVE',
        startDate: { $lte: today },
        endDate: { $gte: today },
        $or: [{ documentType: null }, { documentType: document.documentType.id }],
      },
      { filters: { company: false }, populate: ['delegate'] },
    );
    if (!del) return null;
    const base = document.baseTotalAmount ?? '0';
    if (del.amountLimit != null && Money.compare(base, del.amountLimit) > 0) return null;
    return (del.delegate as AppUser).id;
  }
}
