## MODIFIED Requirements

### Requirement: Submit Stamps The Account Each Line's Spending Will Post To

Submit SHALL resolve an expense account for every line carrying a positive amount and stamp it on
that line as `document_line.account_id`, before any `budget_txn` is written.

The resolution order SHALL be the one the line's `gl_account` display value already uses: the item's
`item_company.default_gl_account` when the line names an item, else the document type's
`default_gl_account`, else the charged `budget.gl_account`. The resolved code SHALL be required to
name an active, postable `account` in the active company, so a code that resolves to nothing is a
refusal at submit rather than a stranded posting after the money has moved.

The stamp SHALL be a foreign key fixed at submit and SHALL NOT be re-derived from configuration
afterwards. Re-deriving would let an edit to an item's default GL, made after the document was
approved, move the account a settlement debits — silently, with the entry still balancing.

The stamp MAY be restated by a person, and only by a person: an approver eligible for the route
step the document is on, where that step's `allows_account_recode` is true, holding
`DOC_LINE_RECODE`, while the document is `IN_APPROVAL` and before any `journal_entry` names it
(approval-workflow: *A Step May Allow Its Approver To Re-Code A Line's Account*). A restatement
changes one document, is attributed in `approval_log`, and still has to survive every approval not
yet given — the same narrowing invariant 6 received for the rate. Nothing else on the line moves
with the stamp: `budget_id`, every amount and every basis are what they were at submit, and the
reservation is untouched.

`document_line.gl_account` SHALL keep its present meaning and nullability. It is a display value; the
stamped account is what the ledger reads. A restatement SHALL set it to the new account's `code`, so
the display value and the posting account never disagree.

A document returned to DRAFT and resubmitted SHALL be re-stamped from configuration at that
submit; a restatement made on the earlier route does not outlive the return. The `approval_log`
row recording it remains.

#### Scenario: An item's account is stamped on the line

- **GIVEN** a line naming an item whose `item_company.default_gl_account` is `5210`
- **WHEN** the document is submitted
- **THEN** the line's `account_id` is the id of account `5210` in the active company

#### Scenario: An item-less line takes the document type's default

- **GIVEN** a line with no item, on a type whose `default_gl_account` is `658.0007`, charging a
  budget that names a different account
- **WHEN** the document is submitted
- **THEN** the line's `account_id` is the id of `658.0007` — the type's default outranks the budget

#### Scenario: An item-less line falls through to its budget's account

- **GIVEN** a line with no item, on a type setting no `default_gl_account`, charging a budget whose
  `gl_account` is `5210`
- **WHEN** the document is submitted
- **THEN** the line's `account_id` is the id of `5210`

#### Scenario: A code that names no postable account is refused

- **GIVEN** a line whose resolved code names an account that is inactive, or not postable, or
  absent from the active company
- **WHEN** the document is submitted
- **THEN** submit is refused and the document is still `DRAFT` with no `budget_txn` written

#### Scenario: The stamp does not move when configuration later changes

- **GIVEN** a submitted document whose line was stamped with account `5210` from its item
- **WHEN** that item's `item_company.default_gl_account` is changed to `5300`
- **THEN** the line's `account_id` is still `5210`

#### Scenario: A person restates the stamp on an allowing step

- **GIVEN** a document `IN_APPROVAL` on a route step allowing re-coding, a line stamped `5210`
- **WHEN** an eligible `DOC_LINE_RECODE` approver re-codes the line to `5300`
- **THEN** the line's `account_id` is `5300`'s id and its `gl_account` is `5300`
- **AND** its `budget_id`, `line_amount` and `budget_base_line_amount` are unchanged

#### Scenario: A return discards the restatement

- **GIVEN** a document whose line was re-coded from `5210` to `5300` mid-route
- **WHEN** the document is returned to DRAFT and resubmitted with the same item
- **THEN** the line is stamped `5210` again, and the earlier `RECODE_ACCOUNT` row is still in the
  approval log

#### Scenario: The line remains uneditable outside DRAFT for everything else

- **GIVEN** a document `IN_APPROVAL` on a step allowing re-coding
- **WHEN** a line write changing `budget_id` or `line_amount` is attempted
- **THEN** it is refused as it is for any non-DRAFT document
