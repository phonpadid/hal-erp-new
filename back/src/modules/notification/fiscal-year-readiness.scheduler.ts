import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { localMidnightInstant } from '../../common/time/company-clock';
import { BudgetPermissions } from '../budget/permissions';
import {
  FiscalYearReadinessService,
  type FiscalYearReadiness,
} from '../multi-company/fiscal-year-readiness.service';
import { MultiCompanyPermissions } from '../multi-company/permissions';
import { Company } from '../multi-company/multi-company.entities';
import { QuotaPermissions } from '../quota/permissions';
import { RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { Notification } from './notification.entities';
import { NotificationService } from './notification.service';

const FILTER_OFF = { filters: { company: false } } as const;

/** The three jobs that prepare a year; holding any one of them is reason enough to be told. */
export const READINESS_CODES = [
  MultiCompanyPermissions.FISCAL_YEAR_MANAGE,
  BudgetPermissions.BUDGET_MANAGE,
  QuotaPermissions.QUOTA_MANAGE,
] as const;

/**
 * Tells the people who prepare a fiscal year what the next one still lacks, once a day, from
 * thirty days before the current one ends until it is ready — and every day after the year has
 * turned unprepared, because then budget documents are already blocked.
 *
 * Hourly rather than at a fixed hour: companies keep their own timezones, so "once a day" is
 * decided per company against its own calendar day, by looking for a notice already sent since
 * that day's local midnight.
 */
@Injectable()
export class FiscalYearReadinessScheduler {
  private readonly logger = new Logger(FiscalYearReadinessScheduler.name);

  constructor(
    private readonly em: EntityManager,
    private readonly readiness: FiscalYearReadinessService,
    private readonly notifications: NotificationService,
  ) {}

  @Interval(60 * 60 * 1000)
  async sweep(): Promise<void> {
    const n = await this.run();
    if (n > 0) this.logger.log(`Fiscal-year readiness: notified ${n} user(s)`);
  }

  /** One pass over every active company. Returns how many notices were sent. */
  async run(now: Date = new Date()): Promise<number> {
    const companies = await this.em.fork().find(Company, { isActive: true }, FILTER_OFF);
    let sent = 0;
    for (const company of companies) {
      const r = await this.readiness.read(company.id, now);
      if (!FiscalYearReadinessService.needsWarning(r)) continue;
      sent += await this.notifyCompany(company, r);
    }
    return sent;
  }

  private async notifyCompany(company: Company, r: FiscalYearReadiness): Promise<number> {
    const em = this.em.fork();
    const recipients = await this.holders(em, company.id, r.today);
    if (!recipients.length) return 0;

    const { title, message } = compose(r);
    const since = localMidnightInstant(r.today, company.timezone ?? 'UTC');
    let sent = 0;
    for (const userId of recipients) {
      const already = await em.count(
        Notification,
        { company: company.id, user: userId, title, createdAt: { $gte: since } },
        FILTER_OFF,
      );
      if (already) continue;
      await this.notifications.dispatch({ userId, companyId: company.id, title, message });
      sent += 1;
    }
    return sent;
  }

  /** Active users whose role in this company carries any readiness code, on `today`. */
  private async holders(em: EntityManager, companyId: string, today: string): Promise<string[]> {
    const grants = await em.find(
      RolePermission,
      { permission: { code: { $in: [...READINESS_CODES] } }, role: { company: companyId } },
      { ...FILTER_OFF, fields: ['role'] },
    );
    const roleIds = [...new Set(grants.map((g) => g.role.id))];
    if (!roleIds.length) return [];
    const memberships = await em.find(
      UserCompanyRole,
      {
        company: companyId,
        role: { $in: roleIds },
        user: { status: 'ACTIVE' },
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: today } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: today } }] },
        ],
      },
      { ...FILTER_OFF, fields: ['user'] },
    );
    return [...new Set(memberships.map((m) => m.user.id))];
  }
}

/**
 * The notice, in Lao — the language the company works in. Names each missing item so the reader
 * knows which screen to open, rather than only that "something" is not ready.
 */
export function compose(r: FiscalYearReadiness): { title: string; message: string } {
  const y = r.target.year;
  const missing: string[] = [];
  if (!r.target.exists) missing.push(`ຍັງບໍ່ໄດ້ສ້າງປີງົບປະມານ ${y}`);
  else if (r.target.status !== 'OPEN') missing.push(`ປີງົບປະມານ ${y} ບໍ່ໄດ້ເປີດຢູ່`);
  if (r.target.activeBudgets === 0) missing.push(`ຍັງບໍ່ມີງົບປະມານປີ ${y} ທີ່ອະນຸມັດແລ້ວ`);
  if (r.target.missingEntitlements > 0) {
    missing.push(`ໂກຕ້າປີ ${y} ຍັງບໍ່ໄດ້ຕັ້ງ ${r.target.missingEntitlements} ລາຍການ`);
  }
  const lead = r.blockedNow
    ? `ຕອນນີ້ສ້າງເອກະສານທີ່ໃຊ້ງົບປະມານບໍ່ໄດ້ ເພາະປີ ${y} ຍັງບໍ່ພ້ອມ.`
    : `ອີກ ${r.daysLeft} ມື້ຈະຂຶ້ນປີງົບປະມານ ${y}.`;
  return {
    title: `ກຽມປີງົບປະມານ ${y}`,
    message: `${lead} ສິ່ງທີ່ຍັງຂາດ: ${missing.join(', ')}. ກະລຸນາກວດທີ່ໜ້າ ປີງົບປະມານ.`,
  };
}
