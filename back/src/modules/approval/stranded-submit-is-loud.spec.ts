import { describe, expect, it, vi } from 'vitest';
import { ApprovalSubmittedListener } from './approval-submitted.listener';

/**
 * A submitted document that no workflow step applies to is stranded: it stays SUBMITTED, it keeps
 * the budget it reserved, and no approver is ever told it exists. It arrived at the same `catch`
 * as the harmless "already routed" case and left by the same door — `logger.debug`, a level that
 * is off by default and therefore not a log at all.
 *
 * The two must not share an exit. One is a configuration defect holding money; the other is noise.
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
    expect(message).toMatch(/zero/i);
  });

  it('keeps an already-routed document quiet', async () => {
    const { listener, error, debug } = listen(new Error('Document is already in approval'));

    await listener.onSubmitted({ documentId: 'doc-2' });

    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('never lets the failure escape into the event emitter', async () => {
    const { listener } = listen(new Error('Workflow has no applicable steps'));
    await expect(listener.onSubmitted({ documentId: 'doc-3' })).resolves.toBeUndefined();
  });
});
