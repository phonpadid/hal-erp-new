import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
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
import { BudgetControlPointService } from './budget-control-point.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetPlanService } from './budget-plan.service';
import { BudgetService } from './budget.service';
import { BudgetTransferService } from './budget-transfer.service';
import { CreateBudgetDto, ResolveBudgetQueryDto, UpdateBudgetDto } from './dto/budget.dto';
import { CreateBudgetPlanDto } from './dto/budget-plan.dto';
import {
  CreateControlPointDto,
  ListControlPointsQueryDto,
  UpdateControlPointDto,
} from './dto/control-point.dto';
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
    private readonly controlPoints: BudgetControlPointService,
    private readonly plans: BudgetPlanService,
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

  // ---- Budget plans: the approval gate in front of setting a budget ------------------------
  // Same permission codes as the rest of budget administration — proposing a budget is budget
  // administration, and whether it takes effect is decided by the workflow, not by a permission
  // code. Declared before :id so 'plans' is not captured as a budget id.

  @Post('plans')
  @RequirePermissions(P.BUDGET_MANAGE)
  createPlan(@Body() dto: CreateBudgetPlanDto) {
    return this.plans.create(dto);
  }

  @Get('plans/:id')
  @RequirePermissions(P.BUDGET_VIEW)
  async getPlan(@Param('id', ParseUUIDPipe) id: string) {
    const plan = await this.plans.get(id);
    if (!plan) throw new NotFoundException(`Budget plan ${id} not found`);
    return plan;
  }

  // ---- Control points: WHERE availability is checked --------------------------------------
  // Administration reuses BUDGET_MANAGE and reads reuse BUDGET_VIEW — moving a control point is
  // budget administration under another name, so it earns no new permission code. Declared
  // before :id so 'control-points' is not captured as a budget id.

  @Post('control-points')
  @RequirePermissions(P.BUDGET_MANAGE)
  createControlPoint(@Body() dto: CreateControlPointDto) {
    return this.controlPoints.create(dto);
  }

  // Defaults to the fiscal year covering today when the caller does not name one. A ceiling is a
  // per-year figure, so listing several years together would put two unrelated numbers for the
  // same category side by side and invite reading them as one. Falls back to the most recent open
  // year when no year covers today, rather than widening to everything.
  @Get('control-points')
  @RequirePermissions(P.BUDGET_VIEW)
  async listControlPoints(@Query() q: ListControlPointsQueryDto) {
    return this.controlPoints.list(q.fiscalYearId ?? (await this.defaultFiscalYearId()));
  }

  private async defaultFiscalYearId(): Promise<string | undefined> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      return (await this.fiscalYears.resolveOpenPeriod(today)).id;
    } catch {
      // No open year covers today — a company mid-setup, or one that has closed the current year.
      // The most recent open year is the useful answer; listing every year is not.
      return (await this.fiscalYears.mostRecentOpen())?.id;
    }
  }

  @Get('control-points/:id/balance')
  @RequirePermissions(P.BUDGET_VIEW)
  controlPointBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.controlPoints.balanceOf(id);
  }

  @Patch('control-points/:id')
  @RequirePermissions(P.BUDGET_MANAGE)
  updateControlPoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateControlPointDto,
  ) {
    return this.controlPoints.update(id, dto);
  }

  @Post('control-points/:id/deactivate')
  @RequirePermissions(P.BUDGET_MANAGE)
  deactivateControlPoint(@Param('id', ParseUUIDPipe) id: string) {
    return this.controlPoints.deactivate(id);
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

  // Movement document types grouped by operation, so the Adjust/Transfer dialogs can prompt for
  // a type only when more than one is configured. Declared before :id so the literal path wins.
  @Get('movement-doc-types')
  @RequirePermissions(P.BUDGET_MANAGE)
  movementDocTypes() {
    return this.budgets.listMovementDocTypes();
  }

  @Get(':id')
  @RequirePermissions(P.BUDGET_VIEW)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.get(id);
  }

  // The plan that proposed this budget, or null. Its own route rather than a field on the detail
  // so the budget read keeps its shape: only a DRAFT or REJECTED budget's screen asks this, and
  // every other reader would be paying for a join it never looks at.
  @Get(':id/plan')
  @RequirePermissions(P.BUDGET_VIEW)
  planOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.planForBudget(id);
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

  // The control points that decide whether a document charging this budget can be submitted,
  // each with its own available. The budget's own balance no longer answers that question, so a
  // detail view without this cannot explain a refusal on a line that still shows room.
  @Get(':id/control-points')
  @RequirePermissions(P.BUDGET_VIEW)
  governingControlPoints(@Param('id', ParseUUIDPipe) id: string) {
    return this.controlPoints.governing(id);
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
