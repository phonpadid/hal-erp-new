import { taxCodeSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';

// The Tax Codes create/edit form mirrors this schema (one Zod schema, shared with the backend DTO).
describe('taxCodeSchema', () => {
  const valid = { code: 'VAT7', name: 'VAT 7%', kind: 'VAT' as const, rate: '0.07' };

  it('accepts a valid VAT code', () => {
    expect(taxCodeSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty code or name', () => {
    expect(taxCodeSchema.safeParse({ ...valid, code: '' }).success).toBe(false);
    expect(taxCodeSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(taxCodeSchema.safeParse({ ...valid, kind: 'SALES' }).success).toBe(false);
  });

  it('rejects a non-decimal or out-of-range rate', () => {
    expect(taxCodeSchema.safeParse({ ...valid, rate: 'abc' }).success).toBe(false);
    expect(taxCodeSchema.safeParse({ ...valid, rate: '1.5' }).success).toBe(false); // > 1
  });

  it('accepts a zero rate (zero-rated VAT)', () => {
    expect(taxCodeSchema.safeParse({ ...valid, rate: '0' }).success).toBe(true);
  });
});
