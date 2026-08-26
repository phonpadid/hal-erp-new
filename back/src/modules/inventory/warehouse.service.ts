import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { Warehouse } from './inventory.entities';
import type { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

/**
 * Warehouse registry, owned per company (invariant 1). `code` is unique within a company, so two
 * companies may each run a warehouse called MAIN without colliding — the same rule
 * `document_type.code` follows.
 *
 * Warehouse is a CompanyScopedEntity, so reads go through CompanyScopeService — the seam that
 * binds the active company to the entity filter (invariant 1). The explicit `company: companyId`
 * on each query is belt-and-braces on top of it, not a substitute.
 */
@Injectable()
export class WarehouseService {
  constructor(private readonly scope: CompanyScopeService) {}

  async create(dto: CreateWarehouseDto): Promise<Warehouse> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany();
    // Uniqueness is per company: check within this company only.
    const dup = await em.findOne(Warehouse, { company: companyId, code: dto.code });
    if (dup) {
      throw new BadRequestException(`Warehouse code '${dto.code}' already exists in this company`);
    }
    const warehouse = em.create(Warehouse, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      isActive: true,
    });
    await em.persistAndFlush(warehouse);
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    const em = this.scope.forActiveCompany();
    const warehouse = await this.getWith(em, id);
    if (dto.name !== undefined) warehouse.name = dto.name;
    if (dto.isActive !== undefined) warehouse.isActive = dto.isActive;
    await em.flush();
    return warehouse;
  }

  /**
   * Deactivate, never delete: historical `stock_txn` rows reference this warehouse and must stay
   * readable. The same reason vendors and items are deactivated rather than removed.
   */
  async deactivate(id: string): Promise<Warehouse> {
    const em = this.scope.forActiveCompany();
    const warehouse = await this.getWith(em, id);
    warehouse.isActive = false;
    await em.flush();
    return warehouse;
  }

  list(q: SearchablePaginationQueryDto = {}, includeInactive = false): Promise<Paginated<Warehouse>> {
    const companyId = RequestContext.companyId()!;
    const where = includeInactive
      ? { company: companyId }
      : { company: companyId, isActive: true };
    return paginate(this.scope.forActiveCompany(), Warehouse, withSearch<Warehouse>(where, q.search, ['code', 'name']), { orderBy: { code: 'ASC' } }, q);
  }

  /**
   * The Create Document wizard's warehouse picker. Authorized by `DOC_CREATE` rather than
   * `INV_VIEW`, and returns only {id, code, name} — no stock figures. The shape
   * `GET /budgets/selectable` and `GET /quotas/selectable` already use: a requester filling in a
   * goods issue needs to name a warehouse, not to read the inventory module.
   */
  async listSelectable(): Promise<Array<{ id: string; code: string; name: string }>> {
    const companyId = RequestContext.companyId()!;
    const rows = await this.scope
      .forActiveCompany()
      .find(Warehouse, { company: companyId, isActive: true }, { orderBy: { code: 'ASC' } });
    return rows.map((w) => ({ id: w.id, code: w.code, name: w.name }));
  }

  /** Resolve by id within the active company; another company's warehouse is simply not found. */
  get(id: string): Promise<Warehouse> {
    return this.getWith(this.scope.forActiveCompany(), id);
  }

  private async getWith(em: EntityManager, id: string): Promise<Warehouse> {
    const companyId = RequestContext.companyId()!;
    const warehouse = await em.findOne(Warehouse, { id, company: companyId });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  /**
   * Resolve a warehouse that a movement may actually target: in the active company AND active.
   * Used by the submit gate and the receipt path, where naming a deactivated or foreign warehouse
   * must be a rejection rather than a silent write into the wrong place.
   *
   * Deliberately takes no EntityManager. Callers hold all sorts of forks — `em.fork()` for a read
   * pass, a transactional `tem` — and most are NOT bound to the active company, which makes the
   * `Warehouse` filter throw "No arguments provided for filter 'company'". This is a validation
   * read of a config row, not part of anyone's write transaction, so it always runs on its own
   * company-bound EntityManager and the hazard disappears with the parameter.
   */
  async requireActive(id: string): Promise<Warehouse> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany();
    const warehouse = await em.findOne(Warehouse, { id, company: companyId });
    if (!warehouse) throw new BadRequestException('Warehouse not found in the active company');
    if (!warehouse.isActive) throw new BadRequestException(`Warehouse '${warehouse.code}' is inactive`);
    return warehouse;
  }
}
