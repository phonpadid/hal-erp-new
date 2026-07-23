# Master Data Specification

## Purpose
Group-wide vendor and item registries with per-company enablement, so masters are
shared once and controlled per company.

## Requirements

### Requirement: Group Vendor Registry
The system SHALL keep vendors in a group-wide `vendor` table with credit terms, and
enable them per company via `vendor_company`.

#### Scenario: Vendor must be enabled for the company
- GIVEN a vendor registered group-wide but not enabled for company A
- WHEN a company A document tries to select that vendor
- THEN the selection MUST be rejected until the vendor is enabled for company A

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

### Requirement: Master Deactivation

Vendors and items SHALL be deactivated by setting `is_active = false` and SHALL NOT be
hard-deleted, so documents and lines that reference them stay intact. A deactivated
vendor or item MUST NOT be selectable on new documents.

#### Scenario: Deactivate a vendor instead of deleting it

- **WHEN** an administrator with `MASTER_MANAGE` removes a vendor
- **THEN** the `vendor` row is retained with `is_active = false` and no row is deleted

#### Scenario: A deactivated item cannot be selected

- **WHEN** a document line tries to use an item whose `is_active` is false
- **THEN** the selection MUST be rejected

### Requirement: Per-Company Enablement

A group-wide vendor or item SHALL be usable in a company only after it is enabled for
that company via `vendor_company` / `item_company`. Enablement records SHALL be
company-scoped, and enabling/disabling SHALL be authorized by `MASTER_MANAGE`. Enabling
a vendor MAY record an `approved_date`.

Enablement rows carry per-company attributes: `item_company.default_gl_account` is the item's
GL for that company, and `vendor_company.payment_term_days` overrides the group vendor's terms
for that company. The item GL, when set, SHALL resolve to an active, postable `account` in the
active company (via the chart-of-accounts resolver, as budgets do) and enablement SHALL be
rejected when it does not; it MAY be left unset (the item then has no GL, and a `requires_budget`
line referencing it is rejected at document time). The vendor's effective payment terms SHALL be
the `vendor_company.payment_term_days` override when set, otherwise the group
`vendor.payment_term_days`.

#### Scenario: Enable a vendor for a company

- **WHEN** an administrator enables a group vendor for company A
- **THEN** a `vendor_company` row for (vendor, A) is created/activated and the vendor
  becomes selectable in company A

#### Scenario: Enablement does not cross companies

- **WHEN** a vendor is enabled for company A only
- **THEN** the `assertVendorEnabled` guard rejects that vendor for company B

#### Scenario: Disable re-blocks selection

- **WHEN** an enabled vendor is disabled for company A (`vendor_company.is_active = false`)
- **THEN** that vendor is no longer selectable in company A

#### Scenario: Per-company item GL is validated

- **WHEN** an administrator sets an item's `item_company.default_gl_account` for company A
- **THEN** it is accepted only if it resolves to an active, postable account in company A, and
  rejected otherwise

#### Scenario: Vendor payment terms fall back to the group value

- **GIVEN** a vendor enabled for company A with no `payment_term_days` override
- **WHEN** the vendor's effective terms are read for company A
- **THEN** the group `vendor.payment_term_days` is used

#### Scenario: Per-company attributes are company-scoped

- **GIVEN** an item with an `item_company.default_gl_account` for company A
- **WHEN** the item's GL is read while company B is active
- **THEN** company A's value does not apply to company B (company B uses its own value, or the
  item has no GL there)

### Requirement: Authorized, Company-Scoped Master Endpoints

Every master-data endpoint SHALL authorize on a permission code (never a role name).
Reads of the per-company enablement tables (`vendor_company`, `item_company`) SHALL
return only rows of the active company, and writes targeting another company MUST be
rejected. UUID path parameters SHALL be validated.

#### Scenario: Reads are limited to the active company

- **WHEN** a user whose active company is A lists enabled vendors
- **THEN** only `vendor_company` rows where `company_id = A` are returned

#### Scenario: Missing permission code is forbidden

- **WHEN** a request without `MASTER_MANAGE` calls an enable/disable endpoint
- **THEN** it is rejected with 403 before the handler runs

