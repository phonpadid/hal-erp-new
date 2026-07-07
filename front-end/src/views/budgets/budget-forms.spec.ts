import { budgetCreateSchema, budgetTransferSchema, budgetUpdateSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { formatAmount } from '../../utils/money';

// The budget forms validate with the shared Zod schemas (single source of truth with the
// backend DTOs). These tests pin the rules the create/edit form and transfer dialog rely on.
describe('budget create schema', () => {
  const base = { fiscalYearId: '11111111-1111-1111-1111-111111111111', departmentId: '22222222-2222-2222-2222-222222222222', glAccount: '5000', amountTotal: '1000' };

  it('accepts a valid dimension + positive amount', () => {
    expect(budgetCreateSchema.safeParse({ ...base, controlPolicy: 'SOFT_WARNING' }).success).toBe(true);
  });

  it('rejects a non-positive or non-numeric amount', () => {
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: '0' }).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: 'abc' }).success).toBe(false);
  });

  it('rejects a missing dimension', () => {
    expect(budgetCreateSchema.safeParse({ ...base, fiscalYearId: '' }).success).toBe(false);
  });
});

describe('budget update schema', () => {
  it('does not allow amountTotal (invariant 3 — never overwritten)', () => {
    const parsed = budgetUpdateSchema.parse({ budgetName: 'X', status: 'ACTIVE', amountTotal: '999' } as Record<string, unknown>);
    expect('amountTotal' in parsed).toBe(false);
  });
});

describe('budget transfer schema', () => {
  const fromId = '11111111-1111-1111-1111-111111111111';
  const toId = '22222222-2222-2222-2222-222222222222';

  it('accepts a valid transfer between two distinct budgets', () => {
    expect(budgetTransferSchema.safeParse({ fromBudgetId: fromId, toBudgetId: toId, amount: '500', reason: 'reallocate' }).success).toBe(true);
  });

  it('rejects a same-budget transfer', () => {
    expect(budgetTransferSchema.safeParse({ fromBudgetId: fromId, toBudgetId: fromId, amount: '500', reason: 'x' }).success).toBe(false);
  });

  it('rejects a non-positive amount or empty reason', () => {
    expect(budgetTransferSchema.safeParse({ fromBudgetId: fromId, toBudgetId: toId, amount: '0', reason: 'x' }).success).toBe(false);
    expect(budgetTransferSchema.safeParse({ fromBudgetId: fromId, toBudgetId: toId, amount: '500', reason: '' }).success).toBe(false);
  });
});

describe('budget amounts honor currency decimal_places', () => {
  it('formats a 0-decimal currency (e.g. JPY) without decimals', () => {
    expect(formatAmount('1000', 0)).toBe('1,000');
  });

  it('formats a 3-decimal currency (e.g. KWD) with three decimals', () => {
    expect(formatAmount('1000', 3)).toBe('1,000.000');
  });

  it('defaults to 2 decimals when unspecified', () => {
    expect(formatAmount('1000')).toBe('1,000.00');
  });
});
