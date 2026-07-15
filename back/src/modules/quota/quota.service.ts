import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { QuotaBalanceService } from './quota-balance.service';
import { Quota } from './quota.entities';
import type { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { wrap, type EntityDTO } from '@mikro-orm/core';

/** Quota definitions (company-scoped). Deactivate-not-delete. */
@Injectable()
export class QuotaService {
  constructor(
    private readonly scope: CompanyScopeService,
    private readonly balance: QuotaBalanceService,
  ) {}

  async create(dto: CreateQuotaDto): Promise<Quota> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany(companyId);
    const quota = em.create(Quota, {
      company: em.getReference(Company, companyId),
      department: dto.departmentId ? em.getReference(Department, dto.departmentId) : undefined,
      quotaType: dto.quotaType,
      unit: dto.unit,
      limitValue: dto.limitValue,
      resetCycle: dto.resetCycle ?? 'YEARLY',
      carryForward: dto.carryForward ?? true,
      isActive: true,
    });
    await em.persistAndFlush(quota);
    return quota;
  }

  async update(id: string, dto: UpdateQuotaDto): Promise<Quota> {
    const em = this.scope.forActiveCompany();
    const quota = await this.getWith(em, id);
    if (dto.quotaType !== undefined) quota.quotaType = dto.quotaType;
    if (dto.unit !== undefined) quota.unit = dto.unit;
    if (dto.limitValue !== undefined) quota.limitValue = dto.limitValue;
    if (dto.resetCycle !== undefined) quota.resetCycle = dto.resetCycle;
    if (dto.carryForward !== undefined) quota.carryForward = dto.carryForward;
    if (dto.isActive !== undefined) quota.isActive = dto.isActive;
    await em.flush();
    return quota;
  }

  async list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<EntityDTO<Quota> & { remaining: string }>> {
    const em = this.scope.forActiveCompany();
    const page = await paginate(em, Quota, includeInactive ? {} : { isActive: true }, {}, q);
    // Attach each row's pool remaining in one batched pass (was an N+1 breakdown call per row
    // on the client). Serialize to a POJO with toJSON() first: MikroORM only emits mapped
    // properties, so a bare assigned field would be dropped from the response.
    const remaining = await this.balance.poolRemainingFor(page.items.map((x) => x.id), em);
    return {
      ...page,
      items: page.items.map((x) => ({ ...wrap(x).toJSON(), remaining: remaining.get(x.id) ?? x.limitValue })),
    };
  }

  get(id: string): Promise<Quota> {
    return this.getWith(this.scope.forActiveCompany(), id);
  }

  async deactivate(id: string): Promise<void> {
    const em = this.scope.forActiveCompany();
    const quota = await this.getWith(em, id);
    quota.isActive = false;
    await em.flush();
  }

  private async getWith(em: EntityManager, id: string): Promise<Quota> {
    const quota = await em.findOne(Quota, { id });
    if (!quota) throw new NotFoundException(`Quota ${id} not found`);
    return quota;
  }
}
