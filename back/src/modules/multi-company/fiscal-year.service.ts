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
  }

  private async getWith(em: EntityManager, id: string): Promise<FiscalYear> {
    const fy = await em.findOne(FiscalYear, { id });
    if (!fy) throw new NotFoundException(`Fiscal year ${id} not found`);
    return fy;
  }
}
