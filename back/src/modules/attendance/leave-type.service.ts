import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Quota } from '../quota/quota.entities';
import { LeaveType } from './attendance.entities';
import type { UpsertLeaveTypeDto } from './dto/leave-type.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The rules that belong to a kind of leave. One row per quota that represents a leave type.
 *
 * Kept apart from `quota` deliberately: that table is a general allowance also used for overtime
 * hours and asset bookings, and none of these rules mean anything to a room booking.
 */
@Injectable()
export class LeaveTypeService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /** Create or replace the configuration for one leave type. */
  async upsert(dto: UpsertLeaveTypeDto): Promise<LeaveType> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    // The quota must be this company's — a leave type cannot configure another company's allowance.
    const quota = await em.findOne(Quota, { id: dto.quotaId });
    if (!quota) throw new BadRequestException(`Unknown quota '${dto.quotaId}' in this company`);

    const existing = await em.findOne(LeaveType, { quota: dto.quotaId }, FILTER_OFF);
    const row =
      existing ??
      em.create(LeaveType, { quota: em.getReference(Quota, dto.quotaId) });
    if (dto.advanceNoticeDays !== undefined) row.advanceNoticeDays = dto.advanceNoticeDays;
    if (dto.backdateLimitDays !== undefined) row.backdateLimitDays = dto.backdateLimitDays;
    if (dto.attachmentRequiredOverDays !== undefined) {
      row.attachmentRequiredOverDays = dto.attachmentRequiredOverDays ?? undefined;
    }
    if (dto.isActive !== undefined) row.isActive = dto.isActive;
    await em.persistAndFlush(row);
    return row;
  }

  /** Configured leave types of the active company, with their quota. */
  async list(): Promise<LeaveType[]> {
    const em = this.companyScope.forActiveCompany();
    const quotas = await em.find(Quota, {}, { fields: ['id'] });
    return em.find(
      LeaveType,
      { quota: { $in: quotas.map((q) => q.id) } },
      { ...FILTER_OFF, populate: ['quota'] },
    );
  }

  async get(quotaId: string): Promise<LeaveType> {
    const em = this.companyScope.forActiveCompany();
    const quota = await em.findOne(Quota, { id: quotaId });
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found in this company`);
    const row = await em.findOne(LeaveType, { quota: quotaId }, { ...FILTER_OFF, populate: ['quota'] });
    if (!row) throw new NotFoundException(`Quota ${quotaId} is not configured as a leave type`);
    return row;
  }
}
