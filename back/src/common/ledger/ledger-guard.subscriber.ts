import { EventSubscriber } from '@mikro-orm/core';
import { AccountingPeriodLog } from '../../modules/accounting/period/accounting-period.entities';
import { ApprovalLog } from '../../modules/approval/approval.entities';
import { AttendanceEvent, AttendancePeriodLog } from '../../modules/attendance/attendance.entities';
import { BudgetTxn } from '../../modules/budget/budget.entities';
import { JournalEntry, JournalLine } from '../../modules/gl/gl.entities';
import { StockTxn } from '../../modules/inventory/inventory.entities';
import type { EventArgs } from '@mikro-orm/core';

// Invariant 2: budget_txn and approval_log are append-only. Inserts only. The GL journal
// (journal_entry / journal_line) is append-only for the same reason — corrections are
// reversing entries, never updates. stock_txn is the third ledger of this shape: a correction
// to stock is a new movement, never a rewrite of the one that was recorded. attendance_event is
// the fourth: a punch is an observation of the world, and an observation that can be edited after
// the fact is worth nothing as evidence — a wrong punch is superseded by a corrective row that
// names it, leaving both readable.
// attendance_period_log is the fifth, and the closest in shape to approval_log: it records that a
// human closed or reopened a period, with who and why. A period that was reopened and re-closed
// must still be able to say so afterwards, which an editable row could not.
// Deliberately absent: attendance_day, stock_balance, and attendance_period_line with its leave
// children. All are PROJECTIONS of a ledger above, not ledgers themselves — recomputation, and in
// the period's case a re-close, has to be able to overwrite them, and the fact that they can be
// thrown away and rebuilt is precisely why the ledgers they derive from must never be.
// budget_control_point is absent for a different reason: it is CONFIGURATION, not a ledger and not
// a projection. It says where availability is checked and holds no money of its own — every amount
// it governs still lives in budget.amount_total and budget_txn. Moving a control point is an
// administrative decision that must be editable; freezing it here would make the control structure
// unchangeable while leaving the money it guards untouched, which protects nothing.
// gl_posting_attempt is absent for a third reason: it is a WORK RECORD, like pending_successor.
// Its rows move PENDING → POSTED / SKIPPED / FAILED in place and a re-queue moves one back, so
// updating them is the entire point. It holds no accounting value — journal_entry, which IS in
// this list, remains the authority on whether a posting happened; the row only says what was tried
// and what went wrong.
const APPEND_ONLY = [
  BudgetTxn,
  ApprovalLog,
  JournalEntry,
  JournalLine,
  StockTxn,
  AttendanceEvent,
  AttendancePeriodLog,
  AccountingPeriodLog,
];

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
