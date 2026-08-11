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

- **WHEN** a payment settlement, an approval accrual, a claim settlement or a stock movement posts
- **THEN** its entry was written through the one constructor, with its balance asserted, its
  `entry_date` resolved in the posting company's timezone, and that day checked against the
  company's accounting periods

### Requirement: Entry Date Is The Posting Company's Own Calendar Day

Every `journal_entry.entry_date` SHALL be the calendar day the posted event fell on **in the posting
company's own `company.timezone`**, and SHALL NOT be derived from the UTC day of that instant. This
SHALL hold for every posting path — payment settlement, approval accrual, claim settlement, stock
movement, and any path added later — because `entry_date` is the only field deciding which period a
figure belongs to, and `financial-reports` ranges the trial balance, account ledger, income
statement and balance sheet over it.

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

- **WHEN** a payment settlement, an approval accrual, a claim settlement and a stock movement are
  each posted for the same company
- **THEN** all four entries derive `entry_date` in that company's timezone, by the same rule

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
`CLAIM_PAYABLE`, and `ACCOUNTS_PAYABLE` — never by a hardcoded account code (invariant 7). A role that
is unmapped, inactive, or in another company SHALL make the posting a logged failure, not a crash.

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

### Requirement: Every Posting Attempt Records Its Outcome

The system SHALL record the outcome of every posting attempt in a `gl_posting_attempt` row, one per
`(company_id, source_type, source_id)` — the same key `journal_entry` is unique on — carrying a
`status` of `PENDING`, `POSTED`, `SKIPPED` or `FAILED`, an `attempts` count and a `last_error`.
`gl_posting_attempt` is a work record, not a ledger: its rows change status in place, and it SHALL
NOT be treated as append-only. `journal_entry` remains the authority on whether a posting happened;
the row records what was tried and what went wrong.

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

### Requirement: Undelivered Postings Are Queryable

The system SHALL expose a read-only, company-scoped query, gated by `GL_VIEW`, returning the
postings that are owed and undelivered: sources having no `journal_entry` and no
`gl_posting_attempt` row in a terminal state (`POSTED` or `SKIPPED`). Each SHALL carry its source
type and id, its attempt count, its last error and its status. The read MUST NOT mutate any ledger.

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

The system SHALL let a user holding `GL_JV_POST` write a journal entry directly: an `entry_date`, a
memo, and two or more lines, each naming a GL account and exactly one non-zero side. This is the
entry no event produces — depreciation, an accrual at period close, prepaid amortisation, payroll,
opening balances carried in from a previous system, and the correction of a posting that was wrong.

A voucher SHALL be subject to every rule an automatic posting obeys, because it SHALL be written
through the same constructor: balanced or refused, dated in the company's own calendar day, refused
when that day falls in a closed accounting period, and append-only once written. Each line's account
SHALL be resolved through the chart-of-accounts resolver, so an account that is missing, inactive,
non-postable, or another company's is rejected (invariant 1).

The entry itself SHALL be the voucher — there SHALL be no separate voucher header. `journal_entry`
already carries the date, memo, author and lines a voucher consists of, and a second table would
duplicate it with an opportunity to disagree. A voucher SHALL be distinguishable by its
`source_type`, which the journal read already exposes.

A voucher SHALL carry a caller-supplied identity when one is given, so that a retried request
resolves to the same entry rather than a second one, using the uniqueness `journal_entry` already
has on `(company, source_type, source_id)`. When none is given the system SHALL generate one, and
the request SHALL NOT be idempotent — a caller that did not ask for that protection does not get it.

A voucher SHALL NOT write any `budget_txn` (invariants 3 and 6): an accountant correcting the ledger
is not adjusting anyone's budget. A voucher SHALL NOT be recorded as a posting attempt, because it
is a person's synchronous act rather than work the system owes itself, and the period close reads
that record to decide whether a month is drained.

#### Scenario: A balanced voucher is posted

