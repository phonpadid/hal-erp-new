import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { AppUser, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalDelegation, WorkflowStep } from './approval.entities';
import type { Document } from '../document/document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

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

  async eligible(step: WorkflowStep, document: Document): Promise<EligibleActor[]> {
    const today = new Date().toISOString().slice(0, 10);
    const principals = await this.principals(step, document.company.id, today);

    const actors: EligibleActor[] = [];
    for (const principalId of principals) {
      actors.push({ userId: principalId }); // the principal may act if present
      const delegate = await this.activeDelegate(principalId, document, today);
      if (delegate) actors.push({ userId: delegate, delegatedFrom: principalId });
    }
    return actors;
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
  async principals(step: WorkflowStep, companyId: string, today = new Date().toISOString().slice(0, 10)): Promise<string[]> {
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
