import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { GlPostingSweeper } from './gl-posting-sweeper.service';

/**
 * Drives the GL posting sweep.
 *
 * Unlike the successor outbox, there is no event to be the normal path here: the posting listeners
 * already ran when the business event fired, and everything this sweep sees is what those listeners
 * failed to finish or never got to attempt. The timer IS the mechanism, not a backstop.
 *
 * One minute, matching the successor sweeper. An idle pass is two indexed queries that normally
 * match nothing, and a minute is short enough that an operator who has just mapped the account a
 * posting was waiting on sees it land while still looking at the screen.
 */
@Injectable()
export class GlPostingSweeperScheduler {
  private readonly logger = new Logger(GlPostingSweeperScheduler.name);

  constructor(private readonly sweeper: GlPostingSweeper) {}

  @Interval(60 * 1000)
  async run(): Promise<void> {
    // Never throws: a sweep failure must not kill the interval, and individual sources already
    // record their own failures — this only guards the scan around them.
    try {
      const { reconciled, posted } = await this.sweeper.sweep();
      if (posted > 0 || reconciled > 0) {
        this.logger.log(`GL posting sweep: ${reconciled} reconciled, ${posted} posted`);
      }
    } catch (e) {
      this.logger.error(`GL posting sweep failed: ${(e as Error).message}`);
    }
  }
}
