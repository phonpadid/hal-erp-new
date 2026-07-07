import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '../context/request-context';

/**
 * Company-scope seam (invariant 1). The `company` filter (see CompanyScopedEntity)
 * is enabled by default; this service forks an EntityManager with the active
 * company's params bound. GROUP-scope reads are read-only and explicitly disable
 * the filter.
 */
@Injectable()
export class CompanyScopeService {
  constructor(private readonly em: EntityManager) {}

  /** EM scoped to the active company (or an explicit one). All reads/writes filtered. */
  forActiveCompany(companyId = RequestContext.companyId()): EntityManager {
    if (!companyId) {
      throw new Error('No active company in context');
    }
    const fork = this.em.fork();
    fork.setFilterParams('company', { companyId });
    return fork;
  }

  /**
   * EM for read-only GROUP-scope reporting across companies. Callers MUST treat
   * the result as read-only and pass `{ filters: { company: false } }` on queries.
   */
  forGroupRead(): EntityManager {
    return this.em.fork();
  }
}
