import { EventSubscriber } from '@mikro-orm/core';
import { ApprovalLog } from '../../modules/approval/approval.entities';
import { BudgetTxn } from '../../modules/budget/budget.entities';
import { JournalEntry, JournalLine } from '../../modules/gl/gl.entities';
import { StockTxn } from '../../modules/inventory/inventory.entities';
import type { EventArgs } from '@mikro-orm/core';

// Invariant 2: budget_txn and approval_log are append-only. Inserts only. The GL journal
// (journal_entry / journal_line) is append-only for the same reason — corrections are
// reversing entries, never updates. stock_txn is the third ledger of this shape: a correction
// to stock is a new movement, never a rewrite of the one that was recorded.
const APPEND_ONLY = [BudgetTxn, ApprovalLog, JournalEntry, JournalLine, StockTxn];

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
