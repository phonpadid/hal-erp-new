import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { pageParams, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { Company } from '../multi-company/multi-company.entities';
import { DeptDocType, Document, DocumentType } from '../document/document.entities';
import { AppUser, Role, UserCompanyRole } from '../rbac/rbac.entities';
import { ApprovalDelegation, Workflow, WorkflowStep } from './approval.entities';

const FILTER_OFF = { filters: { company: false } } as const;
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
      isActive: true,
    });
    await this.em.persistAndFlush(workflow);
    return workflow;
  }

  /** The active company's workflows with their ordered steps (for the config UI). */
  async listWorkflows(): Promise<
    Array<{
      id: string; name: string; isActive: boolean;
      steps: Array<{ id: string; stepNo: number; stepName?: string; approverRoleId?: string; approverUserId?: string; amountMin?: string; amountMax?: string; approveMode: string; slaHours?: number; escalateToRoleId?: string; escalateToUserId?: string; showSignatureOnPdf: boolean; conditionJson?: string }>;
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
        escalateToRoleId: s.escalateToRole?.id, escalateToUserId: s.escalateToUser?.id,
        showSignatureOnPdf: s.showSignatureOnPdf,
        conditionJson: s.conditionJson,
      });
      byWf.set(s.workflow.id, list);
    }
    return workflows.map((w) => ({ id: w.id, name: w.name, isActive: w.isActive, steps: byWf.get(w.id) ?? [] }));
  }

  /**
   * Add a step. Every id in the DTO is RESOLVED inside the active company, never turned into a
   * reference: `getReference` writes a foreign key without reading the row, so the company filter —
   * which only applies to queries — is never consulted and the insert succeeds against any row that
   * exists anywhere (invariant 1).
   *
   * Permitted while the workflow has documents in approval. Routing reads the route each document
   * recorded at submit, so an edit here reaches documents submitted afterwards and cannot reach one
   * already routing. The guard that used to refuse this existed only because routing re-derived the
   * step set, and it meant a company whose documents are always in flight could never maintain its
   * workflows.
   */
  async addStep(dto: CreateWorkflowStepDto): Promise<WorkflowStep> {
    if (dto.amountMin != null && dto.amountMax != null && Money.compare(dto.amountMin, dto.amountMax) > 0) {
      throw new BadRequestException('amountMin must not exceed amountMax');
    }
    const companyId = RequestContext.companyId()!;
    return this.em.fork().transactional(async (em) => {
      const workflow = await em.findOne(Workflow, { id: dto.workflowId }, FILTER_OFF);
      if (!workflow || workflow.company.id !== companyId) {
        throw new NotFoundException(`Workflow ${dto.workflowId} not found`);
      }
      const clash = await em.count(WorkflowStep, { workflow: workflow.id, stepNo: dto.stepNo }, FILTER_OFF);
      if (clash > 0) throw new BadRequestException(`Step number ${dto.stepNo} already exists in this workflow`);

      const approverRole = await this.resolveRole(em, dto.approverRoleId, companyId);
      const approverUser = await this.resolveApprover(em, dto.approverUserId, companyId);
      this.assertNamesAnApprover(workflow.isActive, dto.stepNo, approverRole, approverUser);

      const step = em.create(WorkflowStep, {
        workflow,
        stepNo: dto.stepNo,
        stepName: dto.stepName,
        approverRole,
        approverUser,
        escalateToRole: await this.resolveRole(em, dto.escalateToRoleId, companyId, 'escalateToRoleId'),
        escalateToUser: await this.resolveApprover(em, dto.escalateToUserId, companyId, 'escalateToUserId'),
        amountMin: dto.amountMin,
        amountMax: dto.amountMax,
        approveMode: dto.approveMode ?? 'SEQUENTIAL',
        slaHours: dto.slaHours,
        showSignatureOnPdf: dto.showSignatureOnPdf ?? true,
        conditionJson: dto.conditionJson,
      });
      await em.persistAndFlush(step);
      return step;
    });
  }

  /**
   * A step's approver role, resolved in the active company. A role of another company would leave
   * this company's document waiting on an approver it has never heard of, so the field is named in
   * the refusal rather than the workflow: the caller owns the resource, the argument is wrong.
   */
  private async resolveRole(
    em: EntityManager,
    roleId: string | undefined,
    companyId: string,
    field = 'approverRoleId',
  ): Promise<Role | undefined> {
    if (!roleId) return undefined;
    const role = await em.findOne(Role, { id: roleId }, FILTER_OFF);
    if (!role || role.company.id !== companyId) {
      throw new BadRequestException(`${field} ${roleId} is not a role of the active company`);
    }
    return role;
  }

  /**
   * A step's named approver, resolved as a member of the active company. Membership is
   * `user_company_role` — the same relation `ApproverResolverService.principals` reads — so a step
   * can never be configured with a principal approver resolution could not produce.
   */
  private async resolveApprover(
    em: EntityManager,
    userId: string | undefined,
    companyId: string,
    field = 'approverUserId',
  ): Promise<AppUser | undefined> {
    if (!userId) return undefined;
    const membership = await em.findOne(
      UserCompanyRole,
      { user: userId, company: companyId },
      { ...FILTER_OFF, populate: ['user'] },
    );
    if (!membership) {
      throw new BadRequestException(`${field} ${userId} is not a member of the active company`);
    }
    return membership.user;
  }

  /** Update a workflow's own attributes (name / active). Active-company only. */
  async updateWorkflow(id: string, dto: UpdateWorkflowDto): Promise<Workflow> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const workflow = await em.findOne(Workflow, { id }, FILTER_OFF);
    if (!workflow || workflow.company.id !== companyId) throw new NotFoundException(`Workflow ${id} not found`);
    if (dto.name !== undefined) workflow.name = dto.name;
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
   * Update a step. Permitted while documents are in approval — they run the route they recorded at
   * submit. Preserves the amount-range and per-workflow unique stepNo rules.
   */
  async updateStep(id: string, dto: UpdateWorkflowStepDto): Promise<WorkflowStep> {
    const companyId = RequestContext.companyId()!;
    return this.em.fork().transactional(async (em) => {
      const step = await em.findOne(WorkflowStep, { id }, { ...FILTER_OFF, populate: ['workflow'] });
      if (!step || step.workflow.company.id !== companyId) throw new NotFoundException(`Step ${id} not found`);

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
      // Resolved, not referenced — this operation verifies the step it edits but used to accept an
      // approver from any company, which is the same hole `addStep` had for the workflow itself.
      if (dto.approverRoleId !== undefined) step.approverRole = await this.resolveRole(em, dto.approverRoleId, companyId);
      if (dto.approverUserId !== undefined) step.approverUser = await this.resolveApprover(em, dto.approverUserId, companyId);
      if (dto.escalateToRoleId !== undefined) step.escalateToRole = await this.resolveRole(em, dto.escalateToRoleId, companyId, 'escalateToRoleId');
      if (dto.escalateToUserId !== undefined) step.escalateToUser = await this.resolveApprover(em, dto.escalateToUserId, companyId, 'escalateToUserId');
      if (dto.amountMin !== undefined) step.amountMin = dto.amountMin;
      if (dto.amountMax !== undefined) step.amountMax = dto.amountMax;
      if (dto.approveMode !== undefined) step.approveMode = dto.approveMode;
      if (dto.slaHours !== undefined) step.slaHours = dto.slaHours;
      if (dto.showSignatureOnPdf !== undefined) step.showSignatureOnPdf = dto.showSignatureOnPdf;
      if (dto.conditionJson !== undefined) step.conditionJson = dto.conditionJson;
      // On the RESULTING state, not the dto: clearing the only approver must be refused as surely
      // as never setting one, and a dto-shaped check sees only the field that moved.
      this.assertNamesAnApprover(step.workflow.isActive, step.stepNo, step.approverRole, step.approverUser);
      await em.flush();
      return step;
    });
  }

  /**
   * A step of an active workflow must name an approver — a role or a person.
   *
   * A step naming neither resolves to an empty principal list, and nothing downstream objects: it
   * still matches on its amount band and the requester's level, routing opens it, `openStep` writes
   * zero actors, and the document becomes IN_APPROVAL in nobody's queue, holding whatever it
   * reserved at submit. No error, no notification, indistinguishable from a document merely waiting.
   *
   * Turns on what the configuration NAMES, never on who holds it. A role with no holders today is a
   * staffing fact answered by adding somebody to the role; a step naming nothing cannot be answered
   * that way at all. Mirrors the `workflowStepSchema` refinement in `shared`, so the form and the
   * server refuse the same thing.
   */
  private assertNamesAnApprover(
    workflowIsActive: boolean,
    stepNo: number,
    approverRole?: Role | null,
    approverUser?: AppUser | null,
  ): void {
    if (!workflowIsActive) return;
    if (approverRole || approverUser) return;
    throw new BadRequestException(
      `Step ${stepNo} names no approver: give it an approver role or an approver user, or nothing will ever be able to act on it.`,
    );
  }

  /** Delete a step. Permitted while documents are in approval — see `updateStep`. */
  async deleteStep(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    await this.em.fork().transactional(async (em) => {
      const step = await em.findOne(WorkflowStep, { id }, { ...FILTER_OFF, populate: ['workflow'] });
      if (!step || step.workflow.company.id !== companyId) throw new NotFoundException(`Step ${id} not found`);
      await em.remove(step).flush();
    });
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
