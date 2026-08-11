import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import { AccountingPeriodStatus, PeriodAction } from '../../../common/enums';
import { CompanyScopeService } from '../../../common/scope/company-scope.service';
import { Company, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { JournalService } from '../../gl/journal.service';
import { AccountingPeriod, AccountingPeriodLog } from './accounting-period.entities';

const FILTER_OFF = { filters: { company: false } } as const;

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

    // ③
    period.status = AccountingPeriodStatus.CLOSED;
    this.log(em, period, PeriodAction.CLOSE);
    await em.flush();
    return period;
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
