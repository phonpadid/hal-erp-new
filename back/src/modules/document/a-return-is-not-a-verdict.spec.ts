import { describe, expect, it, vi } from 'vitest';
import { DocumentSubmitService } from './document-submit.service';

/**
 * Releasing a hold is bookkeeping. Marking a plan's budgets REJECTED is a verdict.
 *
 * They used to be the same call. `releaseDocumentHolds` released budget, quota and stock and then
 * marked a plan's DRAFT budgets REJECTED — and it runs for REJECT, for withdrawal, AND for RETURN.
 * So returning a plan for correction destroyed the very lines it asked the requester to correct,
 * and the corrected plan then reached `activate`, which filtered on no status and revived them.
 * Return → correct → resubmit → approve was a complete REJECTED → ACTIVE cycle no requirement
 * permits.
 *
 * The verdict now belongs to the two terminal paths. These tests pin the split at the seam where it
 * went wrong: the hook releases and marks nothing.
 */
describe('releaseDocumentHolds releases, and passes no verdict', () => {
  function serviceWithSpies() {
    const budget = { releaseAll: vi.fn(async () => undefined) };
    const quota = { releaseAll: vi.fn(async () => undefined) };
    const stock = { release: vi.fn(async () => undefined) };
    const plans = { markRejected: vi.fn(async () => undefined) };
    const em = {
      transactional: async (fn: (tem: unknown) => Promise<unknown>) => fn({}),
      fork() {
        return this;
      },
    };
    const svc = new DocumentSubmitService(
      em as never,
      null as never,
      null as never,
      null as never,
      null as never,
      budget as never,
      quota as never,
      undefined, // matching
      stock as never,
      undefined, // warehouses
      undefined, // events
      undefined, // steps
      plans as never,
    );
    return { svc, budget, quota, stock, plans };
  }

  it('releases every kind of hold (invariant 5 is untouched)', async () => {
    const { svc, budget, quota, stock } = serviceWithSpies();
    await svc.releaseDocumentHolds('doc-1');
    expect(budget.releaseAll).toHaveBeenCalledWith('doc-1', expect.anything());
    expect(quota.releaseAll).toHaveBeenCalledWith('doc-1', expect.anything());
    expect(stock.release).toHaveBeenCalledWith(expect.anything(), 'doc-1');
  });

  /**
   * The one assertion this file exists for. RETURN reaches this hook, and a returned plan must
   * still have budgets to correct.
   */
  it('does NOT mark a plan’s budgets rejected', async () => {
    const { svc, plans } = serviceWithSpies();
    await svc.releaseDocumentHolds('doc-1');
    expect(plans.markRejected).not.toHaveBeenCalled();
  });
});
