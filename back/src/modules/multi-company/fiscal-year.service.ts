import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company, FiscalYear } from './multi-company.entities';
import type { CreateFiscalYearDto, UpdateFiscalYearDto } from './dto/fiscal-year.dto';
import type { EntityManager } from '@mikro-orm/postgresql';

export const FISCAL_YEAR_OPEN = 'OPEN';
export const FISCAL_YEAR_CLOSED = 'CLOSED';

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
    if (dto.startDate !== undefined) fy.startDate = dto.startDate;
    if (dto.endDate !== undefined) fy.endDate = dto.endDate;
    await em.flush();
    return fy;
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
      throw new BadRequestException(`No fiscal year covers ${date} for the active company`);
    }
    if (fy.status === FISCAL_YEAR_CLOSED) {
      throw new BadRequestException(`Fiscal year ${fy.year} is closed; ${date} cannot be posted`);
    }
    return fy;
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
