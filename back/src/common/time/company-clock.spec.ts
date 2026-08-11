import { describe, expect, it } from 'vitest';
import { localDateIn } from './company-clock';

/**
 * These are the cases that make the difference between a correct "absent" and a wrong one, so
 * they are asserted against known instants rather than trusted to the runtime.
 */
describe('localDateIn', () => {
  it('rolls forward across midnight for a UTC+7 company', () => {
    // 23:30 UTC on the 1st is 06:30 local on the 2nd — an early start, not a late night.
    const instant = new Date('2026-03-01T23:30:00Z');
    expect(localDateIn(instant, 'Asia/Bangkok')).toBe('2026-03-02');
    expect(localDateIn(instant, 'UTC')).toBe('2026-03-01');
  });

  it('does not roll back for an instant already inside the local day', () => {
    // 01:00 UTC on the 2nd is 08:00 local on the 2nd — the ordinary morning punch.
    const instant = new Date('2026-03-02T01:00:00Z');
    expect(localDateIn(instant, 'Asia/Bangkok')).toBe('2026-03-02');
  });

  it('rolls backward for a company west of UTC', () => {
    // 02:00 UTC on the 2nd is 21:00 on the 1st in New York — an evening shift the day before.
    const instant = new Date('2026-03-02T02:00:00Z');
    expect(localDateIn(instant, 'America/New_York')).toBe('2026-03-01');
  });

  it('handles a zone that observes DST on both sides of the change', () => {
    // US DST began 2026-03-08. 06:30 UTC is 01:30 EST before it and 02:30 EDT after — both still
    // the previous local day, which is the point: the offset moved, the day mapping still holds.
    expect(localDateIn(new Date('2026-03-07T06:30:00Z'), 'America/New_York')).toBe('2026-03-07');
    expect(localDateIn(new Date('2026-03-09T06:30:00Z'), 'America/New_York')).toBe('2026-03-09');
    // And an instant that lands on different local days either side of the boundary.
    expect(localDateIn(new Date('2026-03-08T04:30:00Z'), 'America/New_York')).toBe('2026-03-07');
  });

  it('agrees with Asia/Vientiane, the other zone this platform serves', () => {
    expect(localDateIn(new Date('2026-03-01T23:30:00Z'), 'Asia/Vientiane')).toBe('2026-03-02');
  });

  it('returns a plain YYYY-MM-DD string, sortable and zone-free', () => {
    const day = localDateIn(new Date('2026-12-31T20:00:00Z'), 'Asia/Bangkok');
    expect(day).toBe('2027-01-01');
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
