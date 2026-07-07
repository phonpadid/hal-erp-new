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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import {
  CreateTemplateDto,
  NotificationListQueryDto,
  UpdateTemplateDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';
import { NotificationPermissions as P } from './permissions';
import { TemplateService } from './template.service';
import type { AuthUser } from '../../auth/jwt.strategy';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly templates: TemplateService,
  ) {}

  // ---- Own inbox -------------------------------------------------------------

  @Get('notifications')
  @RequirePermissions(P.NOTIFICATION_VIEW)
  list(@Req() req: { user: AuthUser }, @Query() q: NotificationListQueryDto) {
    return this.notifications.listForUser(
      req.user.userId,
      { unreadOnly: q.unreadOnly ?? false },
      q,
    );
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @RequirePermissions(P.NOTIFICATION_VIEW)
  read(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthUser }) {
    return this.notifications.markRead(id, req.user.userId);
  }

  // ---- Templates -------------------------------------------------------------

  @Post('notification-templates')
  @RequirePermissions(P.NOTIFICATION_MANAGE)
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.templates.create(dto);
  }

  @Get('notification-templates')
  @RequirePermissions(P.NOTIFICATION_MANAGE)
  listTemplates() {
    return this.templates.list();
  }

  @Patch('notification-templates/:code')
  @RequirePermissions(P.NOTIFICATION_MANAGE)
  updateTemplate(@Param('code') code: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(code, dto);
  }
}
