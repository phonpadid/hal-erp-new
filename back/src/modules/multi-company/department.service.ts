import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { WorkShift } from '../attendance/attendance.entities';
import { Company, Department } from './multi-company.entities';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Department tree (invariant 1). All access goes through a company-scoped EM, so
 * a parent in another company is simply not found → rejected. Reparenting also
 * rejects cycles (a department becoming its own ancestor).
 */
@Injectable()
export class DepartmentService {
  constructor(private readonly scope: CompanyScopeService) {}

  /** Resolve a parent within the active company, or reject if absent/cross-company. */
  private async resolveParent(em: EntityManager, parentId: string): Promise<Department> {
    const parent = await em.findOne(Department, { id: parentId });
    if (!parent) {
      throw new BadRequestException(
        `Parent department ${parentId} not found in the active company`,
      );
    }
    return parent;
  }

  /** True if making `parentId` the parent of `deptId` would create a cycle. */
  private async wouldCreateCycle(
    em: EntityManager,
    deptId: string,
    parentId: string,
  ): Promise<boolean> {
    const visited = new Set<string>();
    let current: string | undefined = parentId;
    while (current) {
      if (current === deptId) return true; // reached self → cycle
      if (visited.has(current)) break; // guard against pre-existing corruption
      visited.add(current);
      const node = await em.findOne(Department, { id: current });
      current = node?.parentDept?.id;
    }
    return false;
  }

  /**
   * Resolve a default shift within the active company, or reject. The EM is company-scoped, so a
   * shift belonging to another company is simply not found — which is the rejection (invariant 1).
   */
  private async resolveDefaultShift(em: EntityManager, shiftId: string): Promise<WorkShift> {
    const shift = await em.findOne(WorkShift, { id: shiftId });
    if (!shift) {
      throw new BadRequestException(`Unknown work shift '${shiftId}' in this company`);
    }
    return shift;
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany(companyId);

    const department = em.create(Department, {
      company: em.getReference(Company, companyId),
      deptCode: dto.deptCode,
      name: dto.name,
      costCenter: dto.costCenter,
      parentDept: dto.parentDeptId
        ? await this.resolveParent(em, dto.parentDeptId)
        : undefined,
      attendanceAffectsPay: dto.attendanceAffectsPay ?? true,
      defaultWorkShift: dto.defaultWorkShiftId
        ? await this.resolveDefaultShift(em, dto.defaultWorkShiftId)
        : undefined,
      isActive: true,
    });
    await em.persistAndFlush(department);
    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const em = this.scope.forActiveCompany();
    const department = await this.getWith(em, id);

    if (dto.parentDeptId !== undefined) {
      if (dto.parentDeptId === null) {
        department.parentDept = undefined;
      } else {
        await this.resolveParent(em, dto.parentDeptId);
        if (await this.wouldCreateCycle(em, id, dto.parentDeptId)) {
          throw new BadRequestException(
            'Reparenting would create a cycle in the department tree',
          );
        }
        department.parentDept = em.getReference(Department, dto.parentDeptId);
      }
    }
    if (dto.name !== undefined) department.name = dto.name;
    if (dto.costCenter !== undefined) department.costCenter = dto.costCenter;
    if (dto.attendanceAffectsPay !== undefined) {
      department.attendanceAffectsPay = dto.attendanceAffectsPay;
    }
    if (dto.defaultWorkShiftId !== undefined) {
      department.defaultWorkShift = dto.defaultWorkShiftId
        ? await this.resolveDefaultShift(em, dto.defaultWorkShiftId)
        : undefined;
    }
    if (dto.isActive !== undefined) department.isActive = dto.isActive;

    await em.flush();
    return department;
  }

  list(q: PaginationQueryDto = {}): Promise<Paginated<Department>> {
    return paginate(this.scope.forActiveCompany(), Department, {}, {}, q);
  }

  get(id: string): Promise<Department> {
    return this.getWith(this.scope.forActiveCompany(), id);
  }

  async deactivate(id: string): Promise<void> {
    const em = this.scope.forActiveCompany();
    const department = await this.getWith(em, id);
    department.isActive = false;
    await em.flush();
  }

  private async getWith(em: EntityManager, id: string): Promise<Department> {
    const department = await em.findOne(Department, { id });
    if (!department) throw new NotFoundException(`Department ${id} not found`);
    return department;
  }
}
