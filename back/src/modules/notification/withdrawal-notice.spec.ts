import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsListener } from './notification-events.listener';

/**
 * Who is told when a requester withdraws a document that was with its approvers.
 *
 * The approvers' inbox lists documents by `IN_APPROVAL`, so a withdrawal makes the item vanish with
 * no explanation — and the next thing an approver part-way through hears is "Document is not in
 * approval". The resolution happens in the LISTENER, not in `DocumentSubmitService`: the document
 * module cannot reach `ApproverResolverService` without a cycle, while this module already depends
 * on it for the SLA sweep.
 */
function makeListener(overrides: {
  document?: unknown;
  step?: unknown;
  actors?: Array<{ userId: string; delegatedFrom?: string }>;
  requesterName?: string;
  resolverThrows?: boolean;
} = {}) {
  const notifyWithdrawn = vi.fn().mockResolvedValue(undefined);
  const notifications = { notifyWithdrawn } as never;

  const document = 'document' in overrides ? overrides.document : { id: 'doc-1', workflow: { id: 'wf-1' } };
  const step = 'step' in overrides ? overrides.step : { id: 'step-1', stepNo: 2 };
  const findOne = vi.fn(async (entity: { name: string }) => {
    if (entity.name === 'Document') return document;
    if (entity.name === 'AppUser') return { id: 'u-req', username: overrides.requesterName ?? 'somchai' };
    return null;
  });
  const em = { fork: () => ({ findOne }) } as never;

  // The listener reads the step the document RECORDED, not the workflow as it stands now.
  const routeSvc = { routeStep: async () => step } as never;

  const resolver = {
    eligible: vi.fn(async () => {
      if (overrides.resolverThrows) throw new Error('resolver exploded');
      return overrides.actors ?? [{ userId: 'u-1' }, { userId: 'u-2' }];
    }),
  } as never;

  return {
    listener: new NotificationEventsListener(notifications, em, resolver, routeSvc),
    notifyWithdrawn,
  };
}

describe('withdrawal notice', () => {
  it('tells the actors eligible on the step it was withdrawn from', async () => {
    const { listener, notifyWithdrawn } = makeListener();
    await listener.onCancelled({ documentId: 'doc-1', requesterId: 'u-req', stepNo: 2 });
    expect(notifyWithdrawn).toHaveBeenCalledWith('doc-1', ['u-1', 'u-2'], 'somchai');
  });

  it('deduplicates an actor who appears as both principal and delegate', async () => {
    const { listener, notifyWithdrawn } = makeListener({
      actors: [{ userId: 'u-1' }, { userId: 'u-1', delegatedFrom: 'u-9' }],
    });
    await listener.onCancelled({ documentId: 'doc-1', requesterId: 'u-req', stepNo: 2 });
    expect(notifyWithdrawn).toHaveBeenCalledWith('doc-1', ['u-1'], expect.anything());
  });

  it('tells nobody when a draft is withdrawn — step 0 reached no approver', async () => {
    const { listener, notifyWithdrawn } = makeListener();
    await listener.onCancelled({ documentId: 'doc-1', requesterId: 'u-req', stepNo: 0 });
    expect(notifyWithdrawn).not.toHaveBeenCalled();
  });

  it('says nothing rather than throwing when the step no longer resolves', async () => {
    const { listener, notifyWithdrawn } = makeListener({ step: null });
    await expect(listener.onCancelled({ documentId: 'doc-1', requesterId: 'u-req', stepNo: 2 })).resolves.toBeUndefined();
    expect(notifyWithdrawn).not.toHaveBeenCalled();
  });

  // The withdrawal has already committed by the time this runs. A failure here costs a message,
  // never the record — so it is swallowed and logged, not rethrown into the emitter.
  it('does not propagate a resolution failure', async () => {
    const { listener } = makeListener({ resolverThrows: true });
    await expect(listener.onCancelled({ documentId: 'doc-1', requesterId: 'u-req', stepNo: 2 })).resolves.toBeUndefined();
  });
});
