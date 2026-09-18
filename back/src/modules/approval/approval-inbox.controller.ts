import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { PendingInboxQueryDto, PendingSummaryQueryDto } from './dto/workflow.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { ApprovalInboxService } from './approval-inbox.service';
import { PendingSummaryService } from './pending-summary.service';
import { buildPendingSummaryWorkbook } from './pending-summary-workbook';
import { ApprovalPermissions as P } from './permissions';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApprovalInboxController {
  constructor(
    private readonly inbox: ApprovalInboxService,
    private readonly summary: PendingSummaryService,
  ) {}

  @Get('pending')
  @RequirePermissions(P.DOC_APPROVE)
  pending(@Query() q: PendingInboxQueryDto) {
    return this.inbox.pending(q);
  }

  // The department's weekly view: every IN_APPROVAL document the reader may SEE (their DOC_VIEW
  // scope, as the documents list), not only what they must sign — hence DOC_VIEW, not DOC_APPROVE.
  @Get('pending-summary')
  @RequirePermissions(P.DOC_VIEW)
  pendingSummary(@Query() q: PendingSummaryQueryDto) {
    return this.summary.summary(q);
  }

  @Get('pending-summary.xlsx')
  @RequirePermissions(P.DOC_VIEW)
  @Header('Content-Type', XLSX_TYPE)
  async pendingSummaryXlsx(@Query() q: PendingSummaryQueryDto): Promise<StreamableFile> {
    const summary = await this.summary.summary(q);
    return new StreamableFile(buildPendingSummaryWorkbook(summary), {
      type: XLSX_TYPE,
      disposition: `attachment; filename="pending-approvals-${summary.meta.companyCode}-${summary.meta.today}.xlsx"`,
    });
  }
}
