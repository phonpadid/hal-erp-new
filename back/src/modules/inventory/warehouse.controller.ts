import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { CreateWarehouseDto, ListWarehousesQueryDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { InventoryPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';
import { WarehouseService } from './warehouse.service';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehouseController {
  constructor(private readonly warehouses: WarehouseService) {}

  @Post()
  @RequirePermissions(P.INV_MANAGE)
  create(@Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(dto);
  }

  // Reading warehouses is INV_VIEW, not INV_MANAGE: anyone who may see stock needs the list of
  // places it can be, and the admin UI passes includeInactive to see deactivated ones too.
  @Get()
  @RequirePermissions(P.INV_VIEW)
  list(@Query() q: ListWarehousesQueryDto) {
    return this.warehouses.list(q, q.includeInactive ?? false);
  }

  // Wizard picker: DOC_CREATE, selection fields only. Declared before ':id' so the literal path
  // is not captured as an id param.
  @Get('selectable')
  @RequirePermissions(DocP.DOC_CREATE)
  listSelectable() {
    return this.warehouses.listSelectable();
  }

  @Get(':id')
  @RequirePermissions(P.INV_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.get(id);
  }

  @Patch(':id')
  @RequirePermissions(P.INV_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehouses.update(id, dto);
  }

  // DELETE deactivates rather than removing: historical stock_txn rows point here.
  @Delete(':id')
  @RequirePermissions(P.INV_MANAGE)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.deactivate(id);
  }
}
