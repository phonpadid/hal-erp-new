import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AccountRoleType, AccountType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { Account } from '../accounting/accounting.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Company, FiscalYear } from '../multi-company/multi-company.entities';
import { AccountRoleService } from './account-role.service';
import { createEntry, SOURCE_YEAR_CLOSE } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Roll a fiscal year's result into equity.
 *
 * Without this, revenue and expense accumulate forever: a company in its third year reads an income
 * statement three years deep unless every report is carefully bounded, and a balance sheet whose
 * equity is a derivation rather than a balance. `fiscal_year.status` said "stop submitting documents
 * dated here" and posted nothing.
 *
 * Runs while the year's final period is still OPEN — see `AccountingPeriodService.close`. The entry
 * is dated the year's last day, which is inside that period; posting it afterwards would be refused
 * by the period guard, correctly.
 */
@Injectable()
export class YearCloseService {
  constructor(
    private readonly roles: AccountRoleService,
    private readonly periods: PeriodGuardService,
  ) {}

  /**
   * Post the closing entry for one fiscal year, or nothing when the year has no result to roll.
   *
   * Idempotent on `(company, YEAR_CLOSE, fiscalYearId)`, so a retried close cannot post a second.
   */
  async closeYear(em: EntityManager, company: Company, fy: FiscalYear): Promise<JournalEntry | null> {
    const existing = await em.findOne(
      JournalEntry,
      { company: company.id, sourceType: SOURCE_YEAR_CLOSE, sourceId: fy.id },
      FILTER_OFF,
    );
    if (existing) return existing;

    // Closed by BALANCE, one line per account — a year may hold a hundred thousand lines and three
    // dozen accounts, and the entry that zeroes them needs three dozen lines.
    const lines = await em.find(
      JournalLine,
      {
        company: company.id,
        journalEntry: { entryDate: { $gte: fy.startDate, $lte: fy.endDate } },
        account: { accountType: { $in: [AccountType.REVENUE, AccountType.EXPENSE] } },
      },
      { ...FILTER_OFF, populate: ['account'] },
    );
    if (!lines.length) return null;

    // Revenue carries a credit balance, expense a debit one. Track the natural side of each so the
    // closing line is its exact opposite.
    const balances = new Map<string, { account: Account; debit: string; credit: string }>();
    for (const l of lines) {
      const cur = balances.get(l.account.id) ?? { account: l.account, debit: '0', credit: '0' };
      cur.debit = Money.add(cur.debit, l.debit);
      cur.credit = Money.add(cur.credit, l.credit);
      balances.set(l.account.id, cur);
    }

    const draft: Array<{ account: Account; debit: string; credit: string }> = [];
    let revenueNet = '0';
    let expenseNet = '0';
    for (const { account, debit, credit } of balances.values()) {
      if (account.accountType === AccountType.REVENUE) {
        const bal = Money.subtract(credit, debit); // natural credit balance
        if (Money.compare(bal, '0') === 0) continue; // no activity, no line
        revenueNet = Money.add(revenueNet, bal);
        draft.push({ account, debit: bal, credit: '0' });
      } else {
        const bal = Money.subtract(debit, credit); // natural debit balance
        if (Money.compare(bal, '0') === 0) continue;
        expenseNet = Money.add(expenseNet, bal);
        draft.push({ account, debit: '0', credit: bal });
      }
    }
    if (!draft.length) return null;

    // The difference is the year's result: a credit to retained earnings for a profit, a debit for
    // a loss. Asserting the sign here rather than trusting it — a sign error is invisible in an
    // entry that still balances.
    const result = Money.subtract(revenueNet, expenseNet);
    const retained = await this.roles.resolve(company.id, AccountRoleType.RETAINED_EARNINGS, em);
    if (Money.compare(result, '0') > 0) {
      draft.push({ account: retained, debit: '0', credit: result });
    } else if (Money.compare(result, '0') < 0) {
      draft.push({ account: retained, debit: Money.subtract('0', result), credit: '0' });
    }

    return createEntry(
      em,
      {
        company,
        instant: new Date(`${fy.endDate}T12:00:00Z`),
        sourceType: SOURCE_YEAR_CLOSE,
        sourceId: fy.id,
        memo: `Year-end close ${fy.year}: revenue ${revenueNet}, expense ${expenseNet}`,
        lines: draft,
      },
      this.periods,
    );
  }
}
