import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AccountingPeriodStatus } from '../../../common/enums';
import { AccountingPeriod } from './accounting-period.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Is this company's book open on this day?
 *
 * Three outcomes, and the third is the one that makes this shippable:
 *
 *   OPEN                 → write
 *   CLOSED               → refuse
 *   no period covers it  → write
 *
 * A company that has declared no period is therefore in exactly its current state — the same
 * behaviour `attendance-period` established for the other ledger ("a period that was never declared
 * blocks nothing"), so there is one rule to learn rather than two.
 *
 * Takes the caller's `EntityManager` rather than opening its own: it is asked from inside the
 * posting transaction, and reading through a second connection there would be a lock waiting to
 * happen.
 */
@Injectable()
export class PeriodGuardService {
  /** The closed period covering `date`, or null when the day is writable. */
  async closedPeriodOn(
    em: EntityManager,
    companyId: string,
    date: string,
  ): Promise<AccountingPeriod | null> {
    return em.findOne(
      AccountingPeriod,
      {
        company: companyId,
        status: AccountingPeriodStatus.CLOSED,
        periodStart: { $lte: date },
        periodEnd: { $gte: date },
      },
      FILTER_OFF,
    );
  }

  /**
   * Throws when the day falls in a closed period. The message names the period, because the person
   * who reads it on the undelivered-postings list needs to know which month to reopen.
   */
  async assertOpen(em: EntityManager, companyId: string, date: string): Promise<void> {
    const closed = await this.closedPeriodOn(em, companyId, date);
    if (closed) {
      throw new Error(
        `Accounting period '${closed.code}' (${closed.periodStart} to ${closed.periodEnd}) is ` +
          `closed; no entry may be dated ${date}`,
      );
    }
  }
}
