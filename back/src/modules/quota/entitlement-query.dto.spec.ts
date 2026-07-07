import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { EntitlementQueryDto } from './dto/entitlement.dto';

// The global ValidationPipe in main.ts runs with { whitelist, forbidNonWhitelisted,
// transform } but WITHOUT enableImplicitConversion, so query-string params are only
// coerced when the DTO field declares @Type(). These tests reproduce that pipe against
// EntitlementQueryDto.year — the field that GET /quota-entitlements binds — to lock in
// that a string year is coerced (regression: it previously 400'd) while a non-numeric
// year is still rejected.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const metadata = { type: 'query', metatype: EntitlementQueryDto } as const;
const quotaId = '550e8400-e29b-41d4-a716-446655440000';

describe('EntitlementQueryDto validation (mirrors the global ValidationPipe)', () => {
  it('coerces a string year from the query string to a number and accepts it', async () => {
    const out = await pipe.transform({ quotaId, year: '2026' }, metadata);
    expect(out.year).toBe(2026);
    expect(typeof out.year).toBe('number');
  });

  it('accepts a request with no year (year is optional)', async () => {
    const out = await pipe.transform({ quotaId }, metadata);
    expect(out.year).toBeUndefined();
  });

  it('rejects a non-numeric year', async () => {
    await expect(pipe.transform({ quotaId, year: 'abc' }, metadata)).rejects.toThrow();
  });

  it('rejects an out-of-range year', async () => {
    await expect(pipe.transform({ quotaId, year: '1999' }, metadata)).rejects.toThrow();
  });
});
