import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PaginationQueryDto, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/require-permissions.decorator';
import {
  CreateDelegationDto,
  CreateWorkflowDto,
  CreateWorkflowStepDto,
  UpdateWorkflowDto,
  UpdateWorkflowStepDto,
} from './dto/workflow.dto';
import { ApprovalPermissions as P } from './permissions';
import { WorkflowConfigService } from './workflow-config.service';

@Controller('workflows')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(P.WORKFLOW_MANAGE)
export class ApprovalConfigController {
  constructor(private readonly config: WorkflowConfigService) {}

  @Get()
  listWorkflows() {
    return this.config.listWorkflows();
  }

  @Post()
  createWorkflow(@Body() dto: CreateWorkflowDto) {
    return this.config.createWorkflow(dto);
  }

  @Patch(':id')
  updateWorkflow(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkflowDto) {
    return this.config.updateWorkflow(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  deleteWorkflow(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteWorkflow(id).then(() => ({ ok: true }));
  }

  @Post('steps')
  addStep(@Body() dto: CreateWorkflowStepDto) {
    return this.config.addStep(dto);
  }

  @Patch('steps/:id')
  updateStep(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkflowStepDto) {
    return this.config.updateStep(id, dto);
  }

  @Delete('steps/:id')
  @HttpCode(200)
  deleteStep(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteStep(id).then(() => ({ ok: true }));
  }

  @Get('delegations')
  listDelegations(@Query() q: SearchablePaginationQueryDto) {
    return this.config.listDelegations(q);
  }

  @Post('delegations')
  createDelegation(@Body() dto: CreateDelegationDto) {
    return this.config.createDelegation(dto);
  }

  @Post('delegations/:id/cancel')
  @HttpCode(200)
  cancelDelegation(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.cancelDelegation(id).then(() => ({ ok: true }));
  }
}
