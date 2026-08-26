import { EntityManager } from '@mikro-orm/postgresql';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { Currency } from './currency.entities';
import type { CreateCurrencyDto, UpdateCurrencyDto } from './dto/currency.dto';

/** Minimal currency shape for the document-creation picker. */
export interface SelectableCurrency {
  code: string;
  name: string;
  symbol?: string;
  decimalPlaces: number;
}

/** ISO 4217 currency registry. `code` is the PK; deactivate-not-delete. */
@Injectable()
export class CurrencyService {
  constructor(private readonly em: EntityManager) {}

  async create(dto: CreateCurrencyDto): Promise<Currency> {
    const code = dto.code.toUpperCase();
    if (await this.em.findOne(Currency, { code })) {
      throw new ConflictException(`Currency '${code}' already exists`);
    }
    const currency = this.em.create(Currency, {
      code,
      name: dto.name,
      symbol: dto.symbol,
      decimalPlaces: dto.decimalPlaces ?? 2,
      isActive: true,
    });
    await this.em.persistAndFlush(currency);
    return currency;
  }

  async update(code: string, dto: UpdateCurrencyDto): Promise<Currency> {
    const currency = await this.get(code);
    if (dto.name !== undefined) currency.name = dto.name;
    if (dto.symbol !== undefined) currency.symbol = dto.symbol;
    if (dto.decimalPlaces !== undefined) currency.decimalPlaces = dto.decimalPlaces;
    if (dto.isActive !== undefined) currency.isActive = dto.isActive;
    await this.em.flush();
    return currency;
  }

  list(q: SearchablePaginationQueryDto, includeInactive = false): Promise<Paginated<Currency>> {
    const where = includeInactive ? {} : { isActive: true };
    return paginate(this.em, Currency, withSearch<Currency>(where, q.search, ['code', 'name']), {}, q);
  }

  /**
   * Active currencies a document creator may choose from — gated on DOC_CREATE, not
   * CURRENCY_VIEW. Returns only the picker fields, active-only, ordered by code. A plain
   * (unpaginated) list: the wizard needs the whole small set to populate its Select.
   */
  async listSelectable(): Promise<SelectableCurrency[]> {
    const rows = await this.em.fork().find(
      Currency,
      { isActive: true },
      { fields: ['code', 'name', 'symbol', 'decimalPlaces'], orderBy: { code: 'ASC' } },
    );
    return rows.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, decimalPlaces: c.decimalPlaces }));
  }

  async get(code: string): Promise<Currency> {
    const currency = await this.em.findOne(Currency, { code: code.toUpperCase() });
    if (!currency) throw new NotFoundException(`Currency '${code}' not found`);
    return currency;
  }

  async deactivate(code: string): Promise<void> {
    const currency = await this.get(code);
    currency.isActive = false;
    await this.em.flush();
  }
}
