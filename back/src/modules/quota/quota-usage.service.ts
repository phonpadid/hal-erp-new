import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPolicy } from '../../common/enums';
import { coded, ErrorCode } from '../../common/errors/error-code';
import { Money } from '../../common/money/money';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Document } from '../document/document.entities';
import { Employee } from '../rbac/rbac.entities';
import { QuotaBalanceService } from './quota-balance.service';
import { periodForYear, type QuotaPeriod } from './quota-period';
import { Quota, QuotaEntitlement, QuotaUsage } from './quota.entities';

const FILTER_OFF = { filters: { company: false } } as const;

export interface ReserveQuotaInput {
  documentId: string;
  quotaId: string;
  employeeId?: string;
  qty: string;
  year?: number;
  /**
   * Collector the caller owns. A SOFT_WARNING reservation that exceeds remaining pushes its
   * overshoot here instead of throwing. Deliberately not a field on the service — this is a
   * singleton, and per-request state on it would leak across concurrent requests.
   */
  overshoots?: QuotaOvershoot[];
}

/**
 * A reservation that was allowed to exceed remaining because its quota is SOFT_WARNING. Returned
 * rather than thrown: for such quotas the notification IS the control, so it must reach the caller.
 */
export interface QuotaOvershoot {
  quotaId: string;
  quotaType: string;
  requested: string;
  remaining: string;
  overBy: string;
}

/**
 * Quota reservation engine (invariant 4/5). reserve locks the quota (and the
 * entitlement for personal quotas) FOR UPDATE inside one transaction, stamps the reset
 * period from the quota's reset_cycle, enforces the period's remaining, and inserts a USE
 * row. Reject/cancel inserts RELEASE rows in the same period. quota_usage is NOT
 * append-only — corrections are RELEASE rows; periods never cross.
 *
 * Enforcement follows the quota's own `control_policy`. HARD_STOP rejects an over-quota
 * reservation, which is what every quota did before the policy existed and still does by default.
 * SOFT_WARNING records it and reports the overshoot — Thai law entitles an employee to sick leave
 * for as long as they are genuinely ill, so blocking at the paid ceiling would contradict the law
 * rather than implement it.
 *
 * The lock is taken for BOTH policies. A soft overshoot still has to be measured against a
 * serialized balance, or two concurrent reservations would each report an overshoot computed from
 * the same stale remaining.
 */
@Injectable()
export class QuotaUsageService {
  constructor(
    private readonly em: EntityManager,
    private readonly balance: QuotaBalanceService,
  ) {}

  async reserve(input: ReserveQuotaInput, em?: EntityManager): Promise<QuotaUsage> {
    return em ? this.reserveIn(em, input) : inTransaction(this.em, (tem) => this.reserveIn(tem, input));
  }

  private async reserveIn(tem: EntityManager, input: ReserveQuotaInput): Promise<QuotaUsage> {
    const { documentId, quotaId, employeeId, qty } = input;
    const year = input.year ?? new Date().getUTCFullYear();

    const quota = await lockForUpdate(tem, Quota, { id: quotaId }, FILTER_OFF);
    if (!quota) throw new NotFoundException(`Quota ${quotaId} not found`);
    // The reset period this reservation belongs to (stamped on the USE row).
    const period: QuotaPeriod = periodForYear(quota.resetCycle, year);

    // Lock the entitlement row too for personal quotas (deterministic: quota then ent).
    if (employeeId) {
      await tem.findOne(
        QuotaEntitlement,
        { quota: quotaId, employee: employeeId, year },
        { lockMode: LockMode.PESSIMISTIC_WRITE, ...FILTER_OFF },
      );
    }

    const remaining = await this.balance.remaining(quotaId, { employeeId, year, period }, tem);
    if (Money.compare(qty, remaining) > 0) {
      // HARD_STOP is the default, so a quota created before this policy existed still blocks.
      if (quota.controlPolicy !== ControlPolicy.SOFT_WARNING) {
        // Named apart from the budget code on purpose: what has to be topped up is different.
        throw coded(
          ErrorCode.QUOTA_EXCEEDED,
          `Over quota: ${qty} requested, ${remaining} remaining on quota ${quotaId}`,
        );
      }
      // Recorded, not refused — but never silently. Pushed into a collector the CALLER owns,
      // never held on the service: this is a singleton, so instance state would let one request's
      // overshoot leak into another's response.
      input.overshoots?.push({
        quotaId,
        quotaType: quota.quotaType,
        requested: qty,
        remaining,
        overBy: Money.subtract(qty, remaining),
      });
    }

    const usage = tem.create(QuotaUsage, {
      quota: tem.getReference(Quota, quotaId),
      document: tem.getReference(Document, documentId),
      employee: employeeId ? tem.getReference(Employee, employeeId) : undefined,
      qtyUsed: qty,
      usageType: 'USE',
      periodYear: period.periodYear,
      periodIndex: period.periodIndex,
      createdAt: new Date(),
    });
    tem.persist(usage);
    return usage;
  }

  /**
   * Reject/cancel: RELEASE the document's outstanding USE per (quota, employee, period).
   * Each RELEASE inherits the period of the USE it offsets so balances never cross a
   * reset boundary. Append-only — never UPDATE/DELETE existing rows.
   */
  async releaseAll(documentId: string, em?: EntityManager): Promise<void> {
    const run = async (tem: EntityManager) => {
      const useRows = await tem.find(
        QuotaUsage,
        { document: documentId, usageType: 'USE' },
        FILTER_OFF,
      );
      // Distinct (quota, employee, period) groups the document consumed.
      const seen = new Map<string, { quotaId: string; employeeId?: string; period: QuotaPeriod }>();
      for (const r of useRows) {
        const employeeId = r.employee?.id;
        const period: QuotaPeriod = { periodYear: r.periodYear, periodIndex: r.periodIndex };
        const key = `${r.quota.id}|${employeeId ?? ''}|${period.periodYear}|${period.periodIndex}`;
        seen.set(key, { quotaId: r.quota.id, employeeId, period });
      }
      for (const { quotaId, employeeId, period } of seen.values()) {
        const outstanding = await this.balance.outstandingUsage(documentId, quotaId, employeeId, tem, period);
        if (Money.compare(outstanding, '0') > 0) {
          tem.persist(
            tem.create(QuotaUsage, {
              quota: tem.getReference(Quota, quotaId),
              document: tem.getReference(Document, documentId),
              employee: employeeId ? tem.getReference(Employee, employeeId) : undefined,
              qtyUsed: outstanding,
              usageType: 'RELEASE',
              periodYear: period.periodYear,
              periodIndex: period.periodIndex,
              createdAt: new Date(),
            }),
          );
        }
      }
    };
    return em ? run(em) : inTransaction(this.em, run);
  }
}
