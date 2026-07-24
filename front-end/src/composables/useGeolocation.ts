/**
 * Reading the device's position, for a punch that must happen either way.
 *
 * The first use of a device permission in this codebase, and it behaves unlike every HTTP call
 * around it: the user can refuse, the browser can hang on a prompt nobody answers, and an insecure
 * origin removes the API altogether. None of those is a reason to lose an attendance record — the
 * capture slice already decided that direction when it stored punches for employees whose
 * attendance is not even required, guarding against data loss rather than against writing.
 *
 * So this NEVER rejects. It resolves a verdict, and the caller punches regardless.
 *
 * The four outcomes stay distinct because they lead to different actions. "Location unavailable"
 * is something an administrator fixes by serving the app over https; "you denied location" is
 * something the user fixes in their browser. Collapsing them into one message makes the second one
 * unfixable, because nobody can tell which they are looking at.
 */

export type GeolocationStatus = 'granted' | 'denied' | 'timeout' | 'unavailable';

export interface GeolocationReading {
  status: GeolocationStatus;
  /** Decimal strings, never JS numbers — see `toDecimalString`. Absent unless `granted`. */
  latitude?: string;
  longitude?: string;
  /** Metres, as reported. Advisory only: the server decides the geofence verdict. */
  accuracy?: number;
}

/**
 * Long enough for a real GPS fix outdoors, short enough that a prompt nobody answers does not
 * leave the punch button waiting. A punch with no coordinates beats a button that never resolves.
 */
export const GEOLOCATION_TIMEOUT_MS = 8000;

/** Six decimal places, matching `decimal(9,6)` on `attendance_event`. */
const COORDINATE_DECIMAL_PLACES = 6;

/**
 * A coordinate leaves this module as a STRING and never as a number, for the reason money does:
 * `13.756331` survives a `Number` today and the first arithmetic anyone does on it is the day that
 * stops being true. The server column is `decimal(9,6)` and the shared schema expects a string.
 */
function toDecimalString(value: number): string {
  return value.toFixed(COORDINATE_DECIMAL_PLACES);
}

export function useGeolocation() {
  /** Whether the browser offers the API at all. Absent on an insecure origin. */
  function isAvailable(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  }

  function read(timeoutMs: number = GEOLOCATION_TIMEOUT_MS): Promise<GeolocationReading> {
    if (!isAvailable()) return Promise.resolve({ status: 'unavailable' });

    return new Promise<GeolocationReading>((resolve) => {
      // Resolved once, whichever path gets there first: the browser's own timeout is advisory on
      // some platforms, so the guard below is what actually bounds the wait.
      let settled = false;
      const settle = (reading: GeolocationReading) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reading);
      };
      const timer = setTimeout(() => settle({ status: 'timeout' }), timeoutMs);

      navigator.geolocation.getCurrentPosition(
        (position) =>
          settle({
            status: 'granted',
            latitude: toDecimalString(position.coords.latitude),
            longitude: toDecimalString(position.coords.longitude),
            accuracy: position.coords.accuracy,
          }),
        (error) =>
          settle({
            // PERMISSION_DENIED is 1, POSITION_UNAVAILABLE 2, TIMEOUT 3. A position the device
            // cannot fix is reported as unavailable rather than denied: nothing was refused, and
            // telling somebody to change a permission they never denied wastes their time.
            status:
              error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable',
          }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
    });
  }

  return { read, isAvailable };
}
