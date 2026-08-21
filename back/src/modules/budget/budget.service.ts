import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../common/money/money';
import { wrap, type EntityDTO } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Budget, BudgetNode } from './budget.entities';
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
  code: string;
  budgetName?: string;
  parentId?: string;
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
  ) {}

  /**
   * Propose a budget. The row is DRAFT: not spendable, and governed by nothing.
   *
   * Coverage is NOT established here any more. It is established when a budget plan carrying this
   * budget is approved (`BudgetPlanService.activate`), because that is the moment the budget
   * becomes spendable and therefore the first moment there is anything to check. Minting a control
   * point now would configure a ceiling for a budget nobody has agreed to, and would let whoever
   * proposed it decide the ladder for every budget that later falls under the same node.
   *
   * The coverage invariant is unchanged and still holds: it is owed to ACTIVE budgets, and a DRAFT
   * one is not ACTIVE.
   */
  async create(dto: CreateBudgetDto): Promise<Budget> {
    // A GL account is optional now and, when given, must still reference an active postable
    // account in the active company. Resolved first so a bad code is a 400 before any insert.
    const account = dto.glAccount ? await this.accounts.resolvePostable(dto.glAccount) : undefined;
    const em = this.em.fork();
    // The node is the budget's identity, and it must already exist: where in the plan the money
    // sits is a decision about the plan, not something a budget invents on the way in.
    const node = await em.findOne(
      BudgetNode,
      { id: dto.nodeId, fiscalYear: dto.fiscalYearId },
      FILTER_OFF,
    );
    if (!node) {
      throw new BadRequestException(
        `Budget node ${dto.nodeId} is not in the requested fiscal year`,
      );
    }
    const budget = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, dto.fiscalYearId),
      department: em.getReference(Department, dto.departmentId),
      node,
      glAccount: dto.glAccount,
      account: account ? em.getReference(Account, account.id) : undefined,
      budgetName: dto.budgetName,
      amountTotal: dto.amountTotal,
      status: 'DRAFT',
    });
    // One insert, so no explicit transaction: there is no second write that has to commit with it.
    // The partial unique index refuses a second live budget on the same three dimensions, which is
    // what stops two plans proposing the same line — decided by the database rather than by a
    // check-then-insert race here.
    await em.persistAndFlush(budget);
    return budget;
  }

  async update(id: string, dto: UpdateBudgetDto): Promise<Budget> {
    const budget = await this.get(id);
    if (dto.budgetName !== undefined) budget.budgetName = dto.budgetName;
    // An empty string clears the hint rather than storing one: a budget that posts to several
    // accounts records none, and there has to be a way back to that from a wrong single account.
    if (dto.glAccount !== undefined) budget.glAccount = dto.glAccount || undefined;
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
      // The node comes with the row because it is the budget's identity: a list that showed a
      // name and an amount but not the plan code would be a list a department head cannot check
      // against their own plan. `node.parent` comes too, so the screen can present the tree
      // without a request per row.
      populate: ['fiscalYear', 'department', 'fiscalYear.company.baseCurrency', 'node', 'node.parent'],
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
      fields: ['id', 'budgetName', 'node'],
      populate: ['node'],
      orderBy: { node: { code: 'ASC' } },
    });
    // No filtering needed: categories are `budget_node` rows, so nothing here can be one.
    // Map explicitly so the wire shape is exactly {id, code, budgetName, parentId} — no amount leaks.
    return rows.map((b) => ({
      id: b.id,
      code: b.node.code,
      budgetName: b.budgetName ?? b.node.name,
      parentId: b.node.parent?.id,
    }));
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

  async get(id: string): Promise<Budget> {
    const companyId = RequestContext.companyId();
    // Scope through the join, not a nested relation read (which isn't populated → would throw).
    const where = companyId ? { id, fiscalYear: { company: companyId } } : { id };
    // Populate the company base currency so the detail UI can label amounts (code + decimals).
    const budget = await this.em.fork().findOne(Budget, where, {
      ...FILTER_OFF,
      // The node comes with the row because it is the budget's identity: a list that showed a
      // name and an amount but not the plan code would be a list a department head cannot check
      // against their own plan. `node.parent` comes too, so the screen can present the tree
      // without a request per row.
      populate: ['fiscalYear', 'department', 'fiscalYear.company.baseCurrency', 'node', 'node.parent'],
    });
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);
    return budget;
  }
}
