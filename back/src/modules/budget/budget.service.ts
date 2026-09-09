import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../common/money/money';
import { wrap, type EntityDTO, type FilterQuery } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionBudget } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { GlPostingStatus, Scope } from '../../common/enums';
import { ScopeService } from '../rbac/scope.service';
import { DocumentPermissions as DocP } from '../document/permissions';
import { sharedNodeIds } from './shared-nodes';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { GlPostingAttempt } from '../gl/gl-posting.entities';
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
  /** Money the whole company draws on: offered to every department, owned by one of them. */
  isShared: boolean;
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
  /**
   * The account this budget's spending posts to, so a caller can tell which budgets carry a given
   * account without a second read. An account CODE, not a figure: it is already returned to
   * MASTER_VIEW holders by {@link BudgetGlOption}, and it says nothing about what the budget is
   * worth — the no-amounts rule this shape exists to keep is untouched.
   *
   * Absent, not empty, when the budget records none: a budget whose spending splits across several
   * accounts names no single one, and an empty string would match an item that has no GL either.
   *
   * Offering it is not derivation. The server still refuses to choose a budget from a line's
   * account (one account is charged by many budgets); a client that uses this to prefill a picker
   * still sends an explicit `budget_id` that submit validates on its own terms.
   */
  glAccount?: string;
}

/**
 * A budget offered as the account an ITEM's spending posts to.
 *
 * The master-data screen sets `item_company.default_gl_account`, and an admin knows that account by
 * the budget it belongs to, not by its code. So the picker is phrased in budgets and what it stores
 * is still the account: a budget cannot be an item's identity (it is keyed by fiscal year and
 * department, and an item is neither), while the account it posts to is stable across both.
 *
 * Which is also why several rows here can carry the same `glAccount` — one account is charged by
 * many budgets (invariant behind {@link SelectableBudget}'s existence). The caller collapses them;
 * this read reports what the plan actually says.
 *
 * No amounts, deliberately: it is gated by MASTER_VIEW, and a master-data admin need not be able to
 * read budget figures to name an account.
 */
