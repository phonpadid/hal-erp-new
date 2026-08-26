import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parseStepJobLevels } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Employee } from '../rbac/rbac.entities';
import { WorkflowStep } from '../approval/approval.entities';
import { Company } from '../multi-company/multi-company.entities';
import { JobLevel } from './job-level.entities';
import type { CreateJobLevelDto, UpdateJobLevelDto } from './dto/job-level.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Per-company position-level master (invariant 1). `code` is the value referenced by
 * `employee.job_level` and `workflow_step.condition_json`; `rank` orders seniority for the
 * workflow-step `minRank` condition. Levels are configuration (invariant 7). Deactivate over
 * delete: a level still referenced by an employee or a step condition cannot be hard-deleted, so
 * historical routing stays resolvable.
 */
@Injectable()
export class JobLevelService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateJobLevelDto): Promise<JobLevel> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const dup = await em.findOne(JobLevel, { code: dto.code });
    if (dup) throw new BadRequestException(`Job level '${dto.code}' already exists`);
    const level = em.create(JobLevel, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      rank: dto.rank,
      isActive: dto.isActive ?? true,
    });
    await em.persistAndFlush(level);
    return level;
  }

  async update(id: string, dto: UpdateJobLevelDto): Promise<JobLevel> {
    const em = this.companyScope.forActiveCompany();
    const level = await this.getScoped(em, id);
    if (dto.name !== undefined) level.name = dto.name;
    if (dto.rank !== undefined) level.rank = dto.rank;
    if (dto.isActive !== undefined) level.isActive = dto.isActive;
    await em.flush();
    return level;
  }

  /** Company-scoped list, ordered by rank (ascending). `includeInactive` for the admin surface. */
  list(q: SearchablePaginationQueryDto = {}, includeInactive = false): Promise<Paginated<JobLevel>> {
    const em = this.companyScope.forActiveCompany();
    const where = includeInactive ? {} : { isActive: true };
    return paginate(em, JobLevel, withSearch<JobLevel>(where, q.search, ['code', 'name']), { orderBy: { rank: 'ASC' } }, q);
  }

  get(id: string): Promise<JobLevel> {
    return this.getScoped(this.companyScope.forActiveCompany(), id);
  }

  /** Active levels for the employee/workflow-step assignment pickers (active company only). */
  async listSelectable(): Promise<Array<{ id: string; code: string; name: string; rank: number }>> {
    const em = this.companyScope.forActiveCompany();
    const rows = await em.find(
      JobLevel,
      { isActive: true },
      { fields: ['id', 'code', 'name', 'rank'], orderBy: { rank: 'ASC' } },
    );
    return rows.map((l) => ({ id: l.id, code: l.code, name: l.name, rank: l.rank }));
  }

  /**
   * Resolve an active job level by `code` in a given company (filter-bypassing, explicit company),
   * or null. Used by the employee registry to validate `job_level` and by the approval router to
   * resolve a requester's `rank`. Returns only active rows so a deactivated level is not assignable.
   */
  async resolveActiveByCode(
    code: string,
    companyId: string,
    em: EntityManager = this.em,
  ): Promise<{ code: string; rank: number } | null> {
    const level = await em.findOne(
      JobLevel,
      { company: companyId, code, isActive: true },
      FILTER_OFF,
    );
    return level ? { code: level.code, rank: level.rank } : null;
  }

  /** Soft-delete: keep the row so existing employee/step references still resolve. */
  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const level = await this.getScoped(em, id);
    level.isActive = false;
    await em.flush();
  }

  /**
   * Hard-delete a level. Rejected when the level's `code` is still referenced by any employee's
   * `job_level` or any workflow step's `condition_json` in the company — deactivation is offered
   * instead, so historical routing (including `minRank`, which resolves rank via the code) stays
   * stable.
   */
  async remove(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const level = await this.getScoped(em, id);
    if (await this.isCodeReferenced(em, companyId, level.code)) {
      throw new BadRequestException(
        `Job level '${level.code}' is in use by an employee or a workflow step; deactivate it instead of deleting`,
      );
    }
    await em.removeAndFlush(level);
  }

  /** True when `code` is referenced by an employee.job_level or a workflow step condition. */
  private async isCodeReferenced(em: EntityManager, companyId: string, code: string): Promise<boolean> {
    const emp = await em.findOne(
      Employee,
      { company: companyId, jobLevel: code },
      FILTER_OFF,
    );
    if (emp) return true;
    const steps = await em.find(
      WorkflowStep,
      { workflow: { company: companyId } },
      { ...FILTER_OFF, fields: ['conditionJson'] },
    );
    return steps.some((s) => parseStepJobLevels(s.conditionJson).includes(code));
  }

  private async getScoped(em: EntityManager, id: string): Promise<JobLevel> {
    const level = await em.findOne(JobLevel, { id });
    if (!level) throw new NotFoundException(`Job level ${id} not found`);
    return level;
  }
}
