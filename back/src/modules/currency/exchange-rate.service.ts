import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { Money } from '../../common/money/money';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Currency, ExchangeRate } from './currency.entities';
import type { CreateExchangeRateDto } from './dto/exchange-rate.dto';

export type RateSource = 'IDENTITY' | 'COMPANY' | 'GROUP' | 'INVERSE';

export interface ResolvedRate {
  rate: string;
  source: RateSource;
  asOf: string;
  rateType: string;
}

export interface ConversionResult {
  baseAmount: string;
  rate: string;
  source: RateSource;
}

export interface ResolveArgs {
  from: string;
  to: string;
  asOf: string;
  rateType?: string;
  companyId?: string;
}

const DEFAULT_RATE_TYPE = 'DAILY';

/**
 * Exchange-rate registry + resolution + base-currency conversion (invariant 6:
 * the resolver returns a rate to lock onto the document at submit; resolution is a
 * pure function of `asOf`, so a later rate never moves an earlier date).
 */
@Injectable()
export class ExchangeRateService {
  constructor(private readonly em: EntityManager) {}

  async createRate(dto: CreateExchangeRateDto): Promise<ExchangeRate> {
    const from = await this.requireCurrency(dto.fromCurrency);
    const to = await this.requireCurrency(dto.toCurrency);
    const userId = RequestContext.userId();

    const rate = this.em.create(ExchangeRate, {
      company: dto.companyId ? this.em.getReference(Company, dto.companyId) : undefined,
      fromCurrency: from,
      toCurrency: to,
      rate: dto.rate,
      rateDate: dto.rateDate,
      rateType: dto.rateType ?? DEFAULT_RATE_TYPE,
      source: dto.source,
      createdBy: userId ? this.em.getReference(AppUser, userId) : undefined,
      createdAt: new Date(),
    });
    await this.em.persistAndFlush(rate);
    return rate;
  }

  list(
    filter: { from?: string; to?: string; rateType?: string } = {},
    q: PaginationQueryDto = {},
  ): Promise<Paginated<ExchangeRate>> {
    const where: Record<string, unknown> = {};
    if (filter.from) where.fromCurrency = filter.from.toUpperCase();
    if (filter.to) where.toCurrency = filter.to.toUpperCase();
    if (filter.rateType) where.rateType = filter.rateType;
    return paginate(
      this.em,
      ExchangeRate,
      where,
      {
        orderBy: { rateDate: 'DESC' },
        populate: ['fromCurrency', 'toCurrency', 'company'],
      },
      q,
    );
  }

  /** Latest row with rate_date <= asOf for (from, to, rateType, company|null). */
  private findLatest(
    from: string,
    to: string,
    rateType: string,
    asOf: string,
    companyId: string | null,
  ): Promise<ExchangeRate | null> {
    return this.em.findOne(
      ExchangeRate,
      {
        fromCurrency: { code: from },
        toCurrency: { code: to },
        rateType,
        rateDate: { $lte: asOf },
        company: companyId,
      },
      { orderBy: { rateDate: 'DESC' } },
    );
  }

  /** identity → company override → group → inverse → reject. */
  async resolveRate(args: ResolveArgs): Promise<ResolvedRate> {
    const from = args.from.toUpperCase();
    const to = args.to.toUpperCase();
    const rateType = args.rateType ?? DEFAULT_RATE_TYPE;
    const asOf = args.asOf;
    const companyId = args.companyId;
    const base = { asOf, rateType };

    if (from === to) {
      return { rate: '1', source: 'IDENTITY', ...base };
    }

    // Direct: company override beats group.
    if (companyId) {
      const c = await this.findLatest(from, to, rateType, asOf, companyId);
      if (c) return { rate: c.rate, source: 'COMPANY', ...base };
    }
    const g = await this.findLatest(from, to, rateType, asOf, null);
    if (g) return { rate: g.rate, source: 'GROUP', ...base };

    // Inverse fallback: reverse pair, 1/rate.
    const inv =
      (companyId && (await this.findLatest(to, from, rateType, asOf, companyId))) ||
      (await this.findLatest(to, from, rateType, asOf, null));
    if (inv) {
      return { rate: new Decimal(1).div(inv.rate).toString(), source: 'INVERSE', ...base };
    }

    throw new BadRequestException(
      `No exchange rate for ${from}→${to} (${rateType}) as of ${asOf}`,
    );
  }

  /** Convert an amount to the target currency, rounded to its decimal_places. */
  async convert(args: ResolveArgs & { amount: string }): Promise<ConversionResult> {
    const resolved = await this.resolveRate(args);
    const to = await this.requireCurrency(args.to);
    const raw = Money.multiply(args.amount, resolved.rate);
    return {
      baseAmount: Money.round(raw, to.decimalPlaces),
      rate: resolved.rate,
      source: resolved.source,
    };
  }

  private async requireCurrency(code: string): Promise<Currency> {
    const currency = await this.em.findOne(Currency, { code: code.toUpperCase() });
    if (!currency) throw new NotFoundException(`Currency '${code}' not found`);
    return currency;
  }
}
