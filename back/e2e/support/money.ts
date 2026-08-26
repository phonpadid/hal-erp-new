/**
 * Money in the e2e suite, like everywhere else, is a decimal STRING — never a JS number
 * (CLAUDE.md, "Money is always DECIMAL/NUMERIC carried as string"). The company base currency
 * here is LAK, whose decimal_places is 0, so these helpers stay exact by working on integers
 * scaled by the operand with the most fractional digits.
 */
function scaleOf(v: string): number {
  const dot = v.indexOf('.');
  return dot === -1 ? 0 : v.length - dot - 1;
}

function toScaled(v: string, scale: number): bigint {
  const neg = v.startsWith('-');
  const abs = neg ? v.slice(1) : v;
  const [int, frac = ''] = abs.split('.');
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  const n = BigInt(int + (padded || ''));
  return neg ? -n : n;
}

function fromScaled(n: bigint, scale: number): string {
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const int = abs.slice(0, abs.length - scale) || '0';
  const frac = scale ? '.' + abs.slice(abs.length - scale) : '';
  return (neg ? '-' : '') + int + frac;
}

function align(a: string, b: string): { x: bigint; y: bigint; scale: number } {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return { x: toScaled(a, scale), y: toScaled(b, scale), scale };
}

export const M = {
  add(a: string, b: string): string {
    const { x, y, scale } = align(a, b);
    return fromScaled(x + y, scale);
  },
  sub(a: string, b: string): string {
    const { x, y, scale } = align(a, b);
    return fromScaled(x - y, scale);
  },
  cmp(a: string, b: string): number {
    const { x, y } = align(a, b);
    return x < y ? -1 : x > y ? 1 : 0;
  },
  eq(a: string, b: string): boolean {
    return M.cmp(a, b) === 0;
  },
  /** Normalized for readable assertion messages ('1000.00' and '1000' are the same money). */
  norm(a: string): string {
    return fromScaled(toScaled(a, scaleOf(a)), scaleOf(a))
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1');
  },
};
