import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { budgetsByPlanCode, findBudgetByPlanCode } from '../budget/budget-plan-lookup';
import type { Budget } from '../budget/budget.entities';
import { ScopeService } from '../rbac/scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { Item, ItemCompany } from './master-data.entities';
import { MasterDataPermissions } from './permissions';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';

/** An enabled item flattened with its per-company GL (for the line picker + enablement UI). */
export interface EnabledItem {
  id: string;
  itemCode: string;
  name: string;
  category?: string;
  defaultUnit?: string;
  isActive: boolean;
  defaultGlAccount?: string;
  /**
   * The budget this item belongs to in the active company, by the plan code it is bound to and the
   * name that code carries in the OPEN fiscal year.
   *
   * The name is resolved, not stored: a code means whatever this year's plan says it means, so a
   * binding shows the budget it actually points at today rather than the name it was set against.
   * Absent when the open year carries no such code — the binding is still returned, so the registry
   * can show it rather than let a set row read as unset.
   */
  defaultBudgetCode?: string;
  defaultBudgetName?: string;
  /**
   * Whether the item moves stock. The line editor needs it to offer only usable items on a
   * stock-moving document (`web-inventory`); without it the client had nothing to filter on, so it
   * offered every enabled item and the user learned the difference from a refusal at submit.
   */
  isStockTracked: boolean;
}

