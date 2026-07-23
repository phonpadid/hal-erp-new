## MODIFIED Requirements

### Requirement: Group Item Registry
The system SHALL keep items in a group-wide `item` table, enabled per company via
`item_company`. The group `item` carries no GL account; an item's GL is set **per company** on
`item_company.default_gl_account` and validated against that company's chart of accounts.

The group `item` SHALL carry `is_stock_tracked`, defaulting to `false`, marking whether the item is
a physical good whose quantity is tracked in a warehouse. Stockability is a property of the thing
itself, so it lives on the group `item` and not on `item_company`; per-company control is already
expressed by `item_company.is_active`. Only an item with `is_stock_tracked = true` SHALL produce
`stock_txn` rows — a receipt, issue, adjustment, or transfer naming an untracked item SHALL be
rejected, and an untracked item SHALL continue to behave exactly as items do today on every
existing document type.

#### Scenario: Item GL is set and read per company

- GIVEN an item enabled for company A with an `item_company.default_gl_account`
- WHEN it is added to a document line while company A is active
- THEN the line's GL account is set from company A's `item_company.default_gl_account`
  server-authoritatively and is not editable by the requester

#### Scenario: Stock tracking defaults off

- **GIVEN** an item created without specifying `is_stock_tracked`
- **WHEN** it is used on an existing document type
- **THEN** `is_stock_tracked` is false and no stock behavior applies to it

#### Scenario: Only tracked items move stock

- **WHEN** a stock movement names an item whose `is_stock_tracked` is false
- **THEN** the movement is rejected and no `stock_txn` row is written
