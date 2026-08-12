import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { PostJournalVoucherDto, ReverseEntryDto } from './dto/journal-voucher.dto';
import { UndeliveredQueryDto } from './dto/undelivered.dto';
import { JournalService } from './journal.service';
import { JournalVoucherService } from './journal-voucher.service';
import { GlPermissions as P } from './permissions';

@Controller('journal')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalController {
  constructor(
    private readonly journal: JournalService,
    private readonly vouchers: JournalVoucherService,
  ) {}

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
   * The vendors this company owes and has not paid — derived from the journal, so it cannot
   * disagree with the balance-sheet figure it breaks down.
   */
  @Get('open-payables')
  @RequirePermissions(P.GL_VIEW)
  openPayables(@Query() q: PaginationQueryDto) {
    return this.journal.openPayables(q);
  }

  /**
   * The ageing bands and their totals. Computed on the server because the band a payable falls in
   * depends on the COMPANY's day, which the browser does not know.
   *
   * Declared beside the list rather than under a parameterised route, so nothing can shadow it.
   */
  @Get('open-payables/ageing')
  @RequirePermissions(P.GL_VIEW)
  payablesAgeing() {
    return this.journal.payablesAgeing();
  }

  /**
   * Write the entry no event produces: depreciation, an accrual, opening balances, a correction.
   *
   * The largest privilege in the system, and guarded by a permission rather than by an approval
   * route — see `GL_JV_POST`. Everything it writes is balanced, dated in the company's day, refused
   * in a closed period, attributed, and correctable only by an equally visible reversal.
   */
  @Post('vouchers')
  @RequirePermissions(P.GL_JV_POST)
  postVoucher(@Body() dto: PostJournalVoucherDto) {
    return this.vouchers.post(dto);
  }

  /** Correct an entry by writing its opposite. Any entry, once. */
  @Post(':id/reverse')
  @RequirePermissions(P.GL_JV_POST)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseEntryDto) {
    return this.vouchers.reverse(id, dto);
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
