import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEOLOCATION_TIMEOUT_MS, useGeolocation } from './useGeolocation';

/**
 * All four outcomes, against a stubbed `navigator.geolocation`. The composable's only impure act is
 * the one call it wraps, which is what makes the punch screen's own tests able to ignore the
 * browser API entirely.
 */

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation');

function stubGeolocation(impl: unknown) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: impl,
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(globalThis.navigator, 'geolocation', original);
  else stubGeolocation(undefined);
});

describe('useGeolocation', () => {
  it('reports granted with coordinates as decimal strings', async () => {
    stubGeolocation({
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 13.7563309, longitude: 100.5017654, accuracy: 12 } } as GeolocationPosition),
    });

    const reading = await useGeolocation().read();
    expect(reading.status).toBe('granted');
    // Strings, and rounded to the six places the column stores.
    expect(reading.latitude).toBe('13.756331');
    expect(reading.longitude).toBe('100.501765');
    expect(typeof reading.latitude).toBe('string');
    expect(typeof reading.longitude).toBe('string');
    expect(reading.accuracy).toBe(12);
  });

  it('reports denied when the user refuses, and carries no coordinates', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: 'denied' } as GeolocationPositionError),
    });

    const reading = await useGeolocation().read();
    expect(reading.status).toBe('denied');
    expect(reading.latitude).toBeUndefined();
    expect(reading.longitude).toBeUndefined();
  });

  it('reports timeout when the browser reports one', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 3, message: 'timeout' } as GeolocationPositionError),
    });

    expect((await useGeolocation().read()).status).toBe('timeout');
  });

  it('reports unavailable when the device cannot fix a position — not denied', async () => {
    // Nothing was refused. Telling somebody to change a permission they never denied wastes
    // their time on the one action that cannot help.
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 2, message: 'position unavailable' } as GeolocationPositionError),
    });

    expect((await useGeolocation().read()).status).toBe('unavailable');
  });

  it('reports unavailable when the browser has no geolocation at all', async () => {
    stubGeolocation(undefined);
    const geo = useGeolocation();
    expect(geo.isAvailable()).toBe(false);
    expect((await geo.read()).status).toBe('unavailable');
  });

  it('settles on its own timeout when nothing ever answers', async () => {
    vi.useFakeTimers();
    // A prompt nobody answers must not leave the punch button waiting forever.
    stubGeolocation({ getCurrentPosition: () => {} });

    const pending = useGeolocation().read(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe('timeout');
  });

  it('never rejects, whatever the browser does', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: 'denied' } as GeolocationPositionError),
    });
    // A refused permission must not stop a punch, so the caller is never handed a rejection to
    // handle in the first place.
    await expect(useGeolocation().read()).resolves.toBeTruthy();
  });

  it('resolves once even if the browser answers after the timeout fired', async () => {
    vi.useFakeTimers();
    let late: PositionCallback | undefined;
    stubGeolocation({ getCurrentPosition: (ok: PositionCallback) => { late = ok; } });

    const pending = useGeolocation().read(500);
    await vi.advanceTimersByTimeAsync(500);
    late?.({ coords: { latitude: 1, longitude: 2, accuracy: 1 } } as GeolocationPosition);
    expect((await pending).status).toBe('timeout');
  });

  it('defaults to a bounded wait', () => {
    expect(GEOLOCATION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GEOLOCATION_TIMEOUT_MS).toBeLessThanOrEqual(15000);
  });
});
