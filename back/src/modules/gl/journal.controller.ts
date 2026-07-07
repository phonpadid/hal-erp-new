import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JournalService } from './journal.service';
import { GlPermissions as P } from './permissions';

@Controller('journal')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  // Read-only: journal entries are produced by the posting engine, never via the API.
  @Get()
  @RequirePermissions(P.GL_VIEW)
  list(@Query() q: PaginationQueryDto) {
    return this.journal.list(q);
  }
}
