import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { SuccessorSweeper } from './successor-sweeper.service';

interface OutcomeEvent {
  documentId: string;
  status: string;
  requesterId: string;
}

/**
 * Drives the CREATE_SUCCESSOR outbox.
 *
 * The event is the normal path — a completed document's successors appear right after approval, so
 * the interval below is a BACKSTOP, not the mechanism. It exists because an event is not durable:
 * a restart or a dropped handler between commit and delivery would otherwise strand the obligation
 * as PENDING forever, which is the very failure this change removes. The obligation is in the
 * database, so the timer can always find it.
 *
 * One minute: long enough that an idle sweep costs nothing (the claim query is indexed on
 * (status, created_at) and normally matches no rows), short enough that a missed event is invisible
 * to a requester still looking at the document they just had approved.
 */
@Injectable()
export class SuccessorSweeperScheduler {
  private readonly logger = new Logger(SuccessorSweeperScheduler.name);

  constructor(private readonly sweeper: SuccessorSweeper) {}

  @OnEvent('approval.outcome')
  async onOutcome(e: OutcomeEvent): Promise<void> {
    if (e.status !== 'COMPLETED') return;
    await this.sweep();
  }

  @Interval(60 * 1000)
  async backstop(): Promise<void> {
    await this.sweep();
  }

  /**
   * Never throws: a sweep failure must not fail the approval whose event triggered it, nor kill
   * the interval. Individual rows already record their own failures — this only guards the scan.
   */
  private async sweep(): Promise<void> {
    try {
      const n = await this.sweeper.scanPending();
      if (n > 0) this.logger.log(`Successor sweep created ${n} document(s)`);
    } catch (e) {
      this.logger.error(`Successor sweep failed: ${(e as Error).message}`);
    }
  }
}
