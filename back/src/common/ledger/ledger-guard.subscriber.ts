import { EventSubscriber } from '@mikro-orm/core';
import { ApprovalLog } from '../../modules/approval/approval.entities';
import { BudgetTxn } from '../../modules/budget/budget.entities';
import { JournalEntry, JournalLine } from '../../modules/gl/gl.entities';
import type { EventArgs } from '@mikro-orm/core';

// Invariant 2: budget_txn and approval_log are append-only. Inserts only. The GL journal
// (journal_entry / journal_line) is append-only for the same reason — corrections are
// reversing entries, never updates.
const APPEND_ONLY = [BudgetTxn, ApprovalLog, JournalEntry, JournalLine];

function isAppendOnly(entity: object): boolean {
  return APPEND_ONLY.some((cls) => entity instanceof cls);
}

/**
 * Belt-and-suspenders with the AppendOnlyRepository: rejects any UPDATE or
 * DELETE of an append-only ledger row scheduled through the Unit of Work.
 */
export class LedgerGuardSubscriber implements EventSubscriber {
  beforeUpdate(args: EventArgs<object>): void | Promise<void> {
    if (isAppendOnly(args.entity)) {
      throw new Error(
        `${args.entity.constructor.name} is append-only — corrections must be new rows, not updates`,
      );
    }
  }

  beforeDelete(args: EventArgs<object>): void | Promise<void> {
    if (isAppendOnly(args.entity)) {
      throw new Error(
        `${args.entity.constructor.name} is append-only — rows can never be deleted`,
      );
    }
  }
}
