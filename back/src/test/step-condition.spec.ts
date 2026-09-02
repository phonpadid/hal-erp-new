import { describe, expect, it } from 'vitest';
import {
  isLevelGated,
  parseStepCondition,
  parseStepJobLevels,
  parseStepMinRank,
  serializeStepCondition,
  stepConditionMode,
  stepEngagesFor,
  workflowStepSchema,
} from '@erp/shared';

// The approver fields are genuinely optional AND nullable: PrimeVue's Select `showClear` emits null
// when the approver is cleared, so `.optional()` alone (undefined-only) would fail validation and
// wedge the form. Guard against a silent regression to `.optional()`.
describe('workflowStepSchema approver fields accept null (Select showClear)', () => {
  const base = { workflowId: 'e51fef1c-5881-46d9-8df5-91e90ce79719', stepNo: 1, approveMode: 'SEQUENTIAL' } as const;
  const uuid = 'e51fef1c-5881-46d9-8df5-91e90ce79719';
  it('accepts null on the approver being CLEARED while the other names someone', () => {
    // What `nullish` is for: PrimeVue's showClear emits null, and `.optional()` alone would reject
    // it. Swapping a role for a person clears one field and sets the other in the same write.
    expect(workflowStepSchema.safeParse({ ...base, approverRoleId: null, approverUserId: uuid }).success).toBe(true);
    expect(workflowStepSchema.safeParse({ ...base, approverRoleId: uuid, approverUserId: null }).success).toBe(true);
  });
  it('accepts one approver with the other omitted entirely', () => {
    expect(workflowStepSchema.safeParse({ ...base, approverRoleId: uuid }).success).toBe(true);
    expect(workflowStepSchema.safeParse({ ...base, approverUserId: uuid }).success).toBe(true);
  });
  it('refuses a step that names NEITHER — nulled or omitted', () => {
    // A step nobody can approve opens with zero actors and leaves the document IN_APPROVAL in no
    // one's queue. These two used to be the cases this file asserted were fine.
    expect(workflowStepSchema.safeParse({ ...base, approverRoleId: null, approverUserId: null }).success).toBe(false);
    expect(workflowStepSchema.safeParse({ ...base }).success).toBe(false);
  });
  it('still rejects a non-uuid approver', () => {
    expect(workflowStepSchema.safeParse({ ...base, approverRoleId: 'not-a-uuid', approverUserId: uuid }).success).toBe(false);
  });
});

// Shared workflow-step engagement contract (used by the approval router AND the submit level-gate
// guard, so they cannot drift). Covers explicit jobLevels list, minRank threshold, the both-present
// precedence rule, and empty/malformed → unrestricted.
describe('step condition parsing', () => {
  it('parses an explicit jobLevels list', () => {
    expect(parseStepJobLevels('{"jobLevels":["MANAGER","DIRECTOR"]}')).toEqual(['MANAGER', 'DIRECTOR']);
  });

  it('parses a minRank threshold', () => {
    expect(parseStepMinRank('{"minRank":30}')).toBe(30);
  });

  it('treats empty/malformed as unrestricted', () => {
    for (const c of [undefined, null, '', '{}', 'not json', '{"jobLevels":"x"}', '{"minRank":"x"}']) {
      expect(parseStepJobLevels(c)).toEqual([]);
      expect(parseStepMinRank(c)).toBeNull();
      expect(stepConditionMode(c)).toBe('none');
    }
  });

  it('resolves the condition mode with explicit-wins precedence', () => {
    expect(stepConditionMode('{"jobLevels":["MANAGER"]}')).toBe('levels');
    expect(stepConditionMode('{"minRank":10}')).toBe('minRank');
    // Both present → explicit list wins, minRank ignored.
    expect(stepConditionMode('{"jobLevels":["MANAGER"],"minRank":1}')).toBe('levels');
  });
});

describe('stepEngagesFor', () => {
  it('explicit list engages only exact-code members', () => {
    const cond = '{"jobLevels":["MANAGER"]}';
    expect(stepEngagesFor(cond, { jobLevel: 'MANAGER', rank: 30 })).toBe(true);
    expect(stepEngagesFor(cond, { jobLevel: 'STAFF', rank: 10 })).toBe(false);
    // Exact code, no case-folding.
    expect(stepEngagesFor(cond, { jobLevel: 'Manager', rank: 30 })).toBe(false);
  });

  it('minRank engages at or above the threshold', () => {
    const cond = '{"minRank":30}';
    expect(stepEngagesFor(cond, { jobLevel: 'STAFF', rank: 10 })).toBe(false); // below
    expect(stepEngagesFor(cond, { jobLevel: 'MANAGER', rank: 30 })).toBe(true); // at
    expect(stepEngagesFor(cond, { jobLevel: 'DIRECTOR', rank: 40 })).toBe(true); // above
  });

  it('both-present: explicit list wins, minRank ignored', () => {
    const cond = '{"jobLevels":["MANAGER"],"minRank":1}';
    // A DIRECTOR (rank 40 >= 1) would pass minRank but is not in the explicit list.
    expect(stepEngagesFor(cond, { jobLevel: 'DIRECTOR', rank: 40 })).toBe(false);
    expect(stepEngagesFor(cond, { jobLevel: 'MANAGER', rank: 30 })).toBe(true);
  });

  it('unrestricted step applies to everyone, including a requester with no level', () => {
    expect(stepEngagesFor(undefined, undefined)).toBe(true);
    expect(stepEngagesFor('{}', { jobLevel: 'STAFF', rank: 10 })).toBe(true);
  });

  it('a restricted step never engages a requester with no resolved level', () => {
    expect(stepEngagesFor('{"jobLevels":["MANAGER"]}', undefined)).toBe(false);
    expect(stepEngagesFor('{"minRank":10}', { jobLevel: undefined, rank: undefined })).toBe(false);
  });
});

describe('isLevelGated', () => {
  it('is true when any step carries a jobLevels list or a minRank', () => {
    expect(isLevelGated([{ conditionJson: '{"jobLevels":["MANAGER"]}' }])).toBe(true);
    expect(isLevelGated([{ conditionJson: '{"minRank":20}' }])).toBe(true);
    expect(isLevelGated([{ conditionJson: '{}' }, { conditionJson: undefined }])).toBe(false);
  });
});

describe('serialize / parse round-trip', () => {
  it('serializes each mode and never emits both keys', () => {
    expect(serializeStepCondition({ mode: 'none' })).toBeUndefined();
    expect(serializeStepCondition({ mode: 'levels', jobLevels: ['MANAGER'] })).toBe('{"jobLevels":["MANAGER"]}');
    expect(serializeStepCondition({ mode: 'minRank', minRank: 30 })).toBe('{"minRank":30}');
    // Empty list falls back to unrestricted rather than emitting {"jobLevels":[]}.
    expect(serializeStepCondition({ mode: 'levels', jobLevels: [] })).toBeUndefined();
  });

  it('round-trips through parseStepCondition', () => {
    expect(parseStepCondition('{"jobLevels":["MANAGER","DIRECTOR"]}')).toEqual({
      mode: 'levels',
      jobLevels: ['MANAGER', 'DIRECTOR'],
    });
    expect(parseStepCondition('{"minRank":40}')).toEqual({ mode: 'minRank', minRank: 40 });
    expect(parseStepCondition(undefined)).toEqual({ mode: 'none' });
  });
});
