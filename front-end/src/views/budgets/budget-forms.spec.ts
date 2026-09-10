import { budgetCreateSchema, budgetTransferSchema, budgetUpdateSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { formatAmount } from '../../utils/money';

// The budget forms validate with the shared Zod schemas (single source of truth with the
// backend DTOs). These tests pin the rules the create/edit form and transfer dialog rely on.
describe('budget create schema', () => {
  const base = { fiscalYearId: '11111111-1111-1111-1111-111111111111', departmentId: '22222222-2222-2222-2222-222222222222', nodeId: '33333333-3333-3333-3333-333333333333', glAccount: '5000', amountTotal: '1000' };

  it('accepts a valid dimension + positive amount', () => {
    // The over-limit policy is gone: how strictly a budget is checked belongs to the control
    // point governing it, so the schema no longer carries one and the form no longer offers it.
    expect(budgetCreateSchema.safeParse(base).success).toBe(true);
  });

  it('accepts an amount of zero — an unfunded plan line is a real budget', () => {
    // This asserted the opposite until `set-a-budget-the-plan-never-funded`, and it was wrong for
    // as long as it stood: the plan importer writes `0` for the section the customer's own
    // workbook marks `ບໍ່ມີງົບ`, so the form refused to accept by hand what the importer accepts
    // by file. 92 lines of the 2026 plan are in exactly that state.
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: '0' }).success).toBe(true);
  });

  it('rejects an empty, negative or non-numeric amount', () => {
    // Empty is an unanswered question, not an answer of zero; a negative appropriation has no
    // meaning. Zero is the only thing that moved.
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: '' }).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: '-1' }).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: 'abc' }).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ ...base, amountTotal: '1,000' }).success).toBe(false);
  });

  it('reports the amount failure as an i18n key, not as English prose', () => {
    // The message reaches `<Message>` through the form; when it was the literal `A positive
    // amount`, the one field error a Lao budget officer could trigger was the one sentence on
    // the screen they could not read.
    const r = budgetCreateSchema.safeParse({ ...base, amountTotal: '-1' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('validation.amountZeroOrMore');
  });

  it('rejects a missing dimension', () => {
    expect(budgetCreateSchema.safeParse({ ...base, fiscalYearId: '' }).success).toBe(false);
  });

  it('requires the node — it is the budget’s identity', () => {
    const { nodeId, ...withoutNode } = base;
    expect(budgetCreateSchema.safeParse(withoutNode).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ ...base, nodeId: '' }).success).toBe(false);
  });

  it('accepts no GL account at all', () => {
    // A budget whose spending posts to several accounts records none: naming one would be false.
    const { glAccount, ...withoutGl } = base;
    expect(budgetCreateSchema.safeParse(withoutGl).success).toBe(true);
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
