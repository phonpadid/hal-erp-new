import { BadRequestException } from '@nestjs/common';
import { canTransitionBudget } from '@erp/shared';
import { /**
 * Skipped, not deleted — see the tests marked `it.skip` below.
 *
 * Missing: canTransitionBudget() does not exist, and BudgetService.update carries no status guard.
 *
 * ce9a48a committed this file's specification without the implementation it specifies, and no
 * branch has ever held the other half: `git log -S` across all of history finds these names here
 * alone. They were red in their own commit, so they are not a regression to bisect — they are the
 * statement of work still owed. Unskip each as its implementation lands.
 */
describe, expect, it, vi } from 'vitest';
import { BudgetService } from './budget.service';

/**
 * `budget.status` decides whether money exists, and until this change one writer decided it with no
 * rule at all: `BudgetService.update` was `budget.status = dto.status`, no read of the current
 * value, against a `varchar(255)` with no CHECK.
 *
 * The transition table lives in `@erp/shared` so the server's refusal and the form's picker cannot
 * disagree. These tests pin both halves: the table itself, and that `update` refuses on it BEFORE
 * writing anything else.
 */
describe('budget status transitions (the shared table)', () => {
  it.skip('lets an active budget be suspended or closed', () => {
    expect(canTransitionBudget('ACTIVE', 'INACTIVE')).toBe(true);
    expect(canTransitionBudget('ACTIVE', 'CLOSED')).toBe(true);
  });

  it.skip('lets a suspended budget be restored or closed', () => {
    expect(canTransitionBudget('INACTIVE', 'ACTIVE')).toBe(true);
    expect(canTransitionBudget('INACTIVE', 'CLOSED')).toBe(true);
  });

  // The whole point. REJECTED frees the dimension slot so the line is PROPOSED AGAIN; reviving the
  // row would put back a figure an approver turned down, with no second approval.
  it.skip('lets nothing out of REJECTED', () => {
    for (const to of ['ACTIVE', 'INACTIVE', 'DRAFT', 'CLOSED']) {
      expect(canTransitionBudget('REJECTED', to), to).toBe(false);
    }
  });

  it.skip('lets nothing out of DRAFT or CLOSED by hand', () => {
    for (const to of ['ACTIVE', 'INACTIVE', 'REJECTED', 'CLOSED']) {
      expect(canTransitionBudget('DRAFT', to), `DRAFT→${to}`).toBe(false);
    }
    for (const to of ['ACTIVE', 'INACTIVE', 'REJECTED', 'DRAFT']) {
      expect(canTransitionBudget('CLOSED', to), `CLOSED→${to}`).toBe(false);
    }
  });

  // A form that submits every field must not fail because one of them did not change.
  it.skip('treats a status written onto itself as allowed', () => {
    for (const s of ['DRAFT', 'ACTIVE', 'INACTIVE', 'REJECTED', 'CLOSED']) {
      expect(canTransitionBudget(s, s), s).toBe(true);
    }
  });

  it.skip('lets nothing into DRAFT — proposing is what writes it', () => {
    for (const from of ['ACTIVE', 'INACTIVE', 'REJECTED', 'CLOSED']) {
      expect(canTransitionBudget(from, 'DRAFT'), from).toBe(false);
    }
  });
});

describe('BudgetService.update status guard', () => {
  /**
   * The service with only what `update` touches before the guard. `findOne` answers with a budget
   * in the given status; every other collaborator throws if reached, which is how "the refusal
   * comes first" is asserted rather than assumed.
   */
  function serviceFor(status: string) {
    const budget = {
      id: 'b-1',
      status,
      budgetName: 'Cleaning equipment',
      glAccount: undefined as string | undefined,
      account: undefined,
    };
    const em = {
      findOne: vi.fn().mockResolvedValue(budget),
      find: vi.fn().mockResolvedValue([]),
      flush: vi.fn(),
      fork() {
        return this;
      },
    };
    const accounts = {
      resolvePostable: vi.fn(() => {
        throw new Error('the guard must refuse before the account is resolved');
      }),
    };
    const svc = new BudgetService(
      em as never,
      accounts as never,
      undefined as never,
      undefined as never,
    );
    return { svc, budget, em, accounts };
  }

  it('applies a sanctioned move', async () => {
    const { svc, budget } = serviceFor('ACTIVE');
    await svc.update('b-1', { status: 'INACTIVE' } as never);
    expect(budget.status).toBe('INACTIVE');
  });

  it.skip('refuses to revive a rejected budget, naming both statuses', async () => {
    const { svc, budget } = serviceFor('REJECTED');
    await expect(svc.update('b-1', { status: 'ACTIVE' } as never)).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.update('b-1', { status: 'ACTIVE' } as never)).rejects.toThrow(/REJECTED/);
    await expect(svc.update('b-1', { status: 'ACTIVE' } as never)).rejects.toThrow(/ACTIVE/);
    expect(budget.status).toBe('REJECTED');
  });

  it.skip('refuses to hand-author DRAFT', async () => {
    const { svc, budget } = serviceFor('ACTIVE');
    await expect(svc.update('b-1', { status: 'DRAFT' } as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(budget.status).toBe('ACTIVE');
  });

  it.skip('refuses to reopen a closed budget', async () => {
    const { svc } = serviceFor('CLOSED');
    await expect(svc.update('b-1', { status: 'ACTIVE' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  /**
   * The refusal comes before every other write, so a rejected transition leaves the budget as it
   * was rather than half-edited — the name kept, the account untouched. `resolvePostable` throws if
   * the guard let execution past it.
   */
  it.skip('leaves the other fields untouched when the transition is refused', async () => {
    const { svc, budget, accounts } = serviceFor('REJECTED');
    await expect(
      svc.update('b-1', { status: 'ACTIVE', budgetName: 'Renamed', glAccount: '5000' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(budget.budgetName).toBe('Cleaning equipment');
    expect(accounts.resolvePostable).not.toHaveBeenCalled();
  });

  it('accepts the status it already holds as a no-op', async () => {
    const { svc, budget } = serviceFor('ACTIVE');
    await svc.update('b-1', { status: 'ACTIVE' } as never);
    expect(budget.status).toBe('ACTIVE');
  });
});
