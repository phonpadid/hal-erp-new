import { ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { explained } from '../../common/errors/error-code';
import { localDateIn } from '../../common/time/company-clock';
import { Budget } from '../budget/budget.entities';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, FiscalYear } from './multi-company.entities';
import type { CreateFiscalYearDto, UpdateFiscalYearDto } from './dto/fiscal-year.dto';
import type { EntityManager } from '@mikro-orm/postgresql';

export const FISCAL_YEAR_OPEN = 'OPEN';
export const FISCAL_YEAR_CLOSED = 'CLOSED';

/** Why a budget document cannot be created today, in the shape an explained error carries. */
export interface YearBlock {
  key: 'fiscalYear.noOpenYear' | 'fiscalYear.noActiveBudget';
  year: number;
}

/**
 * Fiscal years per company. `close()` is a guarded OPEN→CLOSED transition;
 * `assertOpenPeriod()` is the reusable guard later capabilities call before
 * budget-consuming work (spec: Fiscal Year Close, Fiscal Year per Company).
 */
@Injectable()
export class FiscalYearService {
  constructor(private readonly scope: CompanyScopeService) {}

  async create(dto: CreateFiscalYearDto): Promise<FiscalYear> {
    const companyId = RequestContext.companyId()!;
    const em = this.scope.forActiveCompany(companyId);
    await this.assertRangeFree(em, dto.startDate, dto.endDate);
    const fy = em.create(FiscalYear, {
      company: em.getReference(Company, companyId),
      year: dto.year,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: FISCAL_YEAR_OPEN,
    });
    await em.persistAndFlush(fy);
    return fy;
  }

  async update(id: string, dto: UpdateFiscalYearDto): Promise<FiscalYear> {
    const em = this.scope.forActiveCompany();
    const fy = await this.getWith(em, id);
    await this.assertRangeFree(em, dto.startDate ?? fy.startDate, dto.endDate ?? fy.endDate, fy.id);
    if (dto.startDate !== undefined) fy.startDate = dto.startDate;
    if (dto.endDate !== undefined) fy.endDate = dto.endDate;
    await em.flush();
    return fy;
  }

  /**
   * Two years of one company may not share a day. `resolveOpenPeriod` takes the one year covering a
   * date; with two, which it found would depend on row order, and a document could be numbered,
   * checked and reserved against a different year than the one its date belongs to.
   */
  private async assertRangeFree(em: EntityManager, start: string, end: string, selfId?: string): Promise<void> {
    if (end.slice(0, 10) <= start.slice(0, 10)) {
      throw explained('fiscalYear.badRange', {}, 'The end date must be after the start date');
    }
    const clash = await em.findOne(FiscalYear, {
      ...(selfId ? { id: { $ne: selfId } } : {}),
      startDate: { $lte: end },
      endDate: { $gte: start },
    });
    if (clash) {
      throw explained(
        'fiscalYear.overlap',
        { year: clash.year },
        `These dates overlap fiscal year ${clash.year}`,
        HttpStatus.CONFLICT,
      );
    }
  }

  list(q: PaginationQueryDto = {}): Promise<Paginated<FiscalYear>> {
    return paginate(this.scope.forActiveCompany(), FiscalYear, {}, {}, q);
  }

  get(id: string): Promise<FiscalYear> {
    return this.getWith(this.scope.forActiveCompany(), id);
  }

  /** OPEN → CLOSED. Closing an already-CLOSED year is rejected, not re-applied. */
  async close(id: string): Promise<FiscalYear> {
    const em = this.scope.forActiveCompany();
    const fy = await this.getWith(em, id);
    if (fy.status === FISCAL_YEAR_CLOSED) {
      throw new ConflictException(`Fiscal year ${id} is already closed`);
    }
    fy.status = FISCAL_YEAR_CLOSED;
    await em.flush();
    return fy;
  }

  /**
   * Reject work dated outside an OPEN fiscal period of the active company. Throws
   * a closed-period error when the covering year is CLOSED or no year covers the date.
   */
  async assertOpenPeriod(date: string, companyId?: string): Promise<void> {
    await this.resolveOpenPeriod(date, companyId);
  }

