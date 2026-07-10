import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { MembershipService } from '../rbac/membership.service';
import { CompanyService } from './company.service';
import type { AuthUser } from '../../auth/jwt.strategy';
import {
  CreateCompanyValidationPipe,
  UpdateCompanyDto,
  type CreateCompanyDto,
} from './dto/company.dto';
import { PresignImageDto, RegisterImageDto } from '../../common/storage/image-upload.dto';
import { MultiCompanyPermissions as P } from './permissions';

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanyController {
  constructor(
    private readonly companies: CompanyService,
    private readonly memberships: MembershipService,
  ) {}

  @Post()
  @RequirePermissions(P.COMPANY_MANAGE)
  create(@Req() req: { user: AuthUser }, @Body(CreateCompanyValidationPipe) dto: CreateCompanyDto) {
    // Pass the creator so the new company is bootstrapped with them as ADMIN (else it's
    // unreachable: switchCompany needs a membership nobody would otherwise have).
    return this.companies.create(dto, req.user.userId);
  }

  @Get()
  @RequirePermissions(P.COMPANY_VIEW)
  list(
    @Query() q: PaginationQueryDto,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.companies.list(q, includeInactive ?? false);
  }

  // Caller-scoped: companies the authenticated user actually belongs to (no
  // COMPANY_VIEW needed). Defined before ':id' so 'mine' isn't parsed as a UUID.
  @Get('mine')
  mine(@Req() req: { user: AuthUser }) {
    return this.memberships.listForUser(req.user.userId);
  }

  @Get(':id')
  @RequirePermissions(P.COMPANY_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.COMPANY_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.COMPANY_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.deactivate(id);
  }

  // --- Company 1:1 profile image ---

  @Get(':id/profile-image')
  @RequirePermissions(P.COMPANY_VIEW)
  profileImage(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.profileImageUrl(id);
  }

  @Post(':id/profile-image/presign-upload')
  @RequirePermissions(P.COMPANY_MANAGE)
  presignImage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PresignImageDto) {
    return this.companies.presignProfileImage(id, dto);
  }

  @Post(':id/profile-image')
  @RequirePermissions(P.COMPANY_MANAGE)
  setImage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterImageDto) {
    return this.companies.setProfileImage(id, dto);
  }
}
