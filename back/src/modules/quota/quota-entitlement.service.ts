import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { Employee } from '../rbac/rbac.entities';
import { QuotaBalanceService } from './quota-balance.service';
import { periodForYear } from './quota-period';
import { Quota, QuotaEntitlement } from './quota.entities';
import type {
  AdjustEntitlementDto,
  CarryForwardDto,
  UpsertEntitlementDto,
} from './dto/entitlement.dto';

const FILTER_OFF = { filters: { company: false } } as const;

export interface EntitlementRow {
  employeeId: string;
  employeeName: string;
  year: number;
  entitledValue: string;
  carriedOver: string;
  adjusted: string;
  entitled: string;
  used: string;
  remaining: string;
}

/** Per-person entitlements: upsert, mid-year adjustment, and quota-wide carry-forward. */
@Injectable()
export class QuotaEntitlementService {
  constructor(
    private readonly em: EntityManager,
    private readonly balance: QuotaBalanceService,
  ) {}

  /** Create or update the (quota, employee, year) entitlement. */
  async upsert(dto: UpsertEntitlementDto): Promise<QuotaEntitlement> {
    const em = this.em.fork();
    const ent = await this.upsertIn(em, dto);
    await em.flush();
    return ent;
  }

  private async upsertIn(em: EntityManager, dto: UpsertEntitlementDto): Promise<QuotaEntitlement> {
    let ent = await em.findOne(
      QuotaEntitlement,
      { quota: dto.quotaId, employee: dto.employeeId, year: dto.year },
      FILTER_OFF,
    );
    if (ent) {
      ent.entitledValue = dto.entitledValue;
      if (dto.carriedOver !== undefined) ent.carriedOver = dto.carriedOver;
      if (dto.adjusted !== undefined) ent.adjusted = dto.adjusted;
    } else {
      ent = em.create(QuotaEntitlement, {
        quota: em.getReference(Quota, dto.quotaId),
        employee: em.getReference(Employee, dto.employeeId),
        year: dto.year,
        entitledValue: dto.entitledValue,
        carriedOver: dto.carriedOver ?? '0',
        adjusted: dto.adjusted ?? '0',
      });
    }
    return ent;
  }

  /**
   * Mid-year adjustment: apply a signed delta to `adjusted` without overwriting
   * `entitled_value` or `carried_over`. Locks the row to avoid a lost update. Fails if the
   * entitlement does not exist.
   */
  async adjust(dto: AdjustEntitlementDto): Promise<QuotaEntitlement> {
    return this.em.transactional(async (tem) => {
      const ent = await tem.findOne(
        QuotaEntitlement,
        { quota: dto.quotaId, employee: dto.employeeId, year: dto.year },
        { lockMode: LockMode.PESSIMISTIC_WRITE, ...FILTER_OFF },
      );
      if (!ent) {
        throw new NotFoundException(
          `No entitlement for quota ${dto.quotaId}, employee ${dto.employeeId}, year ${dto.year}`,
        );
      }
      ent.adjusted = Money.add(ent.adjusted, dto.delta);
      return ent;
    });
  }

  /**
   * Carry forward a whole quota: for every entitlement in `fromYear`, seed `toYear` with
   * `carried_over` = that employee's source-year remaining (0 when the quota's
   * carry-forward policy is off), preserving `entitled_value`. Idempotent — re-running
   * overwrites `carried_over` rather than accumulating.
   */
  async carryForward(dto: CarryForwardDto): Promise<EntitlementRow[]> {
    return this.em.transactional(async (tem) => {
      const quota = await tem.findOne(Quota, { id: dto.quotaId }, FILTER_OFF);
      if (!quota) throw new NotFoundException(`Quota ${dto.quotaId} not found`);

      const sources = await tem.find(
        QuotaEntitlement,
        { quota: dto.quotaId, year: dto.fromYear },
        { populate: ['employee'], ...FILTER_OFF },
      );

      for (const src of sources) {
        const remaining = await this.balance.remaining(
          dto.quotaId,
          { employeeId: src.employee.id, year: dto.fromYear },
          tem,
        );
        const carried = quota.carryForward ? remaining : '0';
        await this.upsertIn(tem, {
          quotaId: dto.quotaId,
          employeeId: src.employee.id,
          year: dto.toYear,
          entitledValue: src.entitledValue,
          carriedOver: carried,
        });
      }
      await tem.flush();
      return this.listForQuota(dto.quotaId, dto.toYear, tem);
    });
  }

  /**
   * Entitlement rows for a quota (optionally one year) with derived entitled total, net
   * usage scoped to the entitlement's period, and remaining. Read-only.
   */
  async listForQuota(quotaId: string, year?: number, em?: EntityManager): Promise<EntitlementRow[]> {
    const m = em ?? this.em.fork();
    const quota = await m.findOne(Quota, { id: quotaId }, FILTER_OFF);
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);

    const where: Record<string, unknown> = { quota: quotaId };
    if (year !== undefined) where.year = year;
    const ents = await m.find(QuotaEntitlement, where, {
      populate: ['employee'],
      orderBy: { year: 'DESC' },
      ...FILTER_OFF,
    });

    const rows: EntitlementRow[] = [];
    for (const e of ents) {
      const entitled = Money.add(Money.add(e.entitledValue, e.carriedOver), e.adjusted);
      const period = periodForYear(quota.resetCycle, e.year);
      const used = await this.balance.netUsage(quotaId, e.employee.id, m, period);
      rows.push({
        employeeId: e.employee.id,
        employeeName: e.employee.fullName,
        year: e.year,
        entitledValue: e.entitledValue,
        carriedOver: e.carriedOver,
        adjusted: e.adjusted,
        entitled,
        used,
        remaining: Money.subtract(entitled, used),
      });
    }
    return rows;
  }
}
