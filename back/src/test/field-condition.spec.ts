import { describe, expect, it } from 'vitest';
import { isFieldVisible } from '@erp/shared';

/** Pure unit tests for the shared conditional-visibility evaluator (no DB). */
describe('isFieldVisible (shared evaluator)', () => {
  it('shows a field with no condition', () => {
    expect(isFieldVisible(undefined, {})).toBe(true);
    expect(isFieldVisible(null, {})).toBe(true);
    expect(isFieldVisible('', { a: '1' })).toBe(true);
  });

  it('eq / ne compare the referenced field', () => {
    const cond = JSON.stringify({ field: 'reason', op: 'eq', value: 'OTHER' });
    expect(isFieldVisible(cond, { reason: 'OTHER' })).toBe(true);
    expect(isFieldVisible(cond, { reason: 'SICK' })).toBe(false);

    const ne = JSON.stringify({ field: 'reason', op: 'ne', value: 'OTHER' });
    expect(isFieldVisible(ne, { reason: 'SICK' })).toBe(true);
    expect(isFieldVisible(ne, { reason: 'OTHER' })).toBe(false);
  });

  it('in / nin compare against an array', () => {
    const inCond = JSON.stringify({ field: 'type', op: 'in', value: ['A', 'B'] });
    expect(isFieldVisible(inCond, { type: 'B' })).toBe(true);
    expect(isFieldVisible(inCond, { type: 'C' })).toBe(false);

    const ninCond = JSON.stringify({ field: 'type', op: 'nin', value: ['A', 'B'] });
    expect(isFieldVisible(ninCond, { type: 'C' })).toBe(true);
    expect(isFieldVisible(ninCond, { type: 'A' })).toBe(false);
  });

  it('empty / notEmpty test presence', () => {
    const empty = JSON.stringify({ field: 'note', op: 'empty' });
    expect(isFieldVisible(empty, {})).toBe(true);
    expect(isFieldVisible(empty, { note: '' })).toBe(true);
    expect(isFieldVisible(empty, { note: 'x' })).toBe(false);

    const notEmpty = JSON.stringify({ field: 'note', op: 'notEmpty' });
    expect(isFieldVisible(notEmpty, { note: 'x' })).toBe(true);
    expect(isFieldVisible(notEmpty, {})).toBe(false);
  });

  it('fails open on malformed JSON or unknown shape', () => {
    expect(isFieldVisible('{not json', { a: '1' })).toBe(true);
    expect(isFieldVisible(JSON.stringify({ nonsense: true }), {})).toBe(true);
  });

  it('treats an unresolved referenced field as empty', () => {
    const eq = JSON.stringify({ field: 'ghost', op: 'eq', value: 'x' });
    expect(isFieldVisible(eq, {})).toBe(false);
    const empty = JSON.stringify({ field: 'ghost', op: 'empty' });
    expect(isFieldVisible(empty, {})).toBe(true);
  });
});
