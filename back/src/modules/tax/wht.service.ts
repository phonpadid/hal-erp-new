import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { AccountRoleService } from '../gl/account-role.service';
import { createEntry, SOURCE_WHT_REMITTANCE } from '../gl/gl-posting.service';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { WhtCertificate, WhtCertificateNumber } from './wht.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The tax a company withheld from its vendors: the evidence it owes them, and the money it owes the
 * revenue authority.
 *
 * Before this, `WHT_PAYABLE` was credited at every withholding payment and debited nowhere. The
 * balance sheet reported a liability the company had in fact been discharging every month, and the
 * payee had no certificate with which to claim the deduction.
 */
@Injectable()
export class WhtService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly roles: AccountRoleService,
    private readonly periods: PeriodGuardService,
  ) {}

  /**
   * Issue the certificate for one payment.
   *
   * Refused for a payment that withheld nothing — there is no deduction to certify — and for one
   * already certified, which the unique index also forbids; the check exists so the caller gets a
   * sentence rather than a duplicate-key error.
   */
  async certify(paymentId: string, issuedOn?: string): Promise<WhtCertificate> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    const scoped = this.companyScope.forActiveCompany();

    const payment = await scoped.findOne(
      Payment,
      { id: paymentId },
      { populate: ['document', 'document.vendor', 'whtTaxCode'] },
    );
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    const amount = payment.whtAmount ?? '0';
    if (Money.compare(amount, '0') <= 0) {
      throw new BadRequestException('This payment withheld no tax, so there is nothing to certify');
    }
    const already = await scoped.findOne(WhtCertificate, { payment: paymentId });
    if (already) {
      throw new BadRequestException(
        `Payment ${paymentId} is already certified by ${already.certificateNo}`,
      );
    }

    // The base the withholding was computed on: the document's pre-VAT net in base currency, which
    // is the same basis `computeWht` used. Recorded rather than recomputed, so a later change to a
    // rate or a total cannot restate an issued certificate.
    const baseAmount = Money.subtract(payment.baseLocked, payment.document.baseTaxTotal ?? '0');
    const issued = issuedOn ?? new Date().toISOString().slice(0, 10);
    const certificateNo = await this.nextNumber(companyId, Number(issued.slice(0, 4)));

    const em = this.companyScope.forActiveCompany();
    const certificate = em.create(WhtCertificate, {
      company: em.getReference(Company, companyId),
      payment: em.getReference(Payment, paymentId),
      certificateNo,
      vendor: payment.document.vendor ?? undefined,
      taxCode: payment.whtTaxCode ?? undefined,
      rate: payment.whtTaxCode?.rate ?? '0',
      baseAmount,
      whtAmount: amount,
      issuedOn: issued,
      issuedBy: userId ? em.getReference(AppUser, userId) : undefined,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return certificate;
  }

  /**
   * The next certificate number for a company and year.
   *
   * The row is taken under `LockMode.PESSIMISTIC_WRITE` before it is incremented, so two concurrent
   * issues cannot read the same value — the rule this repository states for anything that issues a
   * number, and the same one `NumberingService.next` follows for document numbers.
   */
  private async nextNumber(companyId: string, year: number): Promise<string> {
    const existing = await this.em
      .fork()
      .findOne(WhtCertificateNumber, { company: companyId, year }, FILTER_OFF);
    if (!existing) {
      const em = this.em.fork();
      em.create(WhtCertificateNumber, {
        company: em.getReference(Company, companyId),
        year,
        currentNo: 0,
      } as never);
      // A concurrent creator may win this race; the unique index refuses the loser and the lock
      // below then finds the winner's row.
      await em.flush().catch(() => undefined);
    }
    return inTransaction(this.em, async (tem) => {
      const row = await lockForUpdate(
        tem,
        WhtCertificateNumber,
        { company: companyId, year },
        FILTER_OFF,
      );
      row!.currentNo += 1;
      await tem.flush();
      return `WHT-${year}-${String(row!.currentNo).padStart(4, '0')}`;
    });
  }

  /** The certificates a company has issued and not yet remitted, with their total. */
  async outstanding(): Promise<{ items: WhtCertificate[]; total: string }> {
    const items = await this.companyScope
      .forActiveCompany()
      .find(
        WhtCertificate,
        { remittanceId: null },
        { populate: ['vendor', 'taxCode'], orderBy: { issuedOn: 'ASC' } },
      );
    return { items, total: items.reduce((t, c) => Money.add(t, c.whtAmount), '0') };
  }

  /**
   * Remit a set of certificates: post the entry that clears the payable, and stamp them.
   *
   * The amount is the SUM OF THE CERTIFICATES, not the balance of `WHT_PAYABLE`. Clearing by
   * balance would discharge whatever happens to be sitting in the account, including a withholding
   * from a period that is not being filed, and the entry would then not equal the return it
   * accompanies.
   *
   * Idempotent on `(company, WHT_REMITTANCE, remittanceId)` like every other posting, so a retry
   * resolves to the entry already written.
   */
  async remit(input: {
    certificateIds: string[];
    remittedOn: string;
    remittanceId?: string;
  }): Promise<{ remittanceId: string; total: string; count: number }> {
    const companyId = RequestContext.companyId()!;
    if (!input.certificateIds.length) {
      throw new BadRequestException('Remitting needs at least one certificate');
    }
    const remittanceId = input.remittanceId ?? randomUUID();

    return this.em.transactional(async (tem) => {
      const certificates = await tem.find(
        WhtCertificate,
        { company: companyId, id: { $in: input.certificateIds } },
        FILTER_OFF,
      );
      if (certificates.length !== input.certificateIds.length) {
        throw new NotFoundException('One or more certificates were not found for this company');
      }
      const alreadyRemitted = certificates.filter((c) => c.remittanceId);
      if (alreadyRemitted.length) {
        throw new BadRequestException(
          `Already remitted: ${alreadyRemitted.map((c) => c.certificateNo).join(', ')}`,
        );
      }

      const total = certificates.reduce((t, c) => Money.add(t, c.whtAmount), '0');
      const company = await tem.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
      const payable = await this.roles.resolve(companyId, AccountRoleType.WHT_PAYABLE, tem);
      const cash = await this.roles.resolve(companyId, AccountRoleType.CASH_CLEARING, tem);

      await createEntry(
        tem,
        {
          company,
          // Midday, so resolving to the company's calendar day cannot land on a neighbouring one.
          instant: new Date(`${input.remittedOn}T12:00:00Z`),
          sourceType: SOURCE_WHT_REMITTANCE,
          sourceId: remittanceId,
          memo: `Withholding tax remittance of ${certificates.length} certificate(s)`,
          createdById: RequestContext.userId(),
          lines: [
            { account: payable, debit: total, credit: '0' },
            { account: cash, debit: '0', credit: total },
          ],
        },
        this.periods,
      );

      for (const c of certificates) {
        c.remittanceId = remittanceId;
        c.remittedOn = input.remittedOn;
      }
      await tem.flush();
      return { remittanceId, total, count: certificates.length };
    });
  }
}
