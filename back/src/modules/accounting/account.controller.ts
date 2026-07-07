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
import { AccountService } from './account.service';
import { CreateAccountDto, ListAccountsQueryDto, UpdateAccountDto } from './dto/account.dto';
import { AccountingPermissions as P } from './permissions';

@Controller('accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @RequirePermissions(P.COA_MANAGE)
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  @Get()
  @RequirePermissions(P.COA_VIEW)
  list(@Query() q: ListAccountsQueryDto) {
    return this.accounts.list(q, q.includeInactive ?? false);
  }

  // Active, postable accounts for the budget-form GL picker.
  @Get('selectable')
  @RequirePermissions(P.COA_VIEW)
  listSelectable() {
    return this.accounts.listSelectable();
  }

  @Get(':id')
  @RequirePermissions(P.COA_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.COA_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.COA_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.deactivate(id);
  }
}
