import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { RequestContext } from '../../common/context/request-context';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { CreateExchangeRateDto, ResolveRateQueryDto } from './dto/exchange-rate.dto';
import { ExchangeRateService } from './exchange-rate.service';
import { CurrencyPermissions as P } from './permissions';

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExchangeRateController {
  constructor(private readonly rates: ExchangeRateService) {}

  @Post()
  @RequirePermissions(P.CURRENCY_MANAGE)
  create(@Body() dto: CreateExchangeRateDto) {
    return this.rates.createRate(dto);
  }

  @Get()
  @RequirePermissions(P.CURRENCY_VIEW)
  list(
    @Query() q: PaginationQueryDto,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('rateType') rateType?: string,
  ) {
    return this.rates.list({ from, to, rateType }, q);
  }

  // Resolve a rate as of a date for the active company (company override applies).
  @Get('resolve')
  @RequirePermissions(P.CURRENCY_VIEW)
  resolve(@Query() query: ResolveRateQueryDto) {
    return this.rates.resolveRate({
      from: query.from,
      to: query.to,
      asOf: query.asOf,
      rateType: query.rateType,
      companyId: RequestContext.companyId(),
    });
  }
}
