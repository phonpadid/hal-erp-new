import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { QuotaBalanceService } from './quota-balance.service';
import { Quota } from './quota.entities';
import type { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { wrap, type EntityDTO } from '@mikro-orm/core';

/** A quota as offered to a document requester: selection fields + advisory remaining. */
export interface SelectableQuota {
  id: string;
  quotaType: string;
  unit: string;
  resetCycle: string;
  /** True when the quota is entitlement-scoped (per-employee), so its beneficiary is the requester. */
  personal: boolean;
  /** Advisory only: pool remaining, or the requester's own remaining for a personal quota. */
  remaining: string;
}

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

  /**
   * Requester-facing quota picker for the Create Document wizard — mirrors /budgets/selectable.
   * Authorized by DOC_CREATE (not QUOTA_VIEW): a requester picks a quota to reserve against without
   * the finance read. Selection fields only, active-company scoped, active quotas. `personal` marks
   * an entitlement-scoped quota; its advisory `remaining` is the requester's OWN current-period
   * remaining (resolved from their linked employee), while a pool quota reports pool remaining.
   */
  async selectableForRequester(): Promise<SelectableQuota[]> {
    const em = this.scope.forActiveCompany();
    const quotas = await em.find(Quota, { isActive: true });
    if (!quotas.length) return [];
    const ids = quotas.map((q) => q.id);
    const personal = await this.balance.personalQuotaIds(ids, em);
    // The caller's own employee (active company) — the beneficiary of any personal reservation.
    const userId = RequestContext.userId();
    const self = userId
      ? await em.findOne(Employee, { user: userId, company: RequestContext.companyId()! })
      : null;
    // Pool remaining is batched; personal remaining is per-employee for the caller only.
    const poolRemaining = await this.balance.poolRemainingFor(ids, em);
    const rows: SelectableQuota[] = [];
    for (const q of quotas) {
      const isPersonal = personal.has(q.id);
      const remaining = isPersonal
        ? self
          ? await this.balance.remaining(q.id, { employeeId: self.id }, em)
          : '0'
        : poolRemaining.get(q.id) ?? q.limitValue;
      rows.push({
        id: q.id,
        quotaType: q.quotaType,
        unit: q.unit,
        resetCycle: q.resetCycle,
        personal: isPersonal,
        remaining,
      });
    }
    return rows;
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
