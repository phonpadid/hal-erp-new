import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { BankAccountService } from './bank-account.service';
import { ConfirmClearedDto, CreateBankAccountDto } from './dto/bank-account.dto';
import { PaymentPermissions as P } from './permissions';

@Controller('bank-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BankAccountController {
  constructor(private readonly banks: BankAccountService) {}

  @Get()
  @RequirePermissions(P.BANK_ACCOUNT_VIEW)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.banks.list(includeInactive === 'true');
  }

  @Post()
  @RequirePermissions(P.BANK_ACCOUNT_MANAGE)
  create(@Body() dto: CreateBankAccountDto) {
    return this.banks.create(dto);
  }

  @Delete(':id')
  @RequirePermissions(P.BANK_ACCOUNT_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.banks.deactivate(id);
  }

  /** What the books say has left and the bank has not moved. */
  @Get(':id/outstanding')
  @RequirePermissions(P.BANK_ACCOUNT_VIEW)
  outstanding(@Param('id', ParseUUIDPipe) id: string) {
    return this.banks.outstanding(id);
  }

  /**
   * Payments in flight that name no bank account. They sit in the clearing balance and belong to no
   * reconciliation, so without this read the clearing account could never be reconciled to zero.
   */
  @Get('unattributed')
  @RequirePermissions(P.BANK_ACCOUNT_VIEW)
  unattributed() {
    return this.banks.unattributed();
  }

  /** The bank confirms a payment settled: move it out of the clearing account, on the bank's date. */
  @Post('payments/:paymentId/cleared')
  @RequirePermissions(P.PAYMENT_MANAGE)
  confirmCleared(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ConfirmClearedDto,
  ) {
    return this.banks.confirmCleared(paymentId, dto.clearedOn);
  }
}
