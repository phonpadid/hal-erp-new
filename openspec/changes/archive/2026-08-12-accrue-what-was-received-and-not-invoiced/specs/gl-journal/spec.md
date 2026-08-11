## MODIFIED Requirements

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, tax, inventory, and payable accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`VAT_INPUT`, `WHT_PAYABLE`, `INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`,
`CLAIM_PAYABLE`, `ACCOUNTS_PAYABLE`, and `ACCRUED_EXPENSE` — never by a hardcoded account code
(invariant 7). A role that is unmapped, inactive, or in another company SHALL make the posting a
logged failure, not a crash.

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

`ACCRUED_EXPENSE` is the liability standing between a service or untracked good being received and
its invoice arriving — the same shape as `GRNI`, for the purchases `GRNI` does not cover because
they were never capitalized into stock. It is credited when a period closes and debited by the
reversal the following day (see `accounting-period`'s `Closing Accrues What Was Received And Not
Invoiced`).

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

#### Scenario: A close that would accrue needs the accrual role mapped

- **GIVEN** a company with received-and-uninvoiced lines and no account mapped to `ACCRUED_EXPENSE`
- **WHEN** one of its periods is closed
- **THEN** the close is rejected naming the role, and the period stays open — unlike an event-driven
  posting, a close is a synchronous act whose caller can fix the mapping and try again
