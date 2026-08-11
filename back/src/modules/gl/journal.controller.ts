import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { UndeliveredQueryDto } from './dto/undelivered.dto';
import { JournalService } from './journal.service';
import { GlPermissions as P } from './permissions';

@Controller('journal')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  // Read-only: journal entries are produced by the posting engine, never via the API.
  @Get()
  @RequirePermissions(P.GL_VIEW)
  list(@Query() q: PaginationQueryDto) {
    return this.journal.list(q);
  }

  /**
   * The postings this company owes and has not delivered — what a period close asks before it
   * lets a period be closed. Read-only, so it shares GL_VIEW with the journal itself.
   */
  @Get('undelivered')
  @RequirePermissions(P.GL_VIEW)
  undelivered(@Query() q: UndeliveredQueryDto) {
    return this.journal.undelivered(q);
  }

  /**
   * Re-queue a posting the sweep gave up on. A separate permission from GL_VIEW because this
   * writes: it puts work back on the queue that the attempt bound had stopped.
   */
  @Post('undelivered/:id/requeue')
  @RequirePermissions(P.GL_POST_RETRY)
  requeue(@Param('id', ParseUUIDPipe) id: string) {
    return this.journal.requeue(id);
  }
}
