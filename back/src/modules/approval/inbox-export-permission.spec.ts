import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { ApprovalInboxController } from './approval-inbox.controller';

/**
 * The inbox export is gated by the inbox's own code. Its set is "what I may act on", so `DOC_VIEW`
 * is the wrong question — and a handler added without a decorator would answer anyone signed in.
 * Checked as metadata: the guard's own refusal is covered by `permissions.guard.spec.ts`.
 */
const codesFor = (method: keyof ApprovalInboxController): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, ApprovalInboxController.prototype[method]);

describe('approval inbox export gating', () => {
  it('requires DOC_APPROVE, exactly as the inbox it exports', () => {
    expect(codesFor('pendingPayablesXlsx')).toEqual(['DOC_APPROVE']);
    expect(codesFor('pendingPayablesXlsx')).toEqual(codesFor('pending'));
  });
});