  /**
   * Resolve the active company's OPEN fiscal year that covers `date` (used to pin the
   * budget line during document-line creation). Throws the same closed-period error as
   * {@link assertOpenPeriod} when the covering year is CLOSED or none covers the date.
   */
  async resolveOpenPeriod(date: string, companyId?: string): Promise<FiscalYear> {
    const em = this.scope.forActiveCompany(companyId);
    const fy = await em.findOne(FiscalYear, {
      startDate: { $lte: date },
      endDate: { $gte: date },
    });
    if (!fy) {
      throw explained(
        'fiscalYear.noOpenYear',
        { year: Number(date.slice(0, 4)) },
        `No fiscal year covers ${date} for the active company`,
      );
    }
    if (fy.status === FISCAL_YEAR_CLOSED) {
      throw explained(
        'fiscalYear.closed',
        { year: fy.year, date },
        `Fiscal year ${fy.year} is closed; ${date} cannot be posted`,
      );
    }
    return fy;
  }

  /**
   * Today, as the company's own calendar has it. The year turns at local midnight, not UTC's: at
   * UTC+7 the hours 00:00–07:00 of January 1 are still December 31 in UTC, and a number or a
   * year check taken from UTC there belongs to the year that has already ended.
   */
  async todayFor(companyId?: string, now: Date = new Date()): Promise<string> {
    const id = companyId ?? RequestContext.companyId()!;
    const company = await this.scope.forActiveCompany(id).findOneOrFail(Company, { id }, { filters: { company: false } });
    return localDateIn(now, company.timezone ?? 'UTC');
  }

  /** The OPEN year covering `date`, or null — the non-throwing twin of {@link resolveOpenPeriod}. */
  async openYearCovering(date: string, companyId?: string): Promise<FiscalYear | null> {
    const em = this.scope.forActiveCompany(companyId);
    return em.findOne(FiscalYear, {
      status: FISCAL_YEAR_OPEN,
      startDate: { $lte: date },
      endDate: { $gte: date },
    });
  }

  /**
   * Why a budget-consuming document may not be started on `date`, or null when it may.
   *
   * It may when an OPEN year covers the date AND that year holds a budget someone has approved —
   * an empty year would only move the refusal to the budget picker, after the form is filled.
   * Read by creation (refusing) and by the creatable-types list (explaining, ahead of time), so
   * the two can never disagree.
   */
  async budgetBlockOn(date: string, companyId?: string): Promise<YearBlock | null> {
    const fy = await this.openYearCovering(date, companyId);
    if (!fy) return { key: 'fiscalYear.noOpenYear', year: Number(date.slice(0, 4)) };
    const em = this.scope.forActiveCompany(companyId);
    const active = await em.count(Budget, { fiscalYear: fy.id, status: 'ACTIVE' }, { filters: { company: false } });
    return active > 0 ? null : { key: 'fiscalYear.noActiveBudget', year: fy.year };
  }

  /** Throwing form of {@link budgetBlockOn}, for the paths that refuse rather than explain. */
  async assertBudgetedOpenYear(date: string, companyId?: string): Promise<void> {
    const block = await this.budgetBlockOn(date, companyId);
    if (!block) return;
    throw explained(
      block.key,
      { year: block.year },
      block.key === 'fiscalYear.noOpenYear'
        ? `No open fiscal year covers ${date}; budget documents cannot be created`
        : `Fiscal year ${block.year} has no active budget; budget documents cannot be created`,
    );
  }

  /**
   * The active company's most recent OPEN fiscal year, or null when it has none.
   *
   * The fallback for reads that want to default to "the current year" but must not fail when no
   * year covers today — a company mid-setup, or one that has already closed the year in progress.
   * Unlike {@link resolveOpenPeriod} this never throws: a read defaulting a filter has no business
   * refusing to answer.
   */
  async mostRecentOpen(companyId?: string): Promise<FiscalYear | null> {
    const em = this.scope.forActiveCompany(companyId);
    return em.findOne(FiscalYear, { status: { $ne: FISCAL_YEAR_CLOSED } }, { orderBy: { year: 'DESC' } });
  }

  private async getWith(em: EntityManager, id: string): Promise<FiscalYear> {
    const fy = await em.findOne(FiscalYear, { id });
    if (!fy) throw new NotFoundException(`Fiscal year ${id} not found`);
    return fy;
  }
}
