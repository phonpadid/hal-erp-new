import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ScopeService } from '../rbac/scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { Item, ItemCompany } from './master-data.entities';
import { MasterDataPermissions } from './permissions';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';

/** Group-wide item registry + per-company enablement, plus GL defaulting for lines. */
@Injectable()
export class ItemService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly scope: ScopeService,
  ) {}

  // ---- Group registry --------------------------------------------------------

  async create(dto: CreateItemDto): Promise<Item> {
    const item = this.em.create(Item, {
      itemCode: dto.itemCode,
      name: dto.name,
      category: dto.category,
      defaultUnit: dto.defaultUnit,
      defaultGlAccount: dto.defaultGlAccount,
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
    if (dto.defaultGlAccount !== undefined) item.defaultGlAccount = dto.defaultGlAccount;
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
   * Default GL account an item stamps onto a document line — server-authoritative, not
   * requester-editable: the line GL is always this value (or, for item-less lines, the chosen
   * budget's GL), never a code the requester types (invariant 7). Null if the item has none.
   */
  async defaultGlAccountFor(itemId: string): Promise<string | null> {
    const item = await this.get(itemId);
    return item.defaultGlAccount ?? null;
  }

  // ---- Per-company enablement (company-scoped) -------------------------------

  async enableForCompany(itemId: string): Promise<ItemCompany> {
    const companyId = RequestContext.companyId()!;
    await this.get(itemId);
    const em = this.companyScope.forActiveCompany(companyId);

    let ic = await em.findOne(ItemCompany, { item: itemId });
    if (ic) {
      ic.isActive = true;
    } else {
      ic = em.create(ItemCompany, {
        item: em.getReference(Item, itemId),
        company: em.getReference(Company, companyId),
        isActive: true,
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
   * Items enabled for the active company, flattened to the item master — the shape the line
   * picker keys on (id/name + defaultGlAccount) and the enabled toggle keys on. GROUP scope →
   * read-only across companies, deduped by item.
   */
  async listEnabled(): Promise<Item[]> {
    const code = MasterDataPermissions.MASTER_VIEW;
    const rows = this.scope.isGroup(code)
      ? await this.companyScope
          .forGroupRead()
          .find(ItemCompany, { isActive: true }, { filters: { company: false }, populate: ['item'] })
      : await this.companyScope
          .forActiveCompany()
          .find(ItemCompany, { isActive: true }, { populate: ['item'] });
    const byId = new Map<string, Item>();
    for (const ic of rows) byId.set(ic.item.id, ic.item);
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
