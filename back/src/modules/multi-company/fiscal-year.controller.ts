import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CreateFiscalYearDto, UpdateFiscalYearDto } from './dto/fiscal-year.dto';
import { FiscalYearService } from './fiscal-year.service';
import { MultiCompanyPermissions as P } from './permissions';

@Controller('fiscal-years')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FiscalYearController {
  constructor(private readonly fiscalYears: FiscalYearService) {}

  @Post()
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  create(@Body() dto: CreateFiscalYearDto) {
    return this.fiscalYears.create(dto);
  }

  @Get()
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  list(@Query() q: PaginationQueryDto) {
    return this.fiscalYears.list(q);
  }

  @Get(':id')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYears.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFiscalYearDto,
  ) {
    return this.fiscalYears.update(id, dto);
  }

  @Post(':id/close')
  @RequirePermissions(P.FISCAL_YEAR_MANAGE)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYears.close(id);
  }
}
