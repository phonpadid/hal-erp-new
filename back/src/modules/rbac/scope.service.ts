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
   */
  scopeWhere(code: string, fields: ScopeFields): FilterQuery<any> {
    const scope = this.scopeFor(code) ?? Scope.OWN;
    switch (scope) {
      case Scope.OWN:
        return { [fields.ownerField]: RequestContext.userId() };
      case Scope.DEPARTMENT:
        return { [fields.deptField]: RequestContext.departmentId() };
      case Scope.COMPANY:
      case Scope.GROUP:
        return {};
    }
  }
}
