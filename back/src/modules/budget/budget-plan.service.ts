import { EntityManager } from '@mikro-orm/postgresql';
import type { PostAction } from '@erp/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { lockForUpdate } from '../../common/uow/unit-of-work';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import {
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetCoverageService } from './budget-coverage.service';
import { Budget, BudgetControlPoint, BudgetMovement } from './budget.entities';
import { resolveMovementDocType } from './movement-doctype.resolver';
import { ToleranceLadder } from './tolerance-ladder';
import type { CreateBudgetPlanDto } from './dto/budget-plan.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The post_action that identifies a budget plan (invariant 7: config, not a hardcoded type code).
 *
 * Deliberately absent from MOVEMENT_POST_ACTIONS: that list feeds the Adjust/Transfer type picker,
 * and a plan is not a movement a user picks from a budget's detail panel.
 */
export const PLAN_POST_ACTION = 'ACTIVATE_BUDGET' as const satisfies PostAction;

/** Budget status values. A budget is spendable in exactly one of them. */
const DRAFT = 'DRAFT';
const ACTIVE = 'ACTIVE';
const REJECTED = 'REJECTED';

/** A plan as the web app reads it — the document's own state plus the lines it proposes. */
export interface BudgetPlanView {
  id: string;
  docNo: string;
  status: string;
  lines: Array<{
    budgetId: string;
    budgetName?: string;
    glAccount: string;
    departmentId: string;
    amountTotal: string;
    budgetStatus: string;
    reason?: string;
  }>;
}

/**
 * Budget plans — the approval gate in front of setting a budget.
 *
 * Setting a ceiling is the largest financial decision this module makes, and it used to be the
 * only one nobody approved: moving one kip between two budgets took a document and a workflow,
 * while creating a budget of any size took a single call. A plan closes that: budgets are created
 * DRAFT, a plan proposes them, and full approval is what puts them in force.
 *
 * Like the adjustment and transfer services, intake writes a `document` plus its `budget_movement`
 * rows and NOTHING else. Unlike them, approval writes no `budget_txn` either: a budget's opening
 * figure is `budget.amount_total`, not a transaction (invariant 3), so bringing one into force
 * moves no money.
 */
@Injectable()
export class BudgetPlanService {
  constructor(
    private readonly em: EntityManager,
    private readonly deptDocTypes: DeptDocTypeService,
    private readonly numbering: NumberingService,
    private readonly coverage: BudgetCoverageService,
  ) {}

  // ---- Intake ----------------------------------------------------------------------------

  async create(dto: CreateBudgetPlanDto): Promise<{ documentId: string }> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;

    const budgetIds = dto.lines.map((l) => l.budgetId);
    const duplicate = budgetIds.find((id, i) => budgetIds.indexOf(id) !== i);
    if (duplicate) {
      throw new BadRequestException(
        `Budget ${duplicate} appears on this plan more than once`,
      );
    }

    const em = this.em.fork();
    const budgets = await em.find(
      Budget,
      { id: { $in: budgetIds } },
      { ...FILTER_OFF, populate: ['fiscalYear', 'department'] },
    );
    const byId = new Map(budgets.map((b) => [b.id, b]));

    for (const id of budgetIds) {
      const budget = byId.get(id);
      // Scoped through fiscalYear.company — `budget` has no company_id of its own (invariant 1).
      // A budget of another company is reported as not found rather than as a permission problem:
      // the caller must not learn it exists.
      if (!budget || budget.fiscalYear.company.id !== companyId) {
        throw new BadRequestException(
          `Budget ${id} not found in the active company`,
        );
      }
      if (budget.status !== DRAFT) {
        throw new BadRequestException(
          `Budget ${id} is ${budget.status}, so a plan cannot propose it. Only a DRAFT budget can be planned.`,
        );
      }
    }

    // Every line must sit in the routing department's subtree. Checked in one query rather than
    // per line: the answer is a set membership, and asking the tree once is both cheaper and
    // impossible to get inconsistent between lines.
    const lineDepartmentIds = [...new Set(budgets.map((b) => b.department.id))];
    const inSubtree = await this.departmentsUnder(
      em,
      dto.departmentId,
      lineDepartmentIds,
    );
    const stray = budgets.find((b) => !inSubtree.has(b.department.id));
    if (stray) {
      throw new BadRequestException(
        `Budget ${stray.id} is in department ${stray.department.id}, which is outside the plan's routing department. A plan is approved by the routing department's workflow, so it can only propose budgets that department has authority over.`,
      );
    }

