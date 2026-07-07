import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Money } from '../../common/money/money';
import {
  pageParams,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Document } from '../document/document.entities';
import { Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { periodForCycle, periodForYear, type QuotaPeriod } from './quota-period';
import { Quota, QuotaEntitlement, QuotaUsage } from './quota.entities';

const FILTER_OFF = { filters: { company: false } } as const;

export interface QuotaEntitlementBreakdown {
  employeeId: string;
  employeeName: string;
  year: number;
  entitled: string;
  used: string;
  remaining: string;
}

export interface QuotaBreakdown {
  quota: { id: string; quotaType: string; unit: string; limitValue: string; resetCycle: string; carryForward: boolean; departmentName: string | null };
  period: QuotaPeriod;
  pool: { limit: string; used: string; remaining: string };
  entitlements: QuotaEntitlementBreakdown[];
}

export interface QuotaUsageEntry {
  id: string;
  usageType: string;
  qtyUsed: string;
  periodYear: number;
  periodIndex: number;
  employeeName: string | null;
  documentId: string | null;
  documentNo: string | null;
  createdAt: Date | null;
}

/** Build the `quota_usage` period predicate; an undefined period means all-time. */
function periodWhere(period?: QuotaPeriod): Record<string, unknown> {
  return period ? { periodYear: period.periodYear, periodIndex: period.periodIndex } : {};
}

/**
 * Derived quota balances. Net usage = Σ USE − Σ RELEASE over `quota_usage`, scoped to a
 * reset period (period_year + period_index) so MONTHLY / QUARTERLY / YEARLY quotas reset
 * independently. Remaining is the personal entitlement total (entitled + carried_over +
 * adjusted) or the quota's limit_value, minus that period's net usage. Never reads a
 * stored usage total (invariant 3).
 */
@Injectable()
export class QuotaBalanceService {
  constructor(private readonly em: EntityManager) {}

  async netUsage(
    quotaId: string,
    employeeId?: string,
    em?: EntityManager,
    period?: QuotaPeriod,
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const where: Record<string, unknown> = { quota: quotaId, ...periodWhere(period) };
    if (employeeId) where.employee = employeeId;
    const rows = await m.find(QuotaUsage, where, FILTER_OFF);
    let used = '0';
    for (const r of rows) {
      if (r.usageType === 'RELEASE') used = Money.subtract(used, r.qtyUsed);
      else used = Money.add(used, r.qtyUsed); // USE (default)
    }
    return used;
  }

  /** Outstanding USE for one document+quota(+employee), optionally in one period. */
  async outstandingUsage(
    documentId: string,
    quotaId: string,
    employeeId?: string,
    em?: EntityManager,
    period?: QuotaPeriod,
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const where: Record<string, unknown> = { document: documentId, quota: quotaId, ...periodWhere(period) };
    if (employeeId) where.employee = employeeId;
    const rows = await m.find(QuotaUsage, where, FILTER_OFF);
    let used = '0';
    for (const r of rows) {
      if (r.usageType === 'RELEASE') used = Money.subtract(used, r.qtyUsed);
      else used = Money.add(used, r.qtyUsed);
    }
    return used;
  }

  /** entitled + carried_over + adjusted for (quota, employee, year); 0 if none. */
  async entitlementTotal(
    quotaId: string,
    employeeId: string,
    year: number,
    em?: EntityManager,
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const ent = await m.findOne(
      QuotaEntitlement,
      { quota: quotaId, employee: employeeId, year },
      FILTER_OFF,
    );
    if (!ent) return '0';
    return Money.add(Money.add(ent.entitledValue, ent.carriedOver), ent.adjusted);
  }

  /**
   * Remaining quota for a reset period. Personal (employeeId given) uses the entitlement
   * total for the year minus that year's net usage; otherwise the quota's limit_value
   * minus the current (or requested) period's net usage. Usage from a prior period never
   * reduces the current period's remaining.
   */
  async remaining(
    quotaId: string,
    opts: { employeeId?: string; year?: number; period?: QuotaPeriod },
    em?: EntityManager,
  ): Promise<string> {
    const m = em ?? this.em.fork();
    const quota = await m.findOne(Quota, { id: quotaId }, FILTER_OFF);
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);

    if (opts.employeeId) {
      const year = opts.year ?? new Date().getUTCFullYear();
      const period = opts.period ?? periodForYear(quota.resetCycle, year);
      const total = await this.entitlementTotal(quotaId, opts.employeeId, year, m);
      return Money.subtract(total, await this.netUsage(quotaId, opts.employeeId, m, period));
    }
    const period = opts.period ?? periodForCycle(quota.resetCycle);
    return Money.subtract(quota.limitValue, await this.netUsage(quotaId, undefined, m, period));
  }

  /**
   * Derived breakdown for a reset period: the pool (limit − net used in the period) plus,
   * when entitlement-based, each employee's entitled/used/remaining scoped to their
   * entitlement year. All figures derived from usage + entitlements (invariant 3).
   */
  async breakdown(quotaId: string, em?: EntityManager, period?: QuotaPeriod): Promise<QuotaBreakdown> {
    const m = em ?? this.em.fork();
    const quota = await m.findOne(Quota, { id: quotaId }, FILTER_OFF);
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);
    // Resolve department name by id — populate('department') doesn't reliably hydrate here.
    const department = quota.department?.id
      ? await m.findOne(Department, { id: quota.department.id }, FILTER_OFF)
      : null;

    const poolPeriod = period ?? periodForCycle(quota.resetCycle);
    const poolUsed = await this.netUsage(quotaId, undefined, m, poolPeriod);
    const ents = await m.find(QuotaEntitlement, { quota: quotaId }, FILTER_OFF);
    // Resolve employee names by id — populate('employee') doesn't reliably hydrate here (see usageLedger).
    const empIds = [...new Set(ents.map((e) => e.employee?.id).filter(Boolean) as string[])];
    const emps = empIds.length ? await m.find(Employee, { id: { $in: empIds } }, FILTER_OFF) : [];
    const empName = new Map(emps.map((e) => [e.id, e.fullName]));
    const entitlements: QuotaEntitlementBreakdown[] = [];
    for (const e of ents) {
      const entitled = Money.add(Money.add(e.entitledValue, e.carriedOver), e.adjusted);
      const entPeriod = periodForYear(quota.resetCycle, e.year);
      const used = await this.netUsage(quotaId, e.employee.id, m, entPeriod);
      entitlements.push({
        employeeId: e.employee.id,
        employeeName: empName.get(e.employee.id) ?? '',
        year: e.year,
        entitled,
        used,
        remaining: Money.subtract(entitled, used),
      });
    }

    return {
      quota: {
        id: quota.id,
        quotaType: quota.quotaType,
        unit: quota.unit,
        limitValue: quota.limitValue,
        resetCycle: quota.resetCycle,
        carryForward: quota.carryForward,
        departmentName: department?.name ?? null,
      },
      period: poolPeriod,
      pool: { limit: quota.limitValue, used: poolUsed, remaining: Money.subtract(quota.limitValue, poolUsed) },
      entitlements,
    };
  }

  /** The quota's usage entries, newest first. Read-only (invariant 2). Paginated. */
  async usageLedger(
    quotaId: string,
    q: PaginationQueryDto = {},
    em?: EntityManager,
  ): Promise<Paginated<QuotaUsageEntry>> {
    const m = em ?? this.em.fork();
    const { page, limit, offset } = pageParams(q);
    const [rows, total] = await m.findAndCount(
      QuotaUsage,
      { quota: quotaId },
      { orderBy: { createdAt: 'DESC' }, offset, limit, ...FILTER_OFF },
    );

    const empIds = [...new Set(rows.map((r) => r.employee?.id).filter(Boolean) as string[])];
    const docIds = [...new Set(rows.map((r) => r.document?.id).filter(Boolean) as string[])];
    const emps = empIds.length ? await m.find(Employee, { id: { $in: empIds } }, FILTER_OFF) : [];
    const docs = docIds.length ? await m.find(Document, { id: { $in: docIds } }, FILTER_OFF) : [];
    const empName = new Map(emps.map((e) => [e.id, e.fullName]));
    const docNo = new Map(docs.map((d) => [d.id, d.docNo]));

    const items = rows.map((r) => ({
      id: r.id,
      usageType: r.usageType,
      qtyUsed: r.qtyUsed,
      periodYear: r.periodYear,
      periodIndex: r.periodIndex,
      employeeName: r.employee?.id ? empName.get(r.employee.id) ?? null : null,
      documentId: r.document?.id ?? null,
      documentNo: r.document?.id ? docNo.get(r.document.id) ?? null : null,
      createdAt: r.createdAt ?? null,
    }));
    return { items, total, page, limit };
  }
}