/** Group-wide item registry + per-company enablement, plus per-company GL for lines. */
@Injectable()
export class ItemService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly scope: ScopeService,
    private readonly accounts: AccountService,
  ) {}

  // ---- Group registry --------------------------------------------------------

  async create(dto: CreateItemDto): Promise<Item> {
    const item = this.em.create(Item, {
      itemCode: dto.itemCode,
      name: dto.name,
      category: dto.category,
      defaultUnit: dto.defaultUnit,
      isStockTracked: dto.isStockTracked ?? false,
      isActive: dto.isActive ?? true,
    });
    await this.em.persistAndFlush(item);
    return item;
  }

  async update(id: string, dto: UpdateItemDto): Promise<Item> {
    const item = await this.get(id);
    if (dto.name !== undefined) item.name = dto.name;
    if (dto.category !== undefined) item.category = dto.category;
    if (dto.defaultUnit !== undefined) item.defaultUnit = dto.defaultUnit;
    if (dto.isStockTracked !== undefined) item.isStockTracked = dto.isStockTracked;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    await this.em.flush();
    return item;
  }

  list(q: SearchablePaginationQueryDto, includeInactive = false): Promise<Paginated<Item>> {
    const where = includeInactive ? {} : { isActive: true };
    return paginate(this.em, Item, withSearch<Item>(where, q.search, ['itemCode', 'name']), {}, q);
  }

  async get(id: string): Promise<Item> {
    const item = await this.em.findOne(Item, { id });
    if (!item) throw new NotFoundException(`Item ${id} not found`);
    return item;
  }

  async deactivate(id: string): Promise<void> {
    const item = await this.get(id);
    item.isActive = false;
    await this.em.flush();
  }

  /**
   * The GL an item stamps onto a document line — the item's **per-company** GL
   * (`item_company.default_gl_account` for the active company), server-authoritative and not
   * requester-editable (invariant 7). Null when the item is not enabled for the company or has
   * no GL set there.
   */
  async defaultGlAccountFor(itemId: string, companyId?: string): Promise<string | null> {
    const em = this.companyScope.forActiveCompany(companyId);
    const ic = await em.findOne(ItemCompany, { item: itemId });
    return ic?.defaultGlAccount ?? null;
  }

  // ---- Per-company enablement (company-scoped) -------------------------------

  /**
   * Enable an item for the active company, optionally binding it to a budget.
   *
   * The caller names a BUDGET (by plan code), never an account. One account is charged by many
   * budgets — 612.06 carries 6.101, 6.102, 6.103 and 6.107 — so an account is not something an
   * admin can pick one of, and letting the client send one is how the item's account would drift
   * from the budget it claims to belong to. The account is stamped here from the budget that the
   * code resolves to, so `default_gl_account` stays what documents and journal entries read and
   * nothing downstream changes.
   *
   * Passing `''` clears the binding and LEAVES the stamped account: an item that posts today does
   * not stop posting because someone removed a label. Passing `undefined` touches neither, which is
   * what a plain re-enable means.
   */
  async enableForCompany(itemId: string, defaultBudgetCode?: string): Promise<ItemCompany> {
    const companyId = RequestContext.companyId()!;
    await this.get(itemId);
    const em = this.companyScope.forActiveCompany(companyId);

    const code = defaultBudgetCode?.trim() ? defaultBudgetCode.trim() : undefined;
    let stampedGl: string | undefined;
    if (code) {
      const budget = await findBudgetByPlanCode(em, code);
      if (!budget) {
        throw new BadRequestException(
          `No active budget with plan code ${code} in this company's open fiscal year`,
        );
      }
      if (!budget.glAccount) {
        // A budget records no account exactly when its spending posts to several (a vehicle
        // instalment splits into principal and interest), so there is none it could give an item.
        throw new BadRequestException(`Budget ${code} names no GL account`);
      }
      // Still validated against THIS company's chart — the check a group-wide GL could never have.
      await this.accounts.resolvePostable(budget.glAccount, companyId);
      stampedGl = budget.glAccount;
    }

    let ic = await em.findOne(ItemCompany, { item: itemId });
    if (ic) {
      ic.isActive = true;
      if (defaultBudgetCode !== undefined) ic.defaultBudgetCode = code;
      if (stampedGl) ic.defaultGlAccount = stampedGl;
    } else {
      ic = em.create(ItemCompany, {
        item: em.getReference(Item, itemId),
        company: em.getReference(Company, companyId),
        isActive: true,
        defaultBudgetCode: code,
        defaultGlAccount: stampedGl,
      });
    }
    // One flush for binding and stamp: there is no moment where an item names one budget while
    // carrying another budget's account.
    await em.flush();
    return ic;
  }

  async disableForCompany(itemId: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const ic = await em.findOne(ItemCompany, { item: itemId });
    if (!ic) throw new NotFoundException(`Item ${itemId} is not enabled for this company`);
    ic.isActive = false;
    await em.flush();
  }

  /**
   * Items enabled for the active company, flattened to the item master plus the item's
   * **per-company GL** (`item_company.default_gl_account`) — the shape both the line picker
   * (id/name + GL) and the enablement UI key on. GROUP scope → read-only across companies,
   * deduped by item; the per-company GL is ambiguous across companies there, so it is omitted.
   */
  async listEnabled(): Promise<Array<EnabledItem>> {
    const code = MasterDataPermissions.MASTER_VIEW;
    const isGroup = this.scope.isGroup(code);
    const em = isGroup ? this.companyScope.forGroupRead() : this.companyScope.forActiveCompany();
    const rows = isGroup
      ? await em.find(ItemCompany, { isActive: true }, { filters: { company: false }, populate: ['item'] })
      : await em.find(ItemCompany, { isActive: true }, { populate: ['item'] });
    // The open year's budgets once, not once per bound item — the registry reads a page at a time.
    // Skipped under GROUP scope for the reason the GL is: the binding belongs to one company.
    const budgets: Map<string, Budget> =
      isGroup || !rows.some((ic) => ic.defaultBudgetCode) ? new Map() : await budgetsByPlanCode(em);
    const byId = new Map<string, EnabledItem>();
    for (const ic of rows) {
      const i = ic.item;
      const budget = ic.defaultBudgetCode ? budgets.get(ic.defaultBudgetCode) : undefined;
      byId.set(i.id, {
        id: i.id,
        itemCode: i.itemCode,
        name: i.name,
        category: i.category,
        defaultUnit: i.defaultUnit,
        isActive: i.isActive,
        isStockTracked: i.isStockTracked,
        defaultGlAccount: isGroup ? undefined : ic.defaultGlAccount,
        defaultBudgetCode: isGroup ? undefined : ic.defaultBudgetCode,
        defaultBudgetName: budget ? (budget.budgetName ?? budget.node.name) : undefined,
      });
    }
    return [...byId.values()];
  }

  /** Guard for document-engine: item active group-wide AND enabled for the company. */
  async assertItemEnabled(itemId: string, companyId?: string): Promise<void> {
    const item = await this.em.findOne(Item, { id: itemId, isActive: true });
    if (!item) {
      throw new BadRequestException(`Item ${itemId} is inactive or unknown`);
    }
    const em = this.companyScope.forActiveCompany(companyId);
    const ic = await em.findOne(ItemCompany, { item: itemId, isActive: true });
    if (!ic) {
      throw new BadRequestException(`Item ${itemId} is not enabled for this company`);
    }
  }
}
