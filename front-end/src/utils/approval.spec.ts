import { describe, expect, it } from 'vitest';
import { canActOn, pendingApproverNames } from './approval';

const has = (...codes: string[]) => (c: string) => codes.includes(c);

describe('canActOn', () => {
  const inApproval = { status: 'IN_APPROVAL', createdBy: { id: 'creator' } };

  it('allows an eligible non-creator with DOC_APPROVE', () => {
    expect(canActOn(inApproval, 'approver', has('DOC_APPROVE'))).toBe(true);
  });

  it('blocks the creator (no self-approval)', () => {
    expect(canActOn(inApproval, 'creator', has('DOC_APPROVE'))).toBe(false);
  });

  it('blocks without DOC_APPROVE', () => {
    expect(canActOn(inApproval, 'approver', has('DOC_VIEW'))).toBe(false);
  });

  it('blocks when not in approval', () => {
    expect(canActOn({ status: 'DRAFT', createdBy: { id: 'x' } }, 'approver', has('DOC_APPROVE'))).toBe(false);
  });

  // The detail read served `createdBy` as a bare id string for as long as this rule existed, so
  // `.id` was undefined and the creator was never recognised — the mirror waved everyone through.
  // Both shapes must reach the same verdict.
  it('recognises the creator when the read serves a bare id string', () => {
    const asString = { status: 'IN_APPROVAL', createdBy: 'creator' };
    expect(canActOn(asString, 'creator', has('DOC_APPROVE'))).toBe(false);
    expect(canActOn(asString, 'approver', has('DOC_APPROVE'))).toBe(true);
  });

  it('withholds the buttons when the read carries no creator at all', () => {
    expect(canActOn({ status: 'IN_APPROVAL' }, 'approver', has('DOC_APPROVE'))).toBe(false);
    expect(canActOn({ status: 'IN_APPROVAL', createdBy: null }, 'approver', has('DOC_APPROVE'))).toBe(false);
  });
});

describe('pendingApproverNames', () => {
  const via = (name: string) => `on behalf of ${name}`;

  it('lists role holders by name', () => {
    const out = pendingApproverNames([{ name: 'r1' }, { name: 'r2' }], via);
    expect(out).toEqual(['r1', 'r2']);
  });

  it('annotates a delegate with the principal they act for', () => {
    const out = pendingApproverNames([{ name: 'delegate', delegatedFrom: 'delegator' }], via);
    expect(out).toEqual(['delegate (on behalf of delegator)']);
  });
});
