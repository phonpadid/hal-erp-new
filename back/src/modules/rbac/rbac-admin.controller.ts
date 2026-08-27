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
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import {
  AssignRoleDto,
  AttachPermissionDto,
  BulkAssignRolesDto,
  BulkAttachPermissionsDto,
  CreateRoleDto,
  CreateServiceAccountDto,
  DetachPermissionDto,
  RevokeAccessDto,
} from './dto/admin.dto';
import { RbacPermissions as P } from './permissions';
import { PermissionCatalogService } from './permission-catalog.service';
import { RoleAdminService } from './role-admin.service';

@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.RBAC_MANAGE)
export class RbacAdminController {
  constructor(
    private readonly admin: RoleAdminService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  // ---- Reads ---------------------------------------------------------------

  @Get('roles')
  listRoles(@Query() q: PaginationQueryDto) {
    return this.admin.listRoles(q);
  }

  @Get('permissions')
  listPermissions(@Query() q: PaginationQueryDto) {
    return this.admin.listPermissions(q);
  }

  /**
   * Declared permission codes this environment has no row for.
   *
   * Its own read rather than a field on the paginated listing above: an absent code belongs to the
   * catalog as a whole, not to a page of it, and repeating the same list on every page would give
   * a standard envelope a field that means nothing per-page. It mirrors the separation one level
   * down, where `permissions:check` is a command distinct from `permissions:sync` — asking what is
   * missing is not the same act as listing what is there.
   *
   * A code returned here can be granted to nobody until the catalog is reconciled, so the screen
   * that lists grantable codes needs it to explain why a capability is unreachable.
   */
  @Get('permissions/missing')
  missingPermissions() {
    return this.catalog.missing().then((codes) => ({ codes }));
  }

  @Get('users')
  listUsers(@Query() q: SearchablePaginationQueryDto) {
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

  // The app's only surface for creating an account that is not a person. Inherits the class
  // RBAC_MANAGE guard. Issuing its API key stays a separate act under API_KEY_MANAGE.
  @Post('service-accounts')
  createServiceAccount(@Body() dto: CreateServiceAccountDto) {
    return this.admin.createServiceAccount(dto);
  }

  @Post('role-permissions')
  attachPermission(@Body() dto: AttachPermissionDto) {
    return this.admin.attachPermission(dto.roleId, dto.permissionCode, dto.scope);
  }

  /**
   * Apply a whole grant/detach edit for one role in a single atomic request, so the admin
   * screen writes once instead of once per permission. Already-satisfied items are reported
   * as skipped rather than failing the batch — unlike the single-item route above, which
   * keeps its strict 409 because there a duplicate is a genuine mistake.
   */
  @Post('role-permissions/bulk')
  @HttpCode(200)
  attachPermissionsBulk(@Body() dto: BulkAttachPermissionsDto) {
    return this.admin.attachPermissionsBulk(dto.roleId, dto.grants, dto.detach);
  }

  @Post('assignments')
  assign(@Body() dto: AssignRoleDto) {
    return this.admin.assignUserRole(dto);
  }

  /** Assign several roles to one user against a shared department / default / window. */
  @Post('assignments/bulk')
  @HttpCode(200)
  assignBulk(@Body() dto: BulkAssignRolesDto) {
    return this.admin.assignUserRolesBulk(dto);
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
