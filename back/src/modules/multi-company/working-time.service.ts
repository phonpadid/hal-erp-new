import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { HolidayCalendar } from './multi-company.entities';

const HOUR_MS = 3_600_000;

/**
 * Working-time math for workflow SLA countdowns. Counts only Mon–Fri hours and
 * skips dates present in the company's `holiday_calendar`. A working day is a full
 * 24h block for now; business-hour windows can be refined when approval-workflow
 * lands (the contract here is: weekends + holidays are excluded).
 */
@Injectable()
export class WorkingTimeService {
  constructor(private readonly scope: CompanyScopeService) {}

  private async holidaySet(companyId?: string): Promise<Set<string>> {
    const holidays = await this.scope
      .forActiveCompany(companyId)
      .find(HolidayCalendar, {});
    return new Set(holidays.map((h) => h.holidayDate));
  }

  private isWorking(instant: Date, holidays: Set<string>): boolean {
    const day = instant.getUTCDay(); // 0 Sun … 6 Sat
    if (day === 0 || day === 6) return false;
    const iso = instant.toISOString().slice(0, 10);
    return !holidays.has(iso);
  }

  /** Advance `start` by `hours` working hours, skipping weekends and holidays. */
  async addWorkingHours(start: Date, hours: number, companyId?: string): Promise<Date> {
    const holidays = await this.holidaySet(companyId);
    let remaining = hours;
    let cursor = new Date(start.getTime());
    while (remaining > 0) {
      cursor = new Date(cursor.getTime() + HOUR_MS);
      if (this.isWorking(cursor, holidays)) {
        remaining -= 1;
      }
    }
    return cursor;
  }

  /** Count working hours that elapse between two instants (excludes weekends/holidays). */
  async workingHoursBetween(start: Date, end: Date, companyId?: string): Promise<number> {
    if (end <= start) return 0;
    const holidays = await this.holidaySet(companyId);
    let count = 0;
    let cursor = new Date(start.getTime());
    while (cursor < end) {
      cursor = new Date(cursor.getTime() + HOUR_MS);
      if (this.isWorking(cursor, holidays)) count += 1;
    }
    return count;
  }
}
