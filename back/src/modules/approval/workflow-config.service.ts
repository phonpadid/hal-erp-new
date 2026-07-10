import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { pageParams, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { DeptDocType, Document, DocumentType } from '../document/document.entities';
import { DocStatus } from '../../common/enums';
import { AppUser, Role } from '../rbac/rbac.entities';
import { ApprovalDelegation, Workflow, WorkflowStep } from './approval.entities';

const FILTER_OFF = { filters: { company: false } } as const;
// Document statuses that are still actively routing through the live step set.
const IN_FLIGHT = [DocStatus.SUBMITTED, DocStatus.IN_APPROVAL];
import type {
  CreateDelegationDto,
  CreateWorkflowDto,
  CreateWorkflowStepDto,
  UpdateWorkflowDto,
  UpdateWorkflowStepDto,
} from './dto/workflow.dto';

/** Workflow / step / delegation configuration (WORKFLOW_MANAGE). */
@Injectable()
export class WorkflowConfigService {
  constructor(private readonly em: EntityManager) {}

  async createWorkflow(dto: CreateWorkflowDto): Promise<Workflow> {
    const companyId = RequestContext.companyId()!;
    const workflow = this.em.create(Workflow, {
      company: this.em.getReference(Company, companyId),
      name: dto.name,
      conditionJson: dto.conditionJson,
      isActive: true,
    });
    await this.em.persistAndFlush(workflow);
    return workflow;
  }

  /** The active company's workflows with their ordered steps (for the config UI). */
  async listWorkflows(): Promise<
    Array<{
      id: string; name: string; isActive: boolean; conditionJson?: string;
      steps: Array<{ id: string; stepNo: number; stepName?: string; approverRoleId?: string; approverUserId?: string; amountMin?: string; amountMax?: string; approveMode: string; slaHours?: number; showSignatureOnPdf: boolean; conditionJson?: string }>;
    }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const workflows = await em.find(Workflow, { company: companyId }, { filters: { company: false }, orderBy: { name: 'ASC' } });
    const steps = await em.find(
      WorkflowStep,
      { workflow: { $in: workflows.map((w) => w.id) } },
      { filters: { company: false }, orderBy: { stepNo: 'ASC' } },
    );
    const byWf = new Map<string, any[]>();
    for (const s of steps) {
      const list = byWf.get(s.workflow.id) ?? [];
      list.push({
        id: s.id, stepNo: s.stepNo, stepName: s.stepName,
        approverRoleId: s.approverRole?.id, approverUserId: s.approverUser?.id,
        amountMin: s.amountMin, amountMax: s.amountMax, approveMode: s.approveMode, slaHours: s.slaHours,
        showSignatureOnPdf: s.showSignatureOnPdf,
        conditionJson: s.conditionJson,
      });
      byWf.set(s.workflow.id, list);
    }
    return workflows.map((w) => ({ id: w.id, name: w.name, isActive: w.isActive, conditionJson: w.conditionJson, steps: byWf.get(w.id) ?? [] }));
  }

  async addStep(dto: CreateWorkflowStepDto): Promise<WorkflowStep> {
    if (dto.amountMin != null && dto.amountMax != null && Money.compare(dto.amountMin, dto.amountMax) > 0) {
      throw new BadRequestException('amountMin must not exceed amountMax');
    }
    const step = this.em.create(WorkflowStep, {
      workflow: this.em.getReference(Workflow, dto.workflowId),
      stepNo: dto.stepNo,
      stepName: dto.stepName,
      approverRole: dto.approverRoleId ? this.em.getReference(Role, dto.approverRoleId) : undefined,
      approverUser: dto.approverUserId ? this.em.getReference(AppUser, dto.approverUserId) : undefined,
      amountMin: dto.amountMin,
      amountMax: dto.amountMax,
      approveMode: dto.approveMode ?? 'SEQUENTIAL',
      slaHours: dto.slaHours,
      showSignatureOnPdf: dto.showSignatureOnPdf ?? true,
      conditionJson: dto.conditionJson,
    });
    await this.em.persistAndFlush(step);
    return step;
  }

  /** Update a workflow's own attributes (name / condition / active). Active-company only. */
  async updateWorkflow(id: string, dto: UpdateWorkflowDto): Promise<Workflow> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const workflow = await em.findOne(Workflow, { id }, FILTER_OFF);
    if (!workflow || workflow.company.id !== companyId) throw new NotFoundException(`Workflow ${id} not found`);
    if (dto.name !== undefined) workflow.name = dto.name;
    if (dto.conditionJson !== undefined) workflow.conditionJson = dto.conditionJson;
    if (dto.isActive !== undefined) workflow.isActive = dto.isActive;
    await em.flush();
    return workflow;
  }

  /**
   * Delete a workflow and its steps. Rejected when a department mapping or any document
   * references it (the `document`→`workflow` FK is non-nullable) — deactivate such a
   * workflow instead. The workflow and its steps are removed in one transaction.
   */
  async deleteWorkflow(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    await this.em.fork().transactional(async (em) => {
      const workflow = await em.findOne(Workflow, { id }, FILTER_OFF);
      if (!workflow || workflow.company.id !== companyId) throw new NotFoundException(`Workflow ${id} not found`);
      const mapped = await em.count(DeptDocType, { workflow: id }, FILTER_OFF);
      if (mapped > 0) {
        throw new BadRequestException('Workflow is used by a department mapping; remove the mapping or deactivate the workflow instead.');
      }
      const documents = await em.count(Document, { workflow: id }, FILTER_OFF);
      if (documents > 0) {
        throw new BadRequestException('Workflow is referenced by documents; deactivate it instead of deleting.');
      }
      await em.nativeDelete(WorkflowStep, { workflow: id });
      await em.remove(workflow).flush();
    });
  }

  /**
   * Update a step. Rejected while the parent workflow has an in-flight document
   * (SUBMITTED / IN_APPROVAL), since routing reads the live step set. Preserves the
   * amount-range and per-workflow unique stepNo rules.
   */
  async updateStep(id: string, dto: UpdateWorkflowStepDto): Promise<WorkflowStep> {
    const companyId = RequestContext.companyId()!;
    return this.em.fork().transactional(async (em) => {
      const step = await em.findOne(WorkflowStep, { id }, { ...FILTER_OFF, populate: ['workflow'] });
      if (!step || step.workflow.company.id !== companyId) throw new NotFoundException(`Step ${id} not found`);
      await this.assertNoInFlight(em, step.workflow.id);

      const effMin = dto.amountMin !== undefined ? dto.amountMin : step.amountMin;
      const effMax = dto.amountMax !== undefined ? dto.amountMax : step.amountMax;
      if (effMin != null && effMax != null && Money.compare(effMin, effMax) > 0) {
        throw new BadRequestException('amountMin must not exceed amountMax');
      }
      if (dto.stepNo !== undefined && dto.stepNo !== step.stepNo) {
        const clash = await em.count(WorkflowStep, { workflow: step.workflow.id, stepNo: dto.stepNo, id: { $ne: id } }, FILTER_OFF);
        if (clash > 0) throw new BadRequestException(`Step number ${dto.stepNo} already exists in this workflow`);
        step.stepNo = dto.stepNo;
      }
      if (dto.stepName !== undefined) step.stepName = dto.stepName;
      if (dto.approverRoleId !== undefined) step.approverRole = dto.approverRoleId ? em.getReference(Role, dto.approverRoleId) : undefined;
      if (dto.approverUserId !== undefined) step.approverUser = dto.approverUserId ? em.getReference(AppUser, dto.approverUserId) : undefined;
      if (dto.amountMin !== undefined) step.amountMin = dto.amountMin;
      if (dto.amountMax !== undefined) step.amountMax = dto.amountMax;
      if (dto.approveMode !== undefined) step.approveMode = dto.approveMode;
      if (dto.slaHours !== undefined) step.slaHours = dto.slaHours;
      if (dto.showSignatureOnPdf !== undefined) step.showSignatureOnPdf = dto.showSignatureOnPdf;
      if (dto.conditionJson !== undefined) step.conditionJson = dto.conditionJson;
      await em.flush();
      return step;
    });
  }

  /** Delete a step. Rejected while the parent workflow has an in-flight document. */
  async deleteStep(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    await this.em.fork().transactional(async (em) => {
      const step = await em.findOne(WorkflowStep, { id }, { ...FILTER_OFF, populate: ['workflow'] });
      if (!step || step.workflow.company.id !== companyId) throw new NotFoundException(`Step ${id} not found`);
      await this.assertNoInFlight(em, step.workflow.id);
      await em.remove(step).flush();
    });
  }

  /** Guard: block step mutation while the workflow has a document still routing. */
  private async assertNoInFlight(em: EntityManager, workflowId: string): Promise<void> {
    const inFlight = await em.count(Document, { workflow: workflowId, status: { $in: IN_FLIGHT } }, FILTER_OFF);
    if (inFlight > 0) {
      throw new BadRequestException('Workflow has documents in approval; changes to its steps are blocked until they finish.');
    }
  }

  /** The active company's approval delegations (paged, newest first), with resolved names. */
  async listDelegations(
    q: PaginationQueryDto = {},
  ): Promise<
    Paginated<{
      id: string; delegatorId: string; delegatorName: string; delegateId: string; delegateName: string;
      documentTypeId?: string; documentTypeCode?: string; amountLimit?: string;
      startDate: string; endDate: string; status: string; reason?: string;
    }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const { page, limit, offset } = pageParams(q);
    const [rows, total] = await em.findAndCount(
      ApprovalDelegation,
      { company: companyId },
      { ...FILTER_OFF, orderBy: { createdAt: 'DESC' }, offset, limit },
    );
    const userIds = [...new Set(rows.flatMap((r) => [r.delegator.id, r.delegate.id]))];
    const typeIds = [...new Set(rows.map((r) => r.documentType?.id).filter(Boolean) as string[])];
    const users = new Map((userIds.length ? await em.find(AppUser, { id: { $in: userIds } }, FILTER_OFF) : []).map((u) => [u.id, u.username]));
    const types = new Map((typeIds.length ? await em.find(DocumentType, { id: { $in: typeIds } }, FILTER_OFF) : []).map((t) => [t.id, t.code]));
    const items = rows.map((r) => ({
      id: r.id,
      delegatorId: r.delegator.id, delegatorName: users.get(r.delegator.id) ?? '',
      delegateId: r.delegate.id, delegateName: users.get(r.delegate.id) ?? '',
      documentTypeId: r.documentType?.id, documentTypeCode: r.documentType?.id ? types.get(r.documentType.id) : undefined,
      amountLimit: r.amountLimit, startDate: r.startDate, endDate: r.endDate, status: r.status, reason: r.reason,
    }));
    return { items, total, page, limit };
  }

  /** Soft-cancel a delegation (active company only); the resolver honors only ACTIVE. */
  async cancelDelegation(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const del = await em.findOne(ApprovalDelegation, { id }, FILTER_OFF);
    if (!del || del.company.id !== companyId) throw new NotFoundException(`Delegation ${id} not found`);
    del.status = 'CANCELLED';
    await em.flush();
  }

  async createDelegation(dto: CreateDelegationDto): Promise<ApprovalDelegation> {
    const companyId = RequestContext.companyId()!;
    const delegation = this.em.create(ApprovalDelegation, {
      company: this.em.getReference(Company, companyId),
      delegator: this.em.getReference(AppUser, dto.delegatorId),
      delegate: this.em.getReference(AppUser, dto.delegateId),
      documentType: dto.documentTypeId ? this.em.getReference(DocumentType, dto.documentTypeId) : undefined,
      amountLimit: dto.amountLimit,
      startDate: dto.startDate,
      endDate: dto.endDate,
      reason: dto.reason,
      status: 'ACTIVE',
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(delegation);
    return delegation;
  }
}
