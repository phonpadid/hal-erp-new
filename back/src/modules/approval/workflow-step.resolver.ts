import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { parseStepJobLevels } from '@erp/shared';
import { Money } from '../../common/money/money';
import { Employee } from '../rbac/rbac.entities';
import { WorkflowStep } from './approval.entities';
import type { Document } from '../document/document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Decides which workflow steps apply to a document: amount band
 * (`amount_min`/`amount_max`) AND requester position level
 * (`workflow_step.condition_json` jobLevels vs `employee.job_level`).
 * One workflow per dept+doctype; branching happens at the step level.
 */
@Injectable()
export class WorkflowStepResolver {
  constructor(private readonly em: EntityManager) {}

  /** The requester's position level, resolved from their employee record (or undefined). */
  async requesterJobLevel(document: Document, em: EntityManager = this.em): Promise<string | undefined> {
    const employee = await em.findOne(
      Employee,
      { user: document.createdBy.id, company: document.company.id },
      FILTER_OFF,
    );
    return employee?.jobLevel ?? undefined;
  }

  /** True when a step engages for this base amount and requester level. */
  stepMatches(step: WorkflowStep, base: string, jobLevel?: string): boolean {
    if (step.amountMin != null && Money.compare(base, step.amountMin) < 0) return false;
    if (step.amountMax != null && Money.compare(base, step.amountMax) > 0) return false;
    const jobLevels = parseStepJobLevels(step.conditionJson);
    if (jobLevels.length > 0) {
      if (!jobLevel || !jobLevels.includes(jobLevel)) return false;
    }
    return true;
  }

  /** Steps of the document's workflow that apply, in step order. */
  async applicableSteps(document: Document, em: EntityManager = this.em): Promise<WorkflowStep[]> {
    const steps = await em.find(
      WorkflowStep,
      { workflow: document.workflow.id },
      { orderBy: { stepNo: 'ASC' }, ...FILTER_OFF, populate: ['approverUser', 'approverRole'] },
    );
    // Compare bands against the budget base (BUDGET_RATE), so routing is stable against daily FX.
    const base = document.budgetBaseTotalAmount ?? document.baseTotalAmount ?? '0';
    const jobLevel = await this.requesterJobLevel(document, em);
    return steps.filter((s) => this.stepMatches(s, base, jobLevel));
  }
}