- **GIVEN** a `GL_JV_POST` user in a company with two active postable accounts
- **WHEN** they post a voucher debiting one 5,000 and crediting the other 5,000
- **THEN** a `journal_entry` exists with those two lines, its `source_type` marking it as manual and
  its author recorded

#### Scenario: An unbalanced voucher is refused

- **WHEN** a voucher's debits and credits differ
- **THEN** it is rejected and no entry and no line is written

#### Scenario: A voucher cannot name an unusable account

- **WHEN** a voucher line names an account that is inactive, non-postable, or belongs to another
  company
- **THEN** it is rejected naming that account, and no entry is written

#### Scenario: A voucher cannot enter a closed period

- **GIVEN** a closed accounting period covering a date
- **WHEN** a voucher is posted for that date
- **THEN** it is rejected naming the period, and no entry is written

#### Scenario: A retried voucher does not post twice

- **WHEN** the same voucher is posted twice with the same caller-supplied id
- **THEN** exactly one entry exists for it

#### Scenario: Posting a voucher is permission-gated and company-scoped

- **WHEN** a request without `GL_JV_POST` posts a voucher
- **THEN** it is rejected with 403, and a voucher posted by a permitted user belongs to that user's
  active company

#### Scenario: A voucher touches no budget

- **WHEN** a voucher is posted against an account that a budget also uses
- **THEN** no `budget_txn` row is written and no budget balance changes

### Requirement: Any Entry Can Be Reversed, Once

The system SHALL let a user holding `GL_JV_POST` reverse any `journal_entry` of their company by
writing a new entry carrying the same lines with debit and credit exchanged. Corrections are
reversing entries, never edits (invariant 2), and this is the operation that makes that rule usable
rather than merely restrictive.

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
- **WHEN** it is reversed
- **THEN** a new entry exists crediting the first 1,000 and debiting the second 1,000, and the two
  net to zero across both accounts

#### Scenario: An automatic posting can be reversed too

- **GIVEN** a payment settlement entry the engine posted
- **WHEN** a `GL_JV_POST` user reverses it
- **THEN** the reversal is written, and the original entry is unchanged

#### Scenario: An entry is reversed at most once

- **WHEN** an entry that has already been reversed is reversed again
- **THEN** the request is rejected and no second reversal exists

#### Scenario: A reversal is dated when it was decided

- **GIVEN** an entry dated inside a closed period
- **WHEN** it is reversed with no date given
- **THEN** the reversal is dated today and is accepted, rather than being dated into the closed
  period and refused

#### Scenario: Reversing is permission-gated and company-scoped

- **WHEN** a request without `GL_JV_POST`, or one naming another company's entry, reverses it
- **THEN** it is rejected and no entry is written

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

The system SHALL post the stock-tracked portion of a purchase to the `GRNI` account instead of to
the budget's expense account. Goods that were capitalized into `INVENTORY` when they were received
are expensed once, when they are issued; charging expense again would put the same purchase through
profit and loss twice. The stock-tracked portion SHALL be computed from the document's own lines
whose `item.is_stock_tracked` is true, at the same `budget_base_line_amount` basis the budget was
cut on, so the two figures always agree, and it SHALL NOT exceed what was actually cut on that
account. Lines whose item is not stock-tracked SHALL continue to debit the budget's expense account.

The split SHALL be applied **wherever the expense side of that purchase is posted**: at the approval
accrual for a document whose type accrues, and at the payment settlement for one whose type does
not. It is a property of what was bought, not of when the entry happens.

The account a stock-tracked line belongs to SHALL be resolved from the document whose `budget_txn`
ACTUAL rows are being posted — the document's own, or the reference-chain ancestor the expense side
was already taken from — matched by `line_no`, whenever the posting document's own lines carry no
budget. A settlement type is ordinarily not budget-controlled, so its lines are stamped with no
budget and only the charged document's lines carry one. Resolving from that same document is what
makes the stock figure and the cut agree by construction rather than by coincidence: they are read
from one source, not from two that currently match. Without this the portion resolves to nothing on
every chained purchase and the whole amount debits expense — the outcome this requirement exists to
prevent, in the shape most purchases actually have.

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

