import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, TaxKind } from '../../common/enums';
import { Money } from '../../common/money/money';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountRole, JournalLine } from '../gl/gl.entities';
import { Company } from '../multi-company/multi-company.entities';
import { TaxCode } from './tax.entities';
import type { CreateTaxCodeDto, UpdateTaxCodeDto } from './dto/tax-code.dto';

/**
 * Per-company purchase tax master + VAT computation. Company-scoped (invariant 1). Rates are
 * configuration (invariant 7). VAT is computed with the Money decimal helper — never a JS number.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  /** Line VAT = round(netLine × rate, decimalPlaces). Pure string math. */
  static computeLineVat(netLine: string, rate: string, decimalPlaces: number): string {
    return Money.round(Money.multiply(netLine, rate), decimalPlaces);
  }

  /** WHT = round(netBase × rate, decimalPlaces). Pure string math (same shape as VAT). */
  static computeWht(netBase: string, rate: string, decimalPlaces: number): string {
    return Money.round(Money.multiply(netBase, rate), decimalPlaces);
  }

  async create(dto: CreateTaxCodeDto): Promise<TaxCode> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const dup = await em.findOne(TaxCode, { code: dto.code });
    if (dup) throw new BadRequestException(`Tax code '${dto.code}' already exists`);
    const tax = em.create(TaxCode, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      kind: dto.kind,
      rate: dto.rate,
      isActive: dto.isActive ?? true,
    });
    await em.persistAndFlush(tax);
    return tax;
  }

  async update(id: string, dto: UpdateTaxCodeDto): Promise<TaxCode> {
    const em = this.companyScope.forActiveCompany();
    const tax = await this.getScoped(em, id);
    if (dto.name !== undefined) tax.name = dto.name;
    if (dto.rate !== undefined) tax.rate = dto.rate;
    if (dto.isActive !== undefined) tax.isActive = dto.isActive;
    await em.flush();
    return tax;
  }

  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<TaxCode>> {
    const em = this.companyScope.forActiveCompany();
    const where = includeInactive ? {} : { isActive: true };
    return paginate(em, TaxCode, where, { orderBy: { code: 'ASC' } }, q);
  }

  get(id: string): Promise<TaxCode> {
    return this.getScoped(this.companyScope.forActiveCompany(), id);
  }

  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const tax = await this.getScoped(em, id);
    tax.isActive = false;
    await em.flush();
  }

  /** Active VAT codes for the document line picker (active company only). */
  listSelectableVat(): Promise<Array<{ id: string; code: string; name: string; rate: string }>> {
    return this.listSelectableByKind(TaxKind.VAT);
  }

  /** Active WHT codes for the payment-record picker (active company only). */
  listSelectableWht(): Promise<Array<{ id: string; code: string; name: string; rate: string }>> {
    return this.listSelectableByKind(TaxKind.WHT);
  }

  private async listSelectableByKind(kind: TaxKind): Promise<Array<{ id: string; code: string; name: string; rate: string }>> {
    const em = this.companyScope.forActiveCompany();
    const rows = await em.find(
      TaxCode,
      { kind, isActive: true },
      { fields: ['id', 'code', 'name', 'rate'], orderBy: { code: 'ASC' } },
    );
    return rows.map((t) => ({ id: t.id, code: t.code, name: t.name, rate: t.rate }));
  }

  /**
   * Input VAT and withheld tax by period (YYYY-MM) for the active company, read from the LEDGER.
   * Read-only — writes nothing.
   *
   * Both figures are the net movement on the account a role maps to — `VAT_INPUT` for input VAT,
   * `WHT_PAYABLE` for withheld tax — each taken in the direction its account naturally moves:
   * input VAT is an asset and is DEBITED, withheld tax is a liability and is CREDITED. Taking both
   * as `debit − credit` would report every month's withholding as a negative number, which is the
   * kind of sign error a balanced entry hides. Derived rather than stored, for the
   * reason `JournalService.openPayables` gives — a read taken from the journal cannot drift from
   * the journal. Summing `document.base_tax_total` and `payment.wht_amount` instead produced a
   * second figure for the same month, computed from different rows on different dates, and it was
   * the second figure that got filed.
   *
   * It also puts the tax point where the ledger put it. Input VAT is debited when the accrual is
   * posted — at the invoice, which is the tax point — so a December invoice paid in January is
   * reported in December.
   *
   * The period is the calendar month of `entry_date`, which `createEntry` already resolved in the
   * company's timezone. There is no instant left to convert, and therefore no UTC month to get
   * wrong: this used to bin by `toISOString().slice(0, 7)`, which filed everything in the first
   * hours of a month into the month before for any company ahead of UTC.
   *
   * A reversal credits the account and so reduces the period it is dated in — a cancelled invoice
   * reducing that month's claim, which is correct. A manual voucher adjusting either account
   * appears for the same reason.
   */
  async vatSummary(): Promise<Array<{ period: string; vat: string; wht: string }>> {
    const em = this.companyScope.forActiveCompany();

    // Roles are looked up, not resolved: `AccountRoleService.resolve` throws when a role is
    // unmapped, which is right for a posting and wrong for a report. A company that never mapped
    // WHT_PAYABLE never withheld anything, and the honest answer is zero.
    const roles = await em.find(
      AccountRole,
      { role: { $in: [AccountRoleType.VAT_INPUT, AccountRoleType.WHT_PAYABLE] } },
      { populate: ['account'] },
    );
    const accountIdFor = (role: AccountRoleType) =>
      roles.find((r) => r.role === role)?.account.id;
    const vatAccountId = accountIdFor(AccountRoleType.VAT_INPUT);
    const whtAccountId = accountIdFor(AccountRoleType.WHT_PAYABLE);

    const accountIds = [vatAccountId, whtAccountId].filter((id): id is string => !!id);
    if (!accountIds.length) return [];

    const lines = await em.find(
      JournalLine,
      { account: { $in: accountIds } },
      { populate: ['journalEntry', 'account'] },
    );

    const vatByPeriod = new Map<string, string>();
    const whtByPeriod = new Map<string, string>();
    for (const line of lines) {
      // `entry_date` is a company-day string; its month is its first seven characters.
      const period = line.journalEntry.entryDate.slice(0, 7);
      const isVat = line.account.id === vatAccountId;
      // Each in its natural direction: the asset by its debits, the liability by its credits.
      const movement = isVat
        ? Money.subtract(line.debit, line.credit)
        : Money.subtract(line.credit, line.debit);
      const bucket = isVat ? vatByPeriod : whtByPeriod;
      bucket.set(period, Money.add(bucket.get(period) ?? '0', movement));
    }

    const periods = new Set([...vatByPeriod.keys(), ...whtByPeriod.keys()]);
    return [...periods]
      .map((period) => ({ period, vat: vatByPeriod.get(period) ?? '0', wht: whtByPeriod.get(period) ?? '0' }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private async getScoped(em: EntityManager, id: string): Promise<TaxCode> {
    const tax = await em.findOne(TaxCode, { id });
    if (!tax) throw new NotFoundException(`Tax code ${id} not found`);
    return tax;
  }
}
