import { describe, expect, it } from 'vitest';
import { isRefPairingAllowed } from './ref-chain.config';

/** Pure unit tests for the reference-chain pairing allow-list (no DB). */
describe('isRefPairingAllowed', () => {
  it('allows configured pairings', () => {
    expect(isRefPairingAllowed('PR', 'PO')).toBe(true);
    expect(isRefPairingAllowed('ADVANCE', 'CLEAR_ADVANCE')).toBe(true);
  });

  it('rejects unconfigured pairings', () => {
    expect(isRefPairingAllowed('PO', 'PR')).toBe(false); // wrong direction
    expect(isRefPairingAllowed('MEMO', 'PO')).toBe(false);
    expect(isRefPairingAllowed('PR', 'UNKNOWN')).toBe(false);
  });
});
