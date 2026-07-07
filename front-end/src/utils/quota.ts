import { Decimal } from 'decimal.js';

/** entitled − used, exact (no JS-number drift) — mirrors the server's derived remaining. */
export function deriveRemaining(entitled: string, used: string): string {
  return new Decimal(entitled || '0').minus(used || '0').toString();
}
