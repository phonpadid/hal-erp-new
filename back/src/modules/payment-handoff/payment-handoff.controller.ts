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
import { uploadLimits, type UploadedFile as MultipartFile } from '../../common/storage/upload';
import { PaymentAttachmentService, SLIP_MAX_SIZE_KB } from './payment-attachment.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { RecordPaymentDto } from './dto/payment.dto';
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
   * Slips: evidence that the money moved, hung off the document's payment.
   *
   * Keyed by document id like the record endpoint below — `payment` is unique per document and the
   * client is never handed the payment's own id. Declared BEFORE `@Post(':documentId')` so the
   * bare param route cannot shadow them as this controller grows.
   */
  @Post(':documentId/slips/upload')
  @RequirePermissions(P.PAYMENT_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits(SLIP_MAX_SIZE_KB) }))
  attachSlip(@Param('documentId', ParseUUIDPipe) documentId: string, @UploadedFile() file: MultipartFile) {
    return this.slips.upload(documentId, file);
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

  /** Record an actual payment at its real rate; returns the FX gain/loss breakdown. */
  @Post(':documentId')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_MANAGE)
  record(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() dto: RecordPaymentDto) {
    return this.payments.record(documentId, dto.actualRate, dto.whtTaxCodeId);
  }
}
