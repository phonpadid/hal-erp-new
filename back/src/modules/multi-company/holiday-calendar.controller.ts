import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CreateHolidayDto } from './dto/holiday.dto';
import { HolidayCalendarService } from './holiday-calendar.service';
import { MultiCompanyPermissions as P } from './permissions';

@Controller('holidays')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HolidayCalendarController {
  constructor(private readonly holidays: HolidayCalendarService) {}

  @Post()
  @RequirePermissions(P.HOLIDAY_MANAGE)
  create(@Body() dto: CreateHolidayDto) {
    return this.holidays.create(dto);
  }

  @Get()
  @RequirePermissions(P.HOLIDAY_MANAGE)
  list(@Query() q: PaginationQueryDto) {
    return this.holidays.list(q);
  }

  @Get(':id')
  @RequirePermissions(P.HOLIDAY_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.holidays.get(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.HOLIDAY_MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.holidays.remove(id);
  }
}
