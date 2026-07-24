import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DocumentPermissions } from '../document/permissions';
import {
  CreateLeaveRequestValidationPipe,
  PreviewLeaveQueryDto,
  PreviewOwnLeaveQueryDto,
  type CreateLeaveRequestDto,
} from './dto/leave-request.dto';
import { LeaveRequestService } from './leave-request.service';
import { LeaveTypeService } from './leave-type.service';
import { UpsertLeaveTypeDto } from './dto/leave-type.dto';
import { AttendancePermissions as P } from './permissions';

@Controller('leave-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeaveRequestController {
  constructor(
    private readonly leave: LeaveRequestService,
    private readonly types: LeaveTypeService,
  ) {}

  /** Configure the rules of a leave kind. Gated by LEAVE_MANAGE, not by document permissions. */
  @Put('types')
  @RequirePermissions(P.LEAVE_MANAGE)
  upsertType(@Body() dto: UpsertLeaveTypeDto) {
    return this.types.upsert(dto);
  }

  @Get('types')
  @RequirePermissions(P.LEAVE_MANAGE)
  listTypes() {
    return this.types.list();
  }

  /**
   * Attach leave details to a draft document. Gated by the document-creation code rather than a
   * leave-specific one: a leave request IS a document, and whoever may raise one may describe it.
   */
  @Post()
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  create(@Body(CreateLeaveRequestValidationPipe) dto: CreateLeaveRequestDto) {
    return this.leave.create(dto);
  }

  /**
   * The only way a leave document may be submitted: its type carries `derives_quantity`, so the
   * generic endpoint refuses it. Every leave rule is enforced here, before anything is reserved.
   */
  @Post(':documentId/submit')
  @RequirePermissions(DocumentPermissions.DOC_SUBMIT)
  submit(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.leave.submit(documentId);
  }

  /**
   * What a candidate range would cost the CALLER. Declared before the parameterised route so the
   * static path matches here. Its own route rather than an optional query parameter, because an
   * optional subject is a subject somebody eventually supplies.
   */
  @Get('preview/me')
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  previewOwn(@Query() q: PreviewOwnLeaveQueryDto) {
    return this.leave.previewOwn(q.fromDate, q.toDate, q.fromHalf, q.toHalf);
  }

  /** What a candidate range would cost for a named employee, without committing to it. */
  @Get('preview')
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  preview(@Query() q: PreviewLeaveQueryDto) {
    return this.leave.preview(q.employeeId, q.fromDate, q.toDate, q.fromHalf, q.toHalf);
  }

  /**
   * Approved leave whose days have not caught up. Read with the projection's own code, because
   * that is what it reports on — the answer is about `attendance_day`, not about leave.
   */
  @Get('stale-days')
  @RequirePermissions(P.ATTEND_DAY_READ)
  staleDays() {
    return this.leave.staleLeaveDays();
  }

  @Get('document/:documentId')
  @RequirePermissions(DocumentPermissions.DOC_VIEW)
  forDocument(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.leave.findForDocument(documentId);
  }
}
