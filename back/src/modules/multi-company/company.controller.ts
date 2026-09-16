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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { PROFILE_IMAGE_MAX_SIZE_KB } from '../../common/storage/image-upload.dto';
import { multipartOptions, type UploadedFile as MultipartFile } from '../../common/storage/upload';
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

  // Upload the company logo (multipart) through the API; the backend writes it to storage.
  @Post(':id/profile-image/upload')
  @RequirePermissions(P.COMPANY_MANAGE)
  @UseInterceptors(FileInterceptor('file', multipartOptions(PROFILE_IMAGE_MAX_SIZE_KB)))
  uploadImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: MultipartFile) {
    return this.companies.uploadProfileImage(id, file);
  }
}
