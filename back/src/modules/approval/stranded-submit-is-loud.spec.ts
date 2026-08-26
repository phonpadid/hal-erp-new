import { describe, expect, it, vi } from 'vitest';
import { ApprovalSubmittedListener } from './approval-submitted.listener';

/**
 * A submitted document the router could not pick up is stranded: it stays SUBMITTED, it keeps the
 * budget it reserved, and no approver is ever told it exists. Every such failure arrived at the
 * same `catch` as the harmless "already routed" case and left by the same door — `logger.debug`, a
 * level that is off by default and therefore not a log at all.
 *
 * They must not share an exit. A document nobody can act on is holding money; a redelivered event
 * is noise.
 */
describe('a stranded submit is not swallowed', () => {
  const listen = (thrown: Error) => {
    const routing = { start: vi.fn().mockRejectedValue(thrown) };
    const listener = new ApprovalSubmittedListener(routing as never);
    const error = vi.spyOn(listener['logger'], 'error').mockImplementation(() => undefined);
    const debug = vi.spyOn(listener['logger'], 'debug').mockImplementation(() => undefined);
    return { listener, error, debug };
  };

  it('reports a document no step applies to as an error, naming it', async () => {
    const { listener, error, debug } = listen(new Error('Workflow has no applicable steps'));

    await listener.onSubmitted({ documentId: 'doc-1' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('doc-1');
    expect(debug).not.toHaveBeenCalled();
  });

  it('says what is wrong and what to do about it', async () => {
    const { listener, error } = listen(new Error('Workflow has no applicable steps'));

    await listener.onSubmitted({ documentId: 'doc-1' });

    const message = String(error.mock.calls[0][0]);
    expect(message).toMatch(/budget/i);
    // Points at the bands and the requester — the two things applicability turns on. It used to
    // say "the lowest band must start at zero", which was not a rule but a workaround: the submit
    // gate compared every band against an amount it had not stamped yet, so a workflow whose
    // lowest band was not zero refused everything. That is fixed; the advice would now mislead.
    expect(message).toMatch(/bands/i);
    expect(message).not.toMatch(/zero/i);
  });

  it('keeps an already-routed document quiet', async () => {
    const { listener, error, debug } = listen(new Error('Document is already in approval'));

    await listener.onSubmitted({ documentId: 'doc-2' });

    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('keeps a document that was withdrawn before routing quiet', async () => {
    // The withdrawal won the race between the submit committing and this listener running. That is
    // a legitimate outcome, not a fault: the document is CANCELLED and its holds are released.
    const { listener, error, debug } = listen(new Error('Document doc-4 is not SUBMITTED'));

    await listener.onSubmitted({ documentId: 'doc-4' });

    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('reports any other failure to write the route, naming the document and the cause', async () => {
    // The branch that hid the resubmission defect: every returned document sent again violated
    // `document_approval_step_live_uniq`, and the exception left through `logger.debug`.
    const { listener, error, debug } = listen(
      new Error('duplicate key value violates unique constraint "document_approval_step_live_uniq"'),
    );

    await listener.onSubmitted({ documentId: 'doc-5' });

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0][0]);
    expect(message).toContain('doc-5');
    expect(message).toMatch(/stranded/i);
    // The cause travels with it: "could not be routed" alone tells nobody what to fix.
    expect(message).toContain('document_approval_step_live_uniq');
  });

  it('never lets the failure escape into the event emitter', async () => {
    const { listener } = listen(new Error('Workflow has no applicable steps'));
    await expect(listener.onSubmitted({ documentId: 'doc-3' })).resolves.toBeUndefined();
  });
});
