import { accountSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';

// The Chart of Accounts create/edit form mirrors this schema (one Zod schema, shared with
// the backend DTO, so client and server validation can't drift).
describe('accountSchema', () => {
  const valid = { code: '5000', name: 'Office Supplies', accountType: 'EXPENSE' as const };

  it('accepts a minimal valid account', () => {
    expect(accountSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an optional uuid parentId and the flags', () => {
    const r = accountSchema.safeParse({
      ...valid,
      parentId: '11111111-1111-4111-8111-111111111111',
      isPostable: false,
      isActive: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty code or name', () => {
    expect(accountSchema.safeParse({ ...valid, code: '' }).success).toBe(false);
    expect(accountSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects an unknown account type', () => {
    expect(accountSchema.safeParse({ ...valid, accountType: 'BOGUS' }).success).toBe(false);
  });

  it('rejects a non-uuid parentId', () => {
    expect(accountSchema.safeParse({ ...valid, parentId: 'not-a-uuid' }).success).toBe(false);
  });
});
