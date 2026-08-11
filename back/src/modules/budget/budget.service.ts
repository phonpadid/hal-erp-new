import { EntityManager } from '@mikro-orm/postgresql';
import { wrap, type EntityDTO } from '@mikro-orm/core';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ControlPolicy } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { inTransaction } from '../../common/uow/unit-of-work';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Budget, BudgetControlPoint } from './budget.entities';
import { ToleranceLadder } from './tolerance-ladder';
import { DocumentType } from '../document/document.entities';
import { MOVEMENT_POST_ACTIONS } from './movement-doctype.resolver';
import type { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

/** Selection fields for a movement document type — no config/behavior leaks. */
export type MovementDocTypeOption = { id: string; code: string; name: string };
export type MovementDocTypes = {
  adjustIncrease: MovementDocTypeOption[];
  adjustDecrease: MovementDocTypeOption[];
  transfer: MovementDocTypeOption[];
};

const FILTER_OFF = { filters: { company: false } } as const;

/** Minimal budget shape for the document-creation picker — no amount/balance data. */
export interface SelectableBudget {
  id: string;
  budgetName?: string;
  glAccount: string;
}

/**
 * Budget registry. `amount_total` is set at creation and never overwritten to
 * reflect usage — available balance is derived from budget_txn (invariant 3).
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly em: EntityManager,
    private readonly accounts: AccountService,
    private readonly balance: BudgetBalanceService,
    private readonly coverage: BudgetCoverageService,
  ) {}

  async create(dto: CreateBudgetDto): Promise<Budget> {
    // The gl_account must reference an active, postable account in the active company
    // (chart-of-accounts). Resolve first; a bad code is a 400 before any insert.
    const account = await this.accounts.resolvePostable(dto.glAccount);
    // The budget and its coverage commit together. A budget that briefly exists with no
    // governing control point is a budget that briefly cannot be checked — and "briefly" is
    // exactly as long as it takes for a concurrent submit to spend against it unlimited.
    return inTransaction(this.em, async (tem) => {
      const budget = tem.create(Budget, {
        fiscalYear: tem.getReference(FiscalYear, dto.fiscalYearId),
        department: tem.getReference(Department, dto.departmentId),
        glAccount: dto.glAccount,
        account: tem.getReference(Account, account.id),
        budgetName: dto.budgetName,
        amountTotal: dto.amountTotal,
        status: 'ACTIVE',
      });
      await tem.persistAndFlush(budget);
      await this.ensureCovered(tem, budget, dto.tolerance);
      return budget;
    });
  }

  /**
   * Guarantee the coverage invariant for a newly created budget: if no active control point
   * already governs it, create a self-scoped one at the budget's own account and department.
   *
   * Self-scoped is the right default because it reproduces exactly what this budget's control
   * meant before control points existed — its own amount, its own policy — leaving "move the
   * control point upward" a deliberate later decision rather than a side effect of creation.
   */
  private async ensureCovered(
    tem: EntityManager,
    budget: Budget,
    tolerance?: unknown,
  ): Promise<void> {
    const existing = await this.coverage.controlPointsFor(budget.id, tem);
    if (existing.length) return;
    const fiscalYear = await tem.findOneOrFail(
      FiscalYear,
      { id: budget.fiscalYear.id },
      { ...FILTER_OFF, populate: ['company'] },
    );
    const cp = tem.create(BudgetControlPoint, {
      company: tem.getReference(Company, fiscalYear.company.id),
      fiscalYear: tem.getReference(FiscalYear, budget.fiscalYear.id),
      accountNode: tem.getReference(Account, budget.account!.id),
      departmentNode: tem.getReference(Department, budget.department.id),
      capAmount: undefined,
      // The caller's ladder when it gave one, otherwise block at the ceiling. The default is
      // written down rather than inferred: a control point that warns where everyone assumed it
      // blocks is invisible until something is overspent.
      toleranceJson: ToleranceLadder.stringify(
        tolerance === undefined
          ? ToleranceLadder.BLOCK_AT_CEILING
          : ToleranceLadder.parse(tolerance),
      ),
      isActive: true,
    });
    await tem.persistAndFlush(cp);
  }

  async update(id: string, dto: UpdateBudgetDto): Promise<Budget> {
    const budget = await this.get(id);
    if (dto.budgetName !== undefined) budget.budgetName = dto.budgetName;
    if (dto.status !== undefined) budget.status = dto.status;
    await this.em.flush();
    return budget;
  }

  // Budget has no company_id column; scope through fiscalYear.company (invariant 1).
  // Fork so the read never touches the global EntityManager outside a request context.
  async list(q: PaginationQueryDto = {}): Promise<Paginated<EntityDTO<Budget> & { available: string }>> {
    const companyId = RequestContext.companyId();
    const where = companyId ? { fiscalYear: { company: companyId } } : {};
    const em = this.em.fork();
    // Populate the company base currency so the list UI can format amounts to its
    // decimal_places (money rule) — same currency the detail read exposes.
    const page = await paginate(em, Budget, where, {
      ...FILTER_OFF,
      populate: ['fiscalYear', 'department', 'fiscalYear.company.baseCurrency'],
    }, q);
    // Attach the derived available balance per row in one batched pass (was an N+1 breakdown
    // call per row on the client). Serialize each entity to a POJO first: MikroORM's entity
    // serialization only emits mapped properties, so a bare assigned field would be dropped —
    // toJSON() gives a plain object (with the populated relations) we can safely extend.
    const available = await this.balance.availableFor(page.items.map((b) => b.id), em);
    return {
      ...page,
      items: page.items.map((b) => ({ ...wrap(b).toJSON(), available: available.get(b.id) ?? b.amountTotal })),
    };
  }

  /**
   * Budgets a document creator may charge a line to — gated on DOC_CREATE, not BUDGET_VIEW.
   * Returns only selection fields (id, name, GL): the projection never selects amount_total or
   * any derived balance, so this read cannot become a side channel for financial figures. Scoped
   * to the active company via fiscalYear.company (invariant 1) and limited to ACTIVE budgets.
   */
  async listSelectable(): Promise<SelectableBudget[]> {
    const companyId = RequestContext.companyId();
    const where = companyId
      ? { fiscalYear: { company: companyId }, status: 'ACTIVE' }
      : { status: 'ACTIVE' };
    const rows = await this.em.fork().find(Budget, where, {
      ...FILTER_OFF,
      fields: ['id', 'budgetName', 'glAccount'],
      orderBy: { glAccount: 'ASC' },
    });
    // Map explicitly so the wire shape is exactly {id, budgetName, glAccount} — no amount leaks.
    return rows.map((b) => ({ id: b.id, budgetName: b.budgetName, glAccount: b.glAccount }));
  }

  /**
   * Document types a user may choose when raising a budget movement, grouped by operation via
   * `post_action` (invariant 7: config, not a hardcoded code). Scoped to the active company
   * (invariant 1), active types only, selection fields only. A client uses this to decide
   * whether to prompt for a type (more than one) or proceed silently (zero or one).
   */
  async listMovementDocTypes(): Promise<MovementDocTypes> {
    const companyId = RequestContext.companyId();
    const rows = await this.em.fork().find(
      DocumentType,
      { postAction: { $in: [...MOVEMENT_POST_ACTIONS] }, company: companyId, isActive: true },
      { ...FILTER_OFF, fields: ['id', 'code', 'name', 'postAction'], orderBy: { code: 'ASC' } },
    );
    const opt = (t: DocumentType): MovementDocTypeOption => ({ id: t.id, code: t.code, name: t.name });
    return {
      adjustIncrease: rows.filter((t) => t.postAction === 'ADJUST_INCREASE').map(opt),
      adjustDecrease: rows.filter((t) => t.postAction === 'ADJUST_DECREASE').map(opt),
      transfer: rows.filter((t) => t.postAction === 'TRANSFER').map(opt),
    };
  }

  /**
   * Resolve the single ACTIVE budget for a `(fiscalYear, department, glAccount)` triple —
   * the unique key on `budget`, so this returns at most one row. Used during document-line
   * creation to derive a line's `budget_id` from the selected item's GL (invariant 7): the
   * requester picks the item, not the budget. Same selection-only projection as
   * {@link listSelectable} (no amount/balance leaks) and gated on DOC_CREATE at the edge.
   * Scoped to the active company via `fiscalYear.company` (invariant 1); returns null when
   * no ACTIVE budget matches so the caller can reject the line with a specific error.
   */
  async resolveSelectable(params: {
    glAccount: string;
    departmentId: string;
    fiscalYearId: string;
  }): Promise<SelectableBudget | null> {
    const companyId = RequestContext.companyId();
    const b = await this.em.fork().findOne(
      Budget,
      {
        glAccount: params.glAccount,
        department: params.departmentId,
        fiscalYear: companyId
          ? { id: params.fiscalYearId, company: companyId }
          : params.fiscalYearId,
        status: 'ACTIVE',
      },
      { ...FILTER_OFF, fields: ['id', 'budgetName', 'glAccount'] },
    );
    return b ? { id: b.id, budgetName: b.budgetName, glAccount: b.glAccount } : null;
  }

  async get(id: string): Promise<Budget> {
    const companyId = RequestContext.companyId();
    // Scope through the join, not a nested relation read (which isn't populated → would throw).
    const where = companyId ? { id, fiscalYear: { company: companyId } } : { id };
    // Populate the company base currency so the detail UI can label amounts (code + decimals).
    const budget = await this.em.fork().findOne(Budget, where, {
      ...FILTER_OFF,
      populate: ['fiscalYear', 'department', 'fiscalYear.company.baseCurrency'],
    });
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);
    return budget;
  }
}
