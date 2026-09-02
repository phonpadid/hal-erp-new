import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../common/money/money';
import { wrap, type EntityDTO, type FilterQuery } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Budget, BudgetNode } from './budget.entities';
import { DocumentType } from '../document/document.entities';
import { MOVEMENT_POST_ACTIONS } from './movement-doctype.resolver';
import type { BudgetListQueryDto, CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

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
  /**
   * The category this budget sits under, by the parent node's own code and name. Optional
   * together with `parentId`: a node with no parent carries none of the three.
   *
   * Carried because `parentId` on its own names a row the caller never receives — the parent is
   * usually a category holding no money, so it is not a selectable budget. Without these the
   * picker has no way to group ninety budgets whose names differ by a single word.
   */
  parentCode?: string;
  parentName?: string;
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
  async list(
    q: BudgetListQueryDto = {},
  ): Promise<Paginated<EntityDTO<Budget> & { available: string }>> {
    const companyId = RequestContext.companyId();
    const scoped: FilterQuery<Budget> = companyId ? { fiscalYear: { company: companyId } } : {};
    // Both filters NARROW the scoped predicate and cannot replace it, the same property that makes
    // `withSearch` safe to repeat across endpoints. A department id from another company therefore
    // matches nothing — not "found in the wrong company", simply not found, because company scope
    // (invariant 1) has already been applied above.
    const narrowed: FilterQuery<Budget> = {
      ...(scoped as object),
      ...(q.departmentId ? { department: q.departmentId } : {}),
      ...(q.status ? { status: q.status } : {}),
    } as FilterQuery<Budget>;
    // A department's plan runs to hundreds of rows, so the term goes to the server. Searched by
    // what a person reads on the row: the node's plan code and the budget's own name.
    const where = withSearch(narrowed, q.search, ['node.code', 'budgetName']);
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
      /**
       * A TOTAL order, and the reason is not tidiness.
       *
       * Without one this read had no ORDER BY at all, so Postgres was free to return the rows of
       * each LIMIT/OFFSET query in a different order. Measured on the customer's 496 budgets:
       * paging the list end to end returned 7 rows twice and never returned others at all. A
       * reader could page through all 25 pages and still not reach a budget that exists.
       *
       * `node.code` because the plan code is the budget's identity and the order a department
       * head reads their own plan in. `id` behind it because node code is not unique across
       * departments, and a tie broken differently on each query is the same defect again.
       */
      orderBy: { node: { code: 'ASC' }, id: 'ASC' },
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
  async listSelectable(departmentId?: string): Promise<SelectableBudget[]> {
    const companyId = RequestContext.companyId();
    const where: FilterQuery<Budget> = companyId
      ? { fiscalYear: { company: companyId }, status: 'ACTIVE' }
      : { status: 'ACTIVE' };
    // Narrowed to one department when the caller names one. A requester offered every department's
    // budgets is offered choices their own document cannot carry, and the list is long enough that
    // the wrong one is easy to pick — this is the read's only job, so it does it here rather than
    // leaving each screen to filter afterwards.
    if (departmentId) (where as Record<string, unknown>).department = departmentId;
    const rows = await this.em.fork().find(Budget, where, {
      ...FILTER_OFF,
      fields: ['id', 'budgetName', 'node'],
      // `node.parent` too: the parent's code and name travel with the budget because `parentId`
      // alone cannot be resolved by the caller. A parent is usually a CATEGORY node, which holds no
      // money and is therefore never itself a selectable budget — so it never appears in this
      // response. Measured on the customer's largest department, 85 of 92 budgets have such a
      // parent, leaving the client an id that matches nothing it was given.
      populate: ['node', 'node.parent'],
      orderBy: { node: { code: 'ASC' } },
    });
    // No filtering needed: categories are `budget_node` rows, so nothing here can be one.
    //
    // Mapped explicitly so the wire shape is exactly
    // {id, code, budgetName, parentId, parentCode, parentName} — no amount leaks. The category's
    // NAME is a label, not a financial figure: this read is gated on DOC_CREATE rather than
    // BUDGET_VIEW precisely so a requester who may not read budget figures can still raise a
    // document, and it stays that way. Nothing derived from `amount_total` or `budget_txn` belongs
    // here, however convenient it would be in the picker.
    return rows.map((b) => ({
      id: b.id,
      code: b.node.code,
      budgetName: b.budgetName ?? b.node.name,
      parentId: b.node.parent?.id,
      parentCode: b.node.parent?.code,
      // Absent rather than empty when there is no parent, so "has no category" stays
      // distinguishable from "has a category with no name".
      parentName: b.node.parent?.name,
    }));
  }

  /**
   * The departments a reader can narrow the budget list by: those holding at least one budget in
   * the active company.
   *
   * Gated with the budget list itself (`BUDGET_VIEW`), NOT with the department directory. That
   * directory needs `DEPARTMENT_VIEW`, which a holder of `BUDGET_VIEW` need not have — so sourcing
   * this dropdown there would present an empty filter to exactly the department heads it exists to
   * serve. Same reasoning `listSelectable` already applies one gate down.
   *
   * Only departments that HOLD a budget, so a reader can never pick an option that yields nothing.
   * Identifying fields only: a filter's option list has no business carrying figures, and a list of
   * names cannot become a side channel for what a budget is worth.
   */
  async listFilterDepartments(): Promise<Array<{ id: string; deptCode: string; name: string }>> {
    const companyId = RequestContext.companyId();
    const where: FilterQuery<Budget> = companyId ? { fiscalYear: { company: companyId } } : {};
    const rows = await this.em.fork().find(Budget, where, {
      ...FILTER_OFF,
      fields: ['id', 'department'],
      populate: ['department'],
    });
    // Deduplicated here rather than by a DISTINCT: the set is one row per budget in one company,
    // and a map keyed by id is both clearer and cheaper than a second query shape to maintain.
    const byId = new Map<string, { id: string; deptCode: string; name: string }>();
    for (const budget of rows) {
      const d = budget.department;
      if (!byId.has(d.id)) byId.set(d.id, { id: d.id, deptCode: d.deptCode, name: d.name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
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
