import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Scope } from '../../common/enums';
import type { FilterQuery } from '@mikro-orm/core';

/** Field names on the consuming entity that scope filters key off. */
export interface ScopeFields {
  ownerField: string; // e.g. 'createdBy' for OWN scope
  deptField: string; // e.g. 'department' for DEPARTMENT scope
}

/**
 * Data-scope enforcement (rbac: Data Scope Enforcement). Applied AFTER the
 * active-company filter (invariant 1). Returns a row-level WHERE fragment for the
 * scope at which the active context was granted a permission code. GROUP is the
 * only scope that reads across companies and is read-only — callers detect it via
 * isGroup() and switch to a group-read EM.
 */
@Injectable()
export class ScopeService {
  /** The scope a code was granted at in the active context, or undefined if not granted. */
  scopeFor(code: string): Scope | undefined {
    return RequestContext.grants().find((g) => g.code === code)?.scope;
  }

  isGroup(code: string): boolean {
    return this.scopeFor(code) === Scope.GROUP;
  }

  /**
   * Row-level filter for `code` at its granted scope. Fail-safe: an ungranted code
   * (caller should have guarded) collapses to OWN. COMPANY/GROUP add no row filter
   * (company isolation already applied; GROUP additionally needs a group-read EM).
   *
   * DEPARTMENT is the SET of departments the reader is assigned to in the active company, not
   * the home department alone: a second assignment is membership, and honouring only the default
   * one discarded configuration the administrator made. An empty set yields `IN ()`, which
   * matches nothing — the fail-safe direction.
   */
  scopeWhere(code: string, fields: ScopeFields): FilterQuery<any> {
    const scope = this.scopeFor(code) ?? Scope.OWN;
    switch (scope) {
      case Scope.OWN:
        return { [fields.ownerField]: RequestContext.userId() };
      case Scope.DEPARTMENT:
        return { [fields.deptField]: { $in: RequestContext.departmentIds() } };
      case Scope.COMPANY:
      case Scope.GROUP:
        return {};
    }
  }

  /**
   * The same question as `scopeWhere`, asked of a row already in hand: does this code's granted
   * scope cover a record owned by `ownerId` and belonging to `departmentId`?
   *
   * A caller that has locked a row to decide whether an act is permitted cannot use `scopeWhere` —
   * that builds a filter for a query it is not about to run — and re-reading the row through the
   * filter would drop the lock's whole point. Written here rather than in that caller so the scope
   * rule and its fail-safe have ONE implementation: both methods read `scopeFor`, both collapse an
   * ungranted code to OWN, and a scope added later cannot be honoured by one and forgotten by the
   * other.
   *
   * Company isolation is NOT part of this answer, exactly as it is not part of `scopeWhere`'s: the
   * caller has already read the row through a company-scoped em (invariant 1). GROUP is read-only
   * across companies and therefore means COMPANY here — an act is never widened past the active
   * company by this method.
   */
  covers(code: string, record: { ownerId?: string; departmentId?: string }): boolean {
    const scope = this.scopeFor(code) ?? Scope.OWN;
    switch (scope) {
      case Scope.OWN:
        return !!record.ownerId && record.ownerId === RequestContext.userId();
      case Scope.DEPARTMENT:
        return !!record.departmentId && RequestContext.departmentIds().includes(record.departmentId);
      case Scope.COMPANY:
      case Scope.GROUP:
        return true;
    }
  }
}
