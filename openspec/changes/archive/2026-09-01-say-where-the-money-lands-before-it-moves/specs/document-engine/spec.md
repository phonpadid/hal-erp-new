## ADDED Requirements

### Requirement: A Document Charging A Budget With No GL Account Cannot Be Submitted

Submit SHALL refuse a document whose lines charge a `budget` whose `account_id` is null, and the
refusal SHALL name the offending line, the budget's `budget_node.code` and `budget_node.name`, and
where the account is set.

The check SHALL read `budget.account_id` — the column the ledger debits — and SHALL NOT accept a
non-empty `budget.gl_account` in its place: an unresolved code is the state the posting dies on.

It SHALL run in the same enablement pass that re-validates each line's budget for `status =
'ACTIVE'`, which is after the draft may be incomplete and **before** any `budget_txn` is written, so
a refused submit leaves the document `DRAFT` with nothing reserved and nothing to unwind
(invariant: reserve → actual → release never sees a partial state).

Without this the budget is reserved, cut to ACTUAL at final approval and paid before anyone learns
the spend cannot reach the ledger — at which point the failure is a parked `gl_posting_attempt` that
the people who can read it cannot act on.

The refusal SHALL apply to any document whose lines charge a budget, whatever the type's
`post_action`: the posting reads `budget.account_id` for the settlement of any charged budget, not
only for one kind of document.

#### Scenario: Submit is refused when a charged budget names no account

- **GIVEN** a `DRAFT` document with a line charging an `ACTIVE` budget whose `account_id` is null
- **WHEN** the author submits it
- **THEN** submit is rejected, the message names the line and the budget's `budget_node.code` and
  `budget_node.name`, and says where the account is set

#### Scenario: A refused submit reserves nothing

- **GIVEN** the document above
- **WHEN** submit is refused
- **THEN** the document is still `DRAFT` and no `budget_txn` row was written for it
- **AND** its `doc_no`, issued when the draft was created, is unchanged — the refusal neither
  consumes nor releases a number

#### Scenario: A budget carrying an unresolved account code is refused

- **GIVEN** a line charging a budget whose `gl_account` is non-empty but whose `account_id` is null
- **WHEN** the author submits
- **THEN** submit is refused, because the ledger debits `account_id` and there is none

#### Scenario: A document whose charged budgets all name accounts submits

- **GIVEN** a `DRAFT` document whose every budget-charging line charges a budget with an
  `account_id`
- **WHEN** the author submits it
- **THEN** submit proceeds and the budget is reserved as before

#### Scenario: A line charging no budget is not refused by this rule

- **GIVEN** a zero-amount line that charges no budget, on a type that does not require a budget
- **WHEN** the author submits
- **THEN** this rule raises no refusal, because there is no budget whose account could be missing

#### Scenario: The refusal is raised however the type posts

- **GIVEN** two documents charging the same account-less budget, one of a type whose `post_action`
  is `CUT_BUDGET` and one of a type that accrues on approval
- **WHEN** each is submitted
- **THEN** both are refused, because both settle against `budget.account_id`
