import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CertifyWhtDto, RemitWhtDto } from './dto/wht.dto';
import { TaxPermissions as P } from './permissions';
import { WhtService } from './wht.service';

@Controller('wht')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WhtController {
  constructor(private readonly wht: WhtService) {}

  /** What the company still owes the revenue authority: certificates issued and not yet remitted. */
  @Get('outstanding')
  @RequirePermissions(P.TAX_VIEW)
  outstanding() {
    return this.wht.outstanding();
  }

  @Post('payments/:paymentId/certificate')
  @RequirePermissions(P.WHT_CERTIFY)
  certify(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: CertifyWhtDto) {
    return this.wht.certify(paymentId, dto.issuedOn);
  }

  /** Clears WHT_PAYABLE by the certificates' total, not by the account's balance. */
  @Post('remittances')
  @RequirePermissions(P.WHT_REMIT)
  remit(@Body() dto: RemitWhtDto) {
    return this.wht.remit(dto);
  }
}
