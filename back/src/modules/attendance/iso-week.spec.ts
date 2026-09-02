import { describe, expect, it } from 'vitest';
import { isoWeekRange, isoWeeksBetween } from './iso-week';

describe('isoWeekRange', () => {
  it('returns Monday to Sunday for a midweek date', () => {
    // 2026-03-04 is a Wednesday.
    expect(isoWeekRange('2026-03-04')).toEqual({ from: '2026-03-02', to: '2026-03-08' });
  });

  it('treats Monday as the start of its own week', () => {
    expect(isoWeekRange('2026-03-02')).toEqual({ from: '2026-03-02', to: '2026-03-08' });
  });

  /** The classic off-by-one: Sunday belongs to the week that started six days earlier. */
  it('treats Sunday as the end of the week it closes, not the start of the next', () => {
    expect(isoWeekRange('2026-03-08')).toEqual({ from: '2026-03-02', to: '2026-03-08' });
    expect(isoWeekRange('2026-03-09')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
  });

  /**
   * The case that makes ISO week NUMBERING treacherous and which computing a date range sidesteps:
   * the week containing 1 January 2027 begins in December 2026.
   */
  it('spans a year boundary without disagreeing about the year', () => {
    // 2027-01-01 is a Friday, so its week runs from Monday 2026-12-28.
    expect(isoWeekRange('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    // And a late-December date lands in the same range.
    expect(isoWeekRange('2026-12-30')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('handles a leap-year February boundary', () => {
    // 2028-02-29 is a Tuesday.
    expect(isoWeekRange('2028-02-29')).toEqual({ from: '2028-02-28', to: '2028-03-05' });
  });
});

describe('isoWeeksBetween', () => {
  it('returns one week for a range inside a single week', () => {
    expect(isoWeeksBetween('2026-03-03', '2026-03-05')).toEqual([
      { from: '2026-03-02', to: '2026-03-08' },
    ]);
  });

  /** A claim crossing a boundary belongs to both weeks and must satisfy the ceiling in each. */
  it('returns both weeks for a range crossing a boundary', () => {
    expect(isoWeeksBetween('2026-03-06', '2026-03-10')).toEqual([
      { from: '2026-03-02', to: '2026-03-08' },
      { from: '2026-03-09', to: '2026-03-15' },
    ]);
  });

  it('returns every week of a long range', () => {
    const weeks = isoWeeksBetween('2026-03-02', '2026-03-22');
    expect(weeks).toHaveLength(3);
    expect(weeks[0].from).toBe('2026-03-02');
    expect(weeks[2].to).toBe('2026-03-22');
  });

  it('spans the year boundary as two weeks', () => {
    const weeks = isoWeeksBetween('2026-12-30', '2027-01-05');
    expect(weeks).toEqual([
      { from: '2026-12-28', to: '2027-01-03' },
      { from: '2027-01-04', to: '2027-01-10' },
    ]);
  });

  it('returns a single week for a one-day range', () => {
    expect(isoWeeksBetween('2026-03-04', '2026-03-04')).toHaveLength(1);
  });
});
