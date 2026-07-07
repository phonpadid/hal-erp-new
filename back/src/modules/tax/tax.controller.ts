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
import { TaxService } from './tax.service';
import { TaxPermissions as P } from './permissions';

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

  // Active VAT codes for the document line picker.
  @Get('selectable-vat')
  @RequirePermissions(P.TAX_VIEW)
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
