import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { ApprovalInboxService } from './approval-inbox.service';
import { ApprovalPermissions as P } from './permissions';

@Controller('approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApprovalInboxController {
  constructor(private readonly inbox: ApprovalInboxService) {}

  @Get('pending')
  @RequirePermissions(P.DOC_APPROVE)
  pending(@Query() q: PaginationQueryDto) {
    return this.inbox.pending(q);
  }
}
