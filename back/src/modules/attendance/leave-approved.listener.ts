import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { Document } from '../document/document.entities';
import { AttendanceDayService } from './attendance-day.service';
import { LeaveRequest } from './attendance.entities';
import { eachDate } from './shift-resolution.service';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Refreshes the days a leave covers once the leave is approved.
 *
 * Listens to `approval.outcome`, which the router emits AFTER its transaction commits. That
 * ordering is the whole design: a human decision must not be discarded because a derived number
 * could not be written, so this runs outside the approval's transaction and a failure here leaves
 * the approval standing.
 *
 * It stays quiet about nothing, though. A failure is logged, and because `attendance_day` carries
 * `computed_at` and the document carries `approved_at`, a day that never caught up remains
 * findable by comparing the two — which is what `staleLeaveDays` reads.
 *
 * Decoupled by event for the same reason approval routing is: the build order runs
 * document → approval → attendance, and a direct call would invert it.
 */
@Injectable()
export class LeaveApprovedListener {
  private readonly logger = new Logger(LeaveApprovedListener.name);

  constructor(
    private readonly em: EntityManager,
    private readonly days: AttendanceDayService,
  ) {}

  @OnEvent('approval.outcome')
  async onOutcome(payload: { documentId: string; status: string }): Promise<void> {
    // Only a fully approved document excuses an absence. A rejection releases the quota through
    // the existing auto-release path and leaves the days as they were.
    if (payload.status !== 'COMPLETED' && payload.status !== 'APPROVED') return;

    const em = this.em.fork();
    const leave = await em.findOne(
      LeaveRequest,
      { document: payload.documentId },
      { ...FILTER_OFF, populate: ['employee'] },
    );
    if (!leave) return; // not a leave document

    const document = await em.findOne(Document, { id: payload.documentId }, FILTER_OFF);
    if (!document) return;

    try {
      // The router runs outside a request context, so the company scope is supplied explicitly.
      await RequestContext.run({ companyId: document.company.id, grants: [] }, () =>
        this.days.recomputeRange(leave.employee.id, leave.fromDate, leave.toDate),
      );
    } catch (err) {
      // Deliberately swallowed rather than rethrown: rethrowing here cannot undo the approval
      // (it already committed) and would only surface as an unhandled rejection. The days stay
      // stale and remain discoverable through the stale-leave read.
      const dates = [...eachDate(leave.fromDate, leave.toDate)].join(', ');
      this.logger.error(
        `Leave ${payload.documentId} approved but its days did not recompute (${dates}): ` +
          `${(err as Error).message}. They remain visible in the stale-leave read.`,
      );
    }
  }
}