    const docType = await resolveMovementDocType(
      em,
      companyId,
      PLAN_POST_ACTION,
      dto.documentTypeId,
      'Budget plan',
    );
    // The type must be enabled for the routing department, or the document is unroutable.
    const mapping = await this.deptDocTypes.resolve(
      dto.departmentId,
      docType.id,
    );

    const company = await em.findOne(Company, { id: companyId }, FILTER_OFF);
    const year = new Date().getUTCFullYear();
    const prefix = NumberingService.buildPrefix(
      docType.code,
      company!.code,
      year,
    );
    const docNo = await this.numbering.next(
      companyId,
      docType.id,
      year,
      prefix,
    );

    const document = em.create(Document, {
      docNo,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, dto.departmentId),
      documentType: em.getReference(DocumentType, docType.id),
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, userId),
      exchangeRate: '1',
      // The sum of what the plan proposes, so amount-banded workflow steps can route it. Summed
      // with Money, not with `+` on numbers: these are DECIMAL strings and stay that way.
      totalAmount: budgets.reduce(
        (sum, b) => Money.add(sum, b.amountTotal),
        '0',
      ),
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    });
    em.persist(document);

    for (const line of dto.lines) {
      em.persist(
        em.create(BudgetMovement, {
          company: em.getReference(Company, companyId),
          document,
          movementType: PLAN_POST_ACTION,
          toBudget: em.getReference(Budget, line.budgetId),
          amount: byId.get(line.budgetId)!.amountTotal,
          reason: line.reason,
          createdAt: new Date(),
        }),
      );
    }

    await em.flush();
    return { documentId: document.id };
  }

  /**
   * One plan: its document plus the budgets it proposes, so a DRAFT budget's detail can answer
   * "why can nothing be spent against this" by naming the plan and where its approval stands.
   *
   * Company-scoped through the document (invariant 1). Returns null rather than throwing so the
   * caller can decide between 404 and "no plan proposed this budget".
   */
  async get(documentId: string): Promise<BudgetPlanView | null> {
    const companyId = RequestContext.companyId();
    const em = this.em.fork();
    const document = await em.findOne(
      Document,
      companyId ? { id: documentId, company: companyId } : { id: documentId },
      { ...FILTER_OFF, populate: ['documentType'] },
    );
    if (!document || document.documentType.postAction !== PLAN_POST_ACTION)
      return null;
    const movements = await em.find(
      BudgetMovement,
      { document: document.id, movementType: PLAN_POST_ACTION },
      { ...FILTER_OFF, populate: ['toBudget'] },
    );
    const budgets = await em.find(
      Budget,
      { id: { $in: movements.map((m) => m.toBudget!.id) } },
      { ...FILTER_OFF, populate: ['department'] },
    );
    const byId = new Map(budgets.map((b) => [b.id, b]));
    return {
      id: document.id,
      docNo: document.docNo,
      status: document.status,
      lines: movements.map((m) => {
        const budget = byId.get(m.toBudget!.id)!;
        return {
          budgetId: budget.id,
          budgetName: budget.budgetName,
          glAccount: budget.glAccount,
          departmentId: budget.department.id,
          amountTotal: budget.amountTotal,
          budgetStatus: budget.status,
          reason: m.reason,
        };
      }),
    };
  }

  /** The plan that proposed a budget, if one did. Used by the budget detail read. */
  async planForBudget(
    budgetId: string,
  ): Promise<{ id: string; docNo: string; status: string } | null> {
    const em = this.em.fork();
    const movement = await em.findOne(
      BudgetMovement,
      { toBudget: budgetId, movementType: PLAN_POST_ACTION },
      { ...FILTER_OFF, populate: ['document'] },
    );
    if (!movement) return null;
    const { id, docNo, status } = movement.document;
    return { id, docNo, status };
  }

  // ---- Activation ------------------------------------------------------------------------

  /**
   * Put every budget on an approved plan into force, atomically.
   *
   * Runs inside the approval transaction (`tem`), so either the whole year's plan takes effect or
   * none of it does and the terminal transition rolls back with it. A half-active fiscal year is
   * the failure this exists to prevent: spending documents would hit budgets that exist but are
   * not yet in force, and "no budget" is the wrong answer to "not approved yet".
   *
   * SEQUENCE — writes NO `budget_txn` and no `quota_usage`. A budget's opening figure is
   * `budget.amount_total`, not a transaction (invariant 3).
   *
   *   1. read the plan's movements, ordered deterministically
   *   2. refuse a fiscal year that is not OPEN
   *   3. resolve, for ALL of them at once, which existing control points would govern them
   *   4. lock those control points FOR UPDATE, ascending by id
   *   5. flip each budget to ACTIVE and mint the deduplicated set of missing control points
   *   6. re-verify coverage from the database, then commit
   *
   * LOCKING — step 4 uses ascending id order because that is the order
   * `BudgetLedgerService.lockControlPoints` uses. Two transactions taking a shared set in the same
   * total order cannot form a cycle, so a plan activating while documents are spending waits
   * rather than deadlocks. Activation raises a control point's ceiling (its ceiling is the sum of
   * the budgets it governs), which is why it must serialize against reservation at all — even
   * though it cannot over-commit anything. Control points MINTED here take no lock: no other
   * transaction can see them before commit.
   */
  async activate(document: Document, tem: EntityManager): Promise<void> {
    const movements = await tem.find(
      BudgetMovement,
      { document: document.id, movementType: PLAN_POST_ACTION },
      { ...FILTER_OFF, populate: ['toBudget'] },
    );
    if (!movements.length) {
      throw new BadRequestException(
        `No budget_movement rows for budget plan ${document.id}`,
      );
    }

    const budgetIds = movements.map((m) => m.toBudget!.id);
    const budgets = await tem.find(
      Budget,
      { id: { $in: budgetIds } },
      { ...FILTER_OFF, populate: ['fiscalYear', 'department', 'account'] },
    );

    for (const budget of budgets) {
      if (budget.fiscalYear.status !== 'OPEN') {
        throw new BadRequestException(
          `Fiscal year ${budget.fiscalYear.year} is ${budget.fiscalYear.status}, so budget ${budget.id} cannot be put in force. Activating a budget in a closed year would create spendable budget for a finished period.`,
        );
      }
      if (!budget.account) {
        throw new BadRequestException(
          `Budget ${budget.id} has no resolved account, so no control point can be scoped to it`,
        );
      }
    }

    const ordered = await this.deterministicOrder(tem, budgets);

    // Resolve coverage for the WHOLE plan before minting anything. Not per line: the resolver
    // memoises per EntityManager, so a loop would read the empty array it cached before the
    // previous line's insert, mint a duplicate control point for the same node, and fail on the
    // unique constraint at flush — far from the line that caused it.
    const coverage = await this.coverage.resolveControlPoints(
      ordered.map((b) => b.id),
      tem,
    );

    const existingIds = [
      ...new Set([...coverage.values()].flat().map((cp) => cp.id)),
    ].sort();
    for (const id of existingIds) {
      await lockForUpdate(tem, BudgetControlPoint, { id }, FILTER_OFF);
    }

    for (const budget of ordered) budget.status = ACTIVE;

    // Mint the fewest control points that cover the plan.
    //
    // Not one per uncovered budget: a point minted for a budget high in the department tree also
    // governs the plan's budgets below it, and adding a narrower point on top of one that already
    // covers them would be a second ceiling nobody asked for. So mint for the shallowest budget
    // still uncovered, then ask again — each round removes at least one budget from `pending`, and
    // usually more.
    //
    // Asking again means going back to the database. The resolver memoises per EntityManager and
    // the answer has just changed, so the memo is dropped each round: reading the cached pre-mint
    // answer is exactly how a loop would mint a duplicate point for a node it already served and
    // fail on the unique constraint at flush, far from the line that caused it.
    let pending = ordered.filter((b) => !(coverage.get(b.id) ?? []).length);
    while (pending.length) {
      const budget = pending[0];
      tem.persist(
        tem.create(BudgetControlPoint, {
          company: tem.getReference(Company, budget.fiscalYear.company.id),
          fiscalYear: tem.getReference(FiscalYear, budget.fiscalYear.id),
          accountNode: tem.getReference(Account, budget.account!.id),
          departmentNode: tem.getReference(Department, budget.department.id),
          capAmount: undefined,
          // Blocks at its ceiling. The plan authors no ladder: the control point it would
          // configure does not exist while the plan is being written, and a ladder held on a
          // budget in the meantime would be a value meaningless the moment it was used. Ladders
          // are set on the control point itself. The default is written down rather than inferred
          // — a point that warns where everyone assumed it blocks is invisible until something is
          // overspent.
          toleranceJson: ToleranceLadder.stringify(
            ToleranceLadder.BLOCK_AT_CEILING,
          ),
          isActive: true,
        }),
      );
      await tem.flush();
      this.coverage.invalidate(tem);
      const after = await this.coverage.resolveControlPoints(
        pending.map((b) => b.id),
        tem,
      );
      const left = pending.filter((b) => !(after.get(b.id) ?? []).length);
      /* istanbul ignore next -- the point just minted is self-scoped to `pending[0]`, so it always
         governs at least that budget; this only fires if the coverage resolver and the minting
         rule ever disagree, and looping forever would be worse than saying so. */
      if (left.length === pending.length) {
        throw new BadRequestException(
          `Budget ${budget.id} is still uncovered after a control point was created for it. Refusing to activate rather than loop.`,
        );
      }
      pending = left;
    }

    // Verify against the database, not against the loop above — the check exists to catch a budget
    // this routine believed it covered and did not.
    this.coverage.invalidate(tem);
    const final = await this.coverage.resolveControlPoints(
      ordered.map((b) => b.id),
      tem,
    );
    const uncovered = ordered.find((b) => !(final.get(b.id) ?? []).length);
    if (uncovered) {
      throw new BadRequestException(
        `Budget ${uncovered.id} would be ACTIVE with no governing control point, so its spending could never be checked. The plan is not activated.`,
      );
    }
  }

  // ---- Rejection -------------------------------------------------------------------------

  /**
   * Mark an unapproved plan's budgets REJECTED. Called from the shared reject/cancel release hook.
   *
   * The rows are marked, not deleted: `budget_movement.to_budget_id` references them, and the
   * record of what was proposed and turned down is the reason budgets are routed through approval
   * at all. Marking them is also what frees their dimension slot — the uniqueness index ignores
   * REJECTED rows — so a line that was refused can be proposed again.
   *
   * Nothing is released. A plan's document type has `requires_budget` false, so it never held a
   * reservation.
   *
   * Idempotent: a budget already ACTIVE or already REJECTED is left alone. Re-running the hook
   * must not undo an activation.
   */
  async markRejected(documentId: string, tem: EntityManager): Promise<void> {
    const movements = await tem.find(
      BudgetMovement,
      { document: documentId, movementType: PLAN_POST_ACTION },
      { ...FILTER_OFF, populate: ['toBudget'] },
    );
    if (!movements.length) return;
    const budgets = await tem.find(
      Budget,
      { id: { $in: movements.map((m) => m.toBudget!.id) }, status: DRAFT },
      FILTER_OFF,
    );
    for (const budget of budgets) budget.status = REJECTED;
    await tem.flush();
  }

  // ---- Helpers ---------------------------------------------------------------------------

  /**
   * Of `candidateIds`, those that are `rootId` or a descendant of it via `department.parent_dept_id`.
   */
  private async departmentsUnder(
    em: EntityManager,
    rootId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (!candidateIds.length) return new Set();
    const rows = await em.getConnection().execute<{ start_id: string }[]>(
      `
      with recursive up as (
        select d.id as start_id, d.id as node_id, d.parent_dept_id
          from department d
         where d.id in (${candidateIds.map(() => '?').join(',')})
        union all
        select up.start_id, p.id, p.parent_dept_id
          from department p
          join up on p.id = up.parent_dept_id
      )
      select distinct start_id from up where node_id = ?
      `,
      [...candidateIds, rootId],
      'all',
      // Without the transaction context this runs on a pooled connection outside the caller's
      // transaction and cannot see its uncommitted writes.
      em.getTransactionContext(),
    );
    return new Set(rows.map((r) => r.start_id));
  }

  /**
   * The order lines are processed in: department depth (shallowest first), then `dept_code`, then
   * `gl_account`.
   *
   * It matters because when several lines would mint the same control point, the first one wins —
   * and "the first one" must not depend on row order out of the database. Shallowest-first also
   * makes the winner the least surprising one: the control point lands as high in the department
   * tree as the plan reaches.
   */
  private async deterministicOrder(
    tem: EntityManager,
    budgets: Budget[],
  ): Promise<Budget[]> {
    const deptIds = [...new Set(budgets.map((b) => b.department.id))];
    const rows = await tem
      .getConnection()
      .execute<{ start_id: string; depth: string }[]>(
        `
      with recursive up as (
        select d.id as start_id, d.id as node_id, d.parent_dept_id, 0 as depth
          from department d
         where d.id in (${deptIds.map(() => '?').join(',')})
        union all
        select up.start_id, p.id, p.parent_dept_id, up.depth + 1
          from department p
          join up on p.id = up.parent_dept_id
      )
      select start_id, max(depth) as depth from up group by start_id
      `,
        deptIds,
        'all',
        tem.getTransactionContext(),
      );
    const depthOf = new Map(rows.map((r) => [r.start_id, Number(r.depth)]));
    return [...budgets].sort((a, b) => {
      const byDepth =
        (depthOf.get(a.department.id) ?? 0) -
        (depthOf.get(b.department.id) ?? 0);
      if (byDepth) return byDepth;
      const byDept = a.department.deptCode.localeCompare(b.department.deptCode);
      if (byDept) return byDept;
      return a.glAccount.localeCompare(b.glAccount);
    });
  }
}
