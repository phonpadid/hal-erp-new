import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { formatDate, formatDateTime } from './date';

/**
 * Dates follow the language switch.
 *
 * They did not: the helper pinned dayjs to Lao at import time, so an English screen printed
 * `ພຸດ 19-08-2026` next to English column headers. Nothing failed — every test that asserted a
 * date asserted the Lao string, which is exactly what the bug produced.
 */
describe('date formatting follows the active locale', () => {
  const withLocale = <T>(loc: string, fn: () => T): T => {
    const before = (i18n.global.locale as unknown as { value: string }).value;
    (i18n.global.locale as unknown as { value: string }).value = loc;
    try {
      return fn();
    } finally {
      (i18n.global.locale as unknown as { value: string }).value = before;
    }
  };

  it('writes an English weekday when the UI is English', () => {
    expect(withLocale('en', () => formatDate('2026-08-19'))).toBe('Wednesday 19-08-2026');
  });

  it('writes a Lao weekday when the UI is Lao', () => {
    const out = withLocale('la', () => formatDate('2026-08-19'));
    expect(out).toContain('19-08-2026');
    expect(out).not.toContain('Wednesday');
    expect(/[຀-໿]/.test(out)).toBe(true);
  });

  it('writes a Chinese weekday when the UI is Chinese', () => {
    const out = withLocale('zh', () => formatDate('2026-08-19'));
    expect(out).toContain('19-08-2026');
    expect(/[一-鿿]/.test(out)).toBe(true);
  });

  it('keeps day-month-year order in every language', () => {
    // The customer's paperwork is DD-MM-YYYY. The language changes the weekday, never the order.
    for (const loc of ['en', 'la', 'zh']) {
      expect(withLocale(loc, () => formatDate('2026-08-19'))).toContain('19-08-2026');
    }
  });

  it('appends the time in the same way', () => {
    expect(withLocale('en', () => formatDateTime('2026-08-19T10:41:00'))).toBe('Wednesday 19-08-2026 10:41');
  });

  it('renders nothing for a missing date rather than "Invalid Date"', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDateTime(null)).toBe('');
  });
});
