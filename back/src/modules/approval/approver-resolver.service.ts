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

/** One question for `eligibleMany`: who may act on this step of this document. */
export interface EligibilityQuestion {
  step: StepTarget;
  document: Document;
}

/**
 * A `date` column as `YYYY-MM-DD`. Compared as text against the company's day, exactly as the SQL
 * used to compare it, whichever shape the driver hands back.
 */
function dayOf(v: string | Date): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

/**
 * Resolves who may act on a step: the targeted user or the holders of the targeted
 * company role, plus active delegates (one hop only — invariant 8: no chaining).
 *
 * Every rule lives in `eligibleMany`; `eligible` is the one-document case of it. The inbox asks for
 * every pending document in the company at once, and asking one document at a time cost a
 * company read, a role read and a delegation read per approver, per document — some 1,500 queries
 * per inbox open on production. Two implementations of who-may-approve would drift, so there is
 * one, and it reads in batches.
 */
@Injectable()
export class ApproverResolverService {
  constructor(private readonly em: EntityManager) {}

  async eligible(step: StepTarget, document: Document): Promise<EligibleActor[]> {
    return (await this.eligibleMany([{ step, document }]))[0];
  }

  /**
   * `eligible` for many steps at once, answered in input order. A fixed number of reads whatever
   * the number of questions: the companies' days, the role holders, the delegations.
   */
  async eligibleMany(questions: EligibilityQuestion[]): Promise<EligibleActor[][]> {
    if (!questions.length) return [];
    const companyIds = [...new Set(questions.map((q) => q.document.company.id))];
    const todayOf = await this.companyDays(companyIds);
    const roleIds = questions.map((q) => q.step.approverRole?.id).filter((id): id is string => !!id);
    const holders = await this.roleHolders(roleIds, companyIds);
    const principalsOf = questions.map((q) =>
      this.principalsFrom(q.step, q.document.company.id, todayOf.get(q.document.company.id)!, holders),
    );
    const delegations = await this.delegationsFrom([...new Set(principalsOf.flat())], companyIds);

    return questions.map(({ step, document }, i) => {
      const today = todayOf.get(document.company.id)!;
      const actors: EligibleActor[] = [];
      for (const principalId of principalsOf[i]) {
        actors.push({ userId: principalId }); // the principal may act if present
        const delegate = this.activeDelegate(principalId, document, today, delegations);
        if (delegate) actors.push({ userId: delegate, delegatedFrom: principalId });
      }
      // An escalated step gains an actor rather than losing its approval. The creator is never one:
      // no-self-approval holds after escalation exactly as it does after delegation (invariant 8).
      const escalatedTo = step.escalatedToUser?.id;
      if (escalatedTo && escalatedTo !== document.createdBy.id && !actors.some((a) => a.userId === escalatedTo)) {
        actors.push({ userId: escalatedTo });
      }
      return actors;
    });
  }

  /**
   * Today, on each DOCUMENT COMPANY's calendar — never the server's UTC day.
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
  private async companyDays(companyIds: string[]): Promise<Map<string, string>> {
    const companies = await this.em.find(Company, { id: { $in: companyIds } }, FILTER_OFF);
    const zoneOf = new Map(companies.map((c) => [c.id, c.timezone]));
    const now = new Date();
    return new Map(companyIds.map((id) => [id, localDateIn(now, zoneOf.get(id) ?? 'UTC')]));
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
    const holders = await this.roleHolders(step.approverRole ? [step.approverRole.id] : [], [companyId]);
    return this.principalsFrom(step, companyId, today, holders);
  }

  /** Every assignment of these roles in these companies, valid or not — validity is per company day. */
  private async roleHolders(roleIds: string[], companyIds: string[]): Promise<UserCompanyRole[]> {
    if (!roleIds.length) return [];
    return this.em.find(
      UserCompanyRole,
      { role: { $in: [...new Set(roleIds)] }, company: { $in: companyIds } },
      FILTER_OFF,
    );
  }

  /** The targeted user, else the holders of the targeted role in this company valid on `today`. */
  private principalsFrom(step: StepTarget, companyId: string, today: string, holders: UserCompanyRole[]): string[] {
    if (step.approverUser) return [step.approverUser.id];
    if (!step.approverRole) return [];
    const roleId = step.approverRole.id;
    const valid = holders.filter(
      (h) =>
        h.role.id === roleId &&
        h.company.id === companyId &&
        (h.validFrom == null || dayOf(h.validFrom) <= today) &&
        (h.validTo == null || dayOf(h.validTo) >= today),
    );
    return [...new Set(valid.map((h) => h.user.id))];
  }

  /** Every ACTIVE delegation from these principals in these companies, in a stable order. */
  private async delegationsFrom(principalIds: string[], companyIds: string[]): Promise<ApprovalDelegation[]> {
    if (!principalIds.length) return [];
    const rows = await this.em.find(
      ApprovalDelegation,
      { delegator: { $in: principalIds }, company: { $in: companyIds }, status: 'ACTIVE' },
      FILTER_OFF,
    );
    // Sorted here rather than by `orderBy`, which MikroORM can drop for entities already in the fork.
    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The active delegate for a principal on this document, or null. Not recursive. */
  private activeDelegate(
    principalId: string,
    document: Document,
    today: string,
    delegations: ApprovalDelegation[],
  ): string | null {
    const del = delegations.find(
      (d) =>
        d.delegator.id === principalId &&
        d.company.id === document.company.id &&
        dayOf(d.startDate) <= today &&
        dayOf(d.endDate) >= today &&
        (d.documentType == null || d.documentType.id === document.documentType.id),
    );
    if (!del) return null;
    const base = document.baseTotalAmount ?? '0';
    if (del.amountLimit != null && Money.compare(base, del.amountLimit) > 0) return null;
    return (del.delegate as AppUser).id;
  }
}
