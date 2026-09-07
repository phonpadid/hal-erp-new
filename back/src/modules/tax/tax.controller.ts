import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CreateTaxCodeDto, ListTaxCodeQueryDto, UpdateTaxCodeDto } from './dto/tax-code.dto';
import { FileVatReturnDto } from './dto/vat-return.dto';
import { TaxService } from './tax.service';
import { TaxPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';

@Controller('tax-codes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Post()
  @RequirePermissions(P.TAX_MANAGE)
  create(@Body() dto: CreateTaxCodeDto) {
    return this.tax.create(dto);
  }

  @Get()
  @RequirePermissions(P.TAX_VIEW)
  list(@Query() q: ListTaxCodeQueryDto) {
    return this.tax.list(q, q.includeInactive ?? false);
  }

  /**
   * Active VAT codes for the document line picker. Authorized by `DOC_CREATE`, not `TAX_VIEW` —
   * the same reasoning that moved `/budgets/selectable` off `BUDGET_VIEW`.
   *
   * Whether a purchase carries VAT is something the requester knows and nobody else does, so the
   * requester has to be able to say it. Requiring the tax-master read to answer that made the
   * question unaskable: on the customer's data only `ADMIN` holds `TAX_VIEW`, so every requester
   * saw the VAT field silently disappear and raised untaxed documents for taxed purchases.
   *
   * Nothing confidential crosses: the response is the company's own active VAT codes with their
   * published statutory rates, which are printed on every invoice the requester holds. Editing
   * them is still `TAX_MANAGE`, and the server recomputes the tax from these rows at submit.
   */
  @Get('selectable-vat')
  @RequirePermissions(DocP.DOC_CREATE)
  listSelectableVat() {
    return this.tax.listSelectableVat();
  }

  // Active WHT codes for the payment-record picker.
  @Get('selectable-wht')
  @RequirePermissions(P.TAX_VIEW)
  listSelectableWht() {
    return this.tax.listSelectableWht();
  }

  // Read-only input-VAT summary by period.
  @Get('vat-summary')
  @RequirePermissions(P.TAX_VIEW)
  vatSummary() {
    return this.tax.vatSummary();
  }

  /** The VAT returns already filed, so a screen can say which months are closed to further claims. */
  @Get('vat-returns')
  @RequirePermissions(P.TAX_VIEW)
  filedReturns() {
    return this.tax.filedReturns();
  }

  /**
   * File a VAT return. Writes the ledger, so it is gated on VAT_FILE rather than on TAX_VIEW —
   * reading what a month claimed and fixing it are different acts.
   */
  @Post('vat-returns')
  @RequirePermissions(P.VAT_FILE)
  fileVatReturn(@Body() dto: FileVatReturnDto) {
    return this.tax.fileVatReturn(dto);
  }

  @Get(':id')
  @RequirePermissions(P.TAX_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tax.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.TAX_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaxCodeDto) {
    return this.tax.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.TAX_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tax.deactivate(id);
  }
}
