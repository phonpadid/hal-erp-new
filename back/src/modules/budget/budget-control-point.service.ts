import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Account } from '../accounting/accounting.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetControlPoint } from './budget.entities';
import { ToleranceLadder, type ToleranceRung } from './tolerance-ladder';
import type { BalanceBreakdown } from './budget-balance.service';

const FILTER_OFF = { filters: { company: false } } as const;

export interface ControlPointView {
  id: string;
  fiscalYearId: string;
  accountNodeId: string;
  accountNodeCode: string;
  accountNodeName: string;
  departmentNodeId: string;
  departmentNodeCode: string;
  departmentNodeName: string;
  capAmount: string | null;
  tolerance: ToleranceRung[];
  isActive: boolean;
}

/**
 * Administration of `budget_control_point` — the configuration that decides WHERE availability is
 * checked. Reuses `BUDGET_MANAGE` / `BUDGET_VIEW`; no new permission code exists for it, because
 * moving a control point is budget administration by another name.
 */
@Injectable()
export class BudgetControlPointService {
  constructor(
    private readonly em: EntityManager,
    private readonly coverage: BudgetCoverageService,
    private readonly balance: BudgetBalanceService,
  ) {}

  async create(dto: {
    fiscalYearId: string;
    accountNodeId: string;
    departmentNodeId: string;
    tolerance: unknown;
    capAmount?: string | null;
  }): Promise<ControlPointView> {
    const companyId = this.requireCompany();
    const rungs = ToleranceLadder.parse(dto.tolerance);
    this.rejectCap(dto.capAmount);
    return inTransaction(this.em, async (tem) => {
      // Both nodes must belong to the active company (invariant 1). Checked here rather than
      // trusted from the payload: a control point keyed to another company's node would govern
      // nothing and quietly leave budgets uncovered.
      await this.requireOwnNode(tem, Account, dto.accountNodeId, companyId, 'account node');
      await this.requireOwnNode(tem, Department, dto.departmentNodeId, companyId, 'department node');
      await this.requireOwnFiscalYear(tem, dto.fiscalYearId, companyId);

      const cp = tem.create(BudgetControlPoint, {
        company: tem.getReference(Company, companyId),
        fiscalYear: tem.getReference(FiscalYear, dto.fiscalYearId),
        accountNode: tem.getReference(Account, dto.accountNodeId),
        departmentNode: tem.getReference(Department, dto.departmentNodeId),
        capAmount: undefined,
        toleranceJson: ToleranceLadder.stringify(rungs),
        isActive: true,
      });
      await tem.persistAndFlush(cp);
      return this.view(tem, cp.id);
    });
  }

  async update(
    id: string,
    dto: { tolerance?: unknown; capAmount?: string | null; isActive?: boolean },
  ): Promise<ControlPointView> {
    const companyId = this.requireCompany();
    this.rejectCap(dto.capAmount);
    return inTransaction(this.em, async (tem) => {
      const cp = await this.requireOwn(tem, id, companyId);
      if (dto.tolerance !== undefined) {
        cp.toleranceJson = ToleranceLadder.stringify(ToleranceLadder.parse(dto.tolerance));
      }
      if (dto.isActive === false && cp.isActive) {
        await this.refuseIfItStrands(tem, id);
        cp.isActive = false;
      } else if (dto.isActive === true) {
        cp.isActive = true;
      }
      await tem.flush();
      return this.view(tem, cp.id);
    });
  }

  async deactivate(id: string): Promise<ControlPointView> {
    return this.update(id, { isActive: false });
  }

  async remove(id: string): Promise<void> {
    const companyId = this.requireCompany();
    await inTransaction(this.em, async (tem) => {
      const cp = await this.requireOwn(tem, id, companyId);
      await this.refuseIfItStrands(tem, id);
      await tem.removeAndFlush(cp);
    });
  }

  async list(fiscalYearId?: string): Promise<ControlPointView[]> {
    const companyId = this.requireCompany();
    const em = this.em.fork();
    const where = fiscalYearId
      ? { company: companyId, fiscalYear: fiscalYearId }
      : { company: companyId };
    const rows = await em.find(BudgetControlPoint, where, {
      ...FILTER_OFF,
      populate: ['accountNode', 'departmentNode'],
    });
    return rows.map((cp) => this.toView(cp));
  }

