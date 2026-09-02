import {
  Body,
  Controller,
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
  CreateEmployeeDto,
  CreateUserAccountDto,
  LinkEmployeeDto,
  ListEmployeesQueryDto,
  OnboardEmployeeDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { EmployeeService } from './employee.service';
import { RbacPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.EMPLOYEE_MANAGE)
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get()
  list(@Query() q: ListEmployeesQueryDto) {
    return this.employees.list(q);
  }

  // Wizard picker: DOC_CREATE overrides the controller's EMPLOYEE_MANAGE (the guard reads
  // handler-then-class), returning selection fields only. Must precede `@Get(':id')`.
  @Get('selectable')
  @RequirePermissions(DocP.DOC_CREATE)
  listSelectable() {
    return this.employees.listSelectable();
  }

  // Must precede `@Get(':id')` so it is not captured as an :id param route.
  @Get('linkable-accounts')
  linkableAccounts(@Query('search') search?: string) {
    return this.employees.listLinkableAccounts(search);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(id);
  }

  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(id, dto);
  }

  @Post(':id/link')
  link(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkEmployeeDto) {
    return this.employees.link(id, dto.userId);
  }

  @Post(':id/create-account')
  createAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUserAccountDto,
  ) {
    return this.employees.createAccount(id, dto);
  }

  // Onboard = create account + grant first company access atomically. Needs BOTH codes
  // (account creation + role assignment); the guard requires every listed code.
  @Post(':id/onboard')
  @RequirePermissions(P.EMPLOYEE_MANAGE, P.RBAC_MANAGE)
  onboard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OnboardEmployeeDto) {
    return this.employees.onboard(id, dto);
  }

  // Admin escape hatch: mark the linked account's email verified without sending mail.
  @Post(':id/verify-account')
  verifyAccount(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.verifyAccount(id);
  }

  @Post(':id/unlink')
  unlink(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.unlink(id);
  }

  @Post(':id/resign')
  @HttpCode(200)
  resign(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.resign(id);
  }
}
