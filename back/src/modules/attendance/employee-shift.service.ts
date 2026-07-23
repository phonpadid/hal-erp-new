import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { EmployeeShift, WorkShift } from './attendance.entities';
import type { AssignEmployeeShiftDto, EndEmployeeShiftDto } from './dto/employee-shift.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Binds a person to a shift over a date range. Fixed assignment, not a rotating roster.
 *
 * Two ranges for the same employee must never cover the same date, or resolution has no single
 * answer. PostgreSQL could enforce that with an EXCLUDE constraint over a daterange, but that
 * needs the btree_gist extension — a deployment concern for a rule this service can hold.
 *
 * A transaction alone does NOT hold it. At READ COMMITTED a plain SELECT takes no lock, so two
 * concurrent assignments both scan a clear field and both insert; the `(employee, effective_from)`
 * unique index only catches them when the start dates happen to match. The employee row is
 * therefore taken FOR UPDATE first, serializing every write to that person's timeline — the same
 * pessimistic-lock pattern budget reservation and document numbering already use, applied to a
 * different scarce resource.
 */
@Injectable()
export class EmployeeShiftService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async assign(dto: AssignEmployeeShiftDto): Promise<EmployeeShift> {
    const companyId = RequestContext.companyId()!;
    const effectiveFrom = toDateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? toDateOnly(dto.effectiveTo) : undefined;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('effectiveTo must not precede effectiveFrom');
    }

    const em = this.companyScope.forActiveCompany(companyId);
    return inTransaction(em, async (tem) => {
      // Both ends must belong to the active company — an assignment is the one place where an
      // employee and a shift meet, so it is where a cross-company reference would slip in.
      // Locked FOR UPDATE: every write to this person's timeline serializes here, so the overlap
      // scan below cannot race another assignment that has not committed yet.
      const employee = await lockForUpdate(
        tem,
        Employee,
        { id: dto.employeeId, company: companyId },
        FILTER_OFF,
      );
      if (!employee) throw new BadRequestException(`Unknown employee '${dto.employeeId}'`);
      const shift = await tem.findOne(WorkShift, { id: dto.workShiftId, company: companyId }, FILTER_OFF);
      if (!shift) throw new BadRequestException(`Unknown work shift '${dto.workShiftId}'`);

      await this.assertNoOverlap(tem, dto.employeeId, effectiveFrom, effectiveTo);

      const assignment = tem.create(EmployeeShift, {
        company: tem.getReference(Company, companyId),
        employee: tem.getReference(Employee, dto.employeeId),
        workShift: tem.getReference(WorkShift, dto.workShiftId),
        effectiveFrom,
        effectiveTo,
      });
      await tem.persistAndFlush(assignment);
      return assignment;
    });
  }

  /** Assignments of one employee, newest range first. */
  listForEmployee(employeeId: string): Promise<EmployeeShift[]> {
    const em = this.companyScope.forActiveCompany();
    return em.find(
      EmployeeShift,
      { employee: employeeId },
      { populate: ['workShift'], orderBy: { effectiveFrom: 'DESC' } },
    );
  }

  /** Close an open-ended assignment (or move its end), re-checking the range stays disjoint. */
  async end(id: string, dto: EndEmployeeShiftDto): Promise<EmployeeShift> {
    const effectiveTo = toDateOnly(dto.effectiveTo);
    const em = this.companyScope.forActiveCompany();
    return inTransaction(em, async (tem) => {
      const assignment = await tem.findOne(EmployeeShift, { id }, { populate: ['employee'] });
      if (!assignment) throw new NotFoundException(`Employee shift ${id} not found`);
      // Same lock as assign(): extending a range is a write to the timeline and must serialize
      // against a concurrent assign() on the same person.
      await lockForUpdate(tem, Employee, { id: assignment.employee.id }, FILTER_OFF);
      if (effectiveTo < assignment.effectiveFrom) {
        throw new BadRequestException('effectiveTo must not precede effectiveFrom');
      }
      // Shortening a range can never create an overlap, but extending one can.
      await this.assertNoOverlap(tem, assignment.employee.id, assignment.effectiveFrom, effectiveTo, id);
      assignment.effectiveTo = effectiveTo;
      await tem.flush();
      return assignment;
    });
  }

  async remove(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const assignment = await em.findOne(EmployeeShift, { id });
    if (!assignment) throw new NotFoundException(`Employee shift ${id} not found`);
    await em.removeAndFlush(assignment);
  }

  /**
   * Reject a range that touches any existing range of the same employee. Two half-open ranges
   * overlap unless one ends before the other starts; an absent `effectiveTo` is "forever", which
   * is why the comparison is written against nulls rather than a sentinel date.
   */
  private async assertNoOverlap(
    tem: EntityManager,
    employeeId: string,
    effectiveFrom: string,
    effectiveTo: string | undefined,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await tem.find(EmployeeShift, { employee: employeeId }, FILTER_OFF);
    const clash = existing.find((row) => {
      if (ignoreId && row.id === ignoreId) return false;
      const startsAfterOtherEnds = !!row.effectiveTo && effectiveFrom > row.effectiveTo;
      const endsBeforeOtherStarts = !!effectiveTo && effectiveTo < row.effectiveFrom;
      return !startsAfterOtherEnds && !endsBeforeOtherStarts;
    });
    if (clash) {
      throw new BadRequestException(
        `Employee already has a shift assignment covering ${effectiveFrom}` +
          `${effectiveTo ? ` to ${effectiveTo}` : ' onward'} (from ${clash.effectiveFrom})`,
      );
    }
  }
}

/** Dates are compared as `YYYY-MM-DD` strings, which sort correctly and carry no zone. */
function toDateOnly(value: string): string {
  return value.slice(0, 10);
}
