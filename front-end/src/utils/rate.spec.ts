import { describe, expect, it } from 'vitest';
import { formatRate } from './rate';

describe('formatRate', () => {
  it('drops the scale NUMERIC(18,8) reads back with', () => {
    // The case that prompted this: a kip rate is eight zeros of noise on screen.
    expect(formatRate('23000.00000000')).toBe('23000.00');
    expect(formatRate('1.00000000')).toBe('1.00');
  });

  it('pads out to two decimals', () => {
    expect(formatRate('26.5')).toBe('26.50');
    expect(formatRate('27')).toBe('27.00');
  });

  it('keeps precision that is real rather than rounding it away', () => {
    // Rounding here would be a screen quietly changing a figure that moves money.
    expect(formatRate('0.00003450')).toBe('0.0000345');
    expect(formatRate('1.05500000')).toBe('1.055');
    expect(formatRate('26.12345678')).toBe('26.12345678');
  });

  it('has nothing to say about an absent rate', () => {
    expect(formatRate(undefined)).toBe('');
    expect(formatRate(null)).toBe('');
    expect(formatRate('  ')).toBe('');
  });

  it('hands back anything that is not a plain decimal, untouched', () => {
    expect(formatRate('abc')).toBe('abc');
    expect(formatRate('1.2.3')).toBe('1.2.3');
  });
});
