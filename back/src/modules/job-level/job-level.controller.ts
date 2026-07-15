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
import { CreateJobLevelDto, ListJobLevelQueryDto, UpdateJobLevelDto } from './dto/job-level.dto';
import { JobLevelService } from './job-level.service';
import { JobLevelPermissions as P } from './permissions';

@Controller('job-levels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JobLevelController {
  constructor(private readonly jobLevels: JobLevelService) {}

  @Post()
  @RequirePermissions(P.JOB_LEVEL_MANAGE)
  create(@Body() dto: CreateJobLevelDto) {
    return this.jobLevels.create(dto);
  }

  @Get()
  @RequirePermissions(P.JOB_LEVEL_VIEW)
  list(@Query() q: ListJobLevelQueryDto) {
    return this.jobLevels.list(q, q.includeInactive ?? false);
  }

  // Active levels for the employee / workflow-step assignment pickers.
  @Get('selectable')
  @RequirePermissions(P.JOB_LEVEL_VIEW)
  listSelectable() {
    return this.jobLevels.listSelectable();
  }

  @Get(':id')
  @RequirePermissions(P.JOB_LEVEL_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobLevels.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.JOB_LEVEL_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobLevelDto) {
    return this.jobLevels.update(id, dto);
  }

  // Soft-delete (deactivate) — the default, keeping existing references resolvable.
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.JOB_LEVEL_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobLevels.deactivate(id);
  }

  // Hard-delete — rejected when the level is still referenced (deactivate instead).
  @Delete(':id/hard')
  @HttpCode(204)
  @RequirePermissions(P.JOB_LEVEL_MANAGE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobLevels.remove(id);
  }
}
