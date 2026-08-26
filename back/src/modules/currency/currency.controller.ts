import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CurrencyService } from './currency.service';
import { CreateCurrencyDto, UpdateCurrencyDto } from './dto/currency.dto';
import { CurrencyPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';

// `:code` is an ISO 4217 code (string PK), not a UUID — no ParseUUIDPipe here.
@Controller('currencies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CurrencyController {
  constructor(private readonly currencies: CurrencyService) {}

  @Post()
  @RequirePermissions(P.CURRENCY_MANAGE)
  create(@Body() dto: CreateCurrencyDto) {
    return this.currencies.create(dto);
  }

  @Get()
  @RequirePermissions(P.CURRENCY_VIEW)
  list(
    @Query() q: SearchablePaginationQueryDto,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.currencies.list(q, includeInactive ?? false);
  }

  // Currency picker for the Create Document wizard. Authorized by DOC_CREATE (not
  // CURRENCY_VIEW), active-only, picker fields only. Declared before :code so the literal
  // path is not captured as a currency code.
  @Get('selectable')
  @RequirePermissions(DocP.DOC_CREATE)
  listSelectable() {
    return this.currencies.listSelectable();
  }

  @Get(':code')
  @RequirePermissions(P.CURRENCY_VIEW)
  get(@Param('code') code: string) {
    return this.currencies.get(code);
  }

  @Patch(':code')
  @RequirePermissions(P.CURRENCY_MANAGE)
  update(@Param('code') code: string, @Body() dto: UpdateCurrencyDto) {
    return this.currencies.update(code, dto);
  }

  @Delete(':code')
  @HttpCode(204)
  @RequirePermissions(P.CURRENCY_MANAGE)
  deactivate(@Param('code') code: string) {
    return this.currencies.deactivate(code);
  }
}
