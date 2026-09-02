import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Company, Department } from '../multi-company/multi-company.entities';
import { EmployeeShift, WorkShift, WorkShiftDay } from './attendance.entities';
import { normalizeEndMinute, timeToMinutes } from './shift-time';
import type {
  CreateWorkShiftDto,
  SetWorkShiftDaysDto,
  UpdateWorkShiftDto,
} from './dto/work-shift.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Per-company work-shift master (invariant 1), configuration rather than code (invariant 7).
 *
 * Times arrive as "HH:MM" and are stored as minutes from local midnight; an end at or before the
 * start is read as the next day, so 22:00-06:00 becomes 1320-1800. Deactivate over delete: a
 * shift still referenced by an assignment or a department default cannot be hard-deleted, so
 * historical attendance stays resolvable.
 */
@Injectable()
export class WorkShiftService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateWorkShiftDto): Promise<WorkShift> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const dup = await em.findOne(WorkShift, { code: dto.code });
    if (dup) throw new BadRequestException(`Work shift '${dto.code}' already exists`);

    const startMinute = timeToMinutes(dto.startTime);
    const endMinute = normalizeEndMinute(startMinute, timeToMinutes(dto.endTime));
    const { breakStartMinute, breakEndMinute } = this.resolveBreak(
      dto.breakStartTime,
      dto.breakEndTime,
      startMinute,
      endMinute,
    );

    const shift = em.create(WorkShift, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      startMinute,
      endMinute,
      breakStartMinute,
      breakEndMinute,
      standardMinutes: dto.standardMinutes,
      graceMinutes: dto.graceMinutes ?? 15,
      halfDayThresholdMinutes: dto.halfDayThresholdMinutes,
      otMinMinutes: dto.otMinMinutes ?? 30,
      otRoundMinutes: dto.otRoundMinutes ?? 30,
      isActive: dto.isActive ?? true,
    });
    await em.persistAndFlush(shift);
    return shift;
  }

  async update(id: string, dto: UpdateWorkShiftDto): Promise<WorkShift> {
    const em = this.companyScope.forActiveCompany();
    const shift = await this.getScoped(em, id);

    // Times are validated together: changing only the start can invalidate a break that was fine
    // before, so the whole window is re-checked against the resulting span.
    if (dto.startTime !== undefined || dto.endTime !== undefined) {
      const startMinute =
        dto.startTime !== undefined ? timeToMinutes(dto.startTime) : shift.startMinute;
      const endMinute =
        dto.endTime !== undefined
          ? normalizeEndMinute(startMinute, timeToMinutes(dto.endTime))
          : shift.endMinute;
      if (endMinute <= startMinute) {
        throw new BadRequestException('Work shift must end after it starts');
      }
      shift.startMinute = startMinute;
      shift.endMinute = endMinute;
    }

    if (dto.breakStartTime !== undefined || dto.breakEndTime !== undefined) {
      const startTime = dto.breakStartTime === undefined ? undefined : dto.breakStartTime;
      const endTime = dto.breakEndTime === undefined ? undefined : dto.breakEndTime;
      const { breakStartMinute, breakEndMinute } = this.resolveBreak(
        startTime ?? undefined,
        endTime ?? undefined,
        shift.startMinute,
        shift.endMinute,
      );
      shift.breakStartMinute = breakStartMinute;
      shift.breakEndMinute = breakEndMinute;
    } else if (dto.startTime !== undefined || dto.endTime !== undefined) {
      // The span moved; an untouched break must still sit inside it.
      this.assertBreakWithinShift(shift.breakStartMinute, shift.breakEndMinute, shift.startMinute, shift.endMinute);
    }

    if (dto.name !== undefined) shift.name = dto.name;
    if (dto.standardMinutes !== undefined) shift.standardMinutes = dto.standardMinutes;
    if (dto.graceMinutes !== undefined) shift.graceMinutes = dto.graceMinutes;
    if (dto.halfDayThresholdMinutes !== undefined) {
      shift.halfDayThresholdMinutes = dto.halfDayThresholdMinutes;
    }
    if (dto.otMinMinutes !== undefined) shift.otMinMinutes = dto.otMinMinutes;
    if (dto.otRoundMinutes !== undefined) shift.otRoundMinutes = dto.otRoundMinutes;
    if (dto.isActive !== undefined) shift.isActive = dto.isActive;

    await em.flush();
    return shift;
  }

  /** Company-scoped list ordered by code. `includeInactive` for the admin surface. */
  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<WorkShift>> {
    const em = this.companyScope.forActiveCompany();
    const where = includeInactive ? {} : { isActive: true };
    return paginate(em, WorkShift, where, { orderBy: { code: 'ASC' } }, q);
  }

  get(id: string): Promise<WorkShift> {
    return this.getScoped(this.companyScope.forActiveCompany(), id);
  }

  /** The weekday pattern of a shift, ordered Monday-first. */
  async getDays(shiftId: string): Promise<WorkShiftDay[]> {
    const em = this.companyScope.forActiveCompany();
    await this.getScoped(em, shiftId);
    return em.find(WorkShiftDay, { workShift: shiftId }, { orderBy: { weekday: 'ASC' } });
  }

  /**
   * Replace a shift's whole weekday pattern in one transaction. Wholesale rather than per-day
   * because the pattern is a single decision; applying it as a set makes a half-written pattern
   * impossible. A weekday absent from `days` becomes non-working by having no row.
   */
  async setDays(shiftId: string, dto: SetWorkShiftDaysDto): Promise<WorkShiftDay[]> {
    const seen = new Set<number>();
    for (const day of dto.days) {
      if (seen.has(day.weekday)) {
        throw new BadRequestException(`Duplicate weekday ${day.weekday} in the shift pattern`);
      }
      seen.add(day.weekday);
    }

    const em = this.companyScope.forActiveCompany();
    const shift = await this.getScoped(em, shiftId);

    return inTransaction(em, async (tem) => {
      await tem.nativeDelete(WorkShiftDay, { workShift: shift.id });
      const rows = dto.days.map((day) => {
        const startMinute = day.startTime === undefined ? undefined : timeToMinutes(day.startTime);
        let endMinute = day.endTime === undefined ? undefined : timeToMinutes(day.endTime);
        // A per-day override is read against that day's own start, so a night shift can override
        // one weekday without the override silently landing before its start.
        if (endMinute !== undefined) {
          endMinute = normalizeEndMinute(startMinute ?? shift.startMinute, endMinute);
        }
        return tem.create(WorkShiftDay, {
          workShift: tem.getReference(WorkShift, shift.id),
          weekday: day.weekday,
          isWorking: day.isWorking ?? true,
          startMinute,
          endMinute,
        });
      });
      rows.forEach((r) => tem.persist(r));
      await tem.flush();
      return rows.sort((a, b) => a.weekday - b.weekday);
    });
  }

  /** Active shifts for the assignment picker (active company only). */
  async listSelectable(): Promise<Array<{ id: string; code: string; name: string }>> {
    const em = this.companyScope.forActiveCompany();
    const rows = await em.find(
      WorkShift,
      { isActive: true },
      { fields: ['id', 'code', 'name'], orderBy: { code: 'ASC' } },
    );
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name }));
  }

  /** Soft-delete: keep the row so existing assignments still resolve. */
  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const shift = await this.getScoped(em, id);
    shift.isActive = false;
    await em.flush();
  }

  /**
   * Hard-delete a shift. Rejected while any `employee_shift` or `department.default_work_shift_id`
   * still points at it — deactivation is offered instead, so historical attendance keeps
   * resolving the hours it was judged against.
   */
  async remove(id: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const shift = await this.getScoped(em, id);
    if (await this.isReferenced(em, shift.id)) {
      throw new BadRequestException(
        `Work shift '${shift.code}' is assigned to an employee or is a department default; deactivate it instead of deleting`,
      );
    }
    await em.nativeDelete(WorkShiftDay, { workShift: shift.id });
    await em.removeAndFlush(shift);
  }

  private async isReferenced(em: EntityManager, shiftId: string): Promise<boolean> {
    const assigned = await em.findOne(EmployeeShift, { workShift: shiftId }, FILTER_OFF);
    if (assigned) return true;
    const dept = await em.findOne(Department, { defaultWorkShift: shiftId }, FILTER_OFF);
    return !!dept;
  }

  /** Both break ends are set together, or the break is cleared. Half a window is not a break. */
  private resolveBreak(
    breakStartTime: string | undefined,
    breakEndTime: string | undefined,
    startMinute: number,
    endMinute: number,
  ): { breakStartMinute?: number; breakEndMinute?: number } {
    if (breakStartTime === undefined && breakEndTime === undefined) {
      return { breakStartMinute: undefined, breakEndMinute: undefined };
    }
    if (breakStartTime === undefined || breakEndTime === undefined) {
      throw new BadRequestException('A break needs both a start and an end time, or neither');
    }
    const breakStartMinute = timeToMinutes(breakStartTime);
    const breakEndMinute = normalizeEndMinute(breakStartMinute, timeToMinutes(breakEndTime));
    this.assertBreakWithinShift(breakStartMinute, breakEndMinute, startMinute, endMinute);
    return { breakStartMinute, breakEndMinute };
  }

  private assertBreakWithinShift(
    breakStartMinute: number | undefined,
    breakEndMinute: number | undefined,
    startMinute: number,
    endMinute: number,
  ): void {
    if (breakStartMinute === undefined || breakEndMinute === undefined) return;
    if (breakEndMinute <= breakStartMinute) {
      throw new BadRequestException('Break must end after it starts');
    }
    if (breakStartMinute < startMinute || breakEndMinute > endMinute) {
      throw new BadRequestException('Break must fall within the shift span');
    }
  }

  private async getScoped(em: EntityManager, id: string): Promise<WorkShift> {
    const shift = await em.findOne(WorkShift, { id });
    if (!shift) throw new NotFoundException(`Work shift ${id} not found`);
    return shift;
  }
}
