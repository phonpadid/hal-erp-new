## ADDED Requirements

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

## MODIFIED Requirements

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
