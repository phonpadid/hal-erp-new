import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { stepEngagesFor } from '@erp/shared';
import { Money } from '../../common/money/money';
import { Employee } from '../rbac/rbac.entities';
import { JobLevel } from '../job-level/job-level.entities';
import { WorkflowStep } from './approval.entities';
import type { Document } from '../document/document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** The requester's resolved position level: its `code` and seniority `rank` (both absent if none). */
export interface RequesterLevel {
  jobLevel?: string;
  rank?: number;
}

/**
 * Decides which workflow steps apply to a document: amount band
 * (`amount_min`/`amount_max`) AND requester position level. The level condition
 * (`workflow_step.condition_json`) is either an explicit `jobLevels` code list or a `minRank`
 * threshold compared against the requester's `employee.job_level` and its `job_level.rank`.
 * One workflow per dept+doctype; branching happens at the step level.
 */
@Injectable()
export class WorkflowStepResolver {
  constructor(private readonly em: EntityManager) {}

  /**
   * The requester's position level (code + rank), resolved from their employee record and the
   * company `job_level` master. Both fields are undefined when the requester has no employee, no
   * `job_level`, or the level no longer resolves to an active row (rank absent → `minRank` steps
   * skip them, exactly as an unknown level should).
   */
  async requesterLevel(document: Document, em: EntityManager = this.em): Promise<RequesterLevel> {
    const employee = await em.findOne(
      Employee,
      { user: document.createdBy.id, company: document.company.id },
      FILTER_OFF,
    );
    const code = employee?.jobLevel ?? undefined;
    if (!code) return {};
    const level = await em.findOne(
      JobLevel,
      { company: document.company.id, code, isActive: true },
      FILTER_OFF,
    );
    return { jobLevel: code, rank: level?.rank ?? undefined };
  }

  /** True when a step engages for this base amount and requester level. */
  stepMatches(step: WorkflowStep, base: string, requester: RequesterLevel): boolean {
    if (step.amountMin != null && Money.compare(base, step.amountMin) < 0) return false;
    if (step.amountMax != null && Money.compare(base, step.amountMax) > 0) return false;
    return stepEngagesFor(step.conditionJson, requester);
  }

  /**
   * Steps of the document's workflow that apply, in step order.
   *
   * `baseAmount` names the figure the bands are compared against, for the one caller that knows it
   * before the document does: submit computes the budget base and stamps it inside its write
   * transaction, but asks this question BEFORE that — above the transaction, so a document with
   * nowhere to route is refused without reserving anything. Reading the column there gives `'0'` on
   * a first submission and the PREVIOUS attempt's figure on a resubmission, so a workflow whose
   * lowest step carries an `amount_min` above zero refused every document it received however
   * large, and a resubmitted document could be judged on an amount it no longer carried.
   *
   * Routing calls this after the stamp and passes nothing, which is what it has always done. One
   * resolver, one rule, two callers that now agree: the alternative — the gate deriving the figure
   * its own way — is the second copy of the predicate this method exists to avoid.
   */
  async applicableSteps(
    document: Document,
    em: EntityManager = this.em,
    baseAmount?: string,
  ): Promise<WorkflowStep[]> {
    const steps = await em.find(
      WorkflowStep,
      { workflow: document.workflow.id },
      { orderBy: { stepNo: 'ASC' }, ...FILTER_OFF, populate: ['approverUser', 'approverRole'] },
    );
    // Compare bands against the budget base (BUDGET_RATE), so routing is stable against daily FX.
    const base = baseAmount ?? document.budgetBaseTotalAmount ?? document.baseTotalAmount ?? '0';
    const requester = await this.requesterLevel(document, em);
    return steps.filter((s) => this.stepMatches(s, base, requester));
  }
}
