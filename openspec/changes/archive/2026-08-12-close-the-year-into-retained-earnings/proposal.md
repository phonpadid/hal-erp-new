## Why

`financial-reports` has carried the same sentence since it was written:

> Because there is no period-close yet, the balance sheet derives retained earnings as the
> cumulative net income to date.

Months can be closed now, so half of that is obsolete. The other half is not: revenue and expense
accumulate forever, because nothing has ever rolled them into equity. A company in its third year
reads an income statement whose "cumulative" figures are three years deep unless every report is
carefully bounded, and a balance sheet whose equity is really a derivation rather than a balance.

The books therefore have no year. `fiscal_year` has an `OPEN`/`CLOSED` status and `close()` sets
it, but that flip means only "stop submitting documents dated here" — it posts nothing, so the
revenue and expense of the year it closed keep standing in their own accounts forever.

Everything needed to fix it now exists: a manual voucher can write the entry, a period can be closed
in order, and `createEntry` enforces the ledger's rules on both.

## What Changes

- **A new `RETAINED_EARNINGS` account role**: the equity account a year's result is rolled into.
- **A year closes when its last period closes.** When the period being closed ends on the fiscal
  year's last day, the close additionally posts one balanced entry dated that day — debiting every
  revenue account for its credit balance, crediting every expense account for its debit balance, and
  putting the difference to `RETAINED_EARNINGS` — and flips `fiscal_year.status` to `CLOSED` in the
  same operation.
- **That timing is the design, not a convenience.** A closing entry belongs on the year's last day,
  which is inside the period that is closing; if the year were closed afterwards, `createEntry`
  would refuse the entry for being dated in a closed period — correctly, since that is what the
  guard is for. Posting it while that period is still open is the only placement that needs no
  escape hatch, and it makes forgetting to close the year impossible rather than unlikely.
- **The entry is keyed to the fiscal year**, so it cannot be posted twice.
- **`financial-reports` needs no arithmetic change.** Once the year's revenue and expense net to
  zero and the result sits in an equity account, the derived retained earnings automatically becomes
  the *current* period's net income and `equityTotal` carries the prior years. The requirement and
  the Purpose stop saying there is no close, and the report labels the two separately so a reader
  can tell carried-forward equity from this period's result.
- **A company with no declared periods is unaffected**, as everywhere else in this work: no periods
  means no last period, so no closing entry and no automatic year close. `FiscalYearService.close()`
  keeps working as the flag it always was.

Deliberately **out of scope**:

- **Reopening a closed year.** Periods can be reopened; a year cannot, because unwinding a closing
  entry means reversing it and every later year's opening position. When somebody needs it, the
  reversal capability is already there and the operation should be designed around a real request
  rather than a guess.
- **A separate adjustment period.** Real systems post year-end adjustments into a thirteenth period
  that stays open while the twelve are closed. That is the right long-term shape and a bigger idea
  than this; the placement chosen here works without it, and a company needing post-close
  adjustments reopens the final period.
- **Closing revenue and expense per department or dimension.** The entry rolls up by account, which
  is what the balance sheet needs. Departmental result reporting is a report, not a posting.
- **An opening-balance entry for the new year.** Balance-sheet accounts carry forward by simply not
  being closed, which is what makes them balance-sheet accounts. Nothing needs to be written.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `accounting-period`: closing the final period of a fiscal year also closes the year and posts its
  closing entry.
- `gl-journal`: `Config-Driven System Account Roles` gains `RETAINED_EARNINGS`.
- `financial-reports`: the balance sheet stops describing itself as having no period close, and
  separates carried-forward equity from the current period's result.

## Impact

**Backend**

- `back/src/common/enums/index.ts`, `erp_approval_system.dbml` — `RETAINED_EARNINGS` in
  `account_role_type`. No table, no migration.
- `back/src/modules/gl/year-close.service.ts` (new) — the closing entry: aggregate `journal_line`
  over the year's revenue and expense accounts, build the balanced draft, post it through
  `createEntry`.
- `back/src/modules/accounting/period/accounting-period.service.ts` — `close` detects the year's
  final period and runs the year close before flipping either status.
- `back/src/modules/gl/financial-reports.service.ts` — the balance sheet reports
  `retainedEarningsBroughtForward` (from the equity account) beside the current period's derived
  figure. The balance check is unchanged because the arithmetic is.
- `back/src/seed/seed-data.ts` — a `3200 Retained Earnings` equity account and its role mapping.

**Invariants**

- Invariant 2: the closing entry is appended like any other and corrected only by a reversal.
- Invariant 3 and 6: it writes no `budget_txn`. A year-end result is accounting, not budget.
- Invariant 1: accounts and the role resolve per company, and a year belongs to one company.

**Risk**

The closing entry is the largest single entry the system will ever write — every revenue and expense
account of a year in one document. If a company's chart is wrong, this is where it becomes obvious,
and the correction is a reversal plus a voucher rather than an edit. That is the intended behaviour
and it will still be uncomfortable the first time.

Second: closing the final period now does two things, and the second is irreversible in a way the
first is not. A period can be reopened; a year cannot, by the scope decision above. Anyone closing
December should know it ends the year — the operation says so in its refusal messages and its log,
but the person clicking is closing a month.
