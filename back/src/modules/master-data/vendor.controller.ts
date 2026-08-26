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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CreateVendorDto, EnableVendorDto, UpdateVendorDto } from './dto/vendor.dto';
import { MasterDataPermissions as P } from './permissions';
import { VendorService } from './vendor.service';

@Controller('vendors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Post()
  @RequirePermissions(P.MASTER_MANAGE)
  create(@Body() dto: CreateVendorDto) {
    return this.vendors.create(dto);
  }

  @Get()
  @RequirePermissions(P.MASTER_VIEW)
  list(
    @Query() q: SearchablePaginationQueryDto,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.vendors.list(q, includeInactive ?? false);
  }

  // Vendors enabled for the active company (defined before ':id').
  @Get('enabled')
  @RequirePermissions(P.MASTER_VIEW)
  listEnabled() {
    return this.vendors.listEnabled();
  }

  @Get(':id')
  @RequirePermissions(P.MASTER_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.MASTER_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto) {
    return this.vendors.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.MASTER_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.deactivate(id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermissions(P.MASTER_MANAGE)
  enable(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnableVendorDto = {}) {
    return this.vendors.enableForCompany(id, dto.paymentTermDays);
  }

  @Post(':id/disable')
  @HttpCode(204)
  @RequirePermissions(P.MASTER_MANAGE)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.disableForCompany(id);
  }
}
