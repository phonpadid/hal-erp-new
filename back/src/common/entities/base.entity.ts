import { Filter, PrimaryKey } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';

/** All DBML tables use a uuid primary key. */
export abstract class BaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();
}

/**
 * Base for every table that carries a `company_id` (invariant 1: company
 * isolation). The `company` filter is enabled by default; the request layer
 * sets its `companyId` param from the active-company context. GROUP-scope
 * reads explicitly disable it (read-only) via `em.fork()` + `filters: { company: false }`.
 *
 * Subclasses declare their own `@ManyToOne(() => Company) company` relation
 * (fieldName `company_id`) — the filter references that `company` property.
 */
@Filter({
  name: 'company',
  cond: (args: { companyId?: string }) => ({ company: args.companyId }),
  default: true,
})
export abstract class CompanyScopedEntity extends BaseEntity {}
