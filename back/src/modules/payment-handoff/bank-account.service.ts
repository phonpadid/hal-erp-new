import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Account } from '../accounting/accounting.entities';
import { AccountRoleService } from '../gl/account-role.service';
import { createEntry, SOURCE_BANK_CLEARED } from '../gl/gl-posting.service';
import { JournalEntry, JournalLine } from '../gl/gl.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { BankAccount } from './bank-account.entities';
import { Payment } from './payment.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The company's own accounts at a bank, and the second half of a payment.
 *
 * `CASH_CLEARING` was named for a clearing account and mapped to `1000 Cash`, so recording a
 * payment credited Cash whether or not the money had left. The engine was written with a clearing
 * account in mind — the role is not called `CASH` — and only the mapping made it behave as one.
 * What was missing was the second step:
 *
 *   payment recorded    Dr payable        Cr cash clearing   (committed to leave)
 *   bank confirms       Dr cash clearing  Cr bank account    (actually left)
 *
 * The clearing account's balance is then exactly the payments in flight, which is what a bank
 * reconciliation starts from — a property of the structure rather than a query somebody writes.
 */
@Injectable()
export class BankAccountService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly roles: AccountRoleService,
    private readonly periods: PeriodGuardService,
  ) {}

  list(includeInactive = false): Promise<BankAccount[]> {
    return this.companyScope
      .forActiveCompany()
      .find(
        BankAccount,
        includeInactive ? {} : { isActive: true },
        { populate: ['glAccount', 'currency'], orderBy: { name: 'ASC' } },
      );
  }

  async create(dto: {
    name: string;
    bankName: string;
    accountNo: string;
    currencyCode: string;
    glAccountId: string;
  }): Promise<BankAccount> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    // Scoped read: an account of ANOTHER company would misstate this company's cash, and the filter
    // is what refuses it (invariant 1).
    const glAccount = await em.findOne(Account, { id: dto.glAccountId });
    if (!glAccount) {
      throw new NotFoundException(`Account ${dto.glAccountId} not found for this company`);
    }
    const duplicate = await em.findOne(BankAccount, { accountNo: dto.accountNo });
    if (duplicate) {
      throw new BadRequestException(`Bank account '${dto.accountNo}' already exists`);
    }

    const account = em.create(BankAccount, {
      company: em.getReference(Company, companyId),
      name: dto.name,
      bankName: dto.bankName,
      accountNo: dto.accountNo,
      currency: await em.findOneOrFail(Currency, { code: dto.currencyCode }),
      glAccount,
      isActive: true,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return account;
  }

  /** Deactivated, not deleted: payments point at it. */
  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const account = await em.findOne(BankAccount, { id });
    if (!account) throw new NotFoundException(`Bank account ${id} not found`);
    account.isActive = false;
    await em.flush();
  }

  /**
   * The bank says a payment settled: move it out of the clearing account.
   *
   * Dated the day the BANK says the money moved, which is routinely not the day finance recorded
   * the payment — and it is the bank's date the reconciliation is against.
   *
   * Idempotent on `(company, BANK_CLEARED, paymentId)`, like every other posting here, so a
   * confirmation delivered twice resolves to the entry already written.
   */
  async confirmCleared(paymentId: string, clearedOn: string): Promise<JournalEntry> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    const payment = await em.findOne(
      Payment,
      { id: paymentId },
      { populate: ['bankAccount', 'bankAccount.glAccount'] },
    );
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (!payment.bankAccount) {
      throw new BadRequestException(
        'This payment names no bank account, so there is no account to credit',
      );
    }

    const existing = await em.findOne(JournalEntry, {
      sourceType: SOURCE_BANK_CLEARED,
      sourceId: paymentId,
    });
    if (existing) return existing;

    // What actually left the bank: the base actual net of any withholding, which is the figure the
    // payment path already credited to the clearing account.
    const amount = Money.subtract(payment.baseActual, payment.whtAmount ?? '0');
    const clearing = await this.roles.resolve(companyId, AccountRoleType.CASH_CLEARING, em);
    const bankGl = payment.bankAccount.glAccount;
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);

    return this.em.transactional((tem) =>
      createEntry(
        tem,
        {
          company,
          // Midday, so resolving to the company's calendar day cannot land on a neighbouring one.
          instant: new Date(`${clearedOn}T12:00:00Z`),
          sourceType: SOURCE_BANK_CLEARED,
          sourceId: paymentId,
          memo: `Bank cleared payment ${paymentId} from ${payment.bankAccount!.accountNo}`,
          createdById: RequestContext.userId(),
          lines: [
            { account: clearing, debit: amount, credit: '0' },
            { account: bankGl, debit: '0', credit: amount },
          ],
        },
        this.periods,
      ),
    );
  }

  /**
   * Payments in flight that name NO bank account, and so belong to no reconciliation.
   *
   * They credited the clearing account like any other payment, so the clearing balance includes
   * them; without this read the account could never be reconciled to zero and nobody would be told
   * why. Every payment recorded before bank accounts existed is in this state.
   *
   * Reported rather than hidden: unattributed cash in flight is exactly what a reconciliation must
   * surface. Attributing one is a deliberate act — somebody has to know which account it left.
   */
  async unattributed(): Promise<{
    items: Array<{ paymentId: string; documentNo: string | null; amount: string }>;
    total: string;
  }> {
    const em = this.companyScope.forActiveCompany();
    const payments = await em.find(
      Payment,
      { bankAccount: null },
      { populate: ['document'], orderBy: { paidAt: 'ASC' } },
    );
    const items = payments.map((p) => ({
      paymentId: p.id,
      documentNo: p.document?.docNo ?? null,
      amount: Money.subtract(p.baseActual, p.whtAmount ?? '0'),
    }));
    return { items, total: items.reduce((t, i) => Money.add(t, i.amount), '0') };
  }

  /**
   * What the books say has left and the bank has not moved, per bank account.
   *
   * Derived from the journal and the payment rows rather than a stored reconciliation record: a
   * derived read cannot drift from the journal because it is read from it, and a stored one would
   * be a second opinion about the same facts.
   */
  async outstanding(bankAccountId: string): Promise<{
    bankAccount: BankAccount;
    glBalance: string;
    items: Array<{ paymentId: string; documentNo: string | null; amount: string; paidAt?: Date }>;
    total: string;
  }> {
    const em = this.companyScope.forActiveCompany();
    const bankAccount = await em.findOne(
      BankAccount,
      { id: bankAccountId },
      { populate: ['glAccount', 'currency'] },
    );
    if (!bankAccount) throw new NotFoundException(`Bank account ${bankAccountId} not found`);

    const payments = await em.find(
      Payment,
      { bankAccount: bankAccountId },
      { populate: ['document'], orderBy: { paidAt: 'ASC' } },
    );
    const cleared = new Set(
      (
        await em.find(JournalEntry, {
          sourceType: SOURCE_BANK_CLEARED,
          sourceId: { $in: payments.map((p) => p.id) },
        })
      ).map((e) => e.sourceId),
    );

    const items = payments
      .filter((p) => !cleared.has(p.id))
      .map((p) => ({
        paymentId: p.id,
        documentNo: p.document?.docNo ?? null,
        amount: Money.subtract(p.baseActual, p.whtAmount ?? '0'),
        paidAt: p.paidAt,
      }));

    const lines = await em.find(JournalLine, { account: bankAccount.glAccount.id });
    const glBalance = lines.reduce(
      (t, l) => Money.add(t, Money.subtract(l.debit, l.credit)),
      '0',
    );

    return {
      bankAccount,
      glBalance,
      items,
      total: items.reduce((t, i) => Money.add(t, i.amount), '0'),
    };
  }
}
