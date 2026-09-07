import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { sharedNodeIds } from './shared-nodes';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Budget, BudgetNode } from './budget.entities';
import type { CreateBudgetNodeDto, UpdateBudgetNodeDto } from './dto/budget-node.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** A node as the screens read it, with the count that tells structure from leaf. */
export interface BudgetNodeView {
  id: string;
  code: string;
  name?: string;
  parentId?: string;
  fiscalYearId: string;
  /** Budgets hanging off this node — a category has none of its own. */
  budgetCount: number;
  /** Nodes beneath it. Zero means a line; more than zero means a category. */
  childCount: number;
  /** Marked on THIS node: somebody said this place in the plan carries shared money. */
  isShared: boolean;
  /**
   * Shared because an ANCESTOR is marked, not this node. Two different facts, so two fields: the
   * screen offers to un-mark the node that was marked, and explains the ones that inherited it.
   */
  sharedByAncestor: boolean;
}

/**
 * The structure of a budget plan: department → category → line.
 *
 * A node is NOT a budget, which is the point of it having a service of its own. A category has no
 * amount, is charged by nothing, and is approved by nobody on its own. Money is `budget`; where the
 * money sits in the plan is here.
 */
@Injectable()
export class BudgetNodeService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
  ) {}

  async create(dto: CreateBudgetNodeDto): Promise<BudgetNodeView> {
    const em = this.scope.forActiveCompany();
    await this.requireOwnFiscalYear(em, dto.fiscalYearId);
    const parent = dto.parentId
      ? await this.requireParent(em, dto.parentId, dto.fiscalYearId)
      : undefined;
    await this.requireCodeFree(em, dto.fiscalYearId, dto.code);

    const node = em.create(BudgetNode, {
      fiscalYear: em.getReference(FiscalYear, dto.fiscalYearId),
      code: dto.code,
      name: dto.name,
      parent,
    });
    await em.persistAndFlush(node);
    return this.view(em, node.id);
  }

  /**
   * Rename or re-parent a node. The `code` is deliberately not editable: documents and history
   * refer to a budget by the code of the node its money sits at, and rewriting it would rewrite
   * what those records appear to say.
   */
  async update(id: string, dto: UpdateBudgetNodeDto): Promise<BudgetNodeView> {
    const em = this.scope.forActiveCompany();
    const node = await this.get(em, id);
    if (dto.name !== undefined) node.name = dto.name;
    if (dto.parentId !== undefined) {
      node.parent = dto.parentId
        ? await this.requireParent(em, dto.parentId, node.fiscalYear.id, node.id)
        : undefined;
    }
    // Marking a node shares every budget at or beneath it, which is the point: the customer's
    // shared money is already grouped under `1.100` and `1.400`, so two marks cover the lot.
    if (dto.isShared !== undefined) node.isShared = dto.isShared;
    await em.flush();
    return this.view(em, node.id);
  }

  /** Every node of a fiscal year, for the tree pickers and the admin screens. */
  async list(fiscalYearId?: string): Promise<BudgetNodeView[]> {
    const em = this.scope.forActiveCompany();
    const companyId = RequestContext.companyId();
    const where: Record<string, unknown> = {};
    if (fiscalYearId) where.fiscalYear = companyId ? { id: fiscalYearId, company: companyId } : fiscalYearId;
    else if (companyId) where.fiscalYear = { company: companyId };

    const nodes = await em.find(BudgetNode, where, { ...FILTER_OFF, orderBy: { code: 'ASC' } });
    return this.viewAll(em, nodes);
  }

  private async view(em: EntityManager, id: string): Promise<BudgetNodeView> {
    const node = await this.get(em, id);
    return (await this.viewAll(em, [node]))[0];
  }

  /**
   * Counted in two queries for the whole set rather than two per node: these screens render a
   * department's entire tree at once, and a per-row count is the N+1 the list reads exist to avoid.
   */
  private async viewAll(em: EntityManager, nodes: BudgetNode[]): Promise<BudgetNodeView[]> {
    if (!nodes.length) return [];
    const ids = nodes.map((n) => n.id);
    const budgets = await em.find(Budget, { node: { $in: ids } }, { ...FILTER_OFF, fields: ['node'] });
    const children = await em.find(
      BudgetNode,
      { parent: { $in: ids } },
      { ...FILTER_OFF, fields: ['parent'] },
    );
    // Inheritance needs the ancestors, which may not be in `nodes` — `view()` passes exactly one.
    // One extra query for the whole fiscal year, then the walk resolves the set in a single pass.
    const fiscalYearIds = [...new Set(nodes.map((n) => n.fiscalYear.id))];
    const kin = await em.find(
      BudgetNode,
      { fiscalYear: { $in: fiscalYearIds } },
      { ...FILTER_OFF, fields: ['parent', 'isShared'] },
    );
    const shared = sharedNodeIds(
      kin.map((n) => ({ id: n.id, parentId: n.parent?.id, isShared: n.isShared })),
    );

    const budgetCount = new Map<string, number>();
    for (const b of budgets) budgetCount.set(b.node.id, (budgetCount.get(b.node.id) ?? 0) + 1);
    const childCount = new Map<string, number>();
    for (const c of children) {
      const pid = c.parent!.id;
      childCount.set(pid, (childCount.get(pid) ?? 0) + 1);
    }
    return nodes.map((n) => ({
      id: n.id,
      code: n.code,
      name: n.name,
      parentId: n.parent?.id,
      fiscalYearId: n.fiscalYear.id,
      budgetCount: budgetCount.get(n.id) ?? 0,
      childCount: childCount.get(n.id) ?? 0,
      isShared: n.isShared,
      // Shared, but not because of this node. The screen offers to un-mark what was marked and
      // explains the rest, so "I am the mark" and "something above me is" cannot be conflated.
      sharedByAncestor: shared.has(n.id) && !n.isShared,
    }));
  }

  private async get(em: EntityManager, id: string): Promise<BudgetNode> {
    const node = await em.findOne(BudgetNode, { id }, { ...FILTER_OFF, populate: ['parent'] });
    if (!node) throw new NotFoundException(`Budget node ${id} not found`);
    return node;
  }

  /**
   * A parent must sit in the same fiscal year, and must not make the node its own ancestor.
   *
   * The chain is WALKED rather than inferred from the code, because the code cannot carry depth:
   * in this organisation's own plan `1.1` is a category and `1.101` a line beneath it, and both
   * carry exactly one dot.
   */
  private async requireParent(
    em: EntityManager,
    parentId: string,
    fiscalYearId: string,
    movingNodeId?: string,
  ): Promise<BudgetNode> {
    const parent = await em.findOne(
      BudgetNode,
      { id: parentId, fiscalYear: fiscalYearId },
      { ...FILTER_OFF, populate: ['parent'] },
    );
    if (!parent) {
      throw new BadRequestException(`Parent node ${parentId} is not in the same fiscal year`);
    }
    if (movingNodeId) {
      for (let walk: BudgetNode | undefined = parent; walk; walk = walk.parent) {
        if (walk.id === movingNodeId) {
          throw new BadRequestException(
            `Node ${movingNodeId} cannot be placed beneath itself`,
          );
        }
        if (walk.parent) walk.parent = await this.get(em, walk.parent.id);
      }
    }
    return parent;
  }

  private async requireCodeFree(
    em: EntityManager,
    fiscalYearId: string,
    code: string,
  ): Promise<void> {
    const clash = await em.findOne(BudgetNode, { fiscalYear: fiscalYearId, code }, FILTER_OFF);
    if (clash) {
      throw new BadRequestException(`Budget code '${code}' already exists for this fiscal year`);
    }
  }

  private async requireOwnFiscalYear(em: EntityManager, id: string): Promise<void> {
    const companyId = RequestContext.companyId();
    const fy = await em.findOne(
      FiscalYear,
      companyId ? { id, company: companyId } : { id },
      FILTER_OFF,
    );
    if (!fy) throw new BadRequestException(`Fiscal year ${id} does not exist in the active company`);
  }
}
