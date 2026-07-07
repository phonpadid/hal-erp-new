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
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DepartmentService } from './department.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { MultiCompanyPermissions as P } from './permissions';

@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @Post()
  @RequirePermissions(P.DEPARTMENT_MANAGE)
  create(@Body() dto: CreateDepartmentDto) {
    return this.departments.create(dto);
  }

  @Get()
  @RequirePermissions(P.DEPARTMENT_VIEW)
  list(@Query() q: PaginationQueryDto) {
    return this.departments.list(q);
  }

  @Get(':id')
  @RequirePermissions(P.DEPARTMENT_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.DEPARTMENT_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.DEPARTMENT_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.deactivate(id);
  }
}
