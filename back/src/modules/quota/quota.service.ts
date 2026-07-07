import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Quota } from './quota.entities';
import type { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import type { EntityManager } from '@mikro-orm/postgresql';

/** Quota definitions (company-scoped). Deactivate-not-delete. */
@Injectable()
export class QuotaService {
  constructor(private readonly scope: CompanyScopeService) {}

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

  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<Quota>> {
    return paginate(
      this.scope.forActiveCompany(),
      Quota,
      includeInactive ? {} : { isActive: true },
      {},
      q,
    );
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
