import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '@erp/shared';
import { minutesToTime, normalizeEndMinute, timeToMinutes } from './shift-time';

describe('shift time conversion', () => {
  it('converts HH:MM to minutes from midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('12:30')).toBe(750);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('accepts hours past 23 so a next-day end can be written explicitly', () => {
    expect(timeToMinutes('30:00')).toBe(1800);
  });

  it('rejects malformed times', () => {
    for (const bad of ['8:00', '08:60', '48:00', '', 'noon', '08:0']) {
      expect(() => timeToMinutes(bad)).toThrow(/Invalid time/);
    }
  });

  it('round-trips through minutesToTime', () => {
    for (const time of ['00:00', '08:00', '17:30', '23:59', '30:00']) {
      expect(minutesToTime(timeToMinutes(time))).toBe(time);
    }
  });

  describe('normalizeEndMinute', () => {
    it('leaves a same-day end alone', () => {
      expect(normalizeEndMinute(480, 1020)).toBe(1020);
    });

    it('pushes an earlier-looking end to the next day', () => {
      // 22:00 -> 06:00 is a night shift, not a negative duration.
      expect(normalizeEndMinute(1320, 360)).toBe(1800);
      expect(normalizeEndMinute(1320, 360) - 1320).toBe(480);
    });

    it('treats an identical start and end as a full 24 hours, never zero', () => {
      expect(normalizeEndMinute(480, 480)).toBe(1920);
    });
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zone names', () => {
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true);
    expect(isValidTimeZone('Asia/Vientiane')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects anything the runtime does not recognise', () => {
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('+07:00')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
