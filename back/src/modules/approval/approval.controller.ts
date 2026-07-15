import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { JwtOrApiKeyGuard } from '../../auth/jwt-or-api-key.guard';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { ApprovalLog } from './approval.entities';
import { ApprovalRoutingService } from './approval-routing.service';
import { SlaService } from './sla.service';
import { ActDto } from './dto/workflow.dto';
import { ApprovalPermissions as P } from './permissions';

@Controller('documents/:id')
// Reads accept a JWT or an API key; the mutating approval endpoints (start/actions) add
// ApiKeyDenyGuard so a key can never approve/reject/delegate, regardless of its grants.
@UseGuards(JwtOrApiKeyGuard, PermissionsGuard)
export class ApprovalController {
  constructor(
    private readonly routing: ApprovalRoutingService,
    private readonly sla: SlaService,
    private readonly em: EntityManager,
  ) {}

  @Post('start')
  @HttpCode(200)
  @UseGuards(ApiKeyDenyGuard)
  @RequirePermissions(P.DOC_APPROVE)
  async start(@Param('id', ParseUUIDPipe) id: string) {
    await this.routing.start(id);
    return { ok: true };
  }

  @Post('actions')
  @HttpCode(200)
  @UseGuards(ApiKeyDenyGuard)
  @RequirePermissions(P.DOC_APPROVE)
  async act(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActDto) {
    await this.routing.act(id, dto);
    return { ok: true };
  }

  @Get('sla')
  @RequirePermissions(P.DOC_VIEW)
  slaStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.sla.currentStepSla(id);
  }

  /** UX gate for the detail view: may the active user act on the current step now? */
  @Get('can-act')
  @RequirePermissions(P.DOC_VIEW)
  async canAct(@Param('id', ParseUUIDPipe) id: string) {
    return { canAct: await this.routing.canAct(id) };
  }

  /** Who the document is waiting on now — participant-visible (creator or an eligible approver). */
  @Get('pending-approvers')
  @RequirePermissions(P.DOC_VIEW)
  pendingApprovers(@Param('id', ParseUUIDPipe) id: string) {
    return this.routing.pendingApprovers(id);
  }

  @Get('approval-log')
  @RequirePermissions(P.DOC_VIEW)
  log(@Param('id', ParseUUIDPipe) id: string) {
    return this.em.fork().find(
      ApprovalLog,
      { document: id },
      { filters: { company: false }, orderBy: { actedAt: 'ASC' }, populate: ['approver', 'delegatedFrom'] },
    );
  }
}
