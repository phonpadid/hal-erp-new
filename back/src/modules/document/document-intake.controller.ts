import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';
import { JwtOrApiKeyGuard } from '../../auth/jwt-or-api-key.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { DocumentIntakeService } from './document-intake.service';
import { ReceiveDocumentsDto, ReverseIntakeDto } from './dto/intake.dto';
import { DocumentPermissions as P } from './permissions';

/**
 * Finance's intake book.
 *
 * Its own controller on `documents/intake` rather than more routes on `DocumentController`: every
 * path here is a literal segment, so none of it can ever be mistaken for a `:id` route, and the
 * two receipts in this system — paper arriving at a desk, and goods arriving against a purchase
 * order — stay visibly separate things with separate permission codes.
 *
 * API keys are barred. Receiving is a person saying "this reached my desk"; a machine cannot
 * witness that, and an append-only log of who took the paper in is worth nothing if a key can
 * write rows into it.
 */
@Controller('documents/intake')
@UseGuards(JwtOrApiKeyGuard, ApiKeyDenyGuard, PermissionsGuard)
export class DocumentIntakeController {
  constructor(private readonly intake: DocumentIntakeService) {}

  /**
   * Register receipt of a batch.
   *
   * 200, not 201: the answer is a per-document verdict, and some of the batch may have been
   * refused. A caller reading only the status code has been told nothing, which is the point —
   * the body names each document.
   */
  @Post('receive')
  @HttpCode(200)
  @RequirePermissions(P.DOC_INTAKE_RECEIVE)
  receive(@Body() dto: ReceiveDocumentsDto) {
    return this.intake.receive(dto.documentIds);
  }

  /** Undo one receipt. Its own code: reversal is the privileged correction, not ordinary intake. */
  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions(P.DOC_INTAKE_REVERSE)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseIntakeDto) {
    return this.intake.reverse(id, dto.note);
  }
}
