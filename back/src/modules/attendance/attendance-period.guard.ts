import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendancePeriodStatus } from '../../common/enums';
import { AttendancePeriod } from './attendance.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The one place that answers "is this date closed?".
 *
 * Four services need the answer — the daily projection, corrections, leave and overtime — and four
 * copies of the query would be four chances for one of them to drift. It is a separate provider
 * rather than a method on the period service so that depending on it costs nothing: the gate needs
 * the entity manager and no other part of the module.
 *
 * The rule it enforces follows from one decision: a day inside a closed period is not recomputed.
 * Anything that could only take effect BY recomputing such a day is therefore refused at the point
 * it is raised, rather than accepted into silence. Recording what happened is a different act — the
 * capture path deliberately does not consult this guard, and the ledger stays open.
 */
@Injectable()
export class AttendancePeriodGuard {
  constructor(private readonly em: EntityManager) {}

  /** The CLOSED period covering a date, if any. */
  async closedPeriodOn(
    companyId: string,
    date: string,
    em?: EntityManager,
  ): Promise<AttendancePeriod | null> {
    const m = em ?? this.em;
    const day = date.slice(0, 10);
    return m.findOne(
      AttendancePeriod,
      {
        company: companyId,
        status: AttendancePeriodStatus.CLOSED,
        periodStart: { $lte: day },
        periodEnd: { $gte: day },
      },
      FILTER_OFF,
    );
  }

  /** The CLOSED periods a range touches, in date order. */
  async closedPeriodsOverlapping(
    companyId: string,
    from: string,
    to: string,
    em?: EntityManager,
  ): Promise<AttendancePeriod[]> {
    const m = em ?? this.em;
    return m.find(
      AttendancePeriod,
      {
        company: companyId,
        status: AttendancePeriodStatus.CLOSED,
        periodStart: { $lte: to.slice(0, 10) },
        periodEnd: { $gte: from.slice(0, 10) },
      },
      { ...FILTER_OFF, orderBy: { periodStart: 'ASC' } },
    );
  }

  /**
   * Refuse when a date sits inside a closed period. A company that has declared no periods finds
   * nothing and returns quietly, so nothing changes for one that never adopts them.
   */
  async assertOpen(companyId: string, date: string, em?: EntityManager): Promise<void> {
    const period = await this.closedPeriodOn(companyId, date, em);
    if (period) throw new BadRequestException(describe(date, period));
  }

  /**
   * Refuse when ANY date of a range sits inside a closed period.
   *
   * A range straddling the edge is refused in full rather than trimmed: half an approved leave, or
   * half a certified claim, is not a state those records can represent, and quietly accepting the
   * open half would answer a question the requester did not ask.
   */
  async assertRangeOpen(
    companyId: string,
    from: string,
    to: string,
    em?: EntityManager,
  ): Promise<void> {
    const [period] = await this.closedPeriodsOverlapping(companyId, from, to, em);
    if (period) {
      throw new BadRequestException(
        `${from.slice(0, 10)} to ${to.slice(0, 10)} reaches into the closed period ` +
          `'${period.code}' (${period.periodStart} to ${period.periodEnd}). ` +
          `Reopen that period, or raise this for dates outside it.`,
      );
    }
  }

  /** Which of a set of dates are inside a closed period — used to skip rather than to refuse. */
  async closedDatesIn(
    companyId: string,
    from: string,
    to: string,
    em?: EntityManager,
  ): Promise<(date: string) => boolean> {
    const periods = await this.closedPeriodsOverlapping(companyId, from, to, em);
    if (periods.length === 0) return () => false;
    return (date: string) =>
      periods.some((p) => p.periodStart <= date && date <= p.periodEnd);
  }
}

function describe(date: string, period: AttendancePeriod): string {
  return (
    `${date.slice(0, 10)} falls inside the closed period '${period.code}' ` +
    `(${period.periodStart} to ${period.periodEnd}). A closed period is not recomputed, so this ` +
    `would have no effect — reopen the period first.`
  );
}
