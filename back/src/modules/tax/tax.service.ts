import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { TaxKind } from '../../common/enums';
import { Money } from '../../common/money/money';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { TaxCode } from './tax.entities';
import type { CreateTaxCodeDto, UpdateTaxCodeDto } from './dto/tax-code.dto';

const FILTER_OFF = { filters: { company: false } } as const;

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
   * Tax summary by period (YYYY-MM) for the active company. Input VAT is summed from the stamped
   * `document.base_tax_total` (by submit month); withheld WHT from `payment.wht_amount` (by paid
   * month). Read-only — writes nothing.
   */
  async vatSummary(): Promise<Array<{ period: string; vat: string; wht: string }>> {
    const companyId = RequestContext.companyId();
    const em = this.em.fork();
    const docs = await em.find(
      Document,
      companyId ? { company: companyId, baseTaxTotal: { $ne: null } } : { baseTaxTotal: { $ne: null } },
      { ...FILTER_OFF, fields: ['submittedAt', 'createdAt', 'baseTaxTotal'] },
    );
    const payments = await em.find(
      Payment,
      companyId ? { company: companyId } : {},
      { ...FILTER_OFF, fields: ['paidAt', 'createdAt', 'whtAmount'] },
    );

    const vatByPeriod = new Map<string, string>();
    for (const d of docs) {
      const period = (d.submittedAt ?? d.createdAt)?.toISOString().slice(0, 7) ?? 'unknown';
      vatByPeriod.set(period, Money.add(vatByPeriod.get(period) ?? '0', d.baseTaxTotal ?? '0'));
    }
    const whtByPeriod = new Map<string, string>();
    for (const p of payments) {
      const period = (p.paidAt ?? p.createdAt)?.toISOString().slice(0, 7) ?? 'unknown';
      whtByPeriod.set(period, Money.add(whtByPeriod.get(period) ?? '0', p.whtAmount ?? '0'));
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
