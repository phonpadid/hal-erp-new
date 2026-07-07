## ADDED Requirements

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

### Requirement: Posting on Payment Settlement

The system SHALL post one balanced journal entry per settled document when `payment.settled`
occurs. The entry SHALL debit the expense account(s) of the budget(s) the document charged (via
`budget.account_id`) at the locked base amount, credit the cash-clearing account at the actual
base amount, and post the FX difference (`payment.fx_delta`) to the realized FX gain or loss
account. The posting SHALL run after the payment transaction has committed and SHALL NOT write
any `budget_txn` (invariant 6 — FX goes to accounting, not the budget).

#### Scenario: Settlement with no FX difference

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000 charged to one
  budget whose account is an expense account
- **WHEN** `payment.settled` is handled
- **THEN** a balanced entry is posted: debit the expense account 100000 and credit the
  cash-clearing account 100000, with no FX line

#### Scenario: Settlement with an FX loss

- **GIVEN** a settled disbursement with `base_locked` 100000 and `base_actual` 102000
  (`fx_delta` +2000, kind LOSS)
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits the expense account 100000 and the FX-loss account 2000, and
  credits the cash-clearing account 102000 (Σdebit = Σcredit = 102000)

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

The system SHALL resolve the cash-clearing and FX gain/loss accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, and
`FX_LOSS` — never by a hardcoded account code (invariant 7). A role that is unmapped, inactive,
or in another company SHALL make the posting a logged failure, not a crash.

#### Scenario: Roles resolve to the company's mapped accounts

- **WHEN** the engine needs the cash-clearing or FX account for a company
- **THEN** it uses the account mapped to that role for that company

#### Scenario: A missing role mapping fails the posting only

- **WHEN** a required role has no active mapping for the company
- **THEN** the posting is skipped and logged, and the payment flow is unaffected

### Requirement: Authorized, Company-Scoped Journal Read

The system SHALL expose a read-only journal query (entries with their balanced lines) gated by
`GL_VIEW`, scoped to the caller's active company, and it MUST NOT mutate any ledger. There is
no create/update/delete endpoint for journal entries — they are produced only by the posting
engine.

#### Scenario: Reading the journal is permission-gated

- **WHEN** a request without `GL_VIEW` queries the journal
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: The journal read is company-scoped and read-only

- **WHEN** a `GL_VIEW` user in company A reads the journal
- **THEN** only company A's entries are returned and nothing is written
