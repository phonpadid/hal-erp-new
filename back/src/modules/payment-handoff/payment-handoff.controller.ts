import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
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
  ) {}

  /** Ready-to-pay queue for the active company (accounting pulls payables). */
  @Get('handoffs')
  @RequirePermissions(P.PAYMENT_VIEW)
  handoffs() {
    return this.handoff.readyToPay();
  }

  /** Record an actual payment at its real rate; returns the FX gain/loss breakdown. */
  @Post(':documentId')
  @HttpCode(200)
  @RequirePermissions(P.PAYMENT_MANAGE)
  record(@Param('documentId', ParseUUIDPipe) documentId: string, @Body() dto: RecordPaymentDto) {
    return this.payments.record(documentId, dto.actualRate, dto.whtTaxCodeId);
  }
}
