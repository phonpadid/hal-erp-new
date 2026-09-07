import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { AccountingPermissions as P } from '../accounting/permissions';
import { AccountRoleService } from './account-role.service';
import { SetAccountRoleDto } from './dto/account-role.dto';
import type { AccountRoleType } from '../../common/enums';

/**
 * Which account plays each system role for the active company.
 *
 * Under the chart-of-accounts permissions deliberately: a role mapping is a fact ABOUT the chart —
 * which of its accounts is the clearing account — so whoever may create the accounts may say what
 * they are for. A permission of its own would have to be granted to exactly those people anyway,
 * and would be one more code to remember to sync into every role that ought to hold it.
 */
@Controller('account-roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountRoleController {
  constructor(private readonly roles: AccountRoleService) {}

  /** Every role, its purpose, whether this company needs it, and the account it points at. */
  @Get()
  @RequirePermissions(P.COA_VIEW)
  list() {
    return this.roles.list();
  }

  /**
   * Point one role at one account. A PUT because it names the role in the path and replaces
   * whatever that role pointed at — sending it twice leaves the same state as sending it once.
   */
  @Put(':role')
  @RequirePermissions(P.COA_MANAGE)
  set(@Param('role') role: string, @Body() dto: SetAccountRoleDto) {
    return this.roles.set(role as AccountRoleType, dto.accountId);
  }
}
