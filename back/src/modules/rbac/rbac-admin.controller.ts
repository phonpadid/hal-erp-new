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
import {
  AssignRoleDto,
  AttachPermissionDto,
  CreateRoleDto,
  DetachPermissionDto,
  RevokeAccessDto,
} from './dto/admin.dto';
import { RbacPermissions as P } from './permissions';
import { RoleAdminService } from './role-admin.service';

@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.RBAC_MANAGE)
export class RbacAdminController {
  constructor(private readonly admin: RoleAdminService) {}

  // ---- Reads ---------------------------------------------------------------

  @Get('roles')
  listRoles(@Query() q: PaginationQueryDto) {
    return this.admin.listRoles(q);
  }

  @Get('permissions')
  listPermissions(@Query() q: PaginationQueryDto) {
    return this.admin.listPermissions(q);
  }

  @Get('users')
  listUsers(@Query() q: PaginationQueryDto) {
    return this.admin.listUsers(q);
  }

  // Read-only: one user's active assignments across the companies the requester administers.
  @Get('users/:userId/assignments')
  crossCompanyAssignments(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.crossCompanyAssignments(userId);
  }

  // ---- Writes --------------------------------------------------------------

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.admin.createRole(dto);
  }

  @Post('role-permissions')
  attachPermission(@Body() dto: AttachPermissionDto) {
    return this.admin.attachPermission(dto.roleId, dto.permissionCode, dto.scope);
  }

  @Post('assignments')
  assign(@Body() dto: AssignRoleDto) {
    return this.admin.assignUserRole(dto);
  }

  @Post('revoke-access')
  @HttpCode(200)
  revoke(@Body() dto: RevokeAccessDto) {
    return this.admin
      .revokeCompanyAccess(dto.userId, dto.companyId)
      .then((expired) => ({ expired }));
  }

  @Delete('role-permissions')
  @HttpCode(204)
  detachPermission(@Body() dto: DetachPermissionDto) {
    return this.admin.detachPermission(dto.roleId, dto.permissionCode);
  }

  @Delete('assignments/:id')
  @HttpCode(204)
  removeAssignment(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removeAssignment(id);
  }
}
