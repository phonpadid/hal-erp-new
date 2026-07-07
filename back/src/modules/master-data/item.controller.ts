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
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import { ItemService } from './item.service';
import { MasterDataPermissions as P } from './permissions';

@Controller('items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemController {
  constructor(private readonly items: ItemService) {}

  @Post()
  @RequirePermissions(P.MASTER_MANAGE)
  create(@Body() dto: CreateItemDto) {
    return this.items.create(dto);
  }

  @Get()
  @RequirePermissions(P.MASTER_VIEW)
  list(
    @Query() q: PaginationQueryDto,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.items.list(q, includeInactive ?? false);
  }

  @Get('enabled')
  @RequirePermissions(P.MASTER_VIEW)
  listEnabled() {
    return this.items.listEnabled();
  }

  @Get(':id')
  @RequirePermissions(P.MASTER_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.MASTER_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.MASTER_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.deactivate(id);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermissions(P.MASTER_MANAGE)
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.enableForCompany(id);
  }

  @Post(':id/disable')
  @HttpCode(204)
  @RequirePermissions(P.MASTER_MANAGE)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.items.disableForCompany(id);
  }
}
