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
import {
  CreateWorkLocationDto,
  ListWorkLocationQueryDto,
  UpdateWorkLocationDto,
} from './dto/work-location.dto';
import { AttendancePermissions as P } from './permissions';
import { WorkLocationService } from './work-location.service';

@Controller('work-locations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkLocationController {
  constructor(private readonly locations: WorkLocationService) {}

  @Post()
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  create(@Body() dto: CreateWorkLocationDto) {
    return this.locations.create(dto);
  }

  @Get()
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  list(@Query() q: ListWorkLocationQueryDto) {
    return this.locations.list(q, q.includeInactive ?? false);
  }

  @Get(':id')
  @RequirePermissions(P.ATTEND_SHIFT_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkLocationDto) {
    return this.locations.update(id, dto);
  }

  // Soft-delete only: a location referenced by past capture must stay resolvable.
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.ATTEND_SHIFT_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.deactivate(id);
  }
}
