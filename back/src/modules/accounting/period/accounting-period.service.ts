import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import { AccountRoleType, AccountingPeriodStatus, PeriodAction } from '../../../common/enums';
import { Money } from '../../../common/money/money';
import { CompanyScopeService } from '../../../common/scope/company-scope.service';
import { Company, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { Account } from '../accounting.entities';
import { AccountRoleService } from '../../gl/account-role.service';
import {
  createEntry, SOURCE_PERIOD_ACCRUAL, SOURCE_PERIOD_ACCRUAL_REVERSAL,
} from '../../gl/gl-posting.service';
import { JournalEntry } from '../../gl/gl.entities';
import { JournalService } from '../../gl/journal.service';
import { ReceivedNotInvoicedService } from '../../gl/received-not-invoiced.service';
import { PeriodGuardService } from './period-guard.service';
import { AccountingPeriod, AccountingPeriodLog } from './accounting-period.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** `YYYY-MM-DD` plus n days — the reversal lands the day after the period ends. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DeclarePeriodInput {
  fiscalYearId: string;
  code: string;
  periodStart: string;
  periodEnd: string;
}

/**
 * A company's book months: declaring them, closing them, and reopening them.
 *
 * The close is the whole point, and it is not a status change. Postings run AFTER their business
 * transaction commits — deliberately, so a chart-of-accounts fault can never roll back an approval
 * — which means at the moment of a close there may be work already committed whose entry has not
 * been written. Refusing those entries afterwards would lose them; accepting them would make the
 * close meaningless. So a close first establishes that the period is DRAINED, by asking the
 * undelivered-postings read the question it was built to answer.
 */
@Injectable()
export class AccountingPeriodService {
  constructor(
    private readonly companyScope: CompanyScopeService,
    private readonly journal: JournalService,
    private readonly received: ReceivedNotInvoicedService,
    private readonly roles: AccountRoleService,
    private readonly periods: PeriodGuardService,
  ) {}

  list(): Promise<AccountingPeriod[]> {
    return this.companyScope
      .forActiveCompany()
      .find(AccountingPeriod, {}, { orderBy: { periodStart: 'ASC' } });
  }

