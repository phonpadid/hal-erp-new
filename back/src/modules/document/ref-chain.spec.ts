import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { isRefPairingAllowed, successorTypesFor } from './ref-chain.config';

/**
 * Unit tests for the DB-backed reference-chain helpers, driven by a tiny in-memory
 * `document_type_ref` fake. The helpers query by document-type **id** scoped to a company;
 * the fake matches `company` / `predecessorType` / `successorType` the way MikroORM matches a
 * relation against an id string.
 */
type FakeType = { id: string; code: string; isActive: boolean };
type FakeRow = { company: string; predecessorType: FakeType; successorType: FakeType };

const CO_A = 'company-a';
const CO_B = 'company-b';
const PR: FakeType = { id: 't-pr', code: 'PR', isActive: true };
const PO: FakeType = { id: 't-po', code: 'PO', isActive: true };
const PROC: FakeType = { id: 't-proc', code: 'PROC', isActive: true };

// company A: PR→PO, PROC→PO. company B: nothing.
const ROWS: FakeRow[] = [
  { company: CO_A, predecessorType: PR, successorType: PO },
  { company: CO_A, predecessorType: PROC, successorType: PO },
];

function match(row: FakeRow, where: Record<string, string>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'company') return row.company === v;
    if (k === 'predecessorType') return row.predecessorType.id === v;
    if (k === 'successorType') return row.successorType.id === v;
    return false;
  });
}

const fakeEm = {
  findOne: async (_e: unknown, where: Record<string, string>) =>
    ROWS.find((r) => match(r, where)) ?? null,
  find: async (_e: unknown, where: Record<string, string>) =>
    ROWS.filter((r) => match(r, where)),
} as unknown as EntityManager;

describe('isRefPairingAllowed', () => {
  it('allows a configured pairing in the same company', async () => {
    expect(await isRefPairingAllowed(fakeEm, CO_A, PR.id, PO.id)).toBe(true);
    expect(await isRefPairingAllowed(fakeEm, CO_A, PROC.id, PO.id)).toBe(true);
  });

  it('rejects the wrong direction and self pairings', async () => {
    expect(await isRefPairingAllowed(fakeEm, CO_A, PO.id, PR.id)).toBe(false); // reversed
    expect(await isRefPairingAllowed(fakeEm, CO_A, PR.id, PR.id)).toBe(false); // self
  });

  it('does not permit a pairing from another company (isolation)', async () => {
    expect(await isRefPairingAllowed(fakeEm, CO_B, PR.id, PO.id)).toBe(false);
  });
});

describe('successorTypesFor', () => {
  it('returns the paired successor types for a predecessor', async () => {
    const successors = await successorTypesFor(fakeEm, CO_A, PR.id);
    expect(successors.map((t) => t.code)).toEqual(['PO']);
  });

  it('returns nothing for a predecessor with no pairing or another company', async () => {
    expect(await successorTypesFor(fakeEm, CO_A, PO.id)).toEqual([]);
    expect(await successorTypesFor(fakeEm, CO_B, PR.id)).toEqual([]);
  });
});
