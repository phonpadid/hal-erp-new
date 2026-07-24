import { describe, expect, it } from 'vitest';
import { distanceMetres } from './geo';

const BANGKOK_LAT = '13.756331';
const BANGKOK_LNG = '100.501765';

describe('distanceMetres', () => {
  it('is zero for identical points', () => {
    expect(distanceMetres(BANGKOK_LAT, BANGKOK_LNG, BANGKOK_LAT, BANGKOK_LNG)).toBe(0);
  });

  it('is symmetric', () => {
    const there = distanceMetres(BANGKOK_LAT, BANGKOK_LNG, '13.760000', '100.510000');
    const back = distanceMetres('13.760000', '100.510000', BANGKOK_LAT, BANGKOK_LNG);
    expect(there).toBe(back);
  });

  /**
   * One degree of latitude is ~111.2 km anywhere on earth — the cheapest independent check that
   * the formula is not off by a unit or a factor.
   */
  it('measures one degree of latitude as about 111 km', () => {
    const metres = distanceMetres('13.000000', '100.000000', '14.000000', '100.000000');
    expect(metres).toBeGreaterThan(110_500);
    expect(metres).toBeLessThan(111_500);
  });

  /**
   * The accuracy that actually matters: a geofence radius is tens to hundreds of metres, so the
   * formula has to be right at that scale, not just at continental scale.
   */
  it('is accurate at geofence scale', () => {
    // 0.000900 degrees of latitude ~ 100 m.
    const metres = distanceMetres('13.756331', BANGKOK_LNG, '13.757231', BANGKOK_LNG);
    expect(metres).toBeGreaterThan(95);
    expect(metres).toBeLessThan(105);
  });

  it('resolves a sub-metre difference without collapsing to zero', () => {
    // The last stored decimal place is ~0.11 m; two adjacent values must not read as identical.
    const metres = distanceMetres('13.756331', BANGKOK_LNG, '13.756341', BANGKOK_LNG);
    expect(metres).toBeGreaterThanOrEqual(1);
    expect(metres).toBeLessThan(3);
  });

  it('handles longitude convergence away from the equator', () => {
    // A degree of longitude shrinks with latitude; at 13.75 deg it is ~108 km, not 111 km.
    const metres = distanceMetres('13.756331', '100.000000', '13.756331', '101.000000');
    expect(metres).toBeGreaterThan(107_000);
    expect(metres).toBeLessThan(109_000);
  });

  it('handles negative coordinates', () => {
    const metres = distanceMetres('-33.868820', '151.209290', '-33.869820', '151.209290');
    expect(metres).toBeGreaterThan(100);
    expect(metres).toBeLessThan(120);
  });
});
