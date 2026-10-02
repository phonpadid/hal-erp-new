import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Budget } from '../budget/budget.entities';
import { ExchangeRate } from '../currency/currency.entities';
import { QuotaEntitlement } from '../quota/quota.entities';
import { FiscalYearService, type YearBlock } from './fiscal-year.service';
import { FiscalYear } from './multi-company.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** How many days before the current year ends admins start hearing about the next one. */
export const READINESS_WINDOW_DAYS = 30;

export interface FiscalYearReadiness {
  /** Today, in the company's own timezone. */
  today: string;
  /** The year covering today, whatever its status; null when none does. */
  current: { year: number; endDate: string; status: string } | null;
  /** Whole days from today until the current year's last day; null without a current year. */
  daysLeft: number | null;
  /** The year being prepared: the one after `current`, or — once the year has turned unprepared — today's. */
  target: {
    year: number;
    exists: boolean;
    status: string | null;
    activeBudgets: number;
    /** (quota, employee) pairs entitled last year with no entitlement for this one. */
    missingEntitlements: number;
    /** Informational only: a missing budget rate falls back to the latest one and breaks nothing. */
    hasBudgetRate: boolean;
  };
  /** Target exists, is OPEN, has an ACTIVE budget, and no entitlement is missing. */
  ready: boolean;
  /** Within {@link READINESS_WINDOW_DAYS} of the current year's end. */
  inWindow: boolean;
  /** Set when budget documents cannot be started today — the year turned unprepared. */
  blockedNow: YearBlock | null;
}

/**
 * What the next fiscal year still lacks, for one company — counts and flags only, never an amount.
 *
 * Nothing prepares a year on its own: the year, its approved budgets and the per-person quota
 * entitlements are each a decision someone has to take. This read is how the people who take them
 * find out a month ahead, instead of from a requester on the first working day of January.
 */
@Injectable()
export class FiscalYearReadinessService {
  constructor(
    private readonly em: EntityManager,
    private readonly fiscalYears: FiscalYearService,
  ) {}

  async read(companyId: string, now: Date = new Date()): Promise<FiscalYearReadiness> {
    const em = this.em.fork();
    const today = await this.fiscalYears.todayFor(companyId, now);

    const current = await em.findOne(
      FiscalYear,
      { company: companyId, startDate: { $lte: today }, endDate: { $gte: today } },
      FILTER_OFF,
    );
    const blockedNow = await this.fiscalYears.budgetBlockOn(today, companyId);

    // While today is covered, the year being prepared is the next one. Once the year has turned and
    // nothing covers today, it is today's own year that is missing.
    const targetYear = current && !blockedNow ? current.year + 1 : current?.year ?? Number(today.slice(0, 4));
    const target = await em.findOne(FiscalYear, { company: companyId, year: targetYear }, FILTER_OFF);

    const activeBudgets = target
      ? await em.count(Budget, { fiscalYear: target.id, status: 'ACTIVE' }, FILTER_OFF)
      : 0;
    const missingEntitlements = await this.missingEntitlements(em, companyId, targetYear);
    const hasBudgetRate = target
      ? (await em.count(
          ExchangeRate,
          {
            rateType: 'BUDGET_RATE',
            rateDate: { $gte: target.startDate, $lte: target.endDate },
            $or: [{ company: companyId }, { company: null }],
          },
          FILTER_OFF,
        )) > 0
      : false;

    const daysLeft = current ? daysBetween(today, current.endDate) : null;
    const ready = !!target && target.status === 'OPEN' && activeBudgets > 0 && missingEntitlements === 0;

    return {
      today,
      current: current ? { year: current.year, endDate: current.endDate, status: current.status } : null,
      daysLeft,
      target: {
        year: targetYear,
        exists: !!target,
        status: target?.status ?? null,
        activeBudgets,
        missingEntitlements,
        hasBudgetRate,
      },
      ready,
      inWindow: daysLeft !== null && daysLeft <= READINESS_WINDOW_DAYS,
      blockedNow,
    };
  }

  /** Whether admins should hear about it today: inside the window and not ready, or already blocked. */
  static needsWarning(r: FiscalYearReadiness): boolean {
    return !!r.blockedNow || (r.inWindow && !r.ready);
  }

  /**
   * Pairs entitled in the year before `year` that hold nothing for `year`. Quotas that never reset
   * are left out: an entitlement that does not belong to a year is not missing from the next one.
   */
  private async missingEntitlements(em: EntityManager, companyId: string, year: number): Promise<number> {
    const scope = { quota: { company: companyId, resetCycle: { $ne: 'NONE' } } };
    const [before, after] = await Promise.all([
      em.find(QuotaEntitlement, { ...scope, year: year - 1 }, { ...FILTER_OFF, fields: ['quota', 'employee'] }),
      em.find(QuotaEntitlement, { ...scope, year }, { ...FILTER_OFF, fields: ['quota', 'employee'] }),
    ]);
    const have = new Set(after.map((e) => `${e.quota.id}:${e.employee.id}`));
    return before.filter((e) => !have.has(`${e.quota.id}:${e.employee.id}`)).length;
  }
}

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