export interface BudgetGlOption {
  glAccount: string;
  code: string;
  budgetName?: string;
  departmentName: string;
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
    /**
     * The granted scope of `DOC_CREATE`, which decides which budgets the picker may offer.
     *
     * Defaulted, and it is the same object either way: `ScopeService` holds no state and reads only
     * `RequestContext`, so an instance built here and the one Nest injects answer identically. The
     * default exists so that three dozen hand-constructed services in the suites — most of them
     * testing things that have nothing to do with scope — did not all have to be edited to pass a
     * collaborator with nothing in it. Nest still injects the provided one; see
     * `budget-control.module.ts`.
     */
    private readonly scope: ScopeService = new ScopeService(),
  ) {}

  /**
   * Available balance for a set of budgets, batched — the ONE derivation, exposed for readers
   * outside this module.
   *
   * A pass-through rather than a second implementation: the balance formula is invariant 3, and a
   * caller computing it for itself is how two screens come to disagree about the same pot.
   */
  availableFor(budgetIds: string[], em?: EntityManager): Promise<Map<string, string>> {
    return this.balance.availableFor(budgetIds, em);
  }

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
    const em = this.em.fork();
    const budget = await this.draftFor(em, dto);
    // The partial unique index refuses a second live budget on the same dimensions, which is what
    // stops two plans proposing the same line — decided by the database rather than by a
    // check-then-insert race here.
    await em.flush();
    return budget;
  }

  /**
   * Build a `DRAFT` budget in the CALLER'S entity manager, validated but not yet flushed.
   *
   * Split out of `create` so proposing a budget can be one transaction with raising the plan that
   * carries it. It used to be a standalone insert, and the comment it carried — "One insert, so no
   * explicit transaction: there is no second write that has to commit with it" — was true of this
   * method and false of the operation it is half of. The web app called this, then called the plan
   * intake; when the second failed the first had already committed, leaving a `DRAFT` budget no
   * plan carries: money that cannot be spent, cannot be deleted (budgets are financial records and
   * have no delete by design) and cannot be proposed again, because the dimension index refuses a
   * second row and `REJECTED` — the one status that frees it — is not reachable from the product.
   * Budget `1.106` sat in exactly that state on the customer's database.
   *
   * Deliberately does NOT flush: the caller decides when, which is how the insert can be ordered
   * before the numbering lock and rolled back with everything else.
   */
  async draftFor(em: EntityManager, dto: CreateBudgetDto): Promise<Budget> {
    // A GL account is optional now and, when given, must still reference an active postable
    // account in the active company. Resolved first so a bad code is a 400 before any insert.
    const account = dto.glAccount ? await this.accounts.resolvePostable(dto.glAccount) : undefined;
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
    return em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, dto.fiscalYearId),
      department: em.getReference(Department, dto.departmentId),
      node,
      glAccount: dto.glAccount,
      account: account ? em.getReference(Account, account.id) : undefined,
      budgetName: dto.budgetName,
      amountTotal: dto.amountTotal,
      status: 'DRAFT',
    });
  }

  /**
   * Edit a budget's name, GL account or status.
   *
   * Reads and writes in ONE entity manager. It used to read through `get()`, which answers from
   * `this.em.fork()`, and then call `this.em.flush()` — a manager that has never seen the entity
   * the caller just mutated. Every edit was a silent no-op: the response carried the new values,
   * because they were assigned to the returned object, and the database kept the old ones. It
   * surfaced here because this change depends on the one edit that has to work — naming the GL
   * account a document needs to charge the budget.
   */
  async update(id: string, dto: UpdateBudgetDto): Promise<Budget> {
    const em = this.em.fork();
    const companyId = RequestContext.companyId();
    // Scope through the join, matching `get()`: a budget has no company_id of its own (invariant 1).
    const budget = await em.findOne(
      Budget,
      companyId ? { id, fiscalYear: { company: companyId } } : { id },
      { ...FILTER_OFF, populate: ['fiscalYear', 'department', 'fiscalYear.company.baseCurrency', 'node', 'node.parent'] },
    );
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);
    /**
     * Before anything else is written, so a refused transition leaves the budget as it was rather
     * than half-edited — the name kept, the account untouched. This used to be
     * `budget.status = dto.status` further down, after both had already been assigned.
     *
     * The refusal names both statuses because neither alone is actionable: told only that ACTIVE
     * is not allowed, the reader cannot see that it is the budget's own REJECTED that forbids it,
     * and the answer — propose the line again — is not reachable from the message.
     */
    if (dto.status !== undefined && !canTransitionBudget(budget.status, dto.status)) {
      throw new BadRequestException(
        `A budget in ${budget.status} cannot be moved to ${dto.status}.`,
      );
    }
    if (dto.budgetName !== undefined) budget.budgetName = dto.budgetName;
    const hadAccount = !!budget.account;
    if (dto.glAccount !== undefined) {
      /**
       * Resolve the code to the account, the way `draftFor` does on the way in.
       *
       * This wrote only the string. `account_id` — the column the ledger debits and the one submit
       * now refuses a document without — was set at create and never again, so the edit form could
       * name an account all day and the budget stayed unpostable. Resolved first, so an unknown,
       * inactive or non-postable code is a 400 before anything is assigned.
       *
       * An empty string still clears both: a wrong single account has to have a way back.
       */
      const account = dto.glAccount ? await this.accounts.resolvePostable(dto.glAccount) : undefined;
      budget.glAccount = dto.glAccount || undefined;
      budget.account = account;
    }
    if (dto.status !== undefined) budget.status = dto.status;
    /**
     * Naming the account revives the postings that wanted it.
     *
     * The bound on retries parks a posting at `FAILED` after five sweeps, and only `GL_POST_RETRY`
     * could return it — a code the accounting role does not hold, on a screen separate from the one
     * that fixes the cause. So every posting blocked for want of this account stayed parked after
     * the account existed. The holder of `BUDGET_MANAGE` who fixes the cause clears the effect.
     *
     * Only unset → set. Swapping one account for another revives nothing: those postings were never
     * blocked, and `journal_entry`'s uniqueness refuses a second entry for a settled source anyway.
     *
     * In this unit of work on purpose — one flush, so an update that fails cannot leave postings
     * re-queued for an account that was never saved. `lastError` is left standing: the record of
     * what went wrong outlives the fix.
     */
    if (!hadAccount && budget.account) {
      const blocked = await em.find(GlPostingAttempt, {
        blockedByBudget: budget.id,
        status: GlPostingStatus.FAILED,
      }, FILTER_OFF);
      for (const row of blocked) {
        row.status = GlPostingStatus.PENDING;
        row.attempts = 0;
      }
    }
    await em.flush();
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
      items: page.items.map((b) => ({
        ...wrap(b).toJSON(),
        available: available.get(b.id) ?? b.amountTotal,
      })),
    };
  }

  /**
   * Budgets a document creator may charge a line to — gated on DOC_CREATE, not BUDGET_VIEW.
   * Returns only selection fields (id, name, GL): the projection never selects amount_total or
   * any derived balance, so this read cannot become a side channel for financial figures. Scoped
   * to the active company via fiscalYear.company (invariant 1) and limited to ACTIVE budgets.
   *
   * WHICH budgets is decided by the caller's granted `Scope` for `DOC_CREATE`, plus the shared
   * nodes — never by a department the client picks for itself.
   *
   * It used to be exactly that: the read took a department and the wizard filled it from the
   * signed-in user's own, which hardcoded DEPARTMENT behaviour for everybody however widely they
   * had been granted. The company's budget officer holds `DOC_CREATE` at COMPANY and sits in
   * `ພະແນກງົບປະມານ`, which holds no budget because a budget department administers the plan rather
   * than spending it — so every `requires_budget` document was unsubmittable for the one person
   * whose job is keying the year's spending, and the picker said nothing.
   *
   * `departmentId` survives as a FILTER: it narrows within what the scope already allows and can
   * never widen it, the same property that makes the list's filters safe to compose.
   */
  async listSelectable(departmentId?: string): Promise<SelectableBudget[]> {
    const companyId = RequestContext.companyId();
    const where: FilterQuery<Budget> = companyId
      ? { fiscalYear: { company: companyId }, status: 'ACTIVE' }
      : { status: 'ACTIVE' };
    // The scope the caller was granted DOC_CREATE at. DEPARTMENT pins them to their own; COMPANY
    // and GROUP add no row filter (company isolation is already applied above and is never
    // replaced). `scopeWhere` fails safe to OWN for an ungranted code, which has no meaning for a
    // budget — the guard on the route has already refused such a caller — so only the department
    // half is read here.
    const ownDepartment =
      this.scope.scopeFor(DocP.DOC_CREATE) === Scope.DEPARTMENT
        ? RequestContext.departmentId()
        : undefined;

    // Nodes carrying money the whole company draws on, inheritance applied. Asked for once, and
    // used twice below: to widen a department-pinned caller's list, and to tell every returned
    // budget which kind it is.
    const em = this.em.fork();
    const nodes = await em.find(
      BudgetNode,
      companyId ? { fiscalYear: { company: companyId } } : {},
      { ...FILTER_OFF, fields: ['parent', 'isShared'] },
    );
    const shared = sharedNodeIds(
      nodes.map((n) => ({ id: n.id, parentId: n.parent?.id, isShared: n.isShared })),
    );

    if (ownDepartment) {
      // Their own department's money PLUS the shared. Shared widens; it never replaces — read the
      // other way round, this sentence would quietly take a department's own budgets away from it.
      // `departmentId` is ignored here on purpose: a filter cannot widen a scope.
      (where as Record<string, unknown>).$or = [
        { department: ownDepartment },
        { node: { $in: [...shared] } },
      ];
    } else if (departmentId) {
      // A caller who may see more, choosing to see less. Means exactly what it says: that
      // department's budgets, shared ones included only if they belong to it.
      (where as Record<string, unknown>).department = departmentId;
    }
    const rows = await em.find(Budget, where, {
      ...FILTER_OFF,
      fields: ['id', 'budgetName', 'node', 'glAccount'],
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
    // {id, code, budgetName, parentId, parentCode, parentName, glAccount} — no amount leaks. Both
    // additions to the original three are LABELS, not figures: the category's NAME says which
    // branch of the plan a budget hangs from, and `glAccount` says which account its spending
    // posts to. This read is gated on DOC_CREATE rather than BUDGET_VIEW precisely so a requester
    // who may not read budget figures can still raise a document, and it stays that way. Nothing
    // derived from `amount_total` or `budget_txn` belongs here, however convenient it would be in
    // the picker.
    return rows.map((b) => ({
      id: b.id,
      code: b.node.code,
      budgetName: b.budgetName ?? b.node.name,
      // The second use of `shared`: inheritance is already applied in the set, so a budget hanging
      // under a shared category is marked shared even though its own node's flag is false.
      isShared: shared.has(b.node.id),
      parentId: b.node.parent?.id,
      parentCode: b.node.parent?.code,
      // Absent rather than empty when there is no parent, so "has no category" stays
      // distinguishable from "has a category with no name".
      parentName: b.node.parent?.name,
      // Same reasoning one line up: absent rather than empty when the budget records no account,
      // so "spends across several accounts" stays distinguishable from an account named by the
      // empty string — which is also what an item with no GL would carry.
      glAccount: b.glAccount ?? undefined,
    }));
  }

  /**
   * Active budgets that name an account, for the item-master GL picker — see {@link BudgetGlOption}.
   *
   * Narrowed to one fiscal year (the caller passes the open one) because a budget's identity is
   * per-year: listing every year would offer the same category once per year it has ever existed,
   * and every one of those rows would set the same account anyway.
   *
   * Budgets with no `gl_account` are omitted rather than returned unusable. A budget records none
   * exactly when its spending posts to several accounts (a vehicle instalment splits into principal
   * and interest), and there is no single account such a budget could give an item.
   */
  async listGlOptions(fiscalYearId?: string): Promise<BudgetGlOption[]> {
    const companyId = RequestContext.companyId();
    const where: FilterQuery<Budget> = {
      status: 'ACTIVE',
      glAccount: { $ne: null },
      ...(fiscalYearId
        ? { fiscalYear: fiscalYearId }
        : companyId
          ? { fiscalYear: { company: companyId } }
          : {}),
    };
    const rows = await this.em.fork().find(Budget, where, {
      ...FILTER_OFF,
      fields: ['id', 'budgetName', 'glAccount', 'node', 'department'],
      populate: ['node', 'department'],
      orderBy: { node: { code: 'ASC' } },
    });
    return rows
      .filter((b) => b.glAccount)
      .map((b) => ({
        glAccount: b.glAccount!,
        code: b.node.code,
        budgetName: b.budgetName ?? b.node.name,
        departmentName: b.department.name,
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
   * The fiscal years a budget may be PROPOSED for.
   *
   * Exists because authorizing a read by the endpoint that happens to own it, rather than by the
   * act it serves, locked the budget officer out of the form built for them. The create form read
   * its fiscal years from `GET /fiscal-years`, which requires `FISCAL_YEAR_MANAGE` — an
   * organisation-administration permission a budget officer has no reason to hold. `LATTANAPHONE`
   * holds `BUDGET_MANAGE` and not that, so the picker answered 403 and the form could not be
   * filled in at all.
   *
   * `BudgetService.listFilterDepartments` already made this call once, for the budget list's
   * department filter, and wrote down why. This is the same reasoning for the same reason, one
   * screen over.
   *
   * Scoped to the active company (invariant 1). Identifying fields only: a picker's option list has
   * no business carrying anything else, and the whole `fiscal_year` record is more than the form
   * needs to name a year.
   */
  async listSelectableFiscalYears(): Promise<
    Array<{ id: string; year: number; status: string; startDate: string; endDate: string }>
  > {
    const companyId = RequestContext.companyId();
    const rows = await this.em.fork().find(
      FiscalYear,
      companyId ? { company: companyId } : {},
      { ...FILTER_OFF, orderBy: { year: 'DESC' } },
    );
    return rows.map((f) => ({
      id: f.id,
      year: f.year,
      status: f.status,
      // The dates come along because a budget belongs to a year and a reader picking one wants to
      // see which. They are not figures.
      startDate: f.startDate,
      endDate: f.endDate,
    }));
  }

  /**
   * The departments a budget may be PROPOSED for: every ACTIVE department of the active company.
   *
   * Deliberately NOT `listFilterDepartments`. That read returns only departments that already HOLD
   * a budget, which is right for a filter — a filter must never offer an option that yields
   * nothing — and exactly backwards here: a department's FIRST budget is what this form exists to
   * propose, so sourcing the picker there would make an unbudgeted department unbudgetable through
   * the UI.
   *
   * Inactive departments are left out: a budget proposed for one could be approved into a
   * department that no longer operates.
   */
  async listSelectableDepartments(): Promise<Array<{ id: string; deptCode: string; name: string }>> {
    const companyId = RequestContext.companyId();
    const rows = await this.em.fork().find(
      Department,
      companyId ? { company: companyId, isActive: true } : { isActive: true },
      { ...FILTER_OFF, orderBy: { deptCode: 'ASC' } },
    );
    return rows.map((d) => ({ id: d.id, deptCode: d.deptCode, name: d.name }));
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
