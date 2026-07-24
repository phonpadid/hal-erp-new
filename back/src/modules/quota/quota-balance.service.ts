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
   * How much of a quota's usage is compensated, and how much is not.
   *
   * Derived, never stored (invariant 3). `paid_limit_value` is a ceiling on compensation that sits
   * below the ceiling on entitlement, so the boundary can fall inside a single reservation: an
   * employee at 28 of 30 paid sick days who takes 5 more has 2 paid and 3 unpaid. A flag on the
   * quota could not say that, and a flag on each usage row would freeze a derived fact into
   * storage where it could drift from the ledger it came from.
   *
   * A null `paidLimitValue` means the whole limit is compensated — what every quota meant before
   * the column existed.
   */
  async paidSplit(
    quotaId: string,
    opts: { employeeId?: string; year?: number; period?: QuotaPeriod } = {},
    em?: EntityManager,
  ): Promise<{ used: string; paid: string; unpaid: string; paidLimit: string | null }> {
    const m = em ?? this.em.fork();
    const quota = await m.findOne(Quota, { id: quotaId }, FILTER_OFF);
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);

    const year = opts.year ?? new Date().getUTCFullYear();
    const period = opts.period ?? periodForYear(quota.resetCycle, year);
    const used = await this.netUsage(quotaId, opts.employeeId, m, period);

    if (quota.paidLimitValue === undefined || quota.paidLimitValue === null) {
      return { used, paid: used, unpaid: '0', paidLimit: null };
    }
    const paidLimit = quota.paidLimitValue;
    const paid = Money.compare(used, paidLimit) > 0 ? paidLimit : used;
    return { used, paid, unpaid: Money.subtract(used, paid), paidLimit };
  }

  /**
   * Batched pool remaining (limit − net used in the current period) for many quotas in TWO
   * queries — so a list view resolves every row's remaining in one round-trip instead of a
   * `breakdown` call per row (the old N+1). Each quota's pool is scoped to the current period
   * of its OWN reset cycle, so usage rows are matched to their quota's period in memory.
   * Personal entitlements are not needed for the pool figure. Ids not found are omitted.
   */
  async poolRemainingFor(quotaIds: string[], em?: EntityManager): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!quotaIds.length) return out;
    const m = em ?? this.em.fork();
    const quotas = await m.find(Quota, { id: { $in: quotaIds } }, FILTER_OFF);
    if (!quotas.length) return out;
    const periodOf = new Map<string, QuotaPeriod>();
    for (const q of quotas) periodOf.set(q.id, periodForCycle(q.resetCycle));
    const usage = await m.find(QuotaUsage, { quota: { $in: quotas.map((q) => q.id) } }, FILTER_OFF);
    const net = new Map<string, string>();
    for (const q of quotas) net.set(q.id, '0');
    for (const u of usage) {
      const qid = u.quota.id;
      const period = periodOf.get(qid);
      // Only usage in the quota's current reset period counts against its pool (see netUsage).
      if (!period || u.periodYear !== period.periodYear || u.periodIndex !== period.periodIndex) continue;
      const cur = net.get(qid) ?? '0';
      net.set(qid, u.usageType === 'RELEASE' ? Money.subtract(cur, u.qtyUsed) : Money.add(cur, u.qtyUsed));
    }
    for (const q of quotas) out.set(q.id, Money.subtract(q.limitValue, net.get(q.id) ?? '0'));
    return out;
  }

  /**
   * Of the given quotas, which are entitlement-scoped ("personal") — i.e. have at least one
   * `quota_entitlement` row. One query, no N+1: the caller uses this to decide whether a quota's
   * remaining/beneficiary is per-employee (personal) or pool-wide.
   */
  async personalQuotaIds(quotaIds: string[], em?: EntityManager): Promise<Set<string>> {
    const out = new Set<string>();
    if (!quotaIds.length) return out;
    const m = em ?? this.em.fork();
    const ents = await m.find(QuotaEntitlement, { quota: { $in: quotaIds } }, FILTER_OFF);
    for (const e of ents) out.add(e.quota.id);
    return out;
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
