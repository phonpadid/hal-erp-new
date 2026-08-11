## ADDED Requirements

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

## MODIFIED Requirements

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
