# gl-journal

## MODIFIED Requirements

### Requirement: A Person Can Post A Journal Voucher

The system SHALL let a user holding `GL_JV_POST` submit a journal voucher: an `entry_date`, a memo,
and two or more lines, each naming a GL account and exactly one non-zero side. This is the entry no
event produces — depreciation, an accrual at period close, prepaid amortisation, payroll, opening
balances carried in from a previous system, and the correction of a posting that was wrong.

Submitting SHALL record the voucher and SHALL NOT write to the ledger. The entry SHALL be written
when the voucher is approved — see *A Journal Voucher Is Posted By Somebody Other Than Its Author*.

A voucher SHALL be subject to every rule an automatic posting obeys, because it SHALL be written
through the same constructor: balanced or refused, dated in the company's own calendar day, refused
when that day falls in a closed accounting period, and append-only once written. Each line's account
SHALL be resolved through the chart-of-accounts resolver, so an account that is missing, inactive,
non-postable, or another company's is rejected (invariant 1). Balance and account validity SHALL be
checked at submit as well, so a voucher that could never post is refused before a second person is
asked to look at it.

A voucher SHALL be held in its own record until it is approved, carrying its date, memo, lines,
status, author and approver. This record is NOT a duplicate of the entry: it exists to hold a
voucher that is not yet an entry, which an append-only ledger cannot do. Once approved, the entry
SHALL be created from it and never edited, so the two cannot disagree. A voucher SHALL remain
distinguishable in the journal by its `source_type`, which the journal read already exposes.

A voucher's identity SHALL be the entry's `source_id`, so approving the same voucher twice resolves
to the entry already written, using the uniqueness `journal_entry` has on
`(company, source_type, source_id)`.

A voucher SHALL NOT write any `budget_txn` (invariants 3 and 6): an accountant correcting the ledger
is not adjusting anyone's budget. A voucher SHALL NOT be recorded as a posting attempt, because it
is a person's synchronous act rather than work the system owes itself, and the period close reads
that record to decide whether a month is drained.

#### Scenario: A balanced voucher is posted on approval

- **GIVEN** a `GL_JV_POST` user in a company with two active postable accounts
- **WHEN** they submit a voucher debiting one 5,000 and crediting the other 5,000, and another user
  approves it
- **THEN** a `journal_entry` exists with those two lines, its `source_type` marking it as manual and
  its author recorded

#### Scenario: Submitting alone writes no entry

- **WHEN** a voucher is submitted and not yet approved
- **THEN** no `journal_entry` and no `journal_line` exists for it

#### Scenario: An unbalanced voucher is refused

- **WHEN** a voucher's debits and credits differ
- **THEN** it is rejected at submit and no voucher, no entry and no line is written

#### Scenario: A voucher cannot name an unusable account

- **WHEN** a voucher line names an account that is inactive, non-postable, or belongs to another
  company
- **THEN** it is rejected naming that account, and no entry is written

#### Scenario: A voucher cannot enter a closed period

- **GIVEN** a closed accounting period covering a date
- **WHEN** a voucher for that date is approved
- **THEN** it is rejected naming the period, and no entry is written

#### Scenario: A retried approval does not post twice

- **WHEN** the same voucher is approved twice
- **THEN** exactly one entry exists for it

#### Scenario: Submitting a voucher is permission-gated and company-scoped

- **WHEN** a request without `GL_JV_POST` submits a voucher
- **THEN** it is rejected with 403, and a voucher submitted by a permitted user belongs to that
  user's active company

#### Scenario: A voucher touches no budget

- **WHEN** a voucher is approved against an account that a budget also uses
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

## ADDED Requirements

### Requirement: A Journal Voucher Is Posted By Somebody Other Than Its Author

Approving a voucher SHALL be authorized by `GL_JV_APPROVE`, a code distinct from `GL_JV_POST`, and
the user who submitted a voucher SHALL NOT approve it — whatever codes they hold.

The rule SHALL be enforced where the approval happens, not left to permission configuration: a
control that depends on nobody granting two codes to one user is a convention, not a control
(invariant 8).

Approval SHALL post the entry through the same constructor every other entry uses, dated the
VOUCHER's entry date rather than the date of approval — the voucher states an accounting fact and
the moment a checker reached it is not one.

Rejecting a voucher SHALL require a reason, SHALL post nothing, and SHALL leave the voucher
readable with that reason.

#### Scenario: An author cannot approve their own voucher

- **GIVEN** a user holding both `GL_JV_POST` and `GL_JV_APPROVE`
- **WHEN** they approve a voucher they submitted
- **THEN** it is refused and no entry is written

#### Scenario: A second person approves it

- **GIVEN** a voucher submitted by one user
- **WHEN** another user holding `GL_JV_APPROVE` approves it
- **THEN** the entry is written and the voucher records who approved it

#### Scenario: Approving needs its own code

- **WHEN** a user holding `GL_JV_POST` but not `GL_JV_APPROVE` approves a voucher
- **THEN** it is rejected with 403

#### Scenario: The entry carries the voucher's date, not the approval's

- **GIVEN** a voucher dated in a month earlier than today, in an open period
- **WHEN** it is approved
- **THEN** the entry's date is the voucher's

#### Scenario: A rejection records why and posts nothing

- **WHEN** a voucher is rejected with a reason
- **THEN** no entry exists for it and the reason is readable on the voucher

#### Scenario: A rejection without a reason is refused

- **WHEN** a voucher is rejected with no reason
- **THEN** it is refused and the voucher stays pending

#### Scenario: The entry records the person who prepared it

- **WHEN** a voucher submitted by one user is approved by another
- **THEN** the entry's author is the submitter, and the voucher records both names

### Requirement: A Pending Voucher Can Be Withdrawn By Its Author

The system SHALL let the user who submitted a pending voucher withdraw it, recording that it was
withdrawn and posting nothing. A voucher that has been approved, rejected or already withdrawn SHALL
NOT be withdrawable.

Withdrawal exists because a voucher can become unapprovable through no fault of the checker: one
dated in a month that closes before they reach it can never be approved, and without withdrawal it
would sit in the queue for good. A checker who wants a voucher gone rejects it with a reason, on the
record; withdrawal is for the author's own second thoughts.

#### Scenario: An author withdraws their own pending voucher

- **GIVEN** a pending voucher
- **WHEN** its submitter withdraws it
- **THEN** it is recorded as withdrawn, no entry exists, and it no longer awaits approval

#### Scenario: Another user cannot withdraw it

- **WHEN** a user who did not submit the voucher withdraws it
- **THEN** it is refused

#### Scenario: A voucher already decided cannot be withdrawn

- **GIVEN** a voucher that was approved
- **WHEN** its submitter withdraws it
- **THEN** it is refused and the entry stands

### Requirement: Pending Vouchers Are Readable

The system SHALL expose the vouchers awaiting approval for the active company, gated by `GL_VIEW`,
each with its date, memo, total, author and lines, so a checker can see what they are being asked to
accept.

#### Scenario: A checker can read what is waiting

- **WHEN** a user holding `GL_VIEW` reads the pending vouchers
- **THEN** each is returned with its date, memo, total, author and lines

#### Scenario: Another company's vouchers are not returned

- **WHEN** the pending vouchers are read
- **THEN** no voucher of another company appears
