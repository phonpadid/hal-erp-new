// The DTO decorators need the metadata polyfill; Nest loads it at bootstrap, vitest does not.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PendingInboxQueryDto } from './dto/workflow.dto';

/**
 * The inbox's filters under the app's own validation settings. A malformed filter must be a 400,
 * not a filter quietly dropped — an approver who typed an amount and got the unfiltered inbox back
 * would read it as "everything here is under that amount".
 */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

const errorsOn = async (payload: Record<string, unknown>) =>
  (await validate(plainToInstance(PendingInboxQueryDto, payload), PIPE)).map((e) => e.property);

describe('PendingInboxQueryDto', () => {
  it('accepts the three filters, well formed', async () => {
    expect(
      await errorsOn({
        departmentId: '0b6c1f7e-3d2a-4c55-9a7e-6f2d7c1e9a10',
        submittedFrom: '2026-09-14',
        submittedTo: '2026-09-18',
        minAmount: '1000',
        maxAmount: '1000000.50',
      }),
    ).toEqual([]);
  });

  it.each([
    ['minAmount', 'abc'],
    ['maxAmount', '1e3x'],
    ['departmentId', 'x'],
    ['submittedFrom', 'last week'],
    ['submittedTo', '2026-13-45'],
  ])('refuses a malformed %s', async (field, value) => {
    expect(await errorsOn({ [field]: value })).toContain(field);
  });

  it('refuses the filters the inbox does not offer', async () => {
    // Type, vendor and status are the documents list's; the inbox is pending-only by definition.
    expect(await errorsOn({ documentTypeId: '0b6c1f7e-3d2a-4c55-9a7e-6f2d7c1e9a10' })).toContain('documentTypeId');
    expect(await errorsOn({ status: 'APPROVED' })).toContain('status');
  });
});