  /** The derived balance at a control point — same components as a budget's breakdown. */
  async balanceOf(id: string): Promise<BalanceBreakdown & { governedBudgetCount: number }> {
    const companyId = this.requireCompany();
    const em = this.em.fork();
    const cp = await this.requireOwn(em, id, companyId);
    const governed = await this.coverage.budgetsGovernedBy(cp.id, em);
    const breakdown = await this.balance.breakdownAt(governed, cp.capAmount ?? null, em);
    return { ...breakdown, governedBudgetCount: governed.length };
  }

  /** Governing control points of one budget, with each one's available — for the budget detail. */
  async governing(budgetId: string): Promise<(ControlPointView & { available: string })[]> {
    const companyId = this.requireCompany();
    const em = this.em.fork();
    const governing = await this.coverage.controlPointsFor(budgetId, em);
    const out: (ControlPointView & { available: string })[] = [];
    for (const g of governing) {
      const cp = await em.findOne(
        BudgetControlPoint,
        { id: g.id, company: companyId },
        { ...FILTER_OFF, populate: ['accountNode', 'departmentNode'] },
      );
      if (!cp) continue; // another company's point can never govern this budget anyway
      const governed = await this.coverage.budgetsGovernedBy(cp.id, em);
      const { available } = await this.balance.balanceAt(governed, cp.capAmount ?? null, em);
      out.push({ ...this.toView(cp), available });
    }
    return out;
  }

  /**
   * Deactivating or deleting the last point covering an ACTIVE budget is refused. This is the
   * enforcement that matters most: an uncovered budget raises no error when it is spent against,
   * it simply stops being checked, so one configuration edit could disable budget control across
   * a company invisibly.
   */
  private async refuseIfItStrands(tem: EntityManager, id: string): Promise<void> {
    const stranded = await this.coverage.budgetsStrandedByDeactivating(id, tem);
    if (stranded.length) {
      throw new BadRequestException(
        `This control point is the only one governing ${stranded.length} ACTIVE budget(s) (e.g. ${stranded[0]}). Removing it would leave their spending unchecked. Create a covering control point first.`,
      );
    }
  }

  private rejectCap(capAmount?: string | null): void {
    if (capAmount !== undefined && capAmount !== null) {
      throw new BadRequestException(
        'cap_amount is reserved and must be null: a node ceiling that differs from the rollup of the budgets it governs needs a parent/child reconciliation rule that does not exist yet',
      );
    }
  }

  private requireCompany(): string {
    const companyId = RequestContext.companyId();
    if (!companyId) throw new BadRequestException('No active company in context');
    return companyId;
  }

  private async requireOwn(
    em: EntityManager,
    id: string,
    companyId: string,
  ): Promise<BudgetControlPoint> {
    const cp = await em.findOne(
      BudgetControlPoint,
      { id, company: companyId },
      { ...FILTER_OFF, populate: ['accountNode', 'departmentNode'] },
    );
    if (!cp) throw new NotFoundException(`Budget control point ${id} not found`);
    return cp;
  }

  private async requireOwnNode(
    em: EntityManager,
    entity: typeof Account | typeof Department,
    id: string,
    companyId: string,
    label: string,
  ): Promise<void> {
    const found = await em.findOne(entity as never, { id, company: companyId } as never, FILTER_OFF);
    if (!found) {
      throw new BadRequestException(`${label} ${id} does not exist in the active company`);
    }
  }

  private async requireOwnFiscalYear(
    em: EntityManager,
    id: string,
    companyId: string,
  ): Promise<void> {
    const fy = await em.findOne(FiscalYear, { id, company: companyId }, FILTER_OFF);
    if (!fy) throw new BadRequestException(`Fiscal year ${id} does not exist in the active company`);
  }

  private async view(em: EntityManager, id: string): Promise<ControlPointView> {
    const cp = await em.findOneOrFail(
      BudgetControlPoint,
      { id },
      { ...FILTER_OFF, populate: ['accountNode', 'departmentNode'] },
    );
    return this.toView(cp);
  }

  private toView(cp: BudgetControlPoint): ControlPointView {
    return {
      id: cp.id,
      fiscalYearId: cp.fiscalYear.id,
      accountNodeId: cp.accountNode.id,
      accountNodeCode: cp.accountNode.code,
      accountNodeName: cp.accountNode.name,
      departmentNodeId: cp.departmentNode.id,
      departmentNodeCode: cp.departmentNode.deptCode,
      departmentNodeName: cp.departmentNode.name,
      capAmount: cp.capAmount ?? null,
      tolerance: ToleranceLadder.parseJson(cp.toleranceJson),
      isActive: cp.isActive,
    };
  }
}
