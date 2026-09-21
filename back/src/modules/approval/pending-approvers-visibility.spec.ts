import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalController } from './approval.controller';
import type { ApprovalRoutingService } from './approval-routing.service';
import type { DocumentService } from '../document/document.service';

/**
 * Who may ask who a document is waiting on.
 *
 * The service no longer gates this — the participant check is gone, and with it the only thing
 * that had ever stopped this endpoint answering about a document in another company, because it
 * loads the document with the company filter off. The gate is now the DOCUMENT's own visibility,
 * asserted here before the read runs, which is the caller's `DOC_VIEW` scope and no wider. These
 * pin that it is asserted at all, and that a refusal stops the read rather than merely hiding
 * its result.
 */
const controllerWith = (assertVisible: () => Promise<void>) => {
  const pendingApprovers = vi.fn().mockResolvedValue({ pending: { stepNo: 1 } });
  const controller = new ApprovalController(
    { pendingApprovers } as unknown as ApprovalRoutingService,
    null as never,
    null as never,
    { assertVisible } as unknown as DocumentService,
  );
  return { controller, pendingApprovers };
};

const DOC = '00000000-0000-4000-8000-000000000001';

describe('pending-approvers is gated by the document, not by participation', () => {
  it('reads the pending step for a caller who may see the document', async () => {
    const { controller, pendingApprovers } = controllerWith(async () => undefined);

    await expect(controller.pendingApprovers(DOC)).resolves.toEqual({ pending: { stepNo: 1 } });
    expect(pendingApprovers).toHaveBeenCalledWith(DOC);
  });

  it('refuses a caller who may not see the document, and does not read it', async () => {
    const { controller, pendingApprovers } = controllerWith(async () => {
      throw new NotFoundException(`Document ${DOC} not found`);
    });

    await expect(controller.pendingApprovers(DOC)).rejects.toThrow(NotFoundException);
    // The refusal must come BEFORE the read — otherwise the answer is computed for someone who
    // may not have it, and only the response is withheld.
    expect(pendingApprovers).not.toHaveBeenCalled();
  });
});
