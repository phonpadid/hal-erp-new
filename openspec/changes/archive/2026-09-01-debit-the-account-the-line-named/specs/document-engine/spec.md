## ADDED Requirements

### Requirement: Submit Stamps The Account Each Line's Spending Will Post To

Submit SHALL resolve an expense account for every line carrying a positive amount and stamp it on
that line as `document_line.account_id`, before any `budget_txn` is written.

The resolution order SHALL be the one the line's `gl_account` display value already uses: the item's
`item_company.default_gl_account` when the line names an item, else the document type's
`default_gl_account`, else the charged `budget.gl_account`. The resolved code SHALL be required to
name an active, postable `account` in the active company, so a code that resolves to nothing is a
refusal at submit rather than a stranded posting after the money has moved.

The stamp SHALL be a foreign key fixed at submit, never re-derived afterwards. Re-deriving would let
an edit to an item's default GL, made after the document was approved, move the account a settlement
debits — silently, with the entry still balancing.

`document_line.gl_account` SHALL keep its present meaning and nullability. It is a display value; the
stamped account is what the ledger reads.

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

### Requirement: A Line That Can Resolve No Account Cannot Be Submitted

Submit SHALL refuse a document carrying a line with a positive amount for which the resolution chain
yields no account, and the refusal SHALL name the line and all three places an account can come from
— the item, the document type, and the budget.

The refusal SHALL be raised before any `budget_txn` is written, so the document stays `DRAFT` with
nothing reserved and nothing to unwind (invariant: reserve → actual → release never sees a partial
state).

A line carrying no positive amount SHALL NOT be refused by this rule: nothing will be debited for
it, so there is nothing for it to resolve.

#### Scenario: A line with no account anywhere is refused

- **GIVEN** a line with a positive amount, no item, on a type setting no `default_gl_account`,
  charging a budget whose `gl_account` is empty
- **WHEN** the author submits
- **THEN** submit is refused, the message names the line and says the account may be set on the
  item, the document type or the budget

#### Scenario: A budget naming no account is fine when the type names one

- **GIVEN** the same budget, on a type whose `default_gl_account` is set
- **WHEN** the author submits
- **THEN** submit proceeds, because the line resolves an account even though the budget names none

#### Scenario: A refused submit reserves nothing

- **GIVEN** the refused document above
- **WHEN** submit is refused
- **THEN** it is still `DRAFT`, no `budget_txn` row exists for it, and its `doc_no` — issued when
  the draft was created — is unchanged

#### Scenario: A zero-amount line raises no refusal

- **GIVEN** a zero-amount line that resolves no account
- **WHEN** the author submits
- **THEN** this rule raises no refusal

## REMOVED Requirements

### Requirement: A Document Charging A Budget With No GL Account Cannot Be Submitted

**Reason**: It asked the wrong question. The ledger needs an account per line, and a budget is only
the last of three places one can come from — so refusing on `budget.account_id` rejected documents
whose lines resolve an account perfectly well from their item or their document type, and forced a
budget that legitimately spans several accounts to name one of them falsely.

**Migration**: Replaced by `A Line That Can Resolve No Account Cannot Be Submitted`, which refuses
the same documents that would actually strand a posting and no others. A budget naming an account
still satisfies every line charging it, so nothing that submits today stops submitting.
