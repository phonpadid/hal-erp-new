import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DocumentPermissions } from '../document/permissions';
import { CreateOvertimeClaimDto, PreviewOvertimeQueryDto } from './dto/overtime-claim.dto';
import { OvertimeClaimService } from './overtime-claim.service';

@Controller('overtime-claims')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OvertimeClaimController {
  constructor(private readonly claims: OvertimeClaimService) {}

  /** Attach a certification to a draft document. Raising one IS a document action. */
  @Post()
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  create(@Body() dto: CreateOvertimeClaimDto) {
    return this.claims.create(dto);
  }

  /** What a range would certify, by kind, without committing. */
  @Get('preview')
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  preview(@Query() q: PreviewOvertimeQueryDto) {
    return this.claims.preview(q.employeeId, q.fromDate, q.toDate);
  }

  /**
   * The only way an overtime document may be submitted: its type carries `derives_quantity`, so
   * the generic endpoint refuses it. The statutory weekly ceiling is enforced here, before
   * anything is reserved.
   */
  @Post(':documentId/submit')
  @RequirePermissions(DocumentPermissions.DOC_SUBMIT)
  submit(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.claims.submit(documentId);
  }

  @Get('document/:documentId')
  @RequirePermissions(DocumentPermissions.DOC_VIEW)
  forDocument(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.claims.findForDocument(documentId);
  }
}
