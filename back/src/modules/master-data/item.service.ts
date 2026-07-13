import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
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
    if (dto.isActive !== undefined) item.isActive = dto.isActive;
    await this.em.flush();
    return item;
  }

  list(q: PaginationQueryDto, includeInactive = false): Promise<Paginated<Item>> {
    const where = includeInactive ? {} : { isActive: true };
    return paginate(this.em, Item, where, {}, q);
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

  async enableForCompany(itemId: string, defaultGlAccount?: string): Promise<ItemCompany> {
    const companyId = RequestContext.companyId()!;
    await this.get(itemId);
    // A non-empty GL must reference an active, postable account in THIS company (the validation
    // that a group-wide GL could never have — the reason GL now lives on the junction).
    const gl = defaultGlAccount?.trim() ? defaultGlAccount.trim() : undefined;
    if (gl) await this.accounts.resolvePostable(gl, companyId);
    const em = this.companyScope.forActiveCompany(companyId);

    let ic = await em.findOne(ItemCompany, { item: itemId });
    if (ic) {
      ic.isActive = true;
      if (defaultGlAccount !== undefined) ic.defaultGlAccount = gl;
    } else {
      ic = em.create(ItemCompany, {
        item: em.getReference(Item, itemId),
        company: em.getReference(Company, companyId),
        isActive: true,
        defaultGlAccount: gl,
      });
    }
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
    const rows = isGroup
      ? await this.companyScope
          .forGroupRead()
          .find(ItemCompany, { isActive: true }, { filters: { company: false }, populate: ['item'] })
      : await this.companyScope
          .forActiveCompany()
          .find(ItemCompany, { isActive: true }, { populate: ['item'] });
    const byId = new Map<string, EnabledItem>();
    for (const ic of rows) {
      const i = ic.item;
      byId.set(i.id, {
        id: i.id,
        itemCode: i.itemCode,
        name: i.name,
        category: i.category,
        defaultUnit: i.defaultUnit,
        isActive: i.isActive,
        defaultGlAccount: isGroup ? undefined : ic.defaultGlAccount,
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
