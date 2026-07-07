import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { Company } from '../multi-company/multi-company.entities';
import { ScopeService } from '../rbac/scope.service';
import { ReportingPermissions as P } from './permissions';
import { ReportingService } from './reporting.service';
import type { BudgetBalanceGroup } from './reporting.service';

const FILTER_OFF = { filters: { company: false } } as const;

/** The five balance components a consolidation rolls up, all decimal strings. */
interface Totals {
  amountTotal: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface GroupCompanyRow {
  companyId: string;
  companyCode: string;
  companyName: string;
  baseCurrency: string | null;
  rate: string | null;
  rateSource: string | null;
  convertible: boolean;
  nativeTotal: Totals;
  convertedTotal: Totals | null;
  groups: BudgetBalanceGroup[];
}

export interface GroupBudgetBalanceResult {
  currency: string;
  asOf: string;
  companies: GroupCompanyRow[];
  groupTotal: Totals;
}

const ZERO: Totals = { amountTotal: '0', reserved: '0', actual: '0', released: '0', available: '0' };
const KEYS: (keyof Totals)[] = ['amountTotal', 'reserved', 'actual', 'released', 'available'];

function sumGroups(groups: BudgetBalanceGroup[]): Totals {
  return groups.reduce<Totals>(
    (acc, g) => ({
      amountTotal: Money.add(acc.amountTotal, g.amountTotal),
      reserved: Money.add(acc.reserved, g.reserved),
      actual: Money.add(acc.actual, g.actual),
      released: Money.add(acc.released, g.released),
      available: Money.add(acc.available, g.available),
    }),
    { ...ZERO },
  );
}

/**
 * Consolidated GROUP reporting (read-only, cross-company). This is the one place company
 * isolation is intentionally widened — only under a GROUP-scope REPORT_GROUP_VIEW grant, only
 * for reads, and the conversion is presentation-only (never a ledger write, never a locked-FX
 * recompute — invariant 6).
 */
@Injectable()
export class GroupReportingService {
  constructor(
    private readonly companyScope: CompanyScopeService,
    private readonly scope: ScopeService,
    private readonly reporting: ReportingService,
    private readonly fx: ExchangeRateService,
  ) {}

  async consolidatedBudgetBalance(args: { currency: string; asOf?: string }): Promise<GroupBudgetBalanceResult> {
    // GROUP scope is enforced HERE — the permissions guard only checks code presence, not scope.
    if (!this.scope.isGroup(P.REPORT_GROUP_VIEW)) {
      throw new ForbiddenException('REPORT_GROUP_VIEW must be held at GROUP scope');
    }
    const presentation = args.currency.toUpperCase();
    const asOf = args.asOf ?? new Date().toISOString().slice(0, 10);
    const userId = RequestContext.userId();
    const grants = RequestContext.grants();

    const gem = this.companyScope.forGroupRead();
    const companies = await gem.find(Company, { isActive: true }, { ...FILTER_OFF, populate: ['baseCurrency'] });
    const presCurrency = await gem.findOne(Currency, { code: presentation }, FILTER_OFF);
    const presDecimals = presCurrency?.decimalPlaces ?? 2;

    const rows: GroupCompanyRow[] = [];
    const groupTotal: Totals = { ...ZERO };

    for (const c of companies) {
      // Derive this company's balances by reusing the company-scoped aggregation inside a
      // per-company context — no duplicated ledger math, so it matches the company's own report.
      const { groups } = await RequestContext.run(
        { userId, companyId: c.id, departmentId: '', grants },
        () => this.reporting.budgetBalanceByDeptCategory(),
      );
      const nativeTotal = sumGroups(groups);
      const base = c.baseCurrency?.code ?? null;

      let convertible = false;
      let rate: string | null = null;
      let rateSource: string | null = null;
      let convertedTotal: Totals | null = null;

      if (base && base.toUpperCase() === presentation) {
        convertible = true;
        rate = '1';
        rateSource = 'IDENTITY';
        convertedTotal = { ...nativeTotal };
      } else if (base) {
        try {
          // No companyId → the GROUP rate (company=null), with inverse fallback.
          const resolved = await this.fx.resolveRate({ from: base, to: presentation, asOf });
          rate = resolved.rate;
          rateSource = resolved.source;
          convertedTotal = this.convertTotals(nativeTotal, resolved.rate, presDecimals);
          convertible = true;
        } catch {
          convertible = false; // no rate for this pair/date — report native, exclude from total
        }
      }

      rows.push({
        companyId: c.id,
        companyCode: c.code,
        companyName: c.nameEn ?? c.nameTh,
        baseCurrency: base,
        rate,
        rateSource,
        convertible,
        nativeTotal,
        convertedTotal,
        groups,
      });

      if (convertible && convertedTotal) {
        for (const k of KEYS) groupTotal[k] = Money.add(groupTotal[k], convertedTotal[k]);
      }
    }

    return { currency: presentation, asOf, companies: rows, groupTotal };
  }

  /** Multiply each component by the rate and round to the presentation currency's decimals. */
  private convertTotals(t: Totals, rate: string, decimals: number): Totals {
    const out = {} as Totals;
    for (const k of KEYS) out[k] = Money.round(Money.multiply(t[k], rate), decimals);
    return out;
  }
}
