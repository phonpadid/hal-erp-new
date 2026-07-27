## ADDED Requirements

### Requirement: Posting on Approval for Types That Accrue

A document type MAY declare that its expense is recognised at approval. When such a document reaches full approval, the system SHALL post one balanced entry that debits the expense accounts named by the document's `budget_txn` ACTUAL rows, aggregated per account at the locked basis, and credits the `CLAIM_PAYABLE` role for the document's company. The posting SHALL run after the approval transaction commits, so a posting failure SHALL be logged and SHALL leave the approval and its budget effect standing. A document of a type that does not declare it SHALL post nothing at approval, exactly as today.

#### Scenario: An approved claim is recognised

- **GIVEN** a document type that accrues at approval, and a document of that type that cut budget against one expense account
- **WHEN** the document reaches full approval
- **THEN** a journal entry exists debiting that expense account and crediting the company's `CLAIM_PAYABLE` account for the same amount

#### Scenario: The debit follows the budget cuts

- **GIVEN** an approved document whose lines cut two different budgets
- **WHEN** the accrual is posted
- **THEN** it carries one debit line per expense account, each for that account's total, and one credit line for the sum

#### Scenario: Types that do not declare it are unaffected

- **WHEN** a document of a type that does not accrue at approval reaches full approval
- **THEN** no journal entry is posted at approval, and any posting on payment settlement happens exactly as before

#### Scenario: A failed posting does not undo the approval

- **GIVEN** a company with no account mapped to `CLAIM_PAYABLE`
- **WHEN** a document that accrues reaches full approval
- **THEN** the document stays approved with its budget cut, no entry is written, and the failure is logged

#### Scenario: The accrual is posted once

- **WHEN** the approval outcome for the same document is delivered twice
- **THEN** exactly one accrual entry exists for it

#### Scenario: A document that cut no budget accrues nothing

- **GIVEN** a document of an accruing type that wrote no `budget_txn` ACTUAL row
- **WHEN** it reaches full approval
- **THEN** no entry is posted, because there is no charged amount to recognise

## MODIFIED Requirements

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, inventory, and payable accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`, and `CLAIM_PAYABLE` — never by a
hardcoded account code (invariant 7). A role that is unmapped, inactive, or in another company SHALL make the
posting a logged failure, not a crash.

`INVENTORY` is the company's inventory asset account, debited when stock is capitalized and
credited when it is consumed. `GRNI` (goods received not invoiced) is the liability that stands
between capitalizing goods at receipt and paying for them; without it a receipt entry has no
credit side and cannot balance. `INVENTORY_ADJUSTMENT` absorbs the gain or loss of a stock
adjustment. `INVENTORY_IN_TRANSIT` is reserved for multi-step transfers and SHALL be resolvable
but is unused by the current transfer posting, which moves stock in a single step. `CLAIM_PAYABLE`
is the liability that stands between an approved compensation and the money leaving — the same
shape as `GRNI`, for an obligation that arises at approval rather than at receipt.

#### Scenario: Roles resolve to the company's mapped accounts

- **WHEN** the engine needs the cash-clearing, FX, inventory, or payable account for a company
- **THEN** it uses the account mapped to that role for that company

#### Scenario: A missing role mapping fails the posting only

- **WHEN** a required role has no active mapping for the company
- **THEN** the posting is skipped and logged, and the payment, stock, or approval flow is unaffected

#### Scenario: Inventory roles are company-scoped like every other role

- **GIVEN** company A maps `INVENTORY` and company B does not
- **WHEN** a stock movement is approved in company B
- **THEN** the movement commits, its posting is skipped and logged, and company A's mapping is not used
