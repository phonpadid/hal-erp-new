// The DTO decorators need the metadata polyfill; Nest loads it at bootstrap, vitest does not.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

/**
 * The budget DTOs under the app's own validation settings.
 *
 * `main.ts` configures `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, so a property
 * a DTO does not declare is REJECTED rather than stripped. That is what makes removing
 * `controlPolicy` a breaking change instead of a silent one: a caller that states how spending
 * should be controlled and has it quietly discarded believes it configured something it did not.
 */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

const base = {
  fiscalYearId: '6f1b1b7e-0d3e-4a1a-9c5a-2b7f0a1d3e11',
  departmentId: '6f1b1b7e-0d3e-4a1a-9c5a-2b7f0a1d3e12',
  glAccount: '5000',
  amountTotal: '100000',
};

describe('budget DTO validation', () => {
  it('accepts a create with no tolerance — the ladder is optional', async () => {
    const errors = await validate(plainToInstance(CreateBudgetDto, base), PIPE);
    expect(errors).toEqual([]);
  });

  it('rejects a tolerance ladder rather than ignoring it', async () => {
    // Creation no longer mints a control point — coverage is established when a budget plan is
    // approved — so there is no point at this moment for a ladder to belong to. Rejecting is the
    // whole reason the field is undeclared rather than merely unused: a caller that states how
    // spending should be controlled and has it dropped believes it configured something it did not.
    const errors = await validate(
      plainToInstance(CreateBudgetDto, { ...base, tolerance: [{ at: 100, action: 'WARN' }] }),
      PIPE,
    );
    expect(errors.map((e) => e.property)).toContain('tolerance');
  });

  it('rejects the removed over-limit policy rather than ignoring it', async () => {
    const errors = await validate(
      plainToInstance(CreateBudgetDto, { ...base, controlPolicy: 'HARD_STOP' }),
      PIPE,
    );
    expect(errors).not.toEqual([]);
    expect(errors.map((e) => e.property)).toContain('controlPolicy');
  });

  it('rejects the removed policy on update too', async () => {
    const errors = await validate(
      plainToInstance(UpdateBudgetDto, { budgetName: 'x', controlPolicy: 'SOFT_WARNING' }),
      PIPE,
    );
    expect(errors.map((e) => e.property)).toContain('controlPolicy');
  });

  // The ladder's own shape is no longer this DTO's business — any ladder here is rejected outright,
  // whatever it contains. Rung validation is exercised where a ladder is still accepted, on
  // CreateControlPointDto (see budget-coverage-invariant.spec.ts).
});
