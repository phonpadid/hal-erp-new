import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthUser } from '../../auth/jwt.strategy';
import { UpdateUserSettingDto } from './user-setting.dto';
import { UserSettingService } from './user-setting.service';

/**
 * Own UI settings (theme + locale). Identified by the JWT — a user can only read and
 * write their own. Responses wrap the settings as { data } (the web client's contract).
 */
@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserSettingController {
  constructor(private readonly settings: UserSettingService) {}

  @Get('setting')
  async get(@Req() req: { user: AuthUser }) {
    return { data: await this.settings.getForUser(req.user.userId) };
  }

  @Put('setting')
  async update(@Req() req: { user: AuthUser }, @Body() dto: UpdateUserSettingDto) {
    return { data: await this.settings.upsertForUser(req.user.userId, dto) };
  }
}
