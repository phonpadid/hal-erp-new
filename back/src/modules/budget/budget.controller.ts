import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { RequestContext } from '../../common/context/request-context';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { BudgetAdjustmentService } from './budget-adjustment.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetService } from './budget.service';
import { BudgetTransferService } from './budget-transfer.service';
import { CreateBudgetDto, ResolveBudgetQueryDto, UpdateBudgetDto } from './dto/budget.dto';
import {
  CreateAdjustmentDto,
  CreateTransferDto,
  ExecuteAdjustmentDto,
  ExecuteTransferDto,
} from './dto/movement.dto';
import { BudgetPermissions as P } from './permissions';
import { DocumentPermissions as DocP } from '../document/permissions';

@Controller('budgets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BudgetController {
  constructor(
    private readonly budgets: BudgetService,
    private readonly balance: BudgetBalanceService,
    private readonly ledger: BudgetLedgerService,
    private readonly adjustments: BudgetAdjustmentService,
    private readonly transfers: BudgetTransferService,
    private readonly fiscalYears: FiscalYearService,
  ) {}

  @Post()
  @RequirePermissions(P.BUDGET_MANAGE)
  create(@Body() dto: CreateBudgetDto) {
    return this.budgets.create(dto);
  }

  @Get()
  @RequirePermissions(P.BUDGET_VIEW)
  list(@Query() q: PaginationQueryDto) {
    return this.budgets.list(q);
  }

  // Budget picker for the Create Document wizard. Authorized by DOC_CREATE (not BUDGET_VIEW)
  // and returns only {id, budgetName, glAccount} — no amounts. Declared before :id so the
  // literal path is not captured as an id param.
  @Get('selectable')
  @RequirePermissions(DocP.DOC_CREATE)
  listSelectable() {
    return this.budgets.listSelectable();
  }

  // Resolve the budget a line should charge from its GL, the requester's department, and the
  // fiscal year covering the date — so the Create wizard can preview the auto-resolved budget
  // when an item is picked. DOC_CREATE (not BUDGET_VIEW); selection fields only, no amounts.
  // Declared before :id so 'resolve' is not captured as an id param.
  @Get('resolve')
  @RequirePermissions(DocP.DOC_CREATE)
  async resolve(@Query() q: ResolveBudgetQueryDto) {
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    const departmentId = q.departmentId ?? RequestContext.departmentId()!;
    const fy = await this.fiscalYears.resolveOpenPeriod(date);
    return this.budgets.resolveSelectable({
      glAccount: q.glAccount,
      departmentId,
      fiscalYearId: fy.id,
    });
  }

  @Get(':id')
  @RequirePermissions(P.BUDGET_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.get(id);
  }

  @Get(':id/balance')
  @RequirePermissions(P.BUDGET_VIEW)
  async balanceOf(@Param('id', ParseUUIDPipe) id: string) {
    return { budgetId: id, available: await this.balance.availableBalance(id) };
  }

  @Get(':id/breakdown')
  @RequirePermissions(P.BUDGET_VIEW)
  breakdownOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.balance.breakdown(id);
  }

  @Get(':id/ledger')
  @RequirePermissions(P.BUDGET_VIEW)
  ledgerOf(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.balance.ledger(id, q);
  }

  @Patch(':id')
  @RequirePermissions(P.BUDGET_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(id, dto);
  }

  // Manual execution until approval-workflow drives transfers/adjustments.
  @Post('transfer')
  @HttpCode(200)
  @RequirePermissions(P.BUDGET_MANAGE)
  async transfer(@Body() dto: ExecuteTransferDto) {
    await this.ledger.executeTransfer(dto);
    return { ok: true };
  }

  @Post('adjust')
  @HttpCode(200)
  @RequirePermissions(P.BUDGET_MANAGE)
  async adjust(@Body() dto: ExecuteAdjustmentDto) {
    await this.ledger.executeAdjustment(dto);
    return { ok: true };
  }

  // Spec-aligned path: create an approvable adjustment document (+ budget_movement).
  // The ADJUST txn is written by the post-action on full approval, not here.
  @Post(':id/adjustments')
  @RequirePermissions(P.BUDGET_MANAGE)
  createAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAdjustmentDto) {
    return this.adjustments.create(id, dto);
  }

  // Spec-aligned path: create an approvable transfer document (+ budget_movement).
  // The paired TRANSFER_OUT/IN txns are written by the post-action on full approval, not here.
  @Post('transfers')
  @RequirePermissions(P.BUDGET_MANAGE)
  createTransfer(@Body() dto: CreateTransferDto) {
    return this.transfers.create(dto);
  }
}
