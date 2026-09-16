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
import { RequestContext } from '../../common/context/request-context';
import { Document } from '../document/document.entities';
import { ApprovalLog } from './approval.entities';
import { displayNames } from './approver-names';
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

  /**
   * UX gate for the detail view: may the active user act on the current step now? `reason` is
   * present when they may, but an APPROVE would be refused (SIGNATURE_REQUIRED) — so the client
   * disables Approve alone and leaves Reject / Return, which need no signature.
   */
  @Get('can-act')
  @RequirePermissions(P.DOC_VIEW)
  canAct(@Param('id', ParseUUIDPipe) id: string) {
    return this.routing.canAct(id);
  }

  /** Who the document is waiting on now — participant-visible (creator or an eligible approver). */
  @Get('pending-approvers')
  @RequirePermissions(P.DOC_VIEW)
  pendingApprovers(@Param('id', ParseUUIDPipe) id: string) {
    return this.routing.pendingApprovers(id);
  }

  /**
   * The document's full approval history. Readable by an external API key, so the shape is
   * spelled out rather than serialized from the entity: an approver is a name, not an account.
   * The guide in docs/claim-integration.md promises these fields — widen it deliberately.
   *
   * `name` is the employee full name, added for our own UI, where a timeline of `xone` and
   * `finance_head` tells a reader which accounts signed rather than which people. It is withheld
   * from an API key: docs/claim-integration.md promises a key that "an approver is a username and
   * an id — nothing more", and a staff directory is not what an external claimant is reading this
   * endpoint for. `username` stays on every response, so the documented contract is unchanged.
   */
  @Get('approval-log')
  @RequirePermissions(P.DOC_VIEW)
  async log(@Param('id', ParseUUIDPipe) id: string) {
    const em = this.em.fork();
    const entries = await em.find(
      ApprovalLog,
      { document: id },
      { filters: { company: false }, orderBy: { actedAt: 'ASC' }, populate: ['approver', 'delegatedFrom'] },
    );

    // Omitted rather than nulled for a key, so that caller's payload stays byte-identical to the
    // one the guide documents — a field it has never seen is a field it cannot start relying on.
    const forApiKey = !!RequestContext.apiKeyId();
    const names = forApiKey ? new Map<string, string>() : await this.approverNames(em, id, entries);
    const person = (u: { id: string; username: string }) =>
      forApiKey ? { id: u.id, username: u.username } : { id: u.id, username: u.username, name: names.get(u.id) ?? null };

    return entries.map((e) => ({
      id: e.id,
      stepNo: e.stepNo,
      action: e.action,
      remark: e.remark ?? null,
      actedAt: e.actedAt ?? null,
      approver: person(e.approver),
      delegatedFrom: e.delegatedFrom ? person(e.delegatedFrom) : null,
    }));
  }

  /** Full names for everyone in the trail, by user id. */
  private async approverNames(
    em: EntityManager,
    documentId: string,
    entries: ApprovalLog[],
  ): Promise<Map<string, string>> {
    // `employee` is company-scoped, so the name to show is the one in the document's company.
    const document = await em.findOne(
      Document,
      { id: documentId },
      { fields: ['company'], filters: { company: false } },
    );
    if (!document) return new Map();
    const ids = entries.flatMap((e) => [e.approver.id, ...(e.delegatedFrom ? [e.delegatedFrom.id] : [])]);
    return displayNames(em, document.company.id, ids);
  }
}
