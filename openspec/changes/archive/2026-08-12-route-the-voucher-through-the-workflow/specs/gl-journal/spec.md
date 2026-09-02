# gl-journal

## REMOVED Requirements

### Requirement: A Journal Voucher Is Posted By Somebody Other Than Its Author

**Reason**: it described maker-checker as the whole control — one approver, hand-written in the GL
module, because `approval_log` requires a document and a voucher was not one. A voucher is a document
now, so the number of approvals comes from the workflow's amount bands instead of being fixed at one.
Replaced by *A Journal Voucher Is Approved Through Its Document's Workflow*, which keeps every rule
this one stated and adds the ladder.

### Requirement: A Pending Voucher Can Be Withdrawn By Its Author

**Reason**: withdrawal was a voucher-only status, needed because the voucher held its own state.
The document holds the state now, and taking one back is cancelling the document. Replaced by
*A Voucher Still In Approval Can Be Cancelled By Its Author*, which says the same thing about the
record that now carries it.

## MODIFIED Requirements

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

## ADDED Requirements

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
