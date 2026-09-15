import { describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { Scope } from '../../common/enums';
import { PasswordService } from './password.service';
import { ScopeService } from './scope.service';
import type { Grant } from '../../auth/jwt-payload.interface';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes (never plaintext) and verifies', async () => {
    const hash = await passwords.hash('s3cret');
    expect(hash).not.toBe('s3cret');
    expect(await passwords.verify('s3cret', hash)).toBe(true);
    expect(await passwords.verify('wrong', hash)).toBe(false);
  });
});

describe('ScopeService', () => {
  const scope = new ScopeService();
  const fields = { ownerField: 'createdBy', deptField: 'department' };

  function withGrants<T>(grants: Grant[], fn: () => T, departmentIds?: string[]): T {
    return RequestContext.run(
      { userId: 'U', companyId: 'C', departmentId: 'D', departmentIds, grants },
      fn,
    );
  }

  it('OWN scope filters by the owner field', () => {
    withGrants([{ code: 'DOC_VIEW', scope: Scope.OWN }], () => {
      expect(scope.scopeWhere('DOC_VIEW', fields)).toEqual({ createdBy: 'U' });
    });
  });

  it('DEPARTMENT scope filters by the department SET — a lone home department is a set of one', () => {
    withGrants([{ code: 'DOC_VIEW', scope: Scope.DEPARTMENT }], () => {
      expect(scope.scopeWhere('DOC_VIEW', fields)).toEqual({ department: { $in: ['D'] } });
    });
  });

  it('DEPARTMENT scope covers every department the reader is assigned to', () => {
    withGrants(
      [{ code: 'DOC_VIEW', scope: Scope.DEPARTMENT }],
      () => {
        expect(scope.scopeWhere('DOC_VIEW', fields)).toEqual({ department: { $in: ['D', 'D2'] } });
      },
      ['D', 'D2'],
    );
  });

  it('DEPARTMENT scope with no department on the context matches nothing, not everything', () => {
    RequestContext.run({ userId: 'U', companyId: 'C', grants: [{ code: 'DOC_VIEW', scope: Scope.DEPARTMENT }] }, () => {
      expect(scope.scopeWhere('DOC_VIEW', fields)).toEqual({ department: { $in: [] } });
    });
  });

  it('COMPANY scope adds no row filter (company filter already applied)', () => {
    withGrants([{ code: 'DOC_VIEW', scope: Scope.COMPANY }], () => {
      expect(scope.scopeWhere('DOC_VIEW', fields)).toEqual({});
    });
  });

  it('isGroup is true only for GROUP scope', () => {
    withGrants([{ code: 'DOC_VIEW', scope: Scope.GROUP }], () => {
      expect(scope.isGroup('DOC_VIEW')).toBe(true);
    });
    withGrants([{ code: 'DOC_VIEW', scope: Scope.COMPANY }], () => {
      expect(scope.isGroup('DOC_VIEW')).toBe(false);
    });
  });
});
