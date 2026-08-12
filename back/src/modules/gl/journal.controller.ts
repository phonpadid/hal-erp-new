import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { PostJournalVoucherDto, RejectVoucherDto, ReverseEntryDto } from './dto/journal-voucher.dto';
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
  /**
   * Submit the entry no event produces, for approval. Writes nothing to the ledger — approving does.
   *
   * There is deliberately no direct-post endpoint beside this one: a bypass standing next to a
   * control is not a control.
   */
  @Post('vouchers')
  @RequirePermissions(P.GL_JV_POST)
  submitVoucher(@Body() dto: PostJournalVoucherDto) {
    return this.vouchers.submit(dto);
  }

  /** What a checker is being asked to accept. */
  @Get('vouchers/pending')
  @RequirePermissions(P.GL_VIEW)
  pendingVouchers() {
    return this.vouchers.pending();
  }

  /** Posts it. Refused for the person who submitted it, whatever codes they hold. */
  @Post('vouchers/:id/approve')
  @RequirePermissions(P.GL_JV_APPROVE)
  approveVoucher(@Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.approve(id);
  }

  @Post('vouchers/:id/reject')
  @RequirePermissions(P.GL_JV_APPROVE)
  rejectVoucher(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectVoucherDto) {
    return this.vouchers.reject(id, dto.reason);
  }

  /** The author's own second thoughts — a checker who wants one gone rejects it, on the record. */
  @Post('vouchers/:id/withdraw')
  @RequirePermissions(P.GL_JV_POST)
  withdrawVoucher(@Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.withdraw(id);
  }

  /** Correct an entry by submitting its opposite. Any entry, once — and through the same checker. */
  @Post(':id/reverse')
  @RequirePermissions(P.GL_JV_POST)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseEntryDto) {
    return this.vouchers.submitReversal(id, dto);
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
