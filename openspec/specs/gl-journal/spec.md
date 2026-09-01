# GL Journal Specification

## Purpose
An append-only, double-entry general ledger (`journal_entry` / `journal_line`) and the posting
engine that turns disbursement settlements into balanced journal entries against the chart of
accounts. System accounts (cash clearing, FX gain/loss) are resolved by role, not by hardcoded
code. This capability produces the balanced journal that future accounting slices (periods,
subledgers, financial statements) build on; it does not change the budget ledger or the payment
flow.
## Requirements
### Requirement: Append-Only Double-Entry General Ledger

The system SHALL record general-ledger postings as a `journal_entry` header and its
`journal_line` rows, and MUST NOT update or delete either once written — corrections are new
reversing entries (append-only, like `budget_txn`). Each `journal_line` SHALL carry a `debit`
and a `credit` amount (decimal, company base currency) with exactly one non-zero per line, and
reference an `account`. Every `journal_entry` and `journal_line` SHALL be scoped to one company
(invariant 1).

#### Scenario: Entries and lines cannot be mutated

- **WHEN** any code attempts to UPDATE or DELETE a `journal_entry` or `journal_line` row
- **THEN** the operation is rejected (append-only), and a correction must be a new entry

#### Scenario: Each line is one-sided

- **WHEN** a journal line is written
- **THEN** exactly one of its `debit` / `credit` is non-zero and it references an account in
  the same company

### Requirement: Balanced Entry Invariant

Every `journal_entry` SHALL be balanced: the sum of its lines' `debit` amounts MUST equal the
sum of their `credit` amounts, in the company base currency. The system MUST reject an entry
whose sides differ by any minor unit before it is persisted.

#### Scenario: A balanced entry is accepted

- **WHEN** an entry's total debits equal its total credits
- **THEN** the entry and its lines are persisted

#### Scenario: An unbalanced entry is rejected

- **WHEN** an entry's total debits do not equal its total credits
- **THEN** the entry is rejected and no line is written

### Requirement: Every Entry Is Written Through One Balanced Constructor

The system SHALL persist a `journal_entry` and its `journal_line` rows through a single
constructor, and no posting path SHALL build them any other way. The constructor SHALL reject an
entry whose `Σ debit` differs from its `Σ credit` by any amount before anything is persisted, and
SHALL resolve `entry_date` by the company-day rule (see `Entry Date Is The Posting Company's Own
Calendar Day`). This makes `Balanced Entry Invariant` a check rather than a property of how each
path happens to be written — balanced-by-construction is true until the next edit, and says nothing
about a path added later.