- **GIVEN** a document with one stock-tracked line and one untracked line on the same budget
- **WHEN** its expense side is posted
- **THEN** `GRNI` is debited for the stock-tracked line's base amount and the expense account is
  debited for the remainder

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
documents that were accrued at approval and whose payment has not posted. Each SHALL carry its
vendor, the amount credited to the payable, the invoice date (the accrual's `entry_date`) and a due
date derived as that date plus `vendor.payment_term_days`. The read MUST NOT mutate any ledger.

Open payables SHALL be derived, not stored: an accrual entry exists and no settlement entry does for
the same source. `payment.document_id` is unique — a document is paid exactly once — so a payable is
open or it is not, and there is no partial state a stored subledger would be needed to hold. A
derived read cannot drift from the journal because it is read from it.

A payable raised against `CLAIM_PAYABLE` rather than `ACCOUNTS_PAYABLE` SHALL be excluded: it is
owed to a person, not a vendor, and it is cleared by a recorded settlement rather than by a payment.

#### Scenario: An approved, unpaid purchase is listed

- **GIVEN** a document of a vendor type that accrued at approval and has not been paid
- **WHEN** the open-payables read runs for its company
- **THEN** it is listed with its vendor, the accrued amount, its invoice date, and a due date that
  many days later, where the days come from that vendor's `payment_term_days`

#### Scenario: A paid purchase drops off

- **WHEN** the payment for an accrued document posts
- **THEN** that document no longer appears on the read

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's open payables are returned, and a request without `GL_VIEW` is rejected
  with 403

#### Scenario: A claim is not a payable

- **GIVEN** an accrued document with no vendor, whose payable is `CLAIM_PAYABLE`
- **WHEN** the read runs
- **THEN** it is not listed


### Requirement: Recording A Settlement Clears The Payable Its Accrual Raised

The system SHALL post one balanced entry when a settlement is recorded for a document that accrued at approval: debit the `CLAIM_PAYABLE` account of the document's company for the accrued amount, and credit the account resolved from the role the settlement type names — `CASH` crediting `CASH_CLEARING`. The entry SHALL be idempotent per source, keyed distinctly from the accrual so both can exist for one document. The posting SHALL happen in the same transaction as the settlement it records: unlike the accrual, which must not disturb an approval already granted, nothing here has been granted yet, and a settlement whose ledger effect failed SHALL NOT be recorded at all.

A settlement SHALL NOT be recorded for a document that has no accrual entry, because there would be no payable to clear.

#### Scenario: A cash settlement clears the payable

- **GIVEN** a document accrued at approval for 4,500, debiting an expense account and crediting `CLAIM_PAYABLE`
- **WHEN** a `CASH` settlement is recorded for it
- **THEN** a balanced entry debits `CLAIM_PAYABLE` 4,500 and credits `CASH_CLEARING` 4,500, leaving the payable net of that claim at zero

#### Scenario: The ledger failing takes the settlement with it

- **GIVEN** a company with no account mapped to `CASH_CLEARING`
- **WHEN** a settlement is recorded
- **THEN** the request fails, and no settlement row, attachment, or journal entry exists afterwards

#### Scenario: Accrual and settlement coexist on one document

- **GIVEN** a document that has been accrued and then settled
- **WHEN** its journal entries are read
- **THEN** two entries exist for it under different source keys, and together they leave the expense recognised once and the payable cleared

#### Scenario: Settling is posted once

- **WHEN** a settlement is recorded and the posting is attempted again for the same document
- **THEN** exactly one settlement entry exists

#### Scenario: Nothing to clear

- **GIVEN** a document with no accrual entry
- **WHEN** a settlement is recorded for it
- **THEN** the request is rejected and no entry is written

#### Scenario: The budget is untouched

- **WHEN** a settlement is recorded
- **THEN** no `budget_txn` row is written — the budget settled to `ACTUAL` when the document was approved, and paying it out settles nothing further
