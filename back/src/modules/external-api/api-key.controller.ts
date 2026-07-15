import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { ApiKeyService } from './api-key.service';
import { IssueApiKeyDto } from './dto/api-key.dto';
import { ExternalApiPermissions as P } from './permissions';

/**
 * Manage API keys for the caller's active company. Interactive-only (JwtAuthGuard): keys are
 * issued and revoked by a human admin holding API_KEY_MANAGE — a key cannot manage keys.
 * Company-scoped by the active-company context (invariant 1); authorized on the code (#6).
 */
@Controller('api-keys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  /** Issue a key; the raw secret is returned EXACTLY ONCE here and never again. */
  @Post()
  @RequirePermissions(P.API_KEY_MANAGE)
  issue(@Body() dto: IssueApiKeyDto) {
    return this.apiKeys.issue(dto.name, dto.targetUserId, dto.expiresAt);
  }

  /** List the active company's keys — non-secret metadata only. */
  @Get()
  @RequirePermissions(P.API_KEY_MANAGE)
  list() {
    return this.apiKeys.list();
  }

  /** Users a key may be bound to (active members of the active company). */
  @Get('eligible-users')
  @RequirePermissions(P.API_KEY_MANAGE)
  eligibleUsers() {
    return this.apiKeys.eligibleUsers();
  }

  /** Revoke a key immediately (state change, not delete). */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.API_KEY_MANAGE)
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    await this.apiKeys.revoke(id);
  }
}
