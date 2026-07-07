import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AccountType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Account } from '../accounting/accounting.entities';
import { Document } from '../document/document.entities';
import { JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** ASSET/EXPENSE carry a debit-normal balance; LIABILITY/EQUITY/REVENUE carry credit-normal. */
function isDebitNormal(type: AccountType): boolean {
  return type === AccountType.ASSET || type === AccountType.EXPENSE;
}

interface AccountAgg {
  account: Account;
  debit: string;
  credit: string;
}

export interface AccountRow {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  amount: string; // normal-side balance (positive when normal)
}

/**
 * Read-only financial statements aggregated from journal_line. Money stays a decimal string
 * end-to-end (the `Money` helper), never a JS number. All reads are company-scoped and write
 * nothing. Sign rules live only here so the reports reconcile with one another.
 */
@Injectable()
export class FinancialReportsService {
  constructor(private readonly companyScope: CompanyScopeService) {}

  // --- shared core ------------------------------------------------------------

  /** Sum debit/credit per account over an inclusive entry_date window (either bound optional). */
  private async aggregate(window: { from?: string; to?: string }): Promise<AccountAgg[]> {
    const em = this.companyScope.forActiveCompany();
    const entryDate: Record<string, string> = {};
    if (window.from) entryDate.$gte = window.from;
    if (window.to) entryDate.$lte = window.to;
    const where = Object.keys(entryDate).length ? { journalEntry: { entryDate } } : {};

    const lines = await em.find(JournalLine, where, { populate: ['account', 'journalEntry'] });
    const byAccount = new Map<string, AccountAgg>();
    for (const l of lines) {
      const cur = byAccount.get(l.account.id) ?? { account: l.account, debit: '0', credit: '0' };
      cur.debit = Money.add(cur.debit, l.debit);
      cur.credit = Money.add(cur.credit, l.credit);
      byAccount.set(l.account.id, cur);
    }
    return [...byAccount.values()];
  }

  /** Normal-side balance for an account aggregate (positive when the account is at a normal balance). */
  private normalBalance(agg: AccountAgg): string {
    return isDebitNormal(agg.account.accountType)
      ? Money.subtract(agg.debit, agg.credit)
      : Money.subtract(agg.credit, agg.debit);
  }

  private rowsOfType(aggs: AccountAgg[], type: AccountType): AccountRow[] {
    return aggs
      .filter((a) => a.account.accountType === type)
      .map((a) => ({
        accountId: a.account.id,
        code: a.account.code,
        name: a.account.name,
        accountType: a.account.accountType,
        amount: this.normalBalance(a),
      }))
      .sort((x, y) => x.code.localeCompare(y.code));
  }

  private sum(rows: AccountRow[]): string {
    return rows.reduce((s, r) => Money.add(s, r.amount), '0');
  }

  /** Cumulative net income to date = Σ(REVENUE normal) − Σ(EXPENSE normal). */
  private netIncome(aggs: AccountAgg[]): string {
    const revenue = this.sum(this.rowsOfType(aggs, AccountType.REVENUE));
    const expense = this.sum(this.rowsOfType(aggs, AccountType.EXPENSE));
    return Money.subtract(revenue, expense);
  }

  // --- reports ----------------------------------------------------------------

  /** Trial balance: per-account debit/credit totals + normal balance; totals must be equal. */
  async trialBalance(from?: string, to?: string) {
    const aggs = await this.aggregate({ from, to });
    const accounts = aggs
      .map((a) => ({
        accountId: a.account.id,
        code: a.account.code,
        name: a.account.name,
        accountType: a.account.accountType,
        debit: a.debit,
        credit: a.credit,
        balance: this.normalBalance(a),
      }))
      .sort((x, y) => x.code.localeCompare(y.code));
    const totalDebit = aggs.reduce((s, a) => Money.add(s, a.debit), '0');
    const totalCredit = aggs.reduce((s, a) => Money.add(s, a.credit), '0');
    return {
      from,
      to,
      accounts,
      totalDebit,
      totalCredit,
      balanced: Money.compare(totalDebit, totalCredit) === 0,
    };
  }

  /** Income statement: revenue, expense (by account), and net income over a range. */
  async incomeStatement(from?: string, to?: string) {
    const aggs = await this.aggregate({ from, to });
    const revenue = this.rowsOfType(aggs, AccountType.REVENUE);
    const expense = this.rowsOfType(aggs, AccountType.EXPENSE);
    const revenueTotal = this.sum(revenue);
    const expenseTotal = this.sum(expense);
    return {
      from,
      to,
      revenue,
      expense,
      revenueTotal,
      expenseTotal,
      netIncome: Money.subtract(revenueTotal, expenseTotal),
    };
  }

  /** Balance sheet as of a date; retained earnings is the derived cumulative net income (no close). */
  async balanceSheet(asOf?: string) {
    const aggs = await this.aggregate({ to: asOf });
    const assets = this.rowsOfType(aggs, AccountType.ASSET);
    const liabilities = this.rowsOfType(aggs, AccountType.LIABILITY);
    const equity = this.rowsOfType(aggs, AccountType.EQUITY);
    const assetsTotal = this.sum(assets);
    const liabilitiesTotal = this.sum(liabilities);
    const equityTotal = this.sum(equity);
    const retainedEarnings = this.netIncome(aggs);
    const liabilitiesEquity = Money.add(Money.add(liabilitiesTotal, equityTotal), retainedEarnings);
    return {
      asOf,
      assets,
      liabilities,
      equity,
      assetsTotal,
      liabilitiesTotal,
      equityTotal,
      // Derived (no period-close has rolled it into equity) — labelled as current-period.
      retainedEarnings,
      liabilitiesEquityTotal: liabilitiesEquity,
      balanced: Money.compare(assetsTotal, liabilitiesEquity) === 0,
    };
  }

  /** Account ledger: every line for one account in date order with a running balance + source doc. */
  async accountLedger(accountId: string, from?: string, to?: string) {
    const em = this.companyScope.forActiveCompany();
    const entryDate: Record<string, string> = {};
    if (from) entryDate.$gte = from;
    if (to) entryDate.$lte = to;
    const where: Record<string, unknown> = { account: accountId };
    if (Object.keys(entryDate).length) where.journalEntry = { entryDate };

    const lines = await em.find(JournalLine, where, {
      populate: ['journalEntry', 'account'],
      orderBy: { journalEntry: { entryDate: 'ASC' }, id: 'ASC' },
    });

    // Resolve human-readable source document numbers (batch, to avoid N+1).
    const sourceIds = [...new Set(lines.map((l) => l.journalEntry.sourceId))];
    const docs = sourceIds.length
      ? await em.find(Document, { id: { $in: sourceIds } }, { ...FILTER_OFF, fields: ['id', 'docNo'] })
      : [];
    const docNoById = new Map(docs.map((d) => [d.id, d.docNo]));

    let running = '0';
    const rows = lines.map((l) => {
      running = Money.add(running, Money.subtract(l.debit, l.credit));
      return {
        lineId: l.id,
        entryId: l.journalEntry.id,
        entryDate: l.journalEntry.entryDate,
        sourceType: l.journalEntry.sourceType,
        sourceId: l.journalEntry.sourceId,
        sourceDocNo: docNoById.get(l.journalEntry.sourceId) ?? null,
        memo: l.journalEntry.memo ?? null,
        debit: l.debit,
        credit: l.credit,
        runningBalance: running,
      };
    });

    const account = lines[0]?.account
      ? { id: lines[0].account.id, code: lines[0].account.code, name: lines[0].account.name, accountType: lines[0].account.accountType }
      : null;
    return { accountId, account, from, to, lines: rows, balance: running };
  }
}