The constructor SHALL additionally refuse an entry whose resolved `entry_date` falls inside a
`CLOSED` accounting period of the posting company (see `accounting-period`'s `A Closed Period
Refuses New Entries, And A Refused Posting Is Not Lost`). Having one place where the day is resolved
is what makes "is that day open?" answerable once instead of in every posting path, and is why this
requirement exists in the shape it does. A date no declared period covers SHALL post normally.

#### Scenario: An unbalanced draft is refused before anything is written

- **WHEN** a posting path offers lines whose debits and credits differ
- **THEN** the constructor throws naming the source, and no `journal_entry` and no `journal_line`
  row exists for it

#### Scenario: A closed day is refused before anything is written

- **WHEN** a posting path offers an entry whose resolved day falls inside a `CLOSED` period
- **THEN** the constructor throws naming the period, no row is written, and the failure is recorded
  as an undelivered posting rather than being lost

#### Scenario: Every path is constructed the same way

- **WHEN** a payment settlement, an approval accrual or a stock movement posts
- **THEN** its entry was written through the one constructor, with its balance asserted, its
  `entry_date` resolved in the posting company's timezone, and that day checked against the
  company's accounting periods

### Requirement: Entry Date Is The Posting Company's Own Calendar Day

Every `journal_entry.entry_date` SHALL be the calendar day the posted event fell on **in the posting
company's own `company.timezone`**, and SHALL NOT be derived from the UTC day of that instant. This
SHALL hold for every posting path — payment settlement, approval accrual, stock movement, and any
path added later — because `entry_date` is the only field deciding which period a figure belongs to,
and `financial-reports` ranges the trial balance, account ledger, income statement and balance sheet
over it.

Which *instant* a path posts on is unchanged and remains that path's own business: the payment's
`paid_at`, the document's `approved_at`, the movement's `created_at`, each with their existing
fallbacks. Only the conversion from that instant to a calendar day is fixed here.

A company's timezone SHALL be read from `company.timezone`; the system SHALL NOT substitute UTC when
resolving a company's day.

#### Scenario: An early-morning payment is dated that day, not the day before

- **GIVEN** a company whose `timezone` is `Asia/Vientiane` (UTC+7)
- **WHEN** a payment settles at 06:30 on 1 August local time, which is 23:30 on 31 July UTC
- **THEN** the entry's `entry_date` is `2026-08-01`, so the payment falls in the August income
  statement and not the July one

#### Scenario: A late-evening approval west of UTC stays in its own month

- **GIVEN** a company whose `timezone` is west of UTC, such as `America/New_York`
- **WHEN** a document that accrues at approval is approved at 23:00 local on the last day of a
  month, which is past midnight UTC and therefore already the next month there
- **THEN** the accrual's `entry_date` is that last day, not the first day of the next month —
  the opposite direction from the early-morning case above, and the one that moves a figure
  forward across a close rather than back

#### Scenario: Every posting path uses the company's day

- **WHEN** a payment settlement, an approval accrual and a stock movement are each posted for the
  same company
- **THEN** all three entries derive `entry_date` in that company's timezone, by the same rule

#### Scenario: Two companies in different zones date the same instant differently

- **GIVEN** company A in a UTC+7 zone and company B in a UTC+0 zone
- **WHEN** an event is posted for each at the same instant, 22:00 UTC
- **THEN** A's entry is dated the following day and B's entry is dated that day, each being its own
  company's calendar day

### Requirement: Posting on Payment Settlement

The system SHALL post one balanced journal entry per settled document when `payment.settled` occurs.

**When the document was accrued at approval**, the entry SHALL debit the payable that accrual
credited, for the amount it credited, credit the `WHT_PAYABLE` account for `payment.wht_amount` when
it is non-zero, credit the cash-clearing account for the actual base amount **net of
`payment.wht_amount`**, and post the FX difference (`payment.fx_delta`) to the realized FX gain or
loss account. It SHALL NOT debit any expense account, `VAT_INPUT`, or `GRNI`: all three were posted
with the accrual, and posting them again would recognise the same purchase twice. The payable SHALL
be cleared at the amount it was raised at, so the entire rate difference lands in FX by construction
(`payable + fx_delta = base_actual = cash + wht`).

**When it was not**, the entry SHALL debit the expense account(s) of the budget(s) the document
charged (via `budget.account_id`) at the locked base amount, debit the `VAT_INPUT` account for the
document's input-VAT total (`document.base_tax_total`) when it is non-zero, credit `WHT_PAYABLE` and
cash-clearing as above, and post the FX difference the same way. This is the behaviour every
document approved before its type began accruing keeps for the rest of its life, which is what makes
the change incremental rather than a migration.

In both cases the expense or payable side SHALL be taken from the `budget_txn` ACTUAL rows of the
settlement — the paid document's own, or, when the settled hold belongs to a document further up its
`ref_document_id` chain, the nearest ancestor carrying ACTUAL rows — so that a chain-settled
disbursement posts the same entry a self-settling one does. The posting SHALL run after the payment
transaction has committed and SHALL NOT write any `budget_txn` (invariant 6 — FX goes to accounting,
not the budget). Every entry SHALL remain balanced (Σdebit = Σcredit).

#### Scenario: Settlement with no FX difference

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000 charged to one
  budget whose account is an expense account, with no VAT and no WHT, and no accrual
- **WHEN** `payment.settled` is handled
- **THEN** a balanced entry is posted: debit the expense account 100000 and credit the
  cash-clearing account 100000, with no FX, VAT, or WHT line

#### Scenario: Settling an accrued purchase clears its payable

- **GIVEN** a document accrued at approval for 107000 against `ACCOUNTS_PAYABLE`, settled with
  `base_locked` = `base_actual` = 107000 and no WHT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 107000 and credits cash-clearing 107000, and no
  expense, `VAT_INPUT` or `GRNI` line is written

#### Scenario: An accrued purchase paid at a different rate

- **GIVEN** a document accrued at approval for 100000, settled with `base_locked` 100000 and
  `base_actual` 102000 (`fx_delta` +2000, kind LOSS)
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 100000 and the FX-loss account 2000, and credits
  cash-clearing 102000 — the payable clears at the rate it was raised at

#### Scenario: An accrued purchase paid with withholding

- **GIVEN** a document accrued at approval for 107000, settled with `base_actual` 107000 and
  `payment.wht_amount` 3000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `ACCOUNTS_PAYABLE` 107000 and credits `WHT_PAYABLE` 3000 and
  cash-clearing 104000

#### Scenario: Settlement with an FX loss

- **GIVEN** a settled disbursement with no accrual, `base_locked` 100000 and `base_actual` 102000
  (`fx_delta` +2000, kind LOSS), no VAT, no WHT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits the expense account 100000 and the FX-loss account 2000, and
  credits the cash-clearing account 102000 (Σdebit = Σcredit = 102000)

#### Scenario: Settlement carrying input VAT and WHT

- **GIVEN** a settled disbursement with no accrual, expense net 100000, input VAT 7000
  (`base_locked` = `base_actual` = 107000, `base_tax_total` 7000) and `payment.wht_amount` 3000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits expense 100000 and VAT_INPUT 7000 and credits cash-clearing 104000
  (107000 − 3000) and WHT_PAYABLE 3000 (Σdebit = Σcredit = 107000)

#### Scenario: Settlement whose budget hold belongs to a predecessor

- **GIVEN** a paid disbursement that carries no `budget_txn` ACTUAL of its own because the chain's
  hold was reserved and settled on its predecessor
- **WHEN** `payment.settled` is handled
- **THEN** the expense side is taken from the predecessor's ACTUAL rows and a balanced entry is
  posted, rather than the posting being skipped

#### Scenario: Posting never rolls back the payment

- **WHEN** the posting fails (e.g. a system account is not mapped)
- **THEN** the already-committed payment is unaffected, the failure is logged, and the posting
  can be retried

### Requirement: Idempotent Posting

Each `journal_entry` SHALL carry a source key (`source_type`, `source_id`) unique per company.
The system MUST NOT post more than one entry for the same source; a repeated or retried
`payment.settled` for an already-posted source SHALL be a no-op.

#### Scenario: A retried event does not double-post

- **GIVEN** a document whose settlement has already produced a journal entry
- **WHEN** `payment.settled` fires again for that same document
- **THEN** no second entry is written

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, tax, inventory, and payable accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`VAT_INPUT`, `WHT_PAYABLE`, `INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`,
`CLAIM_PAYABLE`, `ACCOUNTS_PAYABLE`, `ACCRUED_EXPENSE`, and `RETAINED_EARNINGS` — never by a
hardcoded account code
(invariant 7). A role that is unmapped, inactive, or in another company SHALL make the posting a
logged failure, not a crash.

`VAT_INPUT` is the recoverable input-VAT account, debited for a document's `base_tax_total` when it
is non-zero. `WHT_PAYABLE` is the withholding tax withheld from a vendor and owed to the tax
authority, credited for `payment.wht_amount` when it is non-zero. Both are named by
`Posting on Payment Settlement` and both are required for any company whose purchases bear VAT or
whose payments withhold tax — a company that maps neither cannot post such a payment at all, and
by the rule above it will fail silently.

`INVENTORY` is the company's inventory asset account, debited when stock is capitalized and
credited when it is consumed. `GRNI` (goods received not invoiced) is the liability that stands
between capitalizing goods at receipt and paying for them; without it a receipt entry has no
credit side and cannot balance. `INVENTORY_ADJUSTMENT` absorbs the gain or loss of a stock
adjustment. `INVENTORY_IN_TRANSIT` is reserved for multi-step transfers and SHALL be resolvable
but is unused by the current transfer posting, which moves stock in a single step. `CLAIM_PAYABLE`
is the liability that stands between an approved compensation and the money leaving — the same
shape as `GRNI`, for an obligation that arises at approval rather than at receipt.

`ACCOUNTS_PAYABLE` is trade payable: what the company owes a vendor between accepting an invoice and
paying it. It is the same shape again, for the obligation with the most volume — and the one that,
before it existed, was recognised only when the cash moved.

`ACCRUED_EXPENSE` is the liability standing between a service or untracked good being received and
its invoice arriving — the same shape as `GRNI`, for the purchases `GRNI` does not cover because
they were never capitalized into stock. It is credited when a period closes and debited by the
reversal the following day (see `accounting-period`'s `Closing Accrues What Was Received And Not
Invoiced`).

`RETAINED_EARNINGS` is the equity account a fiscal year's result is rolled into when the year closes,
so revenue and expense begin the next year at zero and the result stands as a balance rather than as
a figure every report has to re-derive (see `accounting-period`'s `Closing The Year's Final Period
Closes The Year`).

#### Scenario: Roles resolve to the company's mapped accounts

- **WHEN** the engine needs the cash-clearing, FX, tax, inventory, or payable account for a company
- **THEN** it uses the account mapped to that role for that company

#### Scenario: A missing role mapping fails the posting only

- **WHEN** a required role has no active mapping for the company
- **THEN** the posting is skipped and logged, and the payment, stock, or approval flow is unaffected

#### Scenario: Inventory roles are company-scoped like every other role

- **GIVEN** company A maps `INVENTORY` and company B does not
- **WHEN** a stock movement is approved in company B
- **THEN** the movement commits, its posting is skipped and logged, and company A's mapping is not used

#### Scenario: A VAT-bearing payment needs the VAT role mapped

- **GIVEN** a company with no account mapped to `VAT_INPUT`
- **WHEN** a settled document carrying a non-zero `base_tax_total` is posted
- **THEN** the posting is skipped and logged, and the payment is unaffected

#### Scenario: An accruing purchase needs the payable role mapped

- **GIVEN** a company with no account mapped to `ACCOUNTS_PAYABLE`
- **WHEN** a document of a vendor type that accrues reaches full approval
- **THEN** the document stays approved with its budget cut, no entry is written, and the failure is
  recorded as an undelivered posting rather than only logged

#### Scenario: Closing a year needs the retained-earnings role mapped

- **GIVEN** a company closing the final period of a fiscal year and no account mapped to
  `RETAINED_EARNINGS`
- **THEN** the close is rejected naming the role, and neither the period nor the year is closed

#### Scenario: A close that would accrue needs the accrual role mapped

- **GIVEN** a company with received-and-uninvoiced lines and no account mapped to `ACCRUED_EXPENSE`
- **WHEN** one of its periods is closed
- **THEN** the close is rejected naming the role, and the period stays open — unlike an event-driven
  posting, a close is a synchronous act whose caller can fix the mapping and try again

### Requirement: Every Posting Attempt Records Its Outcome

The system SHALL record the outcome of every posting attempt in a `gl_posting_attempt` row, one per
`(company_id, source_type, source_id)` — the same key `journal_entry` is unique on — carrying a
`status` of `PENDING`, `POSTED`, `SKIPPED` or `FAILED`, an `attempts` count and a `last_error`.
`gl_posting_attempt` is a work record, not a ledger: its rows change status in place, and it SHALL
NOT be treated as append-only. `journal_entry` remains the authority on whether a posting happened;
the row records what was tried and what went wrong.

A row SHALL additionally carry a nullable `blocked_by_budget_id`, set when the attempt failed
because that `budget` has no `account_id`, and **cleared on every other outcome** so it can never
describe a cause that no longer applies. This records the cause as data rather than as prose: it is
what lets naming a budget's account re-queue exactly the postings that budget blocked, and what lets
the undelivered read name the budget by joining rather than by parsing a message back apart.

A source that legitimately posts nothing SHALL be recorded `SKIPPED`, terminally — a settlement with
no `budget_txn` ACTUAL row, an accruing document that cut no budget, a `RESERVE` or `RELEASE` stock
row, and an intra-company transfer. Recording the skip is what lets the undelivered-postings read
below stay free of business rules: without it the read would have to re-derive every "nothing to
post" condition in a second place, where it can drift from the posting engine silently.

Recording an outcome SHALL NOT affect the business transaction that triggered the posting, which has
already committed (see `Config-Driven System Account Roles`).

#### Scenario: A successful posting is recorded

- **WHEN** a posting produces a balanced entry
- **THEN** its row is `POSTED`

#### Scenario: A failure is recorded, not only logged

- **GIVEN** a company with no account mapped to a role the posting needs
- **WHEN** the posting is attempted
- **THEN** the payment, approval or stock movement is unaffected, and a row exists carrying the
  failure and its message

#### Scenario: A legitimate no-op is recorded as skipped, not as a failure

- **WHEN** a settled document carrying no `budget_txn` ACTUAL row is posted
- **THEN** no entry is written and its row is `SKIPPED`, distinguishable from a failure

#### Scenario: A reservation is skipped rather than owed forever

- **WHEN** a `RESERVE` or `RELEASE` stock row is posted
- **THEN** no entry is written, its row is `SKIPPED`, and it is never reported as undelivered

#### Scenario: A posting blocked by a budget records which budget

- **GIVEN** a settlement charging a budget whose `account_id` is null
- **WHEN** the posting fails
- **THEN** the row carries that budget's id in `blocked_by_budget_id`

#### Scenario: The recorded cause does not outlive itself

- **GIVEN** a row carrying `blocked_by_budget_id` from an earlier attempt
- **WHEN** the posting is attempted again and either succeeds, is skipped, or fails for another
  reason
- **THEN** `blocked_by_budget_id` is null

### Requirement: Undelivered Postings Are Queryable

The system SHALL expose a read-only, company-scoped query, gated by `GL_VIEW`, returning the
postings that are owed and undelivered: sources having no `journal_entry` and no
`gl_posting_attempt` row in a terminal state (`POSTED` or `SKIPPED`). Each SHALL carry its source
type and id, its attempt count, its last error and its status. The read MUST NOT mutate any ledger.

Where a row records a `blocked_by_budget_id`, the read SHALL additionally carry that budget's
`budget_node.code` and `budget_node.name`, so the reader can tell which budget to fix without
resolving a uuid by hand.

A `FAILED` row SHALL remain on this read. The attempt bound stops the retrying, not the debt: a
posting nobody will retry automatically is the one most in need of being seen.

This read is what a period close will ask before allowing a period to be closed, so it SHALL be
answerable for a date range.

#### Scenario: A failed posting is visible

- **GIVEN** a posting that failed because a role was unmapped
- **WHEN** the undelivered-postings read runs for that company
- **THEN** the source is listed with its attempt count and the role that was missing

#### Scenario: Posted and skipped sources are not listed

- **WHEN** the read runs
- **THEN** sources whose entry exists, and sources recorded `SKIPPED`, are absent

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's undelivered postings are returned, and a request without `GL_VIEW` is
  rejected with 403

#### Scenario: A posting blocked by a budget is listed with that budget's code

- **GIVEN** a `FAILED` posting whose `blocked_by_budget_id` names a budget on node `1.101`
- **WHEN** the read runs
- **THEN** the row carries `1.101` and that node's name alongside its error

### Requirement: Retries Are Bounded and Missed Postings Are Reconciled

The system SHALL drain postings that are owed on an interval. A row SHALL be claimed with
`LockMode.PESSIMISTIC_WRITE` and `SKIP LOCKED` before being attempted, so two concurrent sweeps
cannot both post one source and a slow row does not block the rows behind it. `attempts` SHALL be
incremented and `last_error` stored on each failure, and the row SHALL become `FAILED` at its bound
rather than being retried forever.

The same interval SHALL additionally reconcile: over a bounded recent window it SHALL find sources
that are owed a posting and have **no** `gl_posting_attempt` row at all, and record them `PENDING`
so the retry path picks them up. This covers the posting lost when the process stops between the
business transaction committing and the in-process listener running — a case that produces no row,
no exception and no log line, and is therefore invisible to a retry that reads only the table. The
reconciled sources SHALL be settled payments, fully approved documents of a type that accrues, and
`stock_txn` rows — and a posting path added later SHALL extend this enumeration, or its sources will
never be reconciled.

Reconciliation SHALL NOT post directly; it SHALL only record what is owed, so exactly one code path
attempts a posting and counts its attempts.

#### Scenario: A transient failure is retried

- **GIVEN** a row whose first attempt failed and whose attempts are under the bound
- **WHEN** the sweep runs again
- **THEN** the posting is attempted again, with `attempts` incremented and `last_error` recorded

#### Scenario: A permanent failure stops being retried

- **GIVEN** a row that has failed up to its bound
- **WHEN** the sweep runs again
- **THEN** the row is `FAILED`, is not attempted, and keeps its `last_error`

#### Scenario: Two sweeps post one source once

- **GIVEN** one owed posting and two sweeps running concurrently
- **WHEN** both attempt to claim it
- **THEN** exactly one `journal_entry` exists for that source

#### Scenario: A posting lost to a restart is found

- **GIVEN** a settled payment whose posting never ran, so it has no entry and no row
- **WHEN** the reconciliation pass runs within its window
- **THEN** a `PENDING` row is recorded for it and the next sweep posts it

#### Scenario: Reconciliation does not re-post what is already posted

- **WHEN** the reconciliation pass runs over a window containing sources that posted successfully
- **THEN** no row is recorded for them and no second entry is written

### Requirement: A Failed Posting Can Be Re-Queued

The system SHALL let a user holding `GL_POST_RETRY` return a `FAILED` row to `PENDING` with its
`attempts` reset, so the next sweep attempts it again. `last_error` SHALL be retained, so the record
of what went wrong survives the retry. The operation SHALL be company-scoped and SHALL queue the
work rather than posting inline, keeping one code path that attempts a posting.

Without this the attempt bound would make a failed posting unpostable forever: an operator who reads
the undelivered list, maps the account that was missing, and has no way to complete the posting.

#### Scenario: Re-queuing lets a fixed posting complete

- **GIVEN** a `FAILED` posting whose missing account role has since been mapped
- **WHEN** a `GL_POST_RETRY` user re-queues it and the sweep runs
- **THEN** the entry is posted and the row becomes `POSTED`

#### Scenario: Re-queuing is permission-gated and company-scoped

- **WHEN** a request without `GL_POST_RETRY`, or one for another company's row, re-queues a posting
- **THEN** it is rejected and the row is unchanged

#### Scenario: Only a failed posting is re-queued

- **WHEN** a re-queue is attempted for a row that is `POSTED` or `SKIPPED`
- **THEN** it is rejected and no second entry is ever written for that source

### Requirement: A Person Can Post A Journal Voucher

The system SHALL let a user holding `GL_JV_POST` submit a journal voucher: an `entry_date`, a memo,
and two or more lines, each naming a GL account and exactly one non-zero side. This is the entry no
event produces — depreciation, an accrual at period close, prepaid amortisation, payroll, opening
balances carried in from a previous system, and the correction of a posting that was wrong.

Submitting SHALL record the voucher and SHALL NOT write to the ledger. The entry SHALL be written
when the voucher completes its approval route — see *A Journal Voucher Is Approved Through Its
Document's Workflow*.

A voucher SHALL be raised as a `document` of a voucher type, so that it carries a document number, a
department, and a workflow. The document SHALL hold the header and the routing; the voucher record
SHALL hold what a document cannot express — the accounting date and, for a reversal, the entry it
reverses — and the voucher's lines SHALL stay in their own table.

The document SHALL carry NO `document_line` rows, and its total SHALL be stamped as the sum of the
voucher's debits. A voucher line has a side, and no folding of a side into a single line amount gives
the right figure: signed amounts sum to zero for any voucher that balances, and unsigned amounts sum
to twice the amount. The total is what the approval route bands against, so an amount that is zero or
doubled would route every voucher into the wrong band.

A voucher SHALL be subject to every rule an automatic posting obeys, because it SHALL be written
through the same constructor: balanced or refused, dated in the company's own calendar day, refused
when that day falls in a closed accounting period, and append-only once written. Each line's account
SHALL be resolved through the chart-of-accounts resolver, so an account that is missing, inactive,
non-postable, or another company's is rejected (invariant 1). Balance, account validity and the
period SHALL be checked at submit as well, so a voucher that could never post is refused before
anyone is asked to look at it.

The voucher record is NOT a duplicate of the entry: it exists to hold a voucher that is not yet an
entry, which an append-only ledger cannot do. Once the route completes, the entry SHALL be created
from it and never edited, so the two cannot disagree. A voucher SHALL remain distinguishable in the
journal by its `source_type`, which the journal read already exposes.

A voucher's identity SHALL be the entry's `source_id`, so completing the same voucher twice resolves
to the entry already written, using the uniqueness `journal_entry` has on
`(company, source_type, source_id)`.

A voucher SHALL NOT write any `budget_txn` (invariants 3 and 6): an accountant correcting the ledger
is not adjusting anyone's budget. A voucher SHALL NOT be recorded as a posting attempt, because it
is a person's synchronous act rather than work the system owes itself, and the period close reads
that record to decide whether a month is drained.

#### Scenario: A balanced voucher is posted when its route completes

- **GIVEN** a `GL_JV_POST` user in a company with two active postable accounts
- **WHEN** they submit a voucher debiting one 5,000 and crediting the other 5,000, and every
  applicable approval step approves it
- **THEN** a `journal_entry` exists with those two lines, its `source_type` marking it as manual and
  its author recorded

#### Scenario: A voucher is a document and carries a number

- **WHEN** a voucher is submitted
- **THEN** a document of the voucher type exists for it, numbered and bound to a workflow

#### Scenario: The document's total is the voucher's debits

- **WHEN** a voucher debiting 5,000 across two lines and crediting 5,000 across two others is
  submitted
- **THEN** the document's total is 5,000 — neither zero nor 10,000

#### Scenario: Submitting alone writes no entry

- **WHEN** a voucher is submitted and its route is not complete
- **THEN** no `journal_entry` and no `journal_line` exists for it

#### Scenario: An unbalanced voucher is refused

- **WHEN** a voucher's debits and credits differ
- **THEN** it is rejected at submit and no document, no voucher, no entry and no line is written

#### Scenario: A voucher cannot name an unusable account

- **WHEN** a voucher line names an account that is inactive, non-postable, or belongs to another
  company
- **THEN** it is rejected naming that account, and no entry is written

#### Scenario: A voucher cannot be raised into a closed period

- **GIVEN** a closed accounting period covering a date
- **WHEN** a voucher for that date is submitted
- **THEN** it is refused naming the period, and nothing is written

#### Scenario: A retried completion does not post twice

- **WHEN** the same voucher's final approval is delivered twice
- **THEN** exactly one entry exists for it

#### Scenario: Submitting a voucher is permission-gated and company-scoped

- **WHEN** a request without `GL_JV_POST` submits a voucher
- **THEN** it is rejected with 403, and a voucher submitted by a permitted user belongs to that
  user's active company

#### Scenario: A voucher touches no budget

- **WHEN** a voucher is posted against an account that a budget also uses
- **THEN** no `budget_txn` row is written and no budget balance changes

### Requirement: Any Entry Can Be Reversed, Once

The system SHALL let a user holding `GL_JV_POST` reverse any `journal_entry` of their company by
submitting a voucher carrying the same lines with debit and credit exchanged. Corrections are
reversing entries, never edits (invariant 2), and this is the operation that makes that rule usable
rather than merely restrictive.

A reversal SHALL pass the same approval as any other voucher. A reversal IS a voucher whose lines
were computed for the submitter rather than typed by them, and leaving it outside the control would
make `GL_JV_POST` mean both "submit for approval" and "write the ledger unreviewed" — the second
being the stronger. An unreviewed path standing beside a control is what makes the control
decorative.

A reversal SHALL be keyed to the entry it reverses, so an entry SHALL be reversible at most once and
the second attempt SHALL be rejected. **Any** entry SHALL be reversible, not only a manual one: a
wrong automatic posting is the likelier case, and refusing it would leave the ledger unable to
correct exactly what it most often gets wrong.

The reversal's `entry_date` SHALL be the caller's choice and SHALL default to today, rather than
being copied from the original. The original's period is frequently closed — often the reason it is
being reversed — and dating a correction into a month that has been reported would either be refused
by the period guard or restate figures somebody has already acted on. A correction belongs in the
period in which it was decided.

#### Scenario: A wrong entry is reversed

- **GIVEN** an entry debiting an account 1,000 and crediting another 1,000
- **WHEN** a reversal is submitted and approved
- **THEN** a new entry exists crediting the first 1,000 and debiting the second 1,000, and the two
  net to zero across both accounts

#### Scenario: A reversal awaits the same approval

- **WHEN** a reversal is submitted and not yet approved
- **THEN** no reversing entry exists

#### Scenario: An automatic posting can be reversed too

- **GIVEN** a payment settlement entry the engine posted
- **WHEN** a `GL_JV_POST` user submits a reversal and it is approved
- **THEN** the reversal is written, and the original entry is unchanged

#### Scenario: An entry is reversed at most once

- **WHEN** an entry that has already been reversed is reversed again
- **THEN** the request is rejected and no second reversal exists

### Requirement: Authorized, Company-Scoped Journal Read

The system SHALL expose a read-only journal query (entries with their balanced lines) gated by
`GL_VIEW`, scoped to the caller's active company, and it MUST NOT mutate any ledger. There is no
update or delete endpoint for journal entries: an entry is written once and corrected only by a
reversal (invariant 2).

Entries are produced by the posting engine and, for the entries no event produces, by an authorized
journal voucher (see `A Person Can Post A Journal Voucher`). The read SHALL expose each entry's
`source_type`, so a manual entry and a reversal are distinguishable from an automatic posting
without a further request.

#### Scenario: Reading the journal is permission-gated

- **WHEN** a request without `GL_VIEW` queries the journal
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: The journal read is company-scoped and read-only

- **WHEN** a `GL_VIEW` user in company A reads the journal
- **THEN** only company A's entries are returned and nothing is written

#### Scenario: A manual entry is distinguishable from an automatic one

- **GIVEN** a company with both an engine-posted entry and a manually posted voucher
- **WHEN** the journal is read
- **THEN** each entry carries the `source_type` that says which it is

### Requirement: Settling a Stock Purchase Clears GRNI Rather Than Expense

Goods already capitalized into inventory SHALL NOT be expensed again at settlement. A stock-tracked
line was debited to inventory when it was received, so its share of the document SHALL clear `GRNI`
rather than an expense account; expense is charged once, when the goods are issued.

The share SHALL be taken per **line account** — the account stamped on the line, falling back to its
budget's — using the same `budget_base_line_amount` basis the budget was cut on, so the stock split
and the expense apportionment always agree by construction. It was previously keyed by the budget's
account, which cannot express a budget whose stock-tracked and expensed lines post to different
accounts.

#### Scenario: A stock purchase settles against GRNI

- **GIVEN** a settled document of a non-accruing type whose only line is a stock-tracked item cut
  against one budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI` for that line's base amount and does not debit the budget's
  expense account

#### Scenario: An accruing stock purchase clears GRNI at approval

- **GIVEN** a document of an accruing vendor type whose only line is a stock-tracked item
- **WHEN** it reaches full approval
- **THEN** the accrual debits `GRNI` and credits `ACCOUNTS_PAYABLE`, and the later payment debits
  the payable rather than `GRNI` a second time

#### Scenario: A chain-settled stock purchase also clears GRNI

- **GIVEN** a stock purchase approved as a `PR` that reserved the budget, paid through a `DISB`
  that references it and whose own lines carry no budget
- **WHEN** the payment is posted
- **THEN** the entry debits `GRNI`, not the expense account — the stock-tracked portion is resolved
  from the charged document's line at the same `line_no`

#### Scenario: A mixed document splits between GRNI and expense

- **GIVEN** a settled purchase with one stock-tracked line and one that is not, charging one budget
- **WHEN** it is posted
- **THEN** the stock-tracked line's share debits `GRNI` and the other line's share debits its own
  stamped account

#### Scenario: A document with no stock lines is unaffected

- **WHEN** a document carries no stock-tracked line
- **THEN** the entry debits the budget's expense account exactly as it did before

#### Scenario: The stock portion never exceeds what was cut

- **GIVEN** a document whose stock-tracked lines total more than the amount cut against their
  account
- **WHEN** its expense side is posted
- **THEN** `GRNI` is debited only up to the amount cut, and no expense line is written for a
  negative remainder

### Requirement: Posting on Stock Movement

The system SHALL treat an approved stock movement as a posting source, producing a balanced
`journal_entry` with `source_type` of `STOCK_TXN` and the movement's id as `source_id`, so the
existing idempotency guarantee on `(company_id, source_type, source_id)` applies unchanged and a
retry never double-posts. Entry amounts SHALL be derived from the movement's `qty` and `unit_cost`,
rounded to the currency's `decimal_places`, with any rounding residual absorbed into the inventory
line so `SUM(debit)` equals `SUM(credit)`. Movements that carry no value — `RESERVE` and `RELEASE`
— SHALL NOT post. A transfer between two warehouses of one company SHALL NOT post either: both
ends resolve to the same `INVENTORY` account, so the entry would net to zero and say nothing the
stock ledger has not already recorded.

#### Scenario: A stock movement posts a balanced entry

- **WHEN** a stock movement of 5 units at unit cost 110 is approved
- **THEN** a `journal_entry` exists for it whose debits and credits both total 550

#### Scenario: Retrying a stock posting does not double-post

- **WHEN** the posting for the same `stock_txn` id is attempted a second time
- **THEN** exactly one `journal_entry` exists for that source

#### Scenario: Reservations produce no entry

- **WHEN** a `RESERVE` or `RELEASE` row is written
- **THEN** no `journal_entry` is created for it

#### Scenario: A receipt capitalizes the asset against GRNI

- **WHEN** 10 units are received at a unit cost of 120
- **THEN** a balanced entry debits `INVENTORY` 1200 and credits `GRNI` 1200

#### Scenario: An intra-company transfer posts nothing

- **WHEN** stock moves between two warehouses of the same company
- **THEN** no `journal_entry` is created, because both ends resolve to the same account

### Requirement: Posting on Approval for Types That Accrue

A document type MAY declare that its expense is recognised at approval. When such a document reaches full approval, the system SHALL post one balanced entry that debits the expense accounts named by the document's `budget_txn` ACTUAL rows, aggregated per account at the locked basis, and credits a payable for the document's company. The posting SHALL run after the approval transaction commits, so a posting failure SHALL be logged and SHALL leave the approval and its budget effect standing. A document of a type that does not declare it SHALL post nothing at approval, exactly as today.

**Which payable** SHALL be derived from the document, not configured: a document carrying a `vendor_id` credits `ACCOUNTS_PAYABLE`, and one without credits `CLAIM_PAYABLE`. An approved obligation to a vendor is a trade payable and the document already says so; a second configuration field would only add a way to record it wrongly.

**Which ACTUAL rows** SHALL depend on the same distinction. A vendor document SHALL take the rows of the settlement it charges — its own, or, when the budget hold belongs to a document further up its `ref_document_id` chain, the nearest ancestor carrying ACTUAL rows — the same walk `Posting on Payment Settlement` makes. A document without a vendor SHALL keep using its own rows: a compensation has no reference chain, and its accrual belongs to the document that was approved. Without the walk a chained purchase finds no rows, accrues nothing, and its payment silently falls back to recognising the expense at payment — the behaviour this requirement exists to replace, failing quietly rather than loudly.

**Input VAT and the stock split** SHALL be posted here rather than at payment, when the document carries a vendor. The entry SHALL debit `VAT_INPUT` for the document's `base_tax_total` when it is non-zero, because the tax point of input VAT is the invoice and not the cash. The stock-tracked portion of the charged amount SHALL debit `GRNI` instead of the expense account, under the rules in `Settling a Stock Purchase Clears GRNI Rather Than Expense`: goods capitalized at receipt are turned into a vendor debt by the invoice, not by the payment. The payable SHALL therefore be credited gross of tax — the same `base_locked` the payment will clear — because that is what is owed.

#### Scenario: An approved claim is recognised

- **GIVEN** a document type that accrues at approval, and a document of that type with no vendor that cut budget against one expense account
- **WHEN** the document reaches full approval
- **THEN** a journal entry exists debiting that expense account and crediting the company's `CLAIM_PAYABLE` account for the same amount

#### Scenario: An approved purchase raises a trade payable

- **GIVEN** a document type that accrues at approval and requires a vendor, and a document of that type carrying a vendor that cut budget against one expense account
- **WHEN** the document reaches full approval
- **THEN** a journal entry exists debiting that expense account and crediting `ACCOUNTS_PAYABLE`

#### Scenario: A chained purchase accrues from its ancestor's cuts

- **GIVEN** a purchase approved as a `PROC` that reserved the budget and a `DISB` referencing it that carries no `budget_txn` ACTUAL of its own
- **WHEN** the `DISB` reaches full approval
- **THEN** the accrual debits the expense accounts named by the ancestor's ACTUAL rows and credits `ACCOUNTS_PAYABLE`, rather than being skipped

#### Scenario: Input VAT is recognised with the invoice

- **GIVEN** an accruing purchase whose expense is 100,000 and whose `base_tax_total` is 7,000
- **WHEN** it reaches full approval
- **THEN** the entry debits expense 100,000 and `VAT_INPUT` 7,000 and credits `ACCOUNTS_PAYABLE` 107,000, and the payment posts no VAT line

#### Scenario: A stock purchase accrues against GRNI

- **GIVEN** an accruing purchase whose only line is a stock-tracked item
- **WHEN** it reaches full approval
- **THEN** the entry debits `GRNI` rather than the expense account, and credits `ACCOUNTS_PAYABLE`

#### Scenario: The debit follows the budget cuts

- **GIVEN** an approved document whose lines cut two different budgets
- **WHEN** the accrual is posted
- **THEN** it carries one debit line per expense account, each for that account's total, and one credit line for the sum

#### Scenario: Types that do not declare it are unaffected

- **WHEN** a document of a type that does not accrue at approval reaches full approval
- **THEN** no journal entry is posted at approval, and any posting on payment settlement happens exactly as before

#### Scenario: A failed posting does not undo the approval

- **GIVEN** a company with no account mapped to the payable the document needs
- **WHEN** a document that accrues reaches full approval
- **THEN** the document stays approved with its budget cut, no entry is written, and the failure is recorded

#### Scenario: The accrual is posted once

- **WHEN** the approval outcome for the same document is delivered twice
- **THEN** exactly one accrual entry exists for it

#### Scenario: A document that cut no budget accrues nothing

- **GIVEN** a document of an accruing type that wrote no `budget_txn` ACTUAL row
- **WHEN** it reaches full approval
- **THEN** no entry is posted, because there is no charged amount to recognise

### Requirement: Open Payables Are Readable

The system SHALL expose a read-only, company-scoped list of open payables, gated by `GL_VIEW`: the
documents that were accrued at approval and have not been paid. Each SHALL carry the kind of payable
it is, who it is owed to, the amount credited to the payable, the invoice date (the accrual's
`entry_date`) and a due date. The read MUST NOT mutate any ledger.

Open payables SHALL be derived, not stored: an accrual entry credited a payable account and no
payment entry exists for the same source. A derived read cannot drift from the journal because it is
read from it.

The read SHALL cover EVERY payable the ledger raises. A payable raised against `CLAIM_PAYABLE` is
owed to a person rather than a vendor, which makes it no less owed — and it is now cleared by the
same payment entry a trade payable is. This read breaks down a balance-sheet figure, and one that
covered a single payable account could not break down the company's payables at all.

The kind SHALL be derived from the account the accrual credited, not from whether the document
carries a vendor. The accrual made that decision and wrote it into the ledger; re-deriving it from
the document would be a second opinion about a fact the entry records.

Each row SHALL name who is owed. For a trade payable that is the document's vendor. For a claim it
is the employee the document relates to, when it names one, and otherwise SHALL be absent rather
than substituted — the person who raised a claim is frequently not the person owed it, and naming
the wrong payee is worse than naming none. The document number SHALL be present in either case.

A payable account that is not mapped for the company SHALL contribute no rows rather than causing
the read to fail: no accrual can have credited an account that does not exist, and a report that
failed on a company with no claims would take the trade ageing down with it.

#### Scenario: An approved, unpaid purchase is listed

- **GIVEN** a document of a vendor type that accrued at approval and has not been paid
- **WHEN** the open-payables read runs for its company
- **THEN** it is listed as a trade payable with its vendor, the accrued amount, its invoice date, and
  a due date that many days later, where the days come from that vendor's `payment_term_days`

#### Scenario: An approved, unpaid claim is listed

- **GIVEN** a document with no vendor that accrued at approval to the claim payable and has not been
  paid
- **WHEN** the read runs
- **THEN** it is listed as a claim payable with the accrued amount and the document number

#### Scenario: A paid purchase drops off

- **WHEN** the payment for an accrued document posts
- **THEN** that document no longer appears on the read

#### Scenario: A paid claim drops off

- **WHEN** the payment for an accrued claim posts
- **THEN** that document no longer appears on the read

#### Scenario: The kinds are distinguishable

- **GIVEN** one open trade payable and one open claim payable
- **WHEN** the read runs
- **THEN** each row states which kind it is, so trade and other payables can be told apart

#### Scenario: A claim names the employee it relates to

- **GIVEN** an open claim payable whose document names a related employee
- **WHEN** the read runs
- **THEN** the row reports that person as who is owed

#### Scenario: A claim with no named person is not attributed to its author

- **GIVEN** an open claim payable whose document names no related employee
- **WHEN** the read runs
- **THEN** who is owed is absent, and the row is still identified by its document number

#### Scenario: A company that has never owed a claim still reads its payables

- **GIVEN** a company with open trade payables and no `CLAIM_PAYABLE` account mapped
- **WHEN** the read runs
- **THEN** the trade payables are returned and the read does not fail

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's open payables are returned, and a request without `GL_VIEW` is rejected
  with 403

### Requirement: Open Payables Are Aged Against The Company's Day

Each open payable SHALL carry the number of days it is overdue and the ageing bucket it falls in —
not yet due, 1–30, 31–60, 61–90, or over 90 — measured from its due date.

The day the ageing is measured against SHALL be the company's calendar day, resolved on the server
from the company's timezone, and SHALL be resolved once per read so that a request spanning midnight
cannot place two payables of the same due date in different buckets.

The bucket SHALL NOT be computed by the client: a due date is a company-day, the viewer's browser
day is not, and a client-side bucket would classify the same payable differently for viewers in
different timezones.

Ageing SHALL be measured from the DUE date rather than the invoice date. A payable on sixty-day
terms is not late on the day it is raised.

A claim payable SHALL be due on the day its obligation was raised — the accrual's `entry_date`.
Payment terms are an arrangement with a supplier, and there is no supplier: a person whose
compensation was approved is owed it now. A claim SHALL NOT be given a default term, which would
report a credit agreement nobody made, and SHALL NOT be left without a due date, which would keep
the company's oldest debts permanently out of every band.

#### Scenario: A payable past its due date is aged

- **GIVEN** an open payable whose due date was forty days ago in the company's timezone
- **WHEN** the read runs
- **THEN** it reports forty days overdue and the 31–60 bucket

#### Scenario: A payable not yet due is not aged into a band

- **GIVEN** an open payable whose due date is in the future
- **WHEN** the read runs
- **THEN** it reports the not-yet-due bucket and no positive days overdue

#### Scenario: A claim ages from the day it was approved

- **GIVEN** an open claim payable whose accrual was dated forty days ago in the company's timezone
- **WHEN** the read runs
- **THEN** it reports forty days overdue, with no term added to its due date

#### Scenario: Two companies in different zones age the same due date on their own day

- **GIVEN** the same due date for payables of two companies whose timezones differ across midnight
- **WHEN** each company's read runs
- **THEN** each is aged against its own company day

### Requirement: The Ageing Summary Is Read From The Server

The system SHALL expose the ageing totals — the amount and count in each bucket — as a
company-scoped read gated by `GL_VIEW`, derived from the same open payables and the same company day
as the list, so the summary and the rows cannot disagree.

The totals SHALL cover every kind of payable, and the summary SHALL additionally report the total
per kind. A reported total answers what the company owes; its composition answers what of. Reporting
only the first leaves the reader unable to separate trade from other payables, and reporting only
the second leaves them adding two figures by hand.

Amounts SHALL be summed as decimal strings, never through a JS number.

#### Scenario: The buckets total what the rows hold

- **GIVEN** open payables spread across several buckets
- **WHEN** the ageing summary is read
- **THEN** each bucket reports the total and count of the payables in it, and their sum equals the
  total of all open payables

#### Scenario: Both kinds are counted in one total

- **GIVEN** an open trade payable and an open claim payable
- **WHEN** the ageing summary is read
- **THEN** the overall total covers both

#### Scenario: The composition is reported beside the total

- **GIVEN** open payables of both kinds
- **WHEN** the ageing summary is read
- **THEN** the total owed per kind is reported, and the two sum to the overall total

#### Scenario: The summary is company-scoped

- **WHEN** a user in company A reads the ageing
- **THEN** no payable of another company contributes to any bucket

### Requirement: Pending Vouchers Are Readable

The system SHALL expose the vouchers awaiting approval for the active company, gated by `GL_VIEW`,
each with its date, memo, total, author, lines, and the step it is waiting on, so an approver can see
what they are being asked to accept and where in the route it sits.

The step SHALL be readable because a voucher can now be waiting on any of several approvals, and
"awaiting approval" without saying whose is an answer that stopped being sufficient when the route
gained more than one step.

#### Scenario: An approver can read what is waiting

- **WHEN** a user holding `GL_VIEW` reads the pending vouchers
- **THEN** each is returned with its date, memo, total, author, lines and current step

#### Scenario: Another company's vouchers are not returned

- **WHEN** the pending vouchers are read
- **THEN** no voucher of another company appears

### Requirement: A Payment Clears Through A Clearing Account To A Bank Account

Recording a payment SHALL credit the `CASH_CLEARING` role, as it does, and SHALL NOT be treated as
the money having left the bank. When the bank confirms that a payment settled, the system SHALL post
a second entry debiting `CASH_CLEARING` and crediting the GL account of the bank account the payment
left from, dated the day the BANK says the money moved.

The confirmation SHALL be idempotent on the payment it confirms, so a confirmation delivered twice
resolves to the entry already written.

A payment SHALL NOT be confirmed twice, and a payment that names no bank account SHALL NOT be
confirmable — there is no account to credit.

#### Scenario: Confirming a payment moves it out of the clearing account

- **GIVEN** a recorded payment crediting the clearing account
- **WHEN** the bank confirms it settled on a date
- **THEN** an entry dated that day debits the clearing account and credits the bank account's GL
  account for the same amount

#### Scenario: A payment is confirmed once

- **WHEN** the same payment is confirmed twice
- **THEN** exactly one clearing entry exists for it

#### Scenario: A payment with no bank account cannot be confirmed

- **GIVEN** a payment that names no bank account
- **WHEN** it is confirmed
- **THEN** it is refused

### Requirement: What Has Not Cleared Is Readable Per Bank Account

The system SHALL expose, per bank account and gated by `GL_VIEW`, the payments recorded against it
that the bank has not confirmed, and their total — the money the books say has left and the bank has
not moved.

The read SHALL be derived from the journal and the payment rows rather than from a stored
reconciliation record: a derived read cannot drift from the journal because it is read from it.

The system SHALL also expose the payments in flight that name NO bank account. They credited the
clearing account like any other payment and belong to no bank account's reconciliation, so without
them the clearing balance could never be explained — and every payment recorded before bank accounts
existed is in that state. Unattributed cash in flight is what a reconciliation must surface, not
hide.

What is outstanding across the bank accounts PLUS what is unattributed SHALL equal the clearing
account's balance, so the answers cannot disagree.

#### Scenario: Unconfirmed payments are listed with their total

- **WHEN** a `GL_VIEW` user reads a bank account's reconciliation
- **THEN** the payments it has not confirmed are listed with their total

#### Scenario: A confirmed payment drops off

- **WHEN** a payment is confirmed
- **THEN** it no longer appears as outstanding for its bank account

#### Scenario: Payments naming no bank account are reported, not hidden

- **GIVEN** a payment recorded with no bank account
- **WHEN** the unattributed payments are read
- **THEN** it is listed with its amount

#### Scenario: The two reads account for the whole clearing balance

- **WHEN** the reconciliation is read
- **THEN** the outstanding across bank accounts plus the unattributed equals the clearing account's
  balance

### Requirement: A Journal Voucher Is Approved Through Its Document's Workflow

A voucher SHALL be approved through the same workflow engine every other document uses, and the
number of approvals it needs SHALL come from the workflow's steps and their amount bands rather than
being fixed at one. Approving SHALL be authorized by `GL_JV_APPROVE`, a code distinct from
`GL_JV_POST`.

The user who submitted a voucher SHALL NOT approve it, directly or as somebody's delegate, whatever
codes they hold (invariant 8). The rule SHALL be enforced where the approval happens, not left to
permission configuration: a control that depends on nobody granting two codes to one user is a
convention, not a control.

The entry SHALL be written only when the LAST applicable step approves. It SHALL be dated the
VOUCHER's entry date rather than any approval date — the voucher states an accounting fact and the
moment a checker reached it is not one — and its author SHALL be the submitter, because an entry is
what its preparer wrote and an approval is a control event about it.

Every action on a voucher SHALL be recorded in the shared approval log, so the record shows each step
rather than only the last decision. Rejecting SHALL post nothing and SHALL leave the voucher readable
with the remark that refused it.

The amount bands SHALL be configuration. A company SHALL be able to change how many approvals a
voucher of a given size needs without a deployment.

#### Scenario: A large voucher needs more approvals than a small one

- **GIVEN** a workflow whose second step engages above a threshold
- **WHEN** a voucher above that threshold is approved once
- **THEN** no entry is written and it waits at the next step

#### Scenario: A small voucher needs only the step that engages for it

- **GIVEN** the same workflow
- **WHEN** a voucher below the threshold is approved once
- **THEN** its entry is written

#### Scenario: An author cannot approve their own voucher

- **GIVEN** a user holding both `GL_JV_POST` and `GL_JV_APPROVE`
- **WHEN** they approve a voucher they submitted
- **THEN** it is refused and no entry is written

#### Scenario: An author's delegate cannot approve it either

- **GIVEN** an active delegation from the voucher's author
- **WHEN** the delegate approves it on the author's behalf
- **THEN** it is refused and no entry is written

#### Scenario: Approving needs its own code

- **WHEN** a user holding `GL_JV_POST` but not `GL_JV_APPROVE` approves a voucher
- **THEN** it is rejected with 403

#### Scenario: The entry carries the voucher's date, not the approval's

- **GIVEN** a voucher dated in a month earlier than today, in an open period
- **WHEN** its route completes
- **THEN** the entry's date is the voucher's

#### Scenario: The entry records the person who prepared it

- **WHEN** a voucher submitted by one user is approved by others
- **THEN** the entry's author is the submitter, and the approval log names every approver

#### Scenario: A rejection records why and posts nothing

- **WHEN** a voucher is rejected with a remark
- **THEN** no entry exists for it and the remark is readable on its approval log

### Requirement: A Voucher Still In Approval Can Be Cancelled By Its Author

The system SHALL let the user who raised a voucher cancel it while it is still in approval,
recording the cancellation and posting nothing. A voucher whose route has completed, or which has
been rejected or already cancelled, SHALL NOT be cancellable.

Cancellation exists because a voucher can become unapprovable through no fault of its approvers: one
dated in a month that closes before the route completes can never be posted, and without cancellation
it would sit in the queue for good. An approver who wants a voucher gone rejects it with a remark, on
the record; cancellation is for the author's own second thoughts.

#### Scenario: An author cancels their own voucher in approval

- **GIVEN** a voucher awaiting an approval step
- **WHEN** its author cancels it
- **THEN** it is recorded as cancelled, no entry exists, and it no longer awaits approval

#### Scenario: Another user cannot cancel it

- **WHEN** a user who did not raise the voucher cancels it
- **THEN** it is refused

#### Scenario: A voucher already posted cannot be cancelled

- **GIVEN** a voucher whose route completed
- **WHEN** its author cancels it
- **THEN** it is refused and the entry stands

### Requirement: Expenses Skipped For Want Of A Budget Are Readable

The system SHALL expose a read-only, company-scoped read of the postings recorded `SKIPPED` whose
document has no `ACTUAL` budget transaction — the expenses that were never written to the ledger
because nothing had been charged to a budget.

Each SHALL carry its source type and id, the document it belongs to and that document's number,
status and total, so that what is missing from the books can be identified and decided about.

The read exists because the budget-to-ledger reconciliation cannot see this case. A document with no
budget produces no `ACTUAL` and no journal entry, so both books report zero, the difference is zero,
and a reconciliation without this read would certify the books at the exact moment an entire expense
is absent from both. A reconciliation that cannot see its own worst failure is worse than none,
because it is believed.

This read SHALL be separate from the undelivered-postings read and SHALL NOT change it. `SKIPPED`
stays terminal there for the reason it always did: the period close asks that read whether a month is
drained, and a month must not be blocked by a posting the engine already decided not to write. The
two reads ask different questions — one asks what the engine still owes, this asks what the engine
decided not to say.

The classification SHALL be derived at read time from the absence of `ACTUAL` rows, rather than
stored when the posting is skipped. `gl_posting_attempt` records no reason, and two different
outcomes are recorded identically — a posting skipped because its amount was zero, and one skipped
because there was no expense side to post. Deriving keeps this read from writing anything and uses
the same rule the posting engine used.

The read SHALL be permission-gated and SHALL NOT gate, block or delay a period close.

#### Scenario: A document with no budget appears

- **GIVEN** a settled document whose lines charged no budget, whose posting was recorded `SKIPPED`
- **WHEN** the read runs for that company
- **THEN** the document is listed with its number and total

#### Scenario: A posting skipped because there was nothing to post does not appear

- **GIVEN** a source recorded `SKIPPED` whose document did charge a budget
- **WHEN** the read runs
- **THEN** it is absent — the skip was an answer, not a missing expense

#### Scenario: The undelivered read is unchanged

- **WHEN** the undelivered-postings read runs
- **THEN** `SKIPPED` sources are still absent from it, and a period close is unaffected by anything
  this read returns

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** the read runs for company A
- **THEN** no skipped posting of another company is returned, and a request without the required
  permission is rejected with 403

### Requirement: A Posting Stranded For Want Of A Budget's GL Account Names It

A posting that cannot proceed because a charged `budget` has no `account_id` SHALL record a
`last_error` naming the budget by its `budget_node.code` and the source document by its
`document.doc_no`, and saying that the account is set on the budget.

Identifiers alone are not a message. `Budget 8ad37658-… has no account_id; cannot post document
dd224a4d-…` cannot be searched for, cannot be recognised, and does not say what to do — so the row
sits on the undelivered read until someone reconstructs both ids by hand.

This changes what the failure says, not when it is raised: the expense side is still taken from
`budget.account_id`, and a budget without one is still a failure and not a skip.

#### Scenario: The failure names the budget and the document

- **GIVEN** a settled document charging a budget on node `1.101` whose `account_id` is null
- **WHEN** the posting is attempted
- **THEN** the row is `FAILED` and its `last_error` contains `1.101` and the document's `doc_no`,
  and states that the account is set on the budget

#### Scenario: The accrual path says the same thing

- **GIVEN** a fully approved document of an accruing type charging a budget with no `account_id`
- **WHEN** the accrual posting is attempted
- **THEN** its `last_error` names the budget's `budget_node.code` and the document's `doc_no` the
  same way

### Requirement: Naming A Budget's GL Account Re-Queues What It Blocked

When a `budget` gains an `account_id` where it had none, the system SHALL return every
`gl_posting_attempt` blocked by that budget to `PENDING` with `attempts` reset, so the next sweep
attempts them. `last_error` SHALL be retained, so the record of what went wrong survives.

The reset SHALL share the budget update's unit of work, so a budget update that fails cannot leave
postings re-queued for an account that was never saved.

Only a transition from **no account** to **an account** SHALL trigger it. Changing one account to a
different one SHALL NOT: those postings were never blocked, and re-posting a settled source is
refused by `journal_entry`'s uniqueness anyway.

This SHALL NOT require `GL_POST_RETRY`. The bound on retries makes a posting that has exhausted its
attempts unpostable until something re-queues it, and requiring a second permission on a second
screen is what left every stranded posting parked: the holder of `BUDGET_MANAGE` who fixes the cause
is the one who should clear the effect. `A Failed Posting Can Be Re-Queued` is unchanged and remains
the path for every other cause.

#### Scenario: Naming the account revives the parked postings

- **GIVEN** two `FAILED` postings that exhausted their attempts, both blocked by one budget with no
  `account_id`
- **WHEN** a `BUDGET_MANAGE` user sets that budget's `gl_account` to a postable account
- **THEN** both rows are `PENDING` with `attempts` reset and their `last_error` retained, and the
  next sweep posts them

#### Scenario: Postings blocked by a different budget are left alone

- **GIVEN** two blocked postings, each blocked by a different account-less budget
- **WHEN** one of the two budgets is given an account
- **THEN** only the postings that budget blocked are re-queued; the other stays `FAILED`

#### Scenario: Changing an existing account re-queues nothing

- **GIVEN** a budget that already names an account, and no posting blocked by it
- **WHEN** a `BUDGET_MANAGE` user changes it to a different postable account
- **THEN** no `gl_posting_attempt` row changes status

#### Scenario: A failed budget update re-queues nothing

- **GIVEN** a budget with no account and a posting blocked by it
- **WHEN** an update naming an account is rejected before it commits
- **THEN** the posting is still `FAILED` and the budget still names no account

#### Scenario: A posting failed for another reason is not revived

- **GIVEN** a `FAILED` posting whose cause was an unmapped system account role, on a document
  charging a budget with no `account_id`
- **WHEN** that budget is given an account
- **THEN** the row is re-queued only if the budget was what blocked it, and a posting that fails
  again for the unmapped role is recorded `FAILED` again with its own message

### Requirement: The Expense Side Is Taken From The Account Each Line Named

The expense side of a settlement and of an approval accrual SHALL be keyed by the account stamped on
each line (`document_line.account_id`), not by the account on the budget the line charged. One budget
MAY therefore post to several accounts, and several budgets MAY still post to one.

Each `budget_txn` ACTUAL row SHALL be apportioned across the lines charging that budget, pro rata by
`budget_base_line_amount` — the basis the budget was reserved and settled on, so the weights and the
amount being split are the same number. Rounding SHALL be to the currency's scale, and the residue
SHALL be given to the largest line, so the apportioned shares sum to the ACTUAL amount exactly and
the result does not depend on the order lines are read in.

Where the lines charging a budget carry no `budget_base_line_amount` at all, the whole ACTUAL amount
SHALL be posted to that budget's own account, which is the case a spend-history import produces.

Every entry SHALL remain balanced, and its expense side SHALL total exactly what the budget was cut
by — this changes which accounts are debited, never how much.

#### Scenario: One budget posting to two accounts

- **GIVEN** a settled document charging one budget through two lines of 600 and 400 at the budget
  basis, stamped with accounts `5210` and `5300`, settled ACTUAL 1000
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits `5210` 600 and `5300` 400, and remains balanced

#### Scenario: Two budgets sharing one account still post once

- **GIVEN** a settled document charging two budgets through two lines both stamped with account
  `5210`, ACTUAL 300 and 700
- **WHEN** `payment.settled` is handled
- **THEN** the entry carries one debit of 1000 on `5210`

#### Scenario: A partial settlement is apportioned pro rata

- **GIVEN** a budget reserved through lines of 600 and 400, settled with ACTUAL 500 and the
  remainder released
- **WHEN** the settlement is posted
- **THEN** the accounts are debited 300 and 200, totalling the ACTUAL amount

#### Scenario: The residue of a rounding leaves the total exact

- **GIVEN** a budget with ACTUAL 100 apportioned across three equal lines in a currency with no
  minor unit
- **WHEN** the settlement is posted
- **THEN** the debits sum to exactly 100, with the odd unit on the largest line

#### Scenario: Lines carrying no budget basis post to the budget's account

- **GIVEN** an imported spend whose lines carry no `budget_base_line_amount`
- **WHEN** it is posted
- **THEN** the whole ACTUAL amount debits the budget's own account

### Requirement: A Line With No Stamped Account Posts To Its Budget's

Where a line carries no `document_line.account_id`, the posting SHALL take that line's account from
the budget it charged, exactly as it did before the stamp existed.

This is not a temporary migration step. Every document submitted before this change has no stamp;
`spend-import` writes lines directly; and a chain settled through an ancestor reads that ancestor's
lines, which may be older than the stamp. A null therefore means "post the old way", permanently.

Only when a line has neither a stamped account nor a budget account SHALL the posting fail, with the
message and the recorded `blocked_by_budget_id` cause it already carries.

#### Scenario: A document submitted before the stamp posts unchanged

- **GIVEN** a settled document whose lines carry no `account_id` and whose budget names account
  `5210`
- **WHEN** it is posted
- **THEN** the entry debits `5210` exactly as it did before this change

#### Scenario: Stamped and unstamped lines on one document

- **GIVEN** a document with one line stamped `5300` and one carrying no stamp, charging a budget
  whose account is `5210`
- **WHEN** it is posted
- **THEN** the stamped line's share debits `5300` and the unstamped line's share debits `5210`

#### Scenario: Neither account is a failure, not a skip

- **GIVEN** a line with no stamped account charging a budget with no `account_id`
- **WHEN** it is posted
- **THEN** the attempt is `FAILED`, naming the budget and the document, and records that budget in
  `blocked_by_budget_id`
