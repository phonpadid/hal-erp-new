import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { multipartOptions, type UploadedFile as MultipartFile } from '../../common/storage/upload';
import { PaymentAttachmentService, SLIP_MAX_SIZE_KB } from './payment-attachment.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { AttachSlipDto, RecordPaymentDto, SlipStatusDto, StateRateDto } from './dto/payment.dto';
import { PaymentPermissions as P } from './permissions';

@Controller('payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentHandoffController {
  constructor(
    private readonly handoff: PaymentHandoffService,
    private readonly payments: PaymentService,
    private readonly slips: PaymentAttachmentService,
  ) {}

  /** Ready-to-pay queue for the active company (accounting pulls payables). */
  @Get('handoffs')
  @RequirePermissions(P.PAYMENT_VIEW)
  handoffs() {
    return this.handoff.readyToPay();
  }

  /**
   * Transfer-slip state for a page of documents (documents-list status column): documentId →
   * 'PENDING' | 'UPLOADED'. Only CUT_BUDGET documents appear; others are omitted. A POST because
   * it carries a body of ids, but it is a pure read. Declared before `@Post(':documentId')` so the
   * bare-param route can't shadow it.
   */
  @Post('slip-status')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_VIEW)
  slipStatus(@Body() dto: SlipStatusDto) {
    return this.handoff.slipStatus(dto.documentIds);
  }

  /**
   * Slips: evidence that the money moved, hung off the document's payment.
   *
   * Keyed by document id like the record endpoint below — `payment` is unique per document and the
   * client is never handed the payment's own id. Declared BEFORE `@Post(':documentId')` so the
   * bare param route cannot shadow them as this controller grows.
   */
  @Post(':documentId/slips/upload')
  @RequirePermissions(P.PAYMENT_MANAGE)
  @UseInterceptors(FileInterceptor('file', multipartOptions(SLIP_MAX_SIZE_KB)))
  attachSlip(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AttachSlipDto,
    @UploadedFile() file: MultipartFile,
  ) {
    return this.slips.upload(documentId, file, dto.transferFrom, dto.actualRate);
  }

  /**
   * State the rate this document's money was converted at, without attaching anything.
   *
   * Declared beside the slip routes because it is the same act — finance saying what they paid —
   * minus the file. It exists because a rate that could only travel with an upload was a rate that
   * got typed and discarded: with no new slip to attach, a correction went nowhere and the screen
   * showed no error, because nothing was sent.
   */
  @Post(':documentId/rate')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_MANAGE)
  stateRate(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() dto: StateRateDto) {
    return this.slips.stateRate(documentId, dto.actualRate);
  }

  @Get(':documentId/slips')
  @RequirePermissions(P.PAYMENT_VIEW)
  listSlips(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.slips.list(documentId);
  }

  @Get(':documentId/slips/:slipId/download-url')
  @RequirePermissions(P.PAYMENT_VIEW)
  slipDownloadUrl(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('slipId', ParseUUIDPipe) slipId: string,
  ) {
    return this.slips.downloadUrl(documentId, slipId);
  }

  /** Its own permission: removing evidence is not implied by being allowed to record a payment. */
  @Delete(':documentId/slips/:slipId')
  @HttpCode(204)
  @RequirePermissions(P.PAYMENT_SLIP_DELETE)
  async deleteSlip(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('slipId', ParseUUIDPipe) slipId: string,
  ) {
    await this.slips.remove(documentId, slipId);
  }

  /**
   * Record an actual payment at its real rate; returns the FX gain/loss breakdown.
   *
   * Multipart, because the evidence arrives WITH the record. A payment no bank batch produced has
   * nothing else proving the money moved, and recording it first and asking for the file afterwards
   * leaves a payment nobody is obliged to justify — with no way to tell one that will be evidenced
   * from one that never will be.
   */
  @Post(':documentId')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_MANAGE)
  @UseInterceptors(FileInterceptor('file', multipartOptions(SLIP_MAX_SIZE_KB)))
  record(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: RecordPaymentDto,
    @UploadedFile() file?: MultipartFile,
  ) {
    return this.payments.record(documentId, { ...dto, file });
  }
}
