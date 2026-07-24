import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DocumentPermissions } from '../document/permissions';
import { AttendancePermissions } from './permissions';
import { CreateTimeCorrectionDto, SetCorrectionWindowDto } from './dto/time-correction.dto';
import { TimeCorrectionService } from './time-correction.service';

@Controller('time-corrections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimeCorrectionController {
  constructor(private readonly corrections: TimeCorrectionService) {}

  /**
   * Attach a correction request to a draft document. Gated by `DOC_CREATE` rather than by an
   * attendance code, because raising one changes nothing: it is a document, and only approval
   * touches the ledger.
   */
  @Post()
  @RequirePermissions(DocumentPermissions.DOC_CREATE)
  create(@Body() dto: CreateTimeCorrectionDto) {
    return this.corrections.create(dto);
  }

  /**
   * The punches a correction could name. Reading someone's punches is what
   * `ATTEND_PUNCH_READ` governs, so that is the code — the list is punches, whatever it is for.
   */
  @Get('correctable')
  @RequirePermissions(AttendancePermissions.ATTEND_PUNCH_READ)
  correctable(@Query('employeeId', ParseUUIDPipe) employeeId: string, @Query('shiftDate') shiftDate: string) {
    return this.corrections.correctablePunches(employeeId, shiftDate);
  }

  @Get('window')
  @RequirePermissions(AttendancePermissions.ATTEND_CORRECTION_MANAGE)
  window() {
    return this.corrections.window();
  }

  /** How far back a correction may reach. Company policy, so it is gated by the correction code. */
  @Put('window')
  @RequirePermissions(AttendancePermissions.ATTEND_CORRECTION_MANAGE)
  setWindow(@Body() dto: SetCorrectionWindowDto) {
    return this.corrections.setWindow(dto.correctionWindowDays);
  }

  @Get('document/:documentId')
  @RequirePermissions(DocumentPermissions.DOC_VIEW)
  forDocument(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.corrections.findForDocument(documentId);
  }
}
