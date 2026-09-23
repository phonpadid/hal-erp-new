import { describe, expect, it } from 'vitest';
import { messageOf } from './apiError';
import { i18n } from '../i18n';

/**
 * The backend now adds a `code` field to every error body so integrations can branch on the reason
 * without reading English. Every error toast in this app comes through `messageOf`, which reads
 * `message` and nothing else — these tests are the guard that the added field changed nothing here.
 */
describe('messageOf with the coded error body', () => {
  const err = (data: unknown) => ({ response: { data } });

  it('reads the message from a coded body', () => {
    expect(
      messageOf(
        err({
          statusCode: 400,
          code: 'BUDGET_EXCEEDED',
          message: 'Over budget: 4500.00 requested, 1200.00 available',
          error: 'Bad Request',
        }),
      ),
    ).toBe('Over budget: 4500.00 requested, 1200.00 available');
  });

  it('relays the blocking control point named in an over-budget refusal', () => {
    // Availability is checked at a control point, so the ceiling that refused may belong to an
    // ancestor node while the budget the user picked still shows room. The server puts the
    // blocking point in the message; if this seam ever summarised or rewrote it, the refusal
    // would become unexplainable — and an unexplained refusal is what pushes people to charge
    // the spend to a different line.
    expect(
      messageOf(
        err({
          statusCode: 400,
          code: 'BUDGET_EXCEEDED',
          message:
            'Over budget at control point 7f3a (account node 61, department node HQ): 50000 requested, 10000 available',
          error: 'Bad Request',
        }),
      ),
    ).toContain('control point 7f3a');
  });

  it('still joins the validator array when a code is present', () => {
    expect(
      messageOf(
        err({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: ['qty must be a number string', 'lineNo must not be less than 1'],
          error: 'Bad Request',
        }),
      ),
    ).toBe('qty must be a number string, lineNo must not be less than 1');
  });

  it('is unchanged for a body without a code', () => {
    expect(messageOf(err({ statusCode: 404, message: 'Not found', error: 'Not Found' }))).toBe(
      'Not found',
    );
  });

  it('falls back when there is no message at all', () => {
    expect(messageOf(err({ statusCode: 500, code: 'INTERNAL_ERROR' }), 'fallback')).toBe('fallback');
  });
});

/**
 * A refusal that names its sentence (`messageKey`) is rendered from the catalog in the interface
 * language, with the server's facts substituted; one the catalog does not know falls back to the
 * server's words. Only the key decides — the English `message` is never matched on.
 */
describe('messageOf with a keyed refusal', () => {
  const err = (data: unknown) => ({ response: { data } });
  const stranded = {
    statusCode: 400,
    code: 'BAD_REQUEST',
    messageKey: 'config.type.wouldStrand',
    params: { typeCode: 'CLAIM_RECOVERY' },
    message: "This would leave document type 'CLAIM_RECOVERY' reserving budget with no way to settle it. Give it…",
    error: 'Bad Request',
  };

  it('speaks Lao when the interface does, naming the type', () => {
    (i18n.global.locale as unknown as { value: string }).value = 'la';
    const text = messageOf(err(stranded));
    expect(text).toContain('CLAIM_RECOVERY');
    expect(text).toMatch(/ຈອງງົບ/);
    expect(text).not.toContain('This would leave');
  });

  it('speaks English when the interface does', () => {
    (i18n.global.locale as unknown as { value: string }).value = 'en';
    expect(messageOf(err(stranded))).toBe(
      "This change would leave document type 'CLAIM_RECOVERY' reserving budget with no way to settle it. Keep a pairing from it to a type that settles, or give it a settling post-action, before making this change.",
    );
  });

  it('substitutes a number as readily as a code', () => {
    (i18n.global.locale as unknown as { value: string }).value = 'en';
    expect(messageOf(err({ messageKey: 'config.step.noApprover', params: { stepNo: 3 }, message: 'x' }))).toContain('Step 3');
  });

  it('falls back to the server message for a key the catalog does not know', () => {
    expect(messageOf(err({ messageKey: 'config.something.new', params: {}, message: 'Server words' }))).toBe('Server words');
  });

  it('never shows an id: a not-found reads as the thing, not the uuid', () => {
    (i18n.global.locale as unknown as { value: string }).value = 'en';
    expect(messageOf(err({ statusCode: 404, messageKey: 'config.notFound.workflow', params: {}, message: 'Workflow not found' }))).toBe(
      'The workflow was not found.',
    );
  });
});
