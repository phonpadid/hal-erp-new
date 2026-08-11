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

  it('accepts a create carrying a tolerance ladder', async () => {
    const dto = plainToInstance(CreateBudgetDto, {
      ...base,
      tolerance: [{ at: 100, action: 'WARN' }],
    });
    expect(await validate(dto, PIPE)).toEqual([]);
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

  it('rejects a malformed ladder', async () => {
    const bad = await validate(
      plainToInstance(CreateBudgetDto, { ...base, tolerance: [{ at: 100, action: 'ESCALATE' }] }),
      PIPE,
    );
    expect(bad).not.toEqual([]);
  });

  it('rejects an empty ladder — a point with no rungs would check nothing', async () => {
    const bad = await validate(plainToInstance(CreateBudgetDto, { ...base, tolerance: [] }), PIPE);
    expect(bad).not.toEqual([]);
  });
});