  /**
   * Declare a period. The range is taken exactly as given — a company whose books run 26th to 25th
   * has to be able to say so, which is why this is not a year and a month.
   */
  async declare(input: DeclarePeriodInput): Promise<AccountingPeriod> {
    const em = this.companyScope.forActiveCompany();
    const companyId = RequestContext.companyId()!;

    if (input.periodEnd < input.periodStart) {
      throw new BadRequestException(
        `Period end ${input.periodEnd} precedes its start ${input.periodStart}`,
      );
    }
    const fy = await em.findOne(FiscalYear, { id: input.fiscalYearId });
    if (!fy) throw new NotFoundException(`Fiscal year ${input.fiscalYearId} not found`);
    if (input.periodStart < fy.startDate || input.periodEnd > fy.endDate) {
      throw new BadRequestException(
        `${input.periodStart} to ${input.periodEnd} falls outside fiscal year ${fy.year} ` +
          `(${fy.startDate} to ${fy.endDate})`,
      );
    }
    await this.assertNoOverlap(em, companyId, input.periodStart, input.periodEnd);

    const period = em.create(AccountingPeriod, {
      company: em.getReference(Company, companyId),
      fiscalYear: fy,
      code: input.code,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: AccountingPeriodStatus.OPEN,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return period;
  }

  /**
   * OPEN → CLOSED, in three steps and in this order.
   *
   * The readiness check is step two rather than an afterthought: a close that merely sets a flag
   * leaves whatever was in flight to be refused afterwards, which loses entries the business
   * already committed — the one outcome worse than not closing at all.
   */
  async close(periodId: string): Promise<AccountingPeriod> {
    const em = this.companyScope.forActiveCompany();
    const period = await this.require(em, periodId);
    if (period.status === AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException(`Period '${period.code}' is already closed`);
    }

    // ① Every statement is cumulative, so a month closed out of order fixes figures that an
    //    earlier, still-movable month feeds.
    const earlierOpen = await em.findOne(AccountingPeriod, {
      periodStart: { $lt: period.periodStart },
      status: AccountingPeriodStatus.OPEN,
    });
    if (earlierOpen) {
      throw new BadRequestException(
        `Period '${earlierOpen.code}' (${earlierOpen.periodStart} to ${earlierOpen.periodEnd}) is ` +
          `still open; close it before '${period.code}'`,
      );
    }

    // ② Drain, then lock. The read already knows SKIPPED is terminal, which is exactly why it can
    //    be trusted here — re-deriving "what counts as outstanding" would put that rule in two
    //    places and let them drift.
    //
    //    Asked for the WHOLE company, not for this period's range. An undelivered posting has no
    //    entry, and therefore no date in the books: which month it will land in is knowable only
    //    once it is delivered. Bounding the question by date would have to guess that answer from
    //    the source — re-deriving, outside `createEntry`, the very thing `createEntry` exists to
    //    decide once. Being strict is the honest reading, and its escape hatch (deliver it, or
    //    re-queue it, or resolve why it cannot post) is the behaviour we want anyway.
    const owed = await this.journal.undelivered({ limit: 20 });
    if (owed.total > 0) {
      const sample = owed.items
        .slice(0, 5)
        .map((r) => `${r.sourceType} ${r.sourceDocNo ?? r.sourceId}`)
        .join(', ');
      throw new BadRequestException(
        `Period '${period.code}' still owes ${owed.total} posting(s): ${sample}` +
          `${owed.total > 5 ? ', …' : ''}. Deliver or re-queue them before closing.`,
      );
    }

    // ③ Recognise what was received and not yet invoiced, and post the reversal that unwinds it —
    //    both before the status flips, so a failure here leaves the period open rather than closed
    //    and incomplete. Unlike an event-driven posting, a close is a synchronous act: its caller
    //    can map the missing account and try again.
    await this.accrue(period);

    // ④
    period.status = AccountingPeriodStatus.CLOSED;
    this.log(em, period, PeriodAction.CLOSE);
    await em.flush();
    return period;
  }

  /**
   * The period's accrual for what was received and not invoiced, and its reversal.
   *
   * Both are posted in ONE operation. A reversal that is a future intention is how the same expense
   * gets recognised twice: the accrual stands in the closed month, the invoice arrives in the next,
   * and nothing removes the first unless somebody remembers. Posting the pair together makes
   * forgetting impossible rather than unlikely.
   *
   * Both are keyed by the period's id, so a re-close is a no-op. The consequence, stated because it
   * is a real limitation: the figure belongs to the close that COMPUTED it. A reopen-and-reclose
   * does not recompute, and a changed figure is corrected by reversing the accrual and posting a
   * voucher — both of which an operator can now do, and both of which leave a trail.
   */
  private async accrue(period: AccountingPeriod): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    // Already accrued by an earlier close: the period's figure is the one it computed.
    const existing = await em.findOne(JournalEntry, {
      sourceType: SOURCE_PERIOD_ACCRUAL,
      sourceId: period.id,
    });
    if (existing) return;

    const outstanding = await this.received.outstanding(companyId, period.periodEnd);
    // Nothing received-and-uninvoiced posts NOTHING: no zero-value voucher, no empty entry.
    if (!outstanding.length) return;

    const accrued = await this.roles.resolve(companyId, AccountRoleType.ACCRUED_EXPENSE, em);
    let total = '0';
    const lines: Array<{ account: Account; debit: string; credit: string }> = [];
    for (const o of outstanding) {
      total = Money.add(total, o.amount);
      lines.push({ account: o.account, debit: o.amount, credit: '0' });
    }
    lines.push({ account: accrued, debit: '0', credit: total });

    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const dayAfter = addDays(period.periodEnd, 1);

    await em.transactional(async (tem) => {
      await createEntry(
        tem,
        {
          company,
          instant: new Date(`${period.periodEnd}T12:00:00Z`),
          sourceType: SOURCE_PERIOD_ACCRUAL,
          sourceId: period.id,
          memo: `Accrued expense for ${period.code} — reverses ${dayAfter}`,
          createdById: RequestContext.userId(),
          lines,
        },
        this.periods,
      );
      await createEntry(
        tem,
        {
          company,
          instant: new Date(`${dayAfter}T12:00:00Z`),
          sourceType: SOURCE_PERIOD_ACCRUAL_REVERSAL,
          sourceId: period.id,
          memo: `Reversal of accrued expense for ${period.code}`,
          createdById: RequestContext.userId(),
          // The pair: every side exchanged, so the two net to nothing across both months.
          lines: lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
        },
        this.periods,
      );
    });
  }

  /**
   * CLOSED → OPEN, with a reason and on its own permission.
   *
   * A close is not a promise the figures were right; it is a statement that they were final at a
   * moment. Sometimes they were wrong, and refusing to reopen makes the correction happen somewhere
   * worse — a back-dated entry into the next period, or a spreadsheet.
   */
  async reopen(periodId: string, reason: string): Promise<AccountingPeriod> {
    const em = this.companyScope.forActiveCompany();
    const period = await this.require(em, periodId);
    if (period.status !== AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException(`Period '${period.code}' is not closed`);
    }
    if (!reason?.trim()) {
      throw new BadRequestException('Reopening a period requires a reason');
    }

    // Reopening a month underneath a closed one would let its figures move after the later month's
    // comparatives were already fixed.
    const laterClosed = await em.findOne(AccountingPeriod, {
      periodStart: { $gt: period.periodStart },
      status: AccountingPeriodStatus.CLOSED,
    });
    if (laterClosed) {
      throw new BadRequestException(
        `Period '${laterClosed.code}' is closed and depends on '${period.code}' being final; ` +
          `reopen the later period first`,
      );
    }

    period.status = AccountingPeriodStatus.OPEN;
    this.log(em, period, PeriodAction.REOPEN, reason.trim());
    await em.flush();
    return period;
  }

  private log(
    em: EntityManager,
    period: AccountingPeriod,
    action: PeriodAction,
    reason?: string,
  ): void {
    const userId = RequestContext.userId();
    em.persist(
      em.create(AccountingPeriodLog, {
        period,
        action,
        actedBy: em.getReference(AppUser, userId!),
        actedAt: new Date(),
        reason,
      } as never),
    );
  }

  private async require(em: EntityManager, periodId: string): Promise<AccountingPeriod> {
    const period = await em.findOne(AccountingPeriod, { id: periodId });
    if (!period) throw new NotFoundException(`Accounting period ${periodId} not found`);
    return period;
  }

  /**
   * No two periods of one company may overlap, or "is this date closed?" has more than one answer
   * and the guard depends on it having exactly one. Gaps are allowed: a company that never declares
   * August simply has no August to close, and August stays writable.
   */
  private async assertNoOverlap(
    em: EntityManager,
    companyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<void> {
    const clash = await em.findOne(
      AccountingPeriod,
      {
        company: companyId,
        periodStart: { $lte: periodEnd },
        periodEnd: { $gte: periodStart },
      },
      FILTER_OFF,
    );
    if (clash) {
      throw new BadRequestException(
        `${periodStart} to ${periodEnd} overlaps period '${clash.code}' ` +
          `(${clash.periodStart} to ${clash.periodEnd}); a date must belong to at most one period`,
      );
    }
  }
}
