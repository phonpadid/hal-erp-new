import { describe, expect, it } from 'vitest';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import { adjustEntitlementSchema, carryForwardSchema, entitlementSchema } from '@erp/shared';

// Regression: these three dialogs inject their context fields (quotaId, and for adjust
// also employeeId/year) in the submit handler instead of rendering them. The Form resolver
// only sees the rendered fields. If an injected field is REQUIRED in the schema, the
// resolver fails on it and returns no `values` — while `valid` stays true because the error
// attaches to no rendered field — so the form submits an empty payload. Marking the injected
// fields optional keeps the resolver happy on the rendered subset.
const resolve = (schema: unknown, values: Record<string, unknown>) =>
  (zodResolver(schema as never) as (a: { values: unknown; name?: string }) => Promise<{ values?: unknown; errors: unknown }>)({ values });

describe('quota form schemas resolve on the rendered fields alone', () => {
  it('entitlement: employeeId + year + entitledValue (quotaId injected later)', async () => {
    const r = await resolve(entitlementSchema, {
      employeeId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
      year: 2027,
      entitledValue: '12',
    });
    expect(r.values).toBeTruthy();
    expect(r.values).toMatchObject({ year: 2027, entitledValue: '12' });
  });

  it('adjust: delta (quotaId/employeeId/year injected later)', async () => {
    const r = await resolve(adjustEntitlementSchema, { delta: '-3', reason: 'correction' });
    expect(r.values).toBeTruthy();
    expect(r.values).toMatchObject({ delta: '-3' });
  });

  it('carry-forward: fromYear + toYear (quotaId injected later)', async () => {
    const r = await resolve(carryForwardSchema, { fromYear: 2026, toYear: 2027 });
    expect(r.values).toBeTruthy();
    expect(r.values).toMatchObject({ fromYear: 2026, toYear: 2027 });
  });
});
