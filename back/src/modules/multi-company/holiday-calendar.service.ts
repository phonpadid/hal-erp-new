import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, HolidayCalendar } from './multi-company.entities';
import type { CreateHolidayDto } from './dto/holiday.dto';

/** Per-company holidays (used by WorkingTimeService for SLA day-counting). */
@Injectable()
export class HolidayCalendarService {
  constructor(private readonly scope: CompanyScopeService) {}

  async create(dto: CreateHolidayDto): Promise<HolidayCalendar> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany(companyId);
    const holiday = em.create(HolidayCalendar, {
      company: em.getReference(Company, companyId),
      holidayDate: dto.holidayDate,
      name: dto.name,
    });
    await em.persistAndFlush(holiday);
    return holiday;
  }

  list(q: PaginationQueryDto = {}): Promise<Paginated<HolidayCalendar>> {
    return paginate(this.scope.forActiveCompany(), HolidayCalendar, {}, {}, q);
  }

  async get(id: string): Promise<HolidayCalendar> {
    const holiday = await this.scope.forActiveCompany().findOne(HolidayCalendar, { id });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    return holiday;
  }

  // Holidays carry no downstream references, so removal is a hard delete.
  async remove(id: string): Promise<void> {
    const em = this.scope.forActiveCompany();
    const holiday = await em.findOne(HolidayCalendar, { id });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    await em.removeAndFlush(holiday);
  }
}
