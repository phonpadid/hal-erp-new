import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import {
  CreateVendorBankAccountDto,
  UpdateVendorBankAccountDto,
} from './dto/vendor-bank-account.dto';
import { MasterDataPermissions as P } from './permissions';
import { VendorBankAccountService } from './vendor-bank-account.service';

/**
 * A vendor's payee bank accounts.
 *
 * Reads need only MASTER_VIEW; every mutation needs VENDOR_BANK_MANAGE, which is deliberately NOT
 * MASTER_MANAGE. Redirecting a payee account needs no approval, leaves no document, and pays out on
 * the next run — it must not ride along with editing a vendor's contact details.
 */
@Controller('vendors/:vendorId/bank-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorBankAccountController {
  constructor(private readonly accounts: VendorBankAccountService) {}

  @Get()
  @RequirePermissions(P.MASTER_VIEW)
  list(@Param('vendorId', ParseUUIDPipe) vendorId: string) {
    return this.accounts.list(vendorId);
  }

  /**
   * An account's change history.
   *
   * Gated on VENDOR_BANK_MANAGE rather than MASTER_VIEW: who redirected a payee, and to where, is
   * more sensitive than the account list itself.
   */
  @Get(':id/history')
  @RequirePermissions(P.VENDOR_BANK_MANAGE)
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.history(id);
  }

  @Post()
  @RequirePermissions(P.VENDOR_BANK_MANAGE)
  create(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: CreateVendorBankAccountDto,
  ) {
    return this.accounts.create(vendorId, dto);
  }

  @Patch(':id')
  @RequirePermissions(P.VENDOR_BANK_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorBankAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Patch(':id/primary')
  @RequirePermissions(P.VENDOR_BANK_MANAGE)
  setPrimary(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.setPrimary(id);
  }

  // Deactivate rather than delete: a document or an exported batch that names this account must
  // stay legible.
  @Patch(':id/deactivate')
  @RequirePermissions(P.VENDOR_BANK_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.deactivate(id);
  }
}
