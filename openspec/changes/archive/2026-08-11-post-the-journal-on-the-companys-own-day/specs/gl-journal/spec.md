## ADDED Requirements

### Requirement: Entry Date Is The Posting Company's Own Calendar Day

Every `journal_entry.entry_date` SHALL be the calendar day the posted event fell on **in the posting
company's own `company.timezone`**, and SHALL NOT be derived from the UTC day of that instant. This
SHALL hold for every posting path — payment settlement, approval accrual, claim settlement, stock
movement, and any path added later — because `entry_date` is the only field deciding which period a
figure belongs to, and `financial-reports` ranges the trial balance, account ledger, income
statement and balance sheet over it.

Which *instant* a path posts on is unchanged and remains that path's own business: the payment's
`paid_at`, the document's `approved_at`, the movement's `created_at`, each with their existing
fallbacks. Only the conversion from that instant to a calendar day is fixed here.

A company's timezone SHALL be read from `company.timezone`; the system SHALL NOT substitute UTC when
resolving a company's day.

#### Scenario: An early-morning payment is dated that day, not the day before

- **GIVEN** a company whose `timezone` is `Asia/Vientiane` (UTC+7)
- **WHEN** a payment settles at 06:30 on 1 August local time, which is 23:30 on 31 July UTC
- **THEN** the entry's `entry_date` is `2026-08-01`, so the payment falls in the August income
  statement and not the July one

#### Scenario: A late-evening approval west of UTC stays in its own month

- **GIVEN** a company whose `timezone` is west of UTC, such as `America/New_York`
- **WHEN** a document that accrues at approval is approved at 23:00 local on the last day of a
  month, which is past midnight UTC and therefore already the next month there
- **THEN** the accrual's `entry_date` is that last day, not the first day of the next month —
  the opposite direction from the early-morning case above, and the one that moves a figure
  forward across a close rather than back

#### Scenario: Every posting path uses the company's day

- **WHEN** a payment settlement, an approval accrual, a claim settlement and a stock movement are
  each posted for the same company
- **THEN** all four entries derive `entry_date` in that company's timezone, by the same rule

#### Scenario: Two companies in different zones date the same instant differently

- **GIVEN** company A in a UTC+7 zone and company B in a UTC+0 zone
- **WHEN** an event is posted for each at the same instant, 22:00 UTC
- **THEN** A's entry is dated the following day and B's entry is dated that day, each being its own
  company's calendar day

## MODIFIED Requirements

### Requirement: Config-Driven System Account Roles

The system SHALL resolve the cash-clearing, FX, tax, inventory, and payable accounts through an `account_role`
map from `(company, role)` to an `account`, with roles `CASH_CLEARING`, `FX_GAIN`, `FX_LOSS`,
`VAT_INPUT`, `WHT_PAYABLE`, `INVENTORY`, `GRNI`, `INVENTORY_ADJUSTMENT`, `INVENTORY_IN_TRANSIT`, and
`CLAIM_PAYABLE` — never by a hardcoded account code (invariant 7). A role that is unmapped, inactive,
or in another company SHALL make the posting a logged failure, not a crash.

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
